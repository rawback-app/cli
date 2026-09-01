import { AuthStatusDocument } from '@rawback/sdk'

import { commandOutput, createCommandClient, type ReadCommandDependencies } from './command.ts'
import { DEFAULT_WEB_HOST } from './config.ts'

export interface WebCommandDependencies extends ReadCommandDependencies {
  open?: (command: string, args: string[]) => Promise<number>
  platform?: NodeJS.Platform
}

export async function defaultOpen(command: string, args: string[]): Promise<number> {
  const process = Bun.spawn([command, ...args], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return process.exited
}

export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]]
  return ['xdg-open', [url]]
}

export async function runWeb(dependencies: WebCommandDependencies = {}): Promise<void> {
  const ui = commandOutput(dependencies)
  let webHost = DEFAULT_WEB_HOST
  const result = await ui.withActivity('Loading profile…', async () => {
    const client = await createCommandClient(dependencies)
    webHost = client.environment.webHost ?? DEFAULT_WEB_HOST
    return client.graphql.query({ query: AuthStatusDocument })
  })
  if (result.error) throw result.error
  if (!result.data?.me?.slug) {
    throw new Error('The account response did not include a profile slug')
  }

  const url = `${webHost.replace(/\/$/, '')}/users/${encodeURIComponent(result.data.me.slug)}`
  const [command, args] = browserCommand(dependencies.platform ?? process.platform, url)
  let exitCode: number
  try {
    exitCode = await (dependencies.open ?? defaultOpen)(command, args)
  } catch (error) {
    throw new Error(`Unable to open ${url}`, { cause: error })
  }
  if (exitCode !== 0) {
    throw new Error(`Unable to open ${url}: ${command} exited with status ${exitCode}`)
  }
  ui.success(`Opened ${url}.`)
}
