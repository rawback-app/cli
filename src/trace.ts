/** Header the API echoes with the trace ID identifying the request server-side. */
export const TRACE_ID_HEADER = 'x-trace-id'

interface HeaderBag {
  get(name: string): string | null
}

/**
 * Reads the trace ID off a failed request so it can be shown to the user. The
 * same ID identifies the request in the server's traces.
 *
 * Deliberately structural rather than an `instanceof RawbackHttpError` check:
 * this module is imported by cli.ts, which runs on every invocation, and
 * reaching for the SDK here would drag its barrel (ssh2 included) into the
 * startup path — worth ~240ms on `rawback --help`.
 */
export function traceIdOf(error: unknown): string | undefined {
  const failure = error as { headers?: HeaderBag; traceId?: unknown } | null | undefined
  const headers = failure?.headers
  const echoed = typeof headers?.get === 'function' ? headers.get(TRACE_ID_HEADER)?.trim() : ''
  // The SDK's errors fall back to the ID they sent (their `traceId` getter)
  // when the response carries none: a gateway's error page or a proxy that
  // strips the header, which are the failures that most need something to quote.
  const sent = typeof failure?.traceId === 'string' ? failure.traceId.trim() : ''
  return echoed || sent || undefined
}
