/**
 * The environment selected by the global `--env` flag.
 *
 * Command modules take `dependencies.env` like every other injected value, and
 * that always wins; this module only supplies the default so `cli.ts` does not
 * have to thread a second argument through every command handler. `runCli`
 * sets it once from the parsed arguments, including back to `undefined` when
 * the flag is absent, so nothing leaks between parses in the same process.
 */
let selected: string | undefined

export function setSelectedEnvironment(name: string | undefined): void {
  selected = name?.trim() ? name.trim() : undefined
}

export function selectedEnvironment(): string | undefined {
  return selected
}
