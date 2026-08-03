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
  const headers = (error as { headers?: HeaderBag } | null | undefined)?.headers
  if (typeof headers?.get !== 'function') return undefined
  return headers.get(TRACE_ID_HEADER)?.trim() || undefined
}
