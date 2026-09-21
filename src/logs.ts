import { open } from 'node:fs/promises'

import {
  activeLogFile,
  isLogApp,
  LOG_APPS,
  type LogApp,
  type LogDirectoryListing,
  type LogLevel,
  listLogFiles,
  LOG_LEVEL_NAMES,
  type PurgeLogsResult,
  purgeLogs,
  readEnvironment,
  resolveLoggingOptions,
} from '@rawback/sdk'

/** pino's numbering, so `--level warn` can mean "warn and above". */
const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 70,
}

import { commandOutput, type ReadCommandDependencies } from './command.ts'
import { environmentName } from './config.ts'
import { logFilesDocument, logLinesDocument, purgeResultDocument } from './features/logs/view.ts'

export interface LogsPrompts {
  confirm(message: string): Promise<boolean>
}

export interface LogsCommandDependencies extends ReadCommandDependencies {
  /** Overrides the directory resolved from `config.yml`; tests point it at a tmpdir. */
  logDirectory?: string
  prompts?: LogsPrompts
}

export interface LogsPathOptions {
  json?: boolean
}

export interface LogsShowOptions {
  lines?: number
  level?: string
  app?: string
  json?: boolean
}

export interface LogsPurgeOptions {
  app?: string
  yes?: boolean
  json?: boolean
}

/** One line of the log file, parsed when it is valid JSON and kept raw when not. */
export interface LogLine {
  time?: string
  level?: string
  component?: string
  event?: string
  msg?: string
  traceId?: string
  /** Set instead of the rest when the line could not be parsed. */
  raw?: string
}

/**
 * Where the logs live for this invocation.
 *
 * Resolved the same way the logger itself resolves it — flag, then environment,
 * then `config.yml`, then the default — so `rawback logs path` can never point
 * at a different directory from the one being written to.
 */
export async function resolveLogDirectory(
  dependencies: LogsCommandDependencies = {},
): Promise<string> {
  if (dependencies.logDirectory) return dependencies.logDirectory
  const environment = await readEnvironment(
    dependencies.configPath,
    environmentName(dependencies),
  ).catch(() => undefined)
  return resolveLoggingOptions(environment?.logging ? { config: environment.logging } : {})
    .directory
}

function requireApp(value: string | undefined): LogApp | undefined {
  if (value === undefined || value === 'all') return undefined
  if (!isLogApp(value)) {
    throw new Error(`--app must be one of ${LOG_APPS.join(', ')}, or all`)
  }
  return value
}

export async function runLogsPath(
  options: LogsPathOptions = {},
  dependencies: LogsCommandDependencies = {},
): Promise<void> {
  const listing = await listLogFiles(await resolveLogDirectory(dependencies))
  const output = commandOutput(dependencies)

  if (options.json) {
    output.json(serializeListing(listing))
    return
  }
  output.document(logFilesDocument(listing))
}

function serializeListing(listing: LogDirectoryListing) {
  return {
    directory: listing.directory,
    totalBytes: listing.totalBytes,
    files: listing.files.map((file) => ({
      name: file.name,
      path: file.path,
      bytes: file.bytes,
      modifiedAt: file.modifiedAt,
    })),
  }
}

/** How much of the tail to read. Enough for a large `--lines`, never the whole file. */
const TAIL_BYTES_PER_LINE = 1_024
const MAX_TAIL_BYTES = 4 * 1024 * 1024

/**
 * Reads the last `count` lines of a file.
 *
 * Positioned rather than whole-file: the active log can be ten megabytes, and
 * `rawback logs show` must not pull all of it into memory to print fifty lines.
 */
export async function readTail(path: string, count: number): Promise<string[]> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return []
  try {
    const { size } = await handle.stat()
    const span = Math.min(size, Math.min(count * TAIL_BYTES_PER_LINE, MAX_TAIL_BYTES))
    const buffer = Buffer.alloc(span)
    await handle.read(buffer, 0, span, size - span)
    const text = buffer.toString('utf8')
    // A partial first line is likely when the read started mid-record.
    const lines = text.split('\n').filter((line) => line.trim().length > 0)
    if (span < size && lines.length > 1) lines.shift()
    return lines.slice(-count)
  } finally {
    await handle.close()
  }
}

function parseLine(line: string): LogLine {
  try {
    const record = JSON.parse(line) as Record<string, unknown>
    const ids = record.ids as { traceId?: string } | undefined
    return {
      ...(typeof record.time === 'string' ? { time: record.time } : {}),
      ...(typeof record.level === 'string' ? { level: record.level } : {}),
      ...(typeof record.component === 'string' ? { component: record.component } : {}),
      ...(typeof record.event === 'string' ? { event: record.event } : {}),
      ...(typeof record.msg === 'string' ? { msg: record.msg } : {}),
      ...(ids?.traceId ? { traceId: ids.traceId } : {}),
    }
  } catch {
    // A torn line is worth showing rather than dropping — it is evidence too.
    return { raw: line }
  }
}

function atLeastLevel(line: LogLine, minimum: LogLevel | undefined): boolean {
  if (minimum === undefined) return true
  const level = line.level as LogLevel | undefined
  // A line without a usable level is shown rather than filtered away: it is
  // more likely a torn record than something the caller meant to hide.
  if (level === undefined || !(level in LEVEL_ORDER)) return true
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum]
}

export async function runLogsShow(
  options: LogsShowOptions = {},
  dependencies: LogsCommandDependencies = {},
): Promise<void> {
  const count = options.lines ?? 50
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new Error('--lines must be an integer between 1 and 10000')
  }
  const level = options.level as LogLevel | undefined
  if (level !== undefined && !(level in LEVEL_ORDER)) {
    throw new Error(`--level must be one of ${LOG_LEVEL_NAMES.join(', ')}`)
  }

  const directory = await resolveLogDirectory(dependencies)
  const app = requireApp(options.app) ?? 'cli'
  // `pino-roll` numbers every file, so the current one is the highest-numbered
  // rather than a fixed name.
  const path = await activeLogFile(directory, app)
  const lines = path
    ? (await readTail(path, count)).map(parseLine).filter((line) => atLeastLevel(line, level))
    : []
  const output = commandOutput(dependencies)

  if (options.json) {
    output.json({ file: path ?? null, lines })
    return
  }
  output.document(logLinesDocument(path ?? directory, lines))
}

export async function runLogsPurge(
  options: LogsPurgeOptions = {},
  dependencies: LogsCommandDependencies = {},
): Promise<void> {
  const app = requireApp(options.app)
  const directory = await resolveLogDirectory(dependencies)
  const output = commandOutput(dependencies)

  if (!options.yes) {
    const listing = await listLogFiles(directory, app)
    if (listing.files.length === 0) {
      if (options.json) output.json(emptyPurge(directory))
      else output.info(`No log files to delete in ${directory}.`)
      return
    }
    const prompts = dependencies.prompts ?? defaultPrompts()
    const confirmed = await prompts.confirm(
      `Delete ${listing.files.length} log file${listing.files.length === 1 ? '' : 's'} ` +
        `from ${directory}?`,
    )
    if (!confirmed) {
      output.info('Left the log files in place.')
      return
    }
  }

  const result = await purgeLogs({ directory, ...(app ? { app } : {}) })
  if (options.json) {
    output.json(result)
  } else {
    output.document(purgeResultDocument(result))
  }
  // A file that could not be deleted is reported, not thrown: on Windows the
  // Desktop app holds `desktop.log` open, and the rest should still clear.
  if (result.failed.length > 0) process.exitCode = 1
}

function emptyPurge(directory: string): PurgeLogsResult {
  return { directory, removed: [], failed: [], bytes: 0 }
}

function defaultPrompts(): LogsPrompts {
  return {
    async confirm(message) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Re-run with --yes to delete log files non-interactively.')
      }
      const { confirm } = await import('@inquirer/prompts')
      return confirm({ default: false, message })
    },
  }
}
