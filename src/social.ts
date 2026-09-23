import { commandOutput } from './command.ts'
import { socialDocument } from './features/social/view.ts'
import { browserCommand, defaultOpen, type WebCommandDependencies } from './web.ts'

export interface SocialLink {
  network: string
  name: string
  url: string
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { network: 'x', name: 'X (Twitter)', url: 'https://twitter.com/rawback.app' },
]

export interface SocialOptions {
  json?: boolean
  open?: boolean
}

export async function runSocial(
  options: SocialOptions = {},
  dependencies: WebCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.json) {
    ui.json({ links: SOCIAL_LINKS })
    return
  }
  if (!options.open) {
    ui.document(socialDocument(SOCIAL_LINKS))
    return
  }

  const platform = dependencies.platform ?? process.platform
  const open = dependencies.open ?? defaultOpen
  for (const link of SOCIAL_LINKS) {
    const [command, args] = browserCommand(platform, link.url)
    let exitCode: number
    try {
      exitCode = await open(command, args)
    } catch (error) {
      throw new Error(`Unable to open ${link.url}`, { cause: error })
    }
    if (exitCode !== 0) {
      throw new Error(`Unable to open ${link.url}: ${command} exited with status ${exitCode}`)
    }
    ui.success(`Opened ${link.url}.`)
  }
}
