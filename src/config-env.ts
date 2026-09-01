import { commandOutput, type ReadCommandDependencies } from './command.ts'
import {
  DEFAULT_CONFIG_PATH,
  FileConfigStore,
  environmentName,
  type EnvironmentSummary,
} from './config.ts'
import { DEFAULT_CREDENTIALS_PATH, listCredentialEnvironments } from './credentials.ts'
import { environmentListDocument } from './features/config/view.ts'
import { DEFAULT_API_HOST } from './http.ts'

export interface ConfigEnvListOptions {
  json?: boolean
}

export type ConfigEnvDependencies = ReadCommandDependencies

export interface EnvironmentReport extends EnvironmentSummary {
  /** Whether `credentials.json` holds a token pair for this environment. */
  authenticated: boolean
  /** Whether this is the environment the current invocation would use. */
  selected: boolean
}

export async function collectEnvironments(
  dependencies: ConfigEnvDependencies = {},
): Promise<EnvironmentReport[]> {
  const store = new FileConfigStore(dependencies.configPath ?? DEFAULT_CONFIG_PATH)
  const summaries = await store.listEnvironments()
  const signedIn = new Set(
    await listCredentialEnvironments(dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH),
  )
  const requested = environmentName(dependencies)
  return summaries.map((summary) => ({
    ...summary,
    apiHost: summary.apiHost ?? DEFAULT_API_HOST,
    authenticated: signedIn.has(summary.name),
    selected: requested === undefined ? summary.current : requested === summary.name,
  }))
}

export async function runConfigEnvList(
  options: ConfigEnvListOptions = {},
  dependencies: ConfigEnvDependencies = {},
): Promise<void> {
  const environments = await collectEnvironments(dependencies)
  const output = commandOutput(dependencies)

  if (options.json) {
    output.json({ environments })
    return
  }

  output.document(environmentListDocument(environments))
}

export async function runConfigUse(
  name: string,
  dependencies: ConfigEnvDependencies = {},
): Promise<void> {
  const store = new FileConfigStore(dependencies.configPath ?? DEFAULT_CONFIG_PATH)
  await store.writeCurrentEnvironment(name)
  commandOutput(dependencies).success(`Now using the ${name} environment.`)
}
