import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { commandOutput, type ReadCommandDependencies } from './command.ts'
import { DEFAULT_CONFIG_PATH, DEFAULT_WEB_HOST } from './config.ts'
import { DEFAULT_API_HOST } from './http.ts'
import { type CommandOutput } from './ui/output.tsx'

/**
 * The file the CLI writes the first time a command runs without one.
 *
 * Only `apiHost` and `webHost` are live keys. Everything else is commented out
 * on purpose: the schema rejects an empty `sftp.password` or a placeholder
 * endpoint, an explicit `metadata.concurrency` would disable the automatic
 * CPU- and memory-aware worker sizing, and a `current:` with no matching
 * `environments:` entry would fail every later command with "Unknown
 * environment".
 */
export const DEFAULT_CONFIG_TEMPLATE = `# Rawback CLI configuration.
# Created automatically on first run, at mode 0600 on Linux and macOS because
# this file holds the SFTP password. Never commit it or paste it into an issue.
# Full reference: https://github.com/rawback-app/cli/blob/main/docs/configuration.md

apiHost: ${DEFAULT_API_HOST}
webHost: ${DEFAULT_WEB_HOST}

# Optional. Exact local metadata worker count from 1 through 64.
# Omit this block to size the worker pool automatically.
# metadata:
#   concurrency: 8

# Required by \`rawback photos upload\`. Create the credential with
# \`rawback cred add --name "My computer"\` - its password is shown only once -
# and use the account slug from \`rawback auth status\` as the username.
# sftp:
#   endpoint: sftp://ftp.rawback.app:23168
#   username: your-account-slug
#   password: 'generated-password'
#   # Optional SSH host-key pin. Without it the first observed key is trusted
#   # and recorded in ~/.rawback/upload-state.json.
#   hostFingerprint: SHA256:base64-fingerprint

# Named environments. \`rawback config use <name>\` writes \`current:\` here, and
# Rawback Desktop reads the same setting.
# current: production
# environments:
#   local:
#     apiHost: http://localhost:23164
#     webHost: http://localhost:3407
`

export type ConfigInitOutcome = 'created' | 'existed' | 'replaced' | 'skipped'

export interface ConfigInitResult {
  outcome: ConfigInitOutcome
  path: string
  /** Why the file was not written; present only for `skipped`. */
  reason?: string
}

function isAlreadyPresent(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST'
  )
}

async function prepareDirectory(path: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { mode: 0o700, recursive: true })
  if (process.platform !== 'win32') await chmod(directory, 0o700)
}

/**
 * Replaces an existing file through a private temporary sibling, so a reader
 * never observes a half-written config. Only `config init --force` takes this
 * path; creation deliberately does not, because `rename` clobbers its
 * destination and creation must never overwrite anything.
 */
async function replaceConfig(path: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, DEFAULT_CONFIG_TEMPLATE, { flag: 'wx', mode: 0o600 })
    if (process.platform !== 'win32') await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

/**
 * Writes the default config, reporting whether this call is what created it.
 *
 * Creation uses `wx` (`O_CREAT | O_EXCL`) rather than a temporary file and a
 * rename: it is an atomic create-if-absent, so a second `rawback` process, or
 * `config use` writing `current:` at the same moment, can never be clobbered.
 * A torn write would leave a truncated `apiHost:` behind that fails URL
 * validation on every later run, so a failed write removes the partial file.
 *
 * Throws on failure; {@link bootstrapConfig} is the tolerant wrapper.
 */
export async function createDefaultConfig(
  path: string = DEFAULT_CONFIG_PATH,
  force = false,
): Promise<ConfigInitResult> {
  await prepareDirectory(path)

  if (force) {
    await replaceConfig(path)
    return { outcome: 'replaced', path }
  }

  try {
    await writeFile(path, DEFAULT_CONFIG_TEMPLATE, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (isAlreadyPresent(error)) return { outcome: 'existed', path }
    await rm(path, { force: true })
    throw error
  }

  if (process.platform !== 'win32') await chmod(path, 0o600)
  return { outcome: 'created', path }
}

/**
 * Creates the config when it is missing, for commands that never asked for it.
 *
 * A missing config is already a fully supported state - the SDK reads it as an
 * empty mapping - so this is a convenience and never a precondition: it does
 * not throw, does not set an exit status, and stays silent when it cannot
 * write. A read-only home directory would otherwise print the same unactionable
 * warning on every invocation forever. The notice for a file it did create goes
 * to stderr, so `--json` output on stdout stays machine-readable.
 */
export async function bootstrapConfig(
  output: CommandOutput,
  path: string = DEFAULT_CONFIG_PATH,
): Promise<ConfigInitResult> {
  let result: ConfigInitResult
  try {
    result = await createDefaultConfig(path)
  } catch (error) {
    return { outcome: 'skipped', path, reason: describeReason(error) }
  }

  if (result.outcome === 'created') {
    output.warning(`Created a default config at ${path}.`)
  }
  return result
}

function describeReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface ConfigInitOptions {
  force?: boolean
}

export type ConfigInitDependencies = ReadCommandDependencies

export async function runConfigInit(
  options: ConfigInitOptions = {},
  dependencies: ConfigInitDependencies = {},
): Promise<void> {
  const path = dependencies.configPath ?? DEFAULT_CONFIG_PATH
  const result = await createDefaultConfig(path, options.force ?? false)
  const output = commandOutput(dependencies)

  if (result.outcome === 'existed') {
    output.info(`Configuration already exists at ${path}; pass --force to replace it.`)
    return
  }

  output.success(
    result.outcome === 'replaced'
      ? `Replaced the configuration at ${path}.`
      : `Created a default configuration at ${path}.`,
  )
}
