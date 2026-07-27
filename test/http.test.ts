import { describe, expect, test } from 'bun:test'

import packageJson from '../package.json' with { type: 'json' }
import {
  HttpClient,
  HttpError,
  JsonResponseError,
  resolveApiHost,
  USER_AGENT,
} from '../src/http.ts'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

function createFetch(
  response: Response,
  inspect?: (input: FetchInput, init: FetchInit) => void,
): typeof fetch {
  return (async (input: FetchInput, init: FetchInit) => {
    inspect?.(input, init)
    return response
  }) as typeof fetch
}

describe('HttpClient', () => {
  test('sends JSON, authentication, and the versioned user agent', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const client = new HttpClient({
      apiHost: 'https://example.com/',
      token: 'secret',
      fetch: createFetch(Response.json({ ok: true }), (input, init) => {
        requestUrl = input.toString()
        requestInit = init
      }),
    })

    const result = await client.requestJson<{ ok: boolean }>('/api/test', {
      body: { value: 42 },
      method: 'POST',
    })
    const headers = new Headers(requestInit?.headers)

    expect(result).toEqual({ ok: true })
    expect(requestUrl).toBe('https://example.com/api/test')
    expect(requestInit?.body).toBe('{"value":42}')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('authorization')).toBe('Bearer secret')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('user-agent')).toBe(`rawback-cli@${packageJson.version}`)
    expect(headers.get('x-rawback-client-source')).toBe('cli')
    expect(headers.get('x-rawback-client-version')).toBe(packageJson.version)
    expect(USER_AGENT).toBe(`rawback-cli@${packageJson.version}`)
  })

  test('can omit authentication', async () => {
    let authorization: string | null = 'uninspected'
    const client = new HttpClient({
      token: 'secret',
      fetch: createFetch(Response.json({}), (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization')
      }),
    })

    await client.requestJson('/api/public', { authenticated: false })

    expect(authorization).toBeNull()
  })

  test('supports empty successful responses', async () => {
    const client = new HttpClient({
      fetch: createFetch(new Response(null, { status: 204 })),
    })

    expect(await client.requestJson('/api/empty')).toBeUndefined()
  })

  test('preserves parsed API errors', async () => {
    const body = { code: 401, data: null, msg: 'token has expired' }
    const client = new HttpClient({
      fetch: createFetch(Response.json(body, { status: 401 })),
    })

    try {
      await client.requestJson('/api/private')
      throw new Error('Expected request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect(error).toMatchObject({
        body,
        message: 'token has expired',
        status: 401,
      })
    }
  })

  test('rejects malformed JSON', async () => {
    const client = new HttpClient({
      fetch: createFetch(new Response('not json')),
    })

    try {
      await client.requestJson('/api/broken')
      throw new Error('Expected request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonResponseError)
      expect(error).toMatchObject({ bodyText: 'not json', status: 200 })
    }
  })

  test('ignores environment host overrides and validates protocols', () => {
    const previous = process.env.RAWBACK_API_HOST
    process.env.RAWBACK_API_HOST = 'http://localhost:23164/'

    try {
      expect(resolveApiHost()).toBe('https://api.rawback.app')
      expect(resolveApiHost('https://override.example/')).toBe('https://override.example')
      expect(() => resolveApiHost('file:///tmp/rawback')).toThrow('Unsupported API protocol')
    } finally {
      if (previous === undefined) {
        delete process.env.RAWBACK_API_HOST
      } else {
        process.env.RAWBACK_API_HOST = previous
      }
    }
  })
})
