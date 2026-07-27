import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRawbackClient } from '../src/client.ts'
import { readCredentials } from '../src/credentials.ts'
import { AuthStatusDocument } from '../src/gql/graphql.ts'
import { HttpError } from '../src/http.ts'
import { CredentialSession } from '../src/session.ts'

const temporaryDirectories: string[] = []

async function temporaryCredentialsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-session-'))
  temporaryDirectories.push(directory)
  return join(directory, '.rawback', 'credentials.json')
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

const authUser = {
  id: 7,
  name: 'Raw Back',
  email: 'user@example.com',
  slug: 'raw-back',
  tier: 'free',
  subscriptionStatus: 'active',
  accountStatus: 'active',
}

describe('credential session', () => {
  test('refreshes a REST request, saves credentials, and retries once', async () => {
    const credentialsPath = await temporaryCredentialsPath()
    const requests: Array<{ authorization: string | null; url: string }> = []
    const fetch = createFetch((url, init) => {
      const authorization = new Headers(init?.headers).get('authorization')
      requests.push({ authorization, url })

      if (url.endsWith('/api/v1/auth/refresh')) {
        return Response.json({
          code: 200,
          data: { accessToken: 'new-token', refreshToken: 'new-refresh' },
          msg: '',
        })
      }
      if (authorization === 'Bearer old-token') {
        return Response.json({ code: 401, data: null, msg: 'token has expired' }, { status: 401 })
      }
      return Response.json({ ok: true })
    })
    const client = await createRawbackClient({
      apiHost: 'https://example.com',
      config: {},
      credentials: { token: 'old-token', refreshToken: 'old-refresh' },
      credentialsPath,
      fetch,
    })

    expect(await client.http.requestJson<{ ok: boolean }>('/api/test')).toEqual({ ok: true })
    expect(requests.map((request) => request.authorization)).toEqual([
      'Bearer old-token',
      null,
      'Bearer new-token',
    ])
    expect(client.credentials).toEqual({
      token: 'new-token',
      refreshToken: 'new-refresh',
    })
    expect(await readCredentials(credentialsPath)).toEqual(client.credentials)
  })

  test('refreshes and retries GraphQL authorization errors', async () => {
    const credentialsPath = await temporaryCredentialsPath()
    let graphqlRequests = 0
    let refreshRequests = 0
    const fetch = createFetch((url, init) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshRequests += 1
        return Response.json({
          code: 200,
          data: { accessToken: 'new-token', refreshToken: 'new-refresh' },
          msg: '',
        })
      }

      graphqlRequests += 1
      const authorization = new Headers(init?.headers).get('authorization')
      if (authorization === 'Bearer old-token') {
        return Response.json({
          data: null,
          errors: [{ message: 'unauthorized', extensions: { code: 401 } }],
        })
      }
      return Response.json({ data: { me: authUser } })
    })
    const client = await createRawbackClient({
      apiHost: 'https://example.com',
      config: {},
      credentials: { token: 'old-token', refreshToken: 'old-refresh' },
      credentialsPath,
      fetch,
    })

    const result = await client.graphql.query({ query: AuthStatusDocument })

    expect(result.data).toEqual({ me: authUser })
    expect(result.error).toBeUndefined()
    expect(graphqlRequests).toBe(2)
    expect(refreshRequests).toBe(1)
  })

  test('coalesces concurrent refresh calls', async () => {
    const credentialsPath = await temporaryCredentialsPath()
    let refreshRequests = 0
    const session = new CredentialSession({
      apiHost: 'https://example.com',
      credentials: { token: 'old-token', refreshToken: 'old-refresh' },
      credentialsPath,
      fetch: createFetch(async () => {
        refreshRequests += 1
        await Promise.resolve()
        return Response.json({
          code: 200,
          data: { accessToken: 'new-token', refreshToken: 'new-refresh' },
          msg: '',
        })
      }),
    })

    expect(await Promise.all([session.refresh(), session.refresh()])).toEqual([true, true])
    expect(refreshRequests).toBe(1)
  })

  test('does not refresh unauthenticated requests', async () => {
    const credentialsPath = await temporaryCredentialsPath()
    let refreshRequests = 0
    const client = await createRawbackClient({
      apiHost: 'https://example.com',
      config: {},
      credentials: { token: 'old-token', refreshToken: 'old-refresh' },
      credentialsPath,
      fetch: createFetch((url) => {
        if (url.endsWith('/api/v1/auth/refresh')) {
          refreshRequests += 1
        }
        return Response.json({ code: 401, data: null, msg: 'unauthorized' }, { status: 401 })
      }),
    })

    try {
      await client.http.requestJson('/api/public', { authenticated: false })
      throw new Error('Expected request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
    }
    expect(refreshRequests).toBe(0)
  })

  test('returns the original authorization failure when refresh is invalid', async () => {
    const credentialsPath = await temporaryCredentialsPath()
    let protectedRequests = 0
    const client = await createRawbackClient({
      apiHost: 'https://example.com',
      config: {},
      credentials: { token: 'old-token', refreshToken: 'old-refresh' },
      credentialsPath,
      fetch: createFetch((url) => {
        if (url.endsWith('/api/v1/auth/refresh')) {
          return Response.json(
            { code: 401, data: null, msg: 'invalid refresh token' },
            { status: 401 },
          )
        }
        protectedRequests += 1
        return Response.json({ code: 401, data: null, msg: 'token has expired' }, { status: 401 })
      }),
    })

    expect(client.http.requestJson('/api/private')).rejects.toMatchObject({
      message: 'token has expired',
      status: 401,
    })
    expect(protectedRequests).toBe(1)
  })
})
