import {
  ExistingUploadIdentitiesDocument,
  extractUploadIdentities,
  type UploadIdentity,
  type UploadIdentityExtractor,
} from '@rawback/sdk'

import type { RawbackClient } from './client.ts'
import { createCommandClient, commandOutput, type ReadCommandDependencies } from './command.ts'
import {
  PhotoCheckProgressController,
  type PhotoCheckProgress,
} from './features/photos/check-progress.tsx'
import { photoCheckDocument } from './features/photos/check-view.ts'
import { findBundledExiftoolPath } from './upload-identity.ts'
import { scanUploadPath, type UploadFile } from './upload.ts'

const REMOTE_BATCH_SIZE = 500
const REMOTE_CONCURRENCY = 4

export type PhotoCheckStatus = 'present' | 'absent' | 'unknown'
export type PhotoCheckReason =
  | 'metadata-check-failed'
  | 'metadata-read-failed'
  | 'missing-capture-time'
  | 'remote-check-failed'

export interface PhotoCheckResult {
  filename: string
  imageId: number | null
  path: string
  reason: PhotoCheckReason | null
  status: PhotoCheckStatus
}

export interface PhotoCheckReport {
  files: PhotoCheckResult[]
  summary: {
    total: number
    present: number
    absent: number
    unknown: number
  }
}

export interface PhotoCheckOptions {
  json?: boolean
  path: string
}

export interface PhotoCheckDependencies extends ReadCommandDependencies {
  client?: RawbackClient
  identityExtractor?: UploadIdentityExtractor
  onProgress?: (progress: PhotoCheckProgress | null) => void
}

interface CheckCandidate {
  clientKey: string
  file: UploadFile
}

function unknownResult(file: UploadFile, reason: PhotoCheckReason): PhotoCheckResult {
  return {
    filename: file.basename,
    imageId: null,
    path: file.path,
    reason,
    status: 'unknown',
  }
}

function summarize(files: PhotoCheckResult[]): PhotoCheckReport {
  return {
    files,
    summary: {
      total: files.length,
      present: files.filter(({ status }) => status === 'present').length,
      absent: files.filter(({ status }) => status === 'absent').length,
      unknown: files.filter(({ status }) => status === 'unknown').length,
    },
  }
}

async function checkRemoteIdentities(
  client: RawbackClient,
  identities: UploadIdentity[],
  results: Map<string, PhotoCheckResult>,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  const batches = Array.from(
    { length: Math.ceil(identities.length / REMOTE_BATCH_SIZE) },
    (_, index) => identities.slice(index * REMOTE_BATCH_SIZE, (index + 1) * REMOTE_BATCH_SIZE),
  )
  let nextBatch = 0
  let completed = 0
  const worker = async () => {
    while (nextBatch < batches.length) {
      const index = nextBatch
      nextBatch += 1
      const batch = batches[index]
      if (!batch) return
      try {
        const response = await client.graphql.query({
          query: ExistingUploadIdentitiesDocument,
          variables: {
            identities: batch.map(({ clientKey, originalFilename, capturedAt }) => ({
              clientKey,
              originalFilename,
              capturedAt,
            })),
          },
        })
        if (response.error) throw response.error
        if (!response.data) throw new Error('The Rawback check did not return photo data')
        const matches = new Map(
          response.data.existingUploadIdentities.map(({ clientKey, imageId }) => [
            clientKey,
            imageId,
          ]),
        )
        for (const identity of batch) {
          const current = results.get(identity.clientKey)
          if (!current) continue
          const imageId = matches.get(identity.clientKey)
          results.set(identity.clientKey, {
            ...current,
            imageId: imageId ?? null,
            reason: null,
            status: imageId === undefined ? 'absent' : 'present',
          })
        }
      } catch {
        // Each affected file retains its remote-check-failed result. Other batches
        // continue so the final report contains every result we could determine.
      } finally {
        completed += batch.length
        onProgress(completed, identities.length)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REMOTE_CONCURRENCY, batches.length) }, worker))
}

function renderReport(
  report: PhotoCheckReport,
  options: PhotoCheckOptions,
  dependencies: PhotoCheckDependencies,
): void {
  const ui = commandOutput(dependencies)
  if (options.json) ui.json(report)
  else ui.document(photoCheckDocument(report))
}

export async function runPhotoCheck(
  options: PhotoCheckOptions,
  dependencies: PhotoCheckDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const progress = new PhotoCheckProgressController(ui, !options.json)
  const reportProgress = (next: PhotoCheckProgress) => {
    try {
      progress.update(next)
    } catch {
      // Progress is observational and must not interrupt the photo check.
    }
    try {
      dependencies.onProgress?.(next)
    } catch {
      // Injected progress observers are observational too.
    }
  }
  reportProgress({ stage: 'scanning', completed: 0 })
  let report: PhotoCheckReport
  try {
    const client = dependencies.client ?? (await createCommandClient(dependencies))
    const files = await scanUploadPath(options.path, (completed) =>
      reportProgress({ stage: 'scanning', completed }),
    )
    const candidates: CheckCandidate[] = files.map((file) => ({
      clientKey: crypto.randomUUID(),
      file,
    }))
    const results = new Map(
      candidates.map(({ clientKey, file }) => [
        clientKey,
        unknownResult(file, 'metadata-check-failed'),
      ]),
    )

    reportProgress({ stage: 'metadata', completed: 0, total: candidates.length })
    let identities: UploadIdentity[] = []
    try {
      const sidecarPath = await findBundledExiftoolPath()
      const extractor = dependencies.identityExtractor ?? extractUploadIdentities
      const extracted = await extractor(
        candidates.map(({ clientKey, file }) => ({
          clientKey,
          originalFilename: file.basename,
          path: file.path,
        })),
        {
          ...(sidecarPath ? { exiftoolPath: sidecarPath } : {}),
          onProgress: (completed, total) => reportProgress({ stage: 'metadata', completed, total }),
        },
      )
      reportProgress({
        stage: 'metadata',
        completed: candidates.length,
        total: candidates.length,
      })
      identities = extracted.identities
      const failed = new Set(extracted.failedClientKeys)
      const unchecked = new Set(extracted.uncheckedClientKeys)
      for (const { clientKey, file } of candidates) {
        const reason = failed.has(clientKey)
          ? 'metadata-read-failed'
          : unchecked.has(clientKey)
            ? 'missing-capture-time'
            : 'remote-check-failed'
        results.set(clientKey, unknownResult(file, reason))
      }

      const resolvedWithoutRemote = candidates.length - identities.length
      reportProgress({
        stage: 'checking',
        completed: resolvedWithoutRemote,
        total: candidates.length,
      })
      await checkRemoteIdentities(client, identities, results, (completed) =>
        reportProgress({
          stage: 'checking',
          completed: resolvedWithoutRemote + completed,
          total: candidates.length,
        }),
      )
      reportProgress({
        stage: 'checking',
        completed: candidates.length,
        total: candidates.length,
      })
    } catch {
      // All files retain metadata-check-failed when extraction cannot run at all.
    }

    report = summarize(candidates.map(({ clientKey }) => results.get(clientKey)!).filter(Boolean))
  } finally {
    try {
      await progress.finish()
    } catch {
      // Clearing progress must not replace the command result or its actionable error.
    }
    try {
      dependencies.onProgress?.(null)
    } catch {
      // Injected progress observers are observational too.
    }
  }

  renderReport(report!, options, dependencies)
  if (report!.summary.unknown > 0) {
    throw new Error(
      `${report!.summary.unknown} local photo${report!.summary.unknown === 1 ? '' : 's'} could not be checked`,
    )
  }
}
