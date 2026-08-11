import { UserMemoryDocument, type UserMemoryQuery } from '@rawback/sdk'

import { commandOutput, createCommandClient, type ReadCommandDependencies } from './command.ts'
import { memoryDocument } from './features/memory/view.ts'

export interface MemoryOptions {
  json?: boolean
}

export type MemoryDependencies = ReadCommandDependencies

function serializeMemory(data: UserMemoryQuery) {
  const memory = data.me.memory
  if (!memory) return null
  return {
    id: memory.id,
    content: memory.content,
    generatedAt: memory.generatedAt ?? null,
    sourceImageCount: memory.sourceImageCount,
  }
}

export async function runMemory(
  options: MemoryOptions = {},
  dependencies: MemoryDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading memory…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({ query: UserMemoryDocument })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data?.me) throw new Error('The memory response did not include account data')
  if (options.json) {
    // `null` rather than an omitted key: "not generated yet" is a real state a
    // script may want to branch on.
    ui.json({ memory: serializeMemory(result.data) })
    return
  }
  ui.document(memoryDocument(result.data))
}
