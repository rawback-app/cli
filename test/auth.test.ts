import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AuthPrompts, runAuth, runAuthStatus } from '../src/auth.ts'
import { readCredentials, writeCredentials } from '../src/credentials.ts'
import { HttpError } from '../src/http.ts'

const temporaryDirectories: string[] = []

async function temporaryPaths(): Promise<{ configPath: string; credentialsPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-auth-'))
  temporaryDirectories.push(directory)
  return {
    configPath: join(directory, 'config.yml'),
    credentialsPath: join(directory, '.rawback', 'credentials.json'),
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

function createFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    handler(input.toString(), init)) as typeof fetch
}

function unexpectedPrompts(): AuthPrompts {
  return {
    async confirm() {
      throw new Error('Unexpected confirmation prompt')
    },
  }
}

const authUser = {
  id: 7,
  name: 'Raw Back',
  email: 'user@example.com',
  slug: 'raw-back',
  tier: 'free',
  subscriptionStatus: 'active',
  accountStatus: 'active',
}

const expiresAt = '2099-01-01T00:10:00Z'

function deviceCreated() {
  return Response.json(
    {
      code: 201,
      data: {
        sessionId: 'session-123',
        pollToken: 'private-poll-token',
        expiresAt,
        pollIntervalSeconds: 10,
      },
      msg: '',
    },
    { status: 201 },
  )
}

function deviceApproved() {
  return Response.json({
    code: 200,
    data: {
      status: 'approved',
      user: { id: 7, name: 'Raw Back', email: 'user@example.com' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    },
    msg: '',
  })
}

function deviceUnavailable(
  headers?: ConstructorParameters<typeof Headers>[0],
  message = 'device authorization is temporarily unavailable',
) {
  return Response.json(
    {
      code: 503,
      data: null,
      msg: message,
      reason: 'device_session_unavailable',
    },
    { status: 503, ...(headers ? { headers } : {}) },
  )
}

describe('auth commands', () => {
  test('creates a device session, opens its web page, polls, and saves credentials', async () => {
    const paths = await temporaryPaths()
    const output: string[] = []
    const opened: Array<{ command: string; args: string[] }> = []
    const sleeps: number[] = []
    let polls = 0

    await runAuth(
      { force: true },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        platform: 'linux',
        operatingSystem: () => 'linux',
        architecture: () => 'x64',
        open: async (command, args) => {
          opened.push({ command, args })
          return 0
        },
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
        },
        stdout: (message) => output.push(message),
        fetch: createFetch((url, init) => {
          const headers = new Headers(init?.headers)
          expect(headers.get('authorization')).toBeNull()
          expect(headers.get('x-rawback-client-source')).toBe('cli')
          expect(headers.get('x-rawback-client-version')).not.toBeNull()

          if (url.endsWith('/api/v1/auth/device/sessions')) {
            expect(JSON.parse(String(init?.body))).toEqual({
              operatingSystem: 'linux',
              architecture: 'x64',
            })
            return deviceCreated()
          }
          expect(url).toEndWith('/api/v1/auth/device/sessions/session-123/token')
          expect(JSON.parse(String(init?.body))).toEqual({
            pollToken: 'private-poll-token',
          })
          polls += 1
          return polls === 1
            ? Response.json({ code: 200, data: { status: 'pending' }, msg: '' })
            : deviceApproved()
        }),
      },
    )

    const authorizationURL = 'https://rawback.app/auth/device/session-123'
    expect(opened).toEqual([{ command: 'xdg-open', args: [authorizationURL] }])
    expect(sleeps).toEqual([10_000])
    expect(output).toContain(authorizationURL)
    expect(output.at(-1)).toBe('✓ Authenticated as Raw Back (user@example.com).')
    expect(await readCredentials(paths.credentialsPath)).toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
    })
  })

  test('prints a copyable link and continues when the browser cannot open', async () => {
    const paths = await temporaryPaths()
    const output: string[] = []
    const warnings: string[] = []

    await runAuth(
      { force: true },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        open: async () => 1,
        stdout: (message) => output.push(message),
        stderr: (message) => warnings.push(message),
        fetch: createFetch((url) => (url.endsWith('/token') ? deviceApproved() : deviceCreated())),
      },
    )

    expect(output).toContain('https://rawback.app/auth/device/session-123')
    expect(warnings.join('\n')).toContain('Use the link shown above')
    expect(await readCredentials(paths.credentialsPath)).not.toBeNull()
  })

  test('retries transient polling failures until approval', async () => {
    const paths = await temporaryPaths()
    let polls = 0
    let sleeps = 0

    await runAuth(
      { force: true },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        open: async () => 0,
        sleep: async () => {
          sleeps += 1
        },
        stdout() {},
        fetch: createFetch((url) => {
          if (!url.endsWith('/token')) return deviceCreated()
          polls += 1
          return polls === 1
            ? Response.json(
                {
                  code: 503,
                  data: null,
                  msg: 'temporarily unavailable',
                  reason: 'device_session_unavailable',
                },
                { status: 503 },
              )
            : deviceApproved()
        }),
      },
    )

    expect(polls).toBe(2)
    expect(sleeps).toBe(1)
  })

  test('retries transient device-session creation failures', async () => {
    const paths = await temporaryPaths()
    const sleeps: number[] = []
    let creates = 0

    await runAuth(
      { force: true },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        open: async () => 0,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
        },
        stdout() {},
        fetch: createFetch((url) => {
          if (url.endsWith('/token')) return deviceApproved()
          creates += 1
          return creates === 1 ? deviceUnavailable({ 'retry-after': '30' }) : deviceCreated()
        }),
      },
    )

    expect(creates).toBe(2)
    expect(sleeps).toEqual([10_000])
  })

  test('reports the raw server error and final trace ID when creation remains unavailable', async () => {
    const paths = await temporaryPaths()
    const oldCredentials = { token: 'old-token', refreshToken: 'old-refresh' }
    await writeCredentials(oldCredentials, paths.credentialsPath)
    const sleeps: number[] = []
    let requests = 0

    try {
      await runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          open: async () => {
            throw new Error('Unexpected browser open')
          },
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds)
          },
          fetch: createFetch(() => {
            requests += 1
            return deviceUnavailable(
              { 'x-trace-id': 'trace-final' },
              'device auth is unavailable: redis connection refused',
            )
          }),
        },
      )
      throw new Error('Expected authentication to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('after 3 attempts')
      expect((error as Error).message).toContain(
        'device auth is unavailable: redis connection refused',
      )
      expect((error as Error).message).toContain('Trace ID: trace-final')
    }

    expect(requests).toBe(3)
    expect(sleeps).toEqual([1_000, 2_000])
    expect(await readCredentials(paths.credentialsPath)).toEqual(oldCredentials)
  })

  test('retries a network failure while creating a device session', async () => {
    const paths = await temporaryPaths()
    const sleeps: number[] = []
    let creates = 0

    await runAuth(
      { force: true },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        open: async () => 0,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
        },
        stdout() {},
        fetch: createFetch((url) => {
          if (url.endsWith('/token')) return deviceApproved()
          creates += 1
          if (creates === 1) throw new TypeError('fetch failed')
          return deviceCreated()
        }),
      },
    )

    expect(creates).toBe(2)
    expect(sleeps).toEqual([1_000])
  })

  test('does not retry malformed device-session responses', async () => {
    const paths = await temporaryPaths()
    let requests = 0

    expect(
      runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          sleep: async () => {
            throw new Error('Unexpected retry')
          },
          fetch: createFetch(() => {
            requests += 1
            return new Response('not json', { status: 503 })
          }),
        },
      ),
    ).rejects.toThrow('Expected a JSON response')
    expect(requests).toBe(1)
  })

  test('reports a continuous raw polling failure when the session expires', async () => {
    const paths = await temporaryPaths()
    const times = [Date.parse('2098-01-01T00:00:00Z'), Date.parse('2100-01-01T00:00:00Z')]

    try {
      await runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          open: async () => 0,
          now: () => times.shift() ?? Date.parse('2100-01-01T00:00:00Z'),
          sleep: async () => {},
          stdout() {},
          fetch: createFetch((url) =>
            url.endsWith('/token')
              ? deviceUnavailable(
                  { 'x-trace-id': 'trace-poll' },
                  'device auth is unavailable: redis poll failed',
                )
              : deviceCreated(),
          ),
        },
      )
      throw new Error('Expected authentication to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('redis poll failed')
      expect((error as Error).message).toContain('Trace ID: trace-poll')
    }
  })

  test('clears a transient polling error after the server recovers', async () => {
    const paths = await temporaryPaths()
    const times = [
      Date.parse('2098-01-01T00:00:00Z'),
      Date.parse('2098-01-01T00:00:01Z'),
      Date.parse('2100-01-01T00:00:00Z'),
    ]
    let polls = 0

    try {
      await runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          open: async () => 0,
          now: () => times.shift() ?? Date.parse('2100-01-01T00:00:00Z'),
          sleep: async () => {},
          stdout() {},
          fetch: createFetch((url) => {
            if (!url.endsWith('/token')) return deviceCreated()
            polls += 1
            return polls === 1
              ? deviceUnavailable(undefined, 'device auth is unavailable: stale error')
              : Response.json({ code: 200, data: { status: 'pending' }, msg: '' })
          }),
        },
      )
      throw new Error('Expected authentication to expire')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Device authorization expired')
      expect((error as Error).message).not.toContain('stale error')
    }
  })

  test('preserves existing credentials when authorization is denied', async () => {
    const paths = await temporaryPaths()
    const oldCredentials = { token: 'old-token', refreshToken: 'old-refresh' }
    await writeCredentials(oldCredentials, paths.credentialsPath)

    expect(
      runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          open: async () => 0,
          fetch: createFetch((url) =>
            url.endsWith('/token')
              ? Response.json({ code: 200, data: { status: 'denied' }, msg: '' })
              : deviceCreated(),
          ),
        },
      ),
    ).rejects.toThrow('was denied')
    expect(await readCredentials(paths.credentialsPath)).toEqual(oldCredentials)
  })

  test('keeps a valid session when reauthentication is declined', async () => {
    const paths = await temporaryPaths()
    await writeCredentials(
      { token: 'access-token', refreshToken: 'refresh-token' },
      paths.credentialsPath,
    )
    const output: string[] = []
    const confirmations: string[] = []
    let requests = 0

    await runAuth(
      {},
      {
        ...paths,
        prompts: {
          async confirm(message) {
            confirmations.push(message)
            return false
          },
        },
        stdout: (message) => output.push(message),
        fetch: createFetch(() => {
          requests += 1
          return Response.json({ data: { me: authUser } })
        }),
      },
    )

    expect(requests).toBe(1)
    expect(confirmations).toEqual([
      'Already authenticated as Raw Back (user@example.com). Reauthenticate?',
    ])
    expect(output).toEqual(['ℹ Authentication unchanged.'])
  })

  test('allows authentication to replace malformed credentials', async () => {
    const paths = await temporaryPaths()
    await writeCredentials(
      { token: 'old-token', refreshToken: 'old-refresh' },
      paths.credentialsPath,
    )
    await Bun.write(paths.credentialsPath, 'not json')
    const warnings: string[] = []

    await runAuth(
      {},
      {
        ...paths,
        prompts: unexpectedPrompts(),
        open: async () => 0,
        stderr: (message) => warnings.push(message),
        stdout() {},
        fetch: createFetch((url) => (url.endsWith('/token') ? deviceApproved() : deviceCreated())),
      },
    )

    expect(warnings.join('\n')).toContain('invalid JSON')
    expect(await readCredentials(paths.credentialsPath)).toEqual({
      token: 'access-token',
      refreshToken: 'refresh-token',
    })
  })

  test('does not retry a final polling error', async () => {
    const paths = await temporaryPaths()
    expect(
      runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          open: async () => 0,
          sleep: async () => {
            throw new Error('Unexpected retry')
          },
          fetch: createFetch((url) => {
            if (!url.endsWith('/token')) return deviceCreated()
            return Response.json(
              {
                code: 404,
                data: null,
                msg: 'device session not found',
                reason: 'device_session_not_found',
              },
              { status: 404 },
            )
          }),
        },
      ),
    ).rejects.toThrow('expired or was already used')
  })

  test('prints basic account information for auth status', async () => {
    const paths = await temporaryPaths()
    await writeCredentials(
      { token: 'access-token', refreshToken: 'refresh-token' },
      paths.credentialsPath,
    )
    const output: string[] = []

    await runAuthStatus({
      ...paths,
      stdout: (message) => output.push(message),
      fetch: createFetch(() => Response.json({ data: { me: authUser } })),
    })

    expect(output).toHaveLength(1)
    expect(output[0]).toContain('✓ Authenticated')
    expect(output[0]).toContain('Name          Raw Back')
    expect(output[0]).toContain('Email         user@example.com')
    expect(output[0]).toContain('Profile       @raw-back')
  })

  test('reports missing, malformed, and expired authentication', async () => {
    const missingPaths = await temporaryPaths()
    expect(runAuthStatus(missingPaths)).rejects.toThrow('Not authenticated')

    const malformedPaths = await temporaryPaths()
    await Bun.write(malformedPaths.credentialsPath, 'not json')
    expect(runAuthStatus(malformedPaths)).rejects.toThrow('rawback auth --force')

    const expiredPaths = await temporaryPaths()
    await writeCredentials(
      { token: 'expired-token', refreshToken: 'expired-refresh' },
      expiredPaths.credentialsPath,
    )
    expect(
      runAuthStatus({
        ...expiredPaths,
        fetch: createFetch((url) => {
          if (url.endsWith('/api/v1/auth/refresh')) {
            return Response.json(
              { code: 401, data: null, msg: 'invalid refresh token' },
              { status: 401 },
            )
          }
          return Response.json({
            data: null,
            errors: [{ message: 'unauthorized', extensions: { code: 401 } }],
          })
        }),
      }),
    ).rejects.toThrow('Authentication has expired')
  })

  test('does not retry a device-session rate limit response', async () => {
    const paths = await temporaryPaths()
    let requests = 0

    try {
      await runAuth(
        { force: true },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          open: async () => 0,
          fetch: createFetch(() => {
            requests += 1
            return Response.json(
              {
                code: 429,
                data: null,
                msg: 'too many device sessions',
                reason: 'device_session_rate_limited',
              },
              { status: 429 },
            )
          }),
        },
      )
      throw new Error('Expected authentication to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
    }
    expect(requests).toBe(1)
  })
})
