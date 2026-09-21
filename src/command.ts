import type { Logger, LogLevel } from '@rawback/sdk'

import { type RawbackClient, createRawbackClient } from './client.ts'
import { environmentName } from './config.ts'
import { commandLogger } from './logging.ts'
import { CommandOutput, type CommandOutputOptions } from './ui/output.tsx'

export interface ReadCommandDependencies extends CommandOutputOptions {
  configPath?: string
  credentialsPath?: string
  /** Environment from `~/.rawback/config.yml`; defaults to the `--env` flag. */
  env?: string
  fetch?: typeof globalThis.fetch
  /** Overrides the shared logger; tests inject a capturing one. */
  logger?: Logger
  /** Overrides the `--log-level` flag. */
  logLevel?: LogLevel
  output?: CommandOutput
}

export function commandOutput(dependencies: ReadCommandDependencies): CommandOutput {
  return dependencies.output ?? new CommandOutput(dependencies)
}

export async function createCommandClient(
  dependencies: ReadCommandDependencies,
  authenticated = true,
): Promise<RawbackClient> {
  const env = environmentName(dependencies)
  const logger = await commandLogger({
    ...(dependencies.configPath !== undefined ? { configPath: dependencies.configPath } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(dependencies.logger !== undefined ? { logger: dependencies.logger } : {}),
    ...(dependencies.logLevel !== undefined ? { logLevel: dependencies.logLevel } : {}),
  })
  const client = await createRawbackClient({
    logger,
    ...(dependencies.configPath !== undefined ? { configPath: dependencies.configPath } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(dependencies.credentialsPath !== undefined
      ? { credentialsPath: dependencies.credentialsPath }
      : {}),
    ...(dependencies.fetch !== undefined ? { fetch: dependencies.fetch } : {}),
  })
  if (authenticated && !client.credentials) {
    throw new Error('Authentication credentials are missing; run rawback auth')
  }
  return client
}

export function validatePagination(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error('--page must be a positive integer')
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('--page-size must be an integer between 1 and 100')
  }
}
