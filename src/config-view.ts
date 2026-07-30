import { commandOutput, type ReadCommandDependencies } from './command.ts'
import { DEFAULT_CONFIG_PATH, readConfigView } from './config.ts'

export interface ConfigViewOptions {
  json?: boolean
}

export type ConfigViewDependencies = ReadCommandDependencies

export async function runConfigView(
  options: ConfigViewOptions = {},
  dependencies: ConfigViewDependencies = {},
): Promise<void> {
  const view = await readConfigView(dependencies.configPath ?? DEFAULT_CONFIG_PATH)
  const output = commandOutput(dependencies)

  if (options.json) {
    output.json(view.value)
    return
  }

  if (!view.exists) {
    output.info(`No config file found at ${view.path}.`)
    return
  }

  output.document({
    title: 'Configuration',
    blocks: [
      { type: 'fields', fields: [{ label: 'File', value: view.path }] },
      {
        type: 'text',
        text: view.contents.length > 0 ? view.contents.trimEnd() : '{}',
      },
    ],
  })
}
