import { commandOutput, type ReadCommandDependencies } from './command.ts'
import {
  DEFAULT_CONFIG_PATH,
  environmentName,
  readConfig,
  readConfigView,
  resolveEnvironment,
} from './config.ts'
import { DEFAULT_API_HOST } from './http.ts'

export interface ConfigViewOptions {
  json?: boolean
}

export type ConfigViewDependencies = ReadCommandDependencies

/**
 * Reads only `config.yml` — no credentials, no defaults beyond the API host
 * shown alongside the resolved environment — so it keeps working unauthenticated
 * and its `--json` output stays the config file itself.
 */
export async function runConfigView(
  options: ConfigViewOptions = {},
  dependencies: ConfigViewDependencies = {},
): Promise<void> {
  const configPath = dependencies.configPath ?? DEFAULT_CONFIG_PATH
  const view = await readConfigView(configPath)
  const output = commandOutput(dependencies)

  if (options.json) {
    output.json(view.value)
    return
  }

  if (!view.exists) {
    output.info(`No config file found at ${view.path}.`)
    return
  }

  const environment = resolveEnvironment(
    await readConfig(configPath),
    environmentName(dependencies),
    configPath,
  )

  output.document({
    title: 'Configuration',
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'File', value: view.path },
          { label: 'Environment', value: environment.name },
          { label: 'API host', value: environment.apiHost ?? DEFAULT_API_HOST },
        ],
      },
      {
        type: 'text',
        text: view.contents.length > 0 ? view.contents.trimEnd() : '{}',
      },
    ],
  })
}
