import { DEFAULT_CONFIG_PATH, FileConfigStore, type ConfigView } from '@rawback/sdk'

import { selectedEnvironment } from './environment.ts'

export {
  ConfigError,
  DEFAULT_CONFIG_PATH,
  DEFAULT_ENVIRONMENT,
  DEFAULT_WEB_HOST,
  FileConfigStore,
  environmentNames,
  readConfig,
  readEnvironment,
  resolveEnvironment,
  type ConfigView,
  type EnvironmentConfig,
  type EnvironmentSummary,
  type MetadataConfig,
  type RawbackConfig,
  type ResolvedEnvironment,
  type SftpConfig,
} from '@rawback/sdk'

export async function readConfigView(path = DEFAULT_CONFIG_PATH): Promise<ConfigView> {
  return new FileConfigStore(path).view()
}

/** The environment a command should use: injected first, then `--env`. */
export function environmentName(dependencies: { env?: string } = {}): string | undefined {
  return dependencies.env ?? selectedEnvironment()
}
