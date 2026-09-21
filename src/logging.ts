import {
  createAppLogger,
  flushLogger,
  type Logger,
  type LogLevel,
  NOOP_LOGGER,
  readEnvironment,
  resolveLoggingOptions,
} from '@rawback/sdk'

import packageJson from '../package.json' with { type: 'json' }
import { selectedLogLevel } from './log-level.ts'

export interface LoggerDependencies {
  configPath?: string
  env?: string
  logger?: Logger
  logLevel?: LogLevel
}

let root: Logger | undefined
let building: Promise<Logger> | undefined

/**
 * The one logger this process writes through.
 *
 * Built lazily and memoized: a command that never talks to the network should
 * not create `~/.rawback/logs/` on the way past, and one process wants one
 * rolling destination rather than one per command module.
 */
export async function commandLogger(dependencies: LoggerDependencies = {}): Promise<Logger> {
  if (dependencies.logger) return dependencies.logger
  if (root) return root
  building ??= buildLogger(dependencies)
  root = await building
  return root
}

async function buildLogger(dependencies: LoggerDependencies): Promise<Logger> {
  const level = dependencies.logLevel ?? selectedLogLevel()
  const environment = await readEnvironment(dependencies.configPath, dependencies.env).catch(
    () => undefined,
  )
  return createAppLogger({
    app: 'cli',
    version: packageJson.version,
    options: resolveLoggingOptions({
      ...(level ? { overrides: { level } } : {}),
      ...(environment?.logging ? { config: environment.logging } : {}),
    }),
    ...(environment?.name ? { environmentName: environment.name } : {}),
  })
}

/**
 * Writes out anything still buffered.
 *
 * Called from `runCli`'s `finally` so a command's records reach the file even
 * when it failed: the rolling destination is asynchronous, and a CLI process
 * exits long before it would drain on its own.
 */
export async function flushCommandLogger(): Promise<void> {
  if (!root) return
  await flushLogger(root)
}

/** Forgets the memoized logger. Tests need this; nothing else should. */
export function resetCommandLogger(): void {
  root = undefined
  building = undefined
}

export { NOOP_LOGGER }
