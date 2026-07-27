import { type Credentials, writeCredentials } from './credentials.ts'
import { type ApiEnvelope, HttpClient, HttpError } from './http.ts'

interface TokenPairResponse {
  accessToken: string
  refreshToken: string
}

type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit = Parameters<typeof globalThis.fetch>[1]
type SessionFetch = (input: FetchInput, init?: FetchInit) => Promise<Response>

export interface CredentialSessionOptions {
  apiHost: string
  credentials: Credentials
  credentialsPath: string
  fetch?: typeof globalThis.fetch
}

function parseTokenPair(value: unknown): Credentials {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length === 0 ||
    !('refreshToken' in value) ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length === 0
  ) {
    throw new Error('The token refresh response did not contain a valid token pair')
  }

  return {
    token: value.accessToken,
    refreshToken: value.refreshToken,
  }
}

function requestHeaders(input: FetchInput, init?: FetchInit): Headers {
  if (init?.headers !== undefined) {
    return new Headers(init.headers)
  }
  if (typeof input === 'object' && input !== null && 'headers' in input) {
    return new Headers(input.headers)
  }
  return new Headers()
}

function hasBearerAuthorization(headers: Headers): boolean {
  return /^Bearer\s+\S+/i.test(headers.get('authorization') ?? '')
}

async function isUnauthorizedResponse(response: Response): Promise<boolean> {
  if (response.status === 401) {
    return true
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) {
    return false
  }

  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return false
  }

  if (typeof body !== 'object' || body === null || !('errors' in body)) {
    return false
  }

  const errors = body.errors
  if (!Array.isArray(errors)) {
    return false
  }

  return errors.some((error) => {
    if (typeof error !== 'object' || error === null || !('extensions' in error)) {
      return false
    }
    const extensions = error.extensions
    if (typeof extensions !== 'object' || extensions === null || !('code' in extensions)) {
      return false
    }
    return (
      extensions.code === 401 || extensions.code === '401' || extensions.code === 'UNAUTHENTICATED'
    )
  })
}

export class CredentialSession {
  readonly apiHost: string
  readonly credentialsPath: string
  readonly baseFetch: typeof globalThis.fetch

  #credentials: Credentials
  #refreshPromise: Promise<boolean> | undefined

  constructor(options: CredentialSessionOptions) {
    this.apiHost = options.apiHost
    this.credentialsPath = options.credentialsPath
    this.baseFetch = options.fetch ?? globalThis.fetch
    this.#credentials = options.credentials
  }

  get credentials(): Credentials {
    return this.#credentials
  }

  async refresh(): Promise<boolean> {
    if (!this.#refreshPromise) {
      this.#refreshPromise = this.#refresh().finally(() => {
        this.#refreshPromise = undefined
      })
    }
    return this.#refreshPromise
  }

  createFetch(): typeof globalThis.fetch {
    return (async (input: FetchInput, init?: FetchInit) => {
      const fetch = this.baseFetch as SessionFetch
      const initialHeaders = requestHeaders(input, init)
      const authenticated = hasBearerAuthorization(initialHeaders)
      const retryInput =
        typeof input === 'object' &&
        input !== null &&
        'clone' in input &&
        typeof input.clone === 'function'
          ? (input.clone() as FetchInput)
          : input

      if (authenticated) {
        initialHeaders.set('authorization', `Bearer ${this.#credentials.token}`)
      }

      const initialResponse = await fetch(input, {
        ...init,
        headers: initialHeaders,
      })

      if (!authenticated || !(await isUnauthorizedResponse(initialResponse))) {
        return initialResponse
      }

      if (!(await this.refresh())) {
        return initialResponse
      }

      const retryHeaders = requestHeaders(retryInput, init)
      retryHeaders.set('authorization', `Bearer ${this.#credentials.token}`)
      return fetch(retryInput, {
        ...init,
        headers: retryHeaders,
      })
    }) as typeof globalThis.fetch
  }

  async #refresh(): Promise<boolean> {
    const client = new HttpClient({
      apiHost: this.apiHost,
      fetch: this.baseFetch,
    })

    let response: ApiEnvelope<TokenPairResponse>
    try {
      response = await client.requestJson<ApiEnvelope<TokenPairResponse>>('/api/v1/auth/refresh', {
        authenticated: false,
        body: { refreshToken: this.#credentials.refreshToken },
        method: 'POST',
      })
    } catch (error) {
      if (error instanceof HttpError && (error.status === 400 || error.status === 401)) {
        return false
      }
      throw error
    }

    const credentials = parseTokenPair(response.data)
    await writeCredentials(credentials, this.credentialsPath)
    this.#credentials = credentials
    return true
  }
}
