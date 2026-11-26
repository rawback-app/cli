import { selectedEnvironment } from './environment.ts'
import { traceIdOf } from './trace.ts'

/**
 * Turns a failed command into something a person can act on: what went wrong,
 * and, when there is something to do about it, a hint saying what.
 *
 * The SDK's errors are accurate but terse. When the server refuses a request
 * before GraphQL runs (an expired session, a proxy's error page, a gateway
 * timeout), the reply carries no GraphQL `errors`, and the SDK can only say
 * "GraphQL request failed". The HTTP status it keeps is enough to say more.
 *
 * Like `trace.ts`, this reads errors by shape rather than with `instanceof`:
 * cli.ts imports it on every invocation, and importing the SDK here would put
 * its barrel (ssh2 included) on the startup path of `rawback --help`.
 */
export interface ErrorExplanation {
  /** What went wrong, with the request's trace ID when it has one. */
  message: string
  /** What to do about it, when there is something to do. */
  hint?: string
}

/** The fields the SDK's errors and the runtime's network errors may carry. */
interface FailureShape {
  name?: unknown
  message?: unknown
  status?: unknown
  errors?: unknown
  body?: unknown
  code?: unknown
  path?: unknown
  cause?: unknown
}

interface GraphqlErrorItem {
  message?: unknown
  extensions?: { code?: unknown; reason?: unknown } | null
}

/** GraphQL extension codes the server and gateways use for "not signed in". */
const UNAUTHENTICATED_CODES = new Set<unknown>([401, '401', 'UNAUTHENTICATED'])

/** Runtime error codes for a request that never reached the server. */
const UNREACHABLE_CODES = new Set([
  'ConnectionRefused',
  'FailedToOpenSocket',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_PROXY_TUNNEL',
  'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * Runtime error codes for a connection that dropped, possibly after the
 * request was sent: a change may have been made even though no reply came.
 */
const LOST_CODES = new Set(['ConnectionClosed', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'])

/** Runtime error codes for a server whose TLS certificate was not trusted. */
const CERTIFICATE_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

const CHECK_API_HOST = "Run 'rawback config view' to check which API host this environment uses."
const TRY_AGAIN_LATER =
  'This is usually temporary; try again in a moment. If it keeps failing, report it with the trace ID.'

function shapeOf(error: unknown): FailureShape {
  return typeof error === 'object' && error !== null ? (error as FailureShape) : {}
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * The SDK's errors for a request to the Rawback API. Only these have their
 * status read: the camera library's `CCAPIError` carries a `status` too, and a
 * camera's 401 must not read as an expired Rawback session. The SDK sets each
 * `name` explicitly, so it survives the minified release build.
 */
const API_ERRORS = new Set<unknown>([
  'RawbackGraphqlError',
  'RawbackHttpError',
  'JsonResponseError',
])

function httpStatusOf(error: FailureShape): number | undefined {
  if (!API_ERRORS.has(error.name)) return undefined
  const { status } = error
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined
}

function graphqlErrorsOf(error: FailureShape): GraphqlErrorItem[] {
  if (error.name !== 'RawbackGraphqlError' || !Array.isArray(error.errors)) return []
  return error.errors.filter(
    (item): item is GraphqlErrorItem => typeof item === 'object' && item !== null,
  )
}

/** The REST envelope (`{code, data, msg, reason}`) a `RawbackHttpError` carries. */
function envelopeOf(error: FailureShape): { msg?: unknown; reason?: unknown } {
  if (error.name !== 'RawbackHttpError') return {}
  return typeof error.body === 'object' && error.body !== null
    ? (error.body as { msg?: unknown; reason?: unknown })
    : {}
}

/** The server's machine-readable reason for refusing, when it gave one. */
function reasonOf(error: FailureShape): string | undefined {
  const fromEnvelope = nonEmpty(envelopeOf(error).reason)
  if (fromEnvelope) return fromEnvelope
  for (const item of graphqlErrorsOf(error)) {
    const reason = nonEmpty(item.extensions?.reason)
    if (reason) return reason
  }
  return undefined
}

/**
 * The server's own words, or `undefined` when the error message is the SDK's
 * stand-in for a reply that had none ("GraphQL request failed", "HTTP request
 * failed with status 502").
 */
function serverMessageOf(error: FailureShape): string | undefined {
  if (error.name === 'RawbackGraphqlError') {
    return graphqlErrorsOf(error)
      .map((item) => nonEmpty(item.message))
      .find((message) => message !== undefined)
  }
  if (error.name === 'RawbackHttpError') return nonEmpty(envelopeOf(error).msg)
  if (error.name === 'JsonResponseError') return undefined
  return nonEmpty(error.message)
}

/**
 * Whether the server refused the request because the session is no longer
 * valid. By the time a command sees this the SDK has already tried to refresh
 * the access token and the refresh was refused too, so the only way forward is
 * to sign in again.
 *
 * The API answers an expired or revoked token with HTTP 401 and a REST
 * envelope — not GraphQL's shape, even on `/api/v2/graphql` — so the status is
 * what identifies it. An HTTP 401 that names a reason is about something else
 * (a wrong password, say) and keeps the server's message; a GraphQL
 * `UNAUTHENTICATED` error means the session whatever reason it adds.
 */
export function isSessionRejected(error: unknown): boolean {
  const shape = shapeOf(error)
  if (graphqlErrorsOf(shape).some((item) => UNAUTHENTICATED_CODES.has(item.extensions?.code))) {
    return true
  }
  return (
    shape.name !== 'JsonResponseError' &&
    httpStatusOf(shape) === 401 &&
    reasonOf(shape) === undefined
  )
}

/** `rawback auth --force`, aimed at the environment the command ran against. */
function signInCommand(): string {
  const environment = selectedEnvironment()
  return environment === undefined
    ? 'rawback auth --force'
    : `rawback --env ${environment} auth --force`
}

function isNetworkCode(code: string): boolean {
  return UNREACHABLE_CODES.has(code) || LOST_CODES.has(code) || CERTIFICATE_CODES.has(code)
}

function urlOf(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * The runtime's network error code and the URL it was for, looking through
 * `cause` wrappers: a wrapper may carry the code while the error it wraps
 * carries the URL, so each is taken from the first level that has it.
 */
function networkCodeOf(error: FailureShape): { code: string; url: URL | undefined } | undefined {
  let code: string | undefined
  let url: URL | undefined
  let current: FailureShape | undefined = error
  for (let depth = 0; current !== undefined && depth < 4; depth += 1) {
    const candidate = nonEmpty(current.code)
    if (code === undefined && candidate !== undefined && isNetworkCode(candidate)) code = candidate
    url ??= urlOf(current.path)
    if (code !== undefined && url !== undefined) break
    current = current.cause === undefined ? undefined : shapeOf(current.cause)
  }
  return code === undefined ? undefined : { code, url }
}

/**
 * A request to the Rawback API that never got an answer. Only API paths are
 * recognised: camera and SFTP failures carry the same codes, and they have
 * their own messages, which this must not replace.
 */
function explainNetworkFailure(error: FailureShape): ErrorExplanation | undefined {
  const failure = networkCodeOf(error)
  if (!failure?.url || !failure.url.pathname.startsWith('/api/')) return undefined
  const host = failure.url.origin
  if (CERTIFICATE_CODES.has(failure.code)) {
    return {
      message: `Could not verify the TLS certificate of the Rawback API at ${host} (${failure.code}).`,
      hint: `A proxy that intercepts HTTPS may be in the way. ${CHECK_API_HOST}`,
    }
  }
  if (LOST_CODES.has(failure.code)) {
    return {
      message: `The connection to the Rawback API at ${host} was lost (${failure.code}).`,
      hint: 'Check your internet connection, then try again. If you were changing something, check whether the change was made before repeating it.',
    }
  }
  return {
    message: `Could not connect to the Rawback API at ${host} (${failure.code}).`,
    hint: `Check your internet connection. ${CHECK_API_HOST}`,
  }
}

function explainHttpFailure(error: FailureShape): ErrorExplanation | undefined {
  const status = httpStatusOf(error)
  if (status === undefined) return undefined
  // A GraphQL reply that names its errors is already specific; the server's
  // message stands. Only the SDK's stand-in is replaced.
  const server = serverMessageOf(error)

  if (status >= 500) {
    return {
      message: server ?? `The Rawback API failed to answer (HTTP ${status}).`,
      hint: TRY_AGAIN_LATER,
    }
  }
  if (status === 429) {
    return {
      message: server ?? 'The Rawback API is receiving too many requests (HTTP 429).',
      hint: 'Wait a minute, then try again.',
    }
  }
  if (status === 408) {
    return {
      message: server ?? 'The request to the Rawback API timed out (HTTP 408).',
      hint: 'Check your internet connection, then try again.',
    }
  }
  if (server !== undefined) return undefined
  if (status === 403) {
    return {
      message: 'The Rawback API refused this request for this account (HTTP 403).',
      // Signing in again fixes a failed account lookup, but not a firewall or
      // an IP block, which look the same, and it replaces working credentials.
      hint: `If it keeps happening, report it with the trace ID. Signing in again with '${signInCommand()}' may also help.`,
    }
  }
  if (status === 404) {
    return {
      message: 'The Rawback API did not recognise this request (HTTP 404).',
      hint: CHECK_API_HOST,
    }
  }
  if (status < 300) {
    // GraphQL errors without a message are the server's answer, just a terse
    // one: the original message stands.
    if (graphqlErrorsOf(error).length > 0) return undefined
    // A 2xx with no GraphQL data or errors: the body was not the API's JSON at
    // all, which is what a proxy, a captive portal or the wrong host sends.
    return {
      message: `The server answered, but not with a Rawback API response (HTTP ${status}).`,
      hint: `A proxy or captive portal may be in the way. ${CHECK_API_HOST}`,
    }
  }
  return { message: `The Rawback API rejected this request (HTTP ${status}).` }
}

function explainFailure(error: unknown): ErrorExplanation {
  const shape = shapeOf(error)
  const original = error instanceof Error ? error.message : String(error)
  const reason = reasonOf(shape)

  if (reason === 'email_verification_required') {
    return {
      message: serverMessageOf(shape) ?? original,
      hint: 'Open the confirmation link Rawback emailed you, then try again.',
    }
  }
  if (isSessionRejected(error)) {
    return {
      message: 'Your Rawback session has expired or was signed out.',
      hint: `Run '${signInCommand()}' to sign in again.`,
    }
  }
  if (shape.name === 'JsonResponseError') {
    // An error page from the API's own gateway (a 502, a 429) says more by its
    // status than by not being JSON.
    const status = httpStatusOf(shape)
    const byStatus = status !== undefined && status >= 300 ? explainHttpFailure(shape) : undefined
    return (
      byStatus ?? {
        message: original,
        hint: `A proxy or captive portal may be in the way. ${CHECK_API_HOST}`,
      }
    )
  }
  return explainNetworkFailure(shape) ?? explainHttpFailure(shape) ?? { message: original }
}

/**
 * Explains a failed command. The trace ID of a failed request is appended so
 * the user can quote it — the same ID identifies the request in the server's
 * traces. Messages that already embed it (the device authorization errors) are
 * left alone.
 */
export function explainError(error: unknown): ErrorExplanation {
  const { message, hint } = explainFailure(error)
  const traceID = traceIdOf(error)
  const withTrace =
    !traceID || message.includes(traceID) ? message : `${message} Trace ID: ${traceID}.`
  return hint === undefined ? { message: withTrace } : { message: withTrace, hint }
}
