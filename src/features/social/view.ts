import type { SocialLink } from '../../social.ts'
import { type UiDocument } from '../../ui/model.ts'

export function socialDocument(links: readonly SocialLink[]): UiDocument {
  return {
    title: 'Rawback on social media',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No social media links yet.',
        columns: [
          { key: 'name', label: 'Network', required: true, priority: 1, minWidth: 10 },
          { key: 'url', label: 'URL', required: true, priority: 1 },
        ],
        rows: links.map((link) => ({ name: link.name, url: link.url })),
      },
    ],
  }
}
