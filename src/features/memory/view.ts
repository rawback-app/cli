import { type UserMemoryQuery } from '@rawback/sdk'

import { formatTimestamp } from '../../ui/format.ts'
import { type UiBlock, type UiDocument } from '../../ui/model.ts'

/**
 * The memory is prose, not a record, so it renders as text rather than being
 * squeezed into a fields table. The provenance line goes underneath so a stale
 * profile is obvious without having to ask when it was written.
 */
export function memoryDocument(data: UserMemoryQuery): UiDocument {
  const memory = data.me.memory
  const content = memory?.content?.trim()

  if (!content) {
    return {
      title: 'Memory',
      blocks: [
        {
          type: 'notice',
          message: 'No memory yet. Rawback writes one each week once you have enough photos.',
          tone: 'info',
        },
      ],
    }
  }

  const blocks: UiBlock[] = [{ type: 'text', text: content }]
  if (memory?.generatedAt) {
    blocks.push({
      type: 'fields',
      fields: [
        { label: 'Updated', value: formatTimestamp(memory.generatedAt) },
        { label: 'Photos used', value: memory.sourceImageCount },
      ],
    })
  }
  return { title: 'Memory', blocks }
}
