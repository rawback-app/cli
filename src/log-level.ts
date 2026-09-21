import type { LogLevel } from '@rawback/sdk'

/**
 * The verbosity selected by the global `--log-level` and `-v` flags.
 *
 * Mirrors `src/environment.ts`: `runCli` sets it once per parse, including back
 * to `undefined` when neither flag is present, so nothing leaks between parses
 * in the same process. Command modules take `dependencies.logLevel` like every
 * other injected value and that always wins.
 *
 * The `@rawback/sdk` import is **type-only** and erases at compile time. That
 * matters: `cli.ts` imports this module and runs on every invocation, so a
 * runtime import would drag the SDK barrel — ssh2 included — onto the
 * `rawback --help` path, the same trap `src/trace.ts` documents.
 */
export const LOG_LEVEL_CHOICES = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const satisfies readonly LogLevel[]

let selected: LogLevel | undefined

export function setSelectedLogLevel(input: { level?: string; verbose?: number }): void {
  const named = LOG_LEVEL_CHOICES.find((choice) => choice === input.level?.trim())
  if (named) {
    selected = named
    return
  }
  // `-v` is debug and `-vv` is trace; an explicit `--log-level` beats both.
  const verbosity = input.verbose ?? 0
  selected = verbosity >= 2 ? 'trace' : verbosity === 1 ? 'debug' : undefined
}

export function selectedLogLevel(): LogLevel | undefined {
  return selected
}
