import { DEFAULT_CONFIG_PATH, FileConfigStore, type ConfigView } from '@rawback/sdk'

export {
  ConfigError,
  DEFAULT_CONFIG_PATH,
  DEFAULT_WEB_HOST,
  FileConfigStore,
  readConfig,
  type ConfigView,
  type RawbackConfig,
  type SftpConfig,
} from '@rawback/sdk'

export async function readConfigView(path = DEFAULT_CONFIG_PATH): Promise<ConfigView> {
  return new FileConfigStore(path).view()
}
