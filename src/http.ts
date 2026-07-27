import packageJson from '../package.json' with { type: 'json' }

export const DEFAULT_API_HOST = 'https://api.rawback.app'
export const CLIENT_SOURCE = 'cli'
export const CLIENT_VERSION = packageJson.version
export const USER_AGENT = `rawback-cli@${CLIENT_VERSION}`

export interface ApiEnvelope<T> {
  code: number
  data: T | null
  msg: string
  reason?: string
}

export interface HttpClientOptions {
  apiHost?: string
  token?: string
  fetch?: typeof globalThis.fetch
}

export interface JsonRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  authenticated?: boolean
}

export class HttpError<T = unknown> extends Error {
  readonly status: number
  readonly url: string
  readonly headers: Headers
  readonly body: T

  constructor(response: Response, body: T) {
    super(getErrorMessage(response, body))
    this.name = 'HttpError'
    this.status = response.status
    this.url = response.url
    this.headers = response.headers
    this.body = body
  }
}

export class JsonResponseError extends Error {
  readonly status: number
  readonly url: string
  readonly bodyText: string

  constructor(response: Response, bodyText: string, options?: ErrorOptions) {
    super(`Expected a JSON response from ${response.url || 'request'}`, options)
    this.name = 'JsonResponseError'
    this.status = response.status
    this.url = response.url
    this.bodyText = bodyText
  }
}

function getErrorMessage(response: Response, body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'msg' in body &&
    typeof body.msg === 'string' &&
    body.msg.length > 0
  ) {
    return body.msg
  }

  return response.statusText || `HTTP request failed with status ${response.status}`
}

export function resolveApiHost(apiHost?: string): string {
  const value = apiHost ?? DEFAULT_API_HOST
  const url = new URL(value)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`Unsupported API protocol: ${url.protocol}`)
  }

  return url.toString().replace(/\/$/, '')
}

export function resolveApiUrl(apiHost: string, path: string): string {
  const base = `${resolveApiHost(apiHost)}/`
  return new URL(path.replace(/^\//, ''), base).toString()
}

export class HttpClient {
  readonly apiHost: string
  readonly token: string | undefined
  readonly fetch: typeof globalThis.fetch

  constructor(options: HttpClientOptions = {}) {
    this.apiHost = resolveApiHost(options.apiHost)
    this.token = options.token
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async requestJson<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
    const { authenticated = true, body: requestBody, ...requestOptions } = options
    const headers = new Headers(requestOptions.headers)
    headers.set('accept', 'application/json')
    headers.set('user-agent', USER_AGENT)
    headers.set('x-rawback-client-source', CLIENT_SOURCE)
    headers.set('x-rawback-client-version', CLIENT_VERSION)

    if (requestBody !== undefined) {
      headers.set('content-type', 'application/json')
    }

    if (authenticated && this.token) {
      headers.set('authorization', `Bearer ${this.token}`)
    }

    const response = await this.fetch(resolveApiUrl(this.apiHost, path), {
      ...requestOptions,
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      headers,
    })
    const bodyText = await response.text()
    let body: unknown

    if (bodyText.length > 0) {
      try {
        body = JSON.parse(bodyText)
      } catch (error) {
        throw new JsonResponseError(response, bodyText, { cause: error })
      }
    }

    if (!response.ok) {
      throw new HttpError(response, body)
    }

    return body as T
  }
}
