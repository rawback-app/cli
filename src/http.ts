import {
  HttpClient as SdkHttpClient,
  JsonResponseError,
  RawbackHttpError,
  resolveApiHost,
  resolveApiUrl,
  type ApiEnvelope,
  type JsonRequestOptions,
} from '@rawback/sdk'

import packageJson from '../package.json' with { type: 'json' }

export const DEFAULT_API_HOST = 'https://api.rawback.app'
export const CLIENT_SOURCE = 'cli'
export const CLIENT_VERSION = packageJson.version
export const USER_AGENT = `rawback-cli@${CLIENT_VERSION}`

export interface HttpClientOptions {
  apiHost?: string
  token?: string
  fetch?: typeof globalThis.fetch
}

export class HttpClient extends SdkHttpClient {
  readonly token: string | undefined

  constructor(options: HttpClientOptions = {}) {
    super({
      identity: {
        source: CLIENT_SOURCE,
        version: CLIENT_VERSION,
        userAgent: USER_AGENT,
      },
      ...(options.apiHost ? { apiHost: options.apiHost } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.token ? { token: () => options.token } : {}),
    })
    this.token = options.token
  }
}

/** Header the API echoes with the trace ID identifying the request server-side. */
export const TRACE_ID_HEADER = 'x-trace-id'

/**
 * Reads the trace ID off a failed request so it can be shown to the user. The
 * same ID identifies the request in the server's traces.
 */
export function traceIdOf(error: unknown): string | undefined {
  if (!(error instanceof RawbackHttpError)) return undefined
  return error.headers.get(TRACE_ID_HEADER)?.trim() || undefined
}

export {
  JsonResponseError,
  RawbackHttpError,
  RawbackHttpError as HttpError,
  resolveApiHost,
  resolveApiUrl,
  type ApiEnvelope,
  type JsonRequestOptions,
}
