import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UploadIdentityExtractor } from '@rawback/sdk'

import type { RawbackClient } from '../src/client.ts'
import type { PhotoCheckProgress } from '../src/features/photos/check-progress.tsx'
import {
  runPhotoCheck,
  type PhotoCheckDependencies,
  type PhotoCheckReport,
} from '../src/photo-check.ts'

interface RemoteIdentity {
  capturedAt: string
  clientKey: string
  originalFilename: string
}

const capturedAt = '2026-06-04T09:57:01.123457Z'
const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-photo-check-'))
  temporaryDirectories.push(directory)
  return directory
}

function fakeClient(
  handler: (
    identities: RemoteIdentity[],
  ) =>
    | { data: { existingUploadIdentities: Array<{ clientKey: string; imageId: number }> } }
    | { error: Error },
): RawbackClient {
  return {
    config: {},
    credentials: { token: 'access-token', refreshToken: 'refresh-token' },
    graphql: {
      async query(request: { variables?: { identities?: RemoteIdentity[] } }) {
        return handler(request.variables?.identities ?? [])
      },
    },
    http: {},
  } as unknown as RawbackClient
}

function jsonDependencies(
  client: RawbackClient,
  identityExtractor: UploadIdentityExtractor,
  lines: string[],
): PhotoCheckDependencies {
  return {
    client,
    identityExtractor,
    stdout: (message) => lines.push(message),
  }
}

function parsedReport(lines: string[]): PhotoCheckReport {
  return JSON.parse(lines.join('\n')) as PhotoCheckReport
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('photos check', () => {
  test('reports present, absent, and metadata-unknown files in stable JSON', async () => {
    const directory = await temporaryDirectory()
    for (const filename of ['absent.jpg', 'failed.nef', 'present.jpg', 'unchecked.png']) {
      await Bun.write(join(directory, filename), filename)
    }
    const requested: RemoteIdentity[][] = []
    const client = fakeClient((identities) => {
      requested.push(identities)
      return {
        data: {
          existingUploadIdentities: identities
            .filter(({ originalFilename }) => originalFilename === 'present.jpg')
            .map(({ clientKey }) => ({ clientKey, imageId: 42 })),
        },
      }
    })
    const identityExtractor: UploadIdentityExtractor = async (candidates) => ({
      identities: candidates
        .filter(({ originalFilename }) => ['absent.jpg', 'present.jpg'].includes(originalFilename))
        .map((candidate) => ({ ...candidate, capturedAt })),
      failedClientKeys: candidates
        .filter(({ originalFilename }) => originalFilename === 'failed.nef')
        .map(({ clientKey }) => clientKey),
      uncheckedClientKeys: candidates
        .filter(({ originalFilename }) => originalFilename === 'unchecked.png')
        .map(({ clientKey }) => clientKey),
    })
    const lines: string[] = []

    await expect(
      runPhotoCheck(
        { json: true, path: directory },
        jsonDependencies(client, identityExtractor, lines),
      ),
    ).rejects.toThrow('2 local photos could not be checked')

    expect(requested).toHaveLength(1)
    expect(requested[0]?.map(({ originalFilename }) => originalFilename)).toEqual([
      'absent.jpg',
      'present.jpg',
    ])
    expect(parsedReport(lines)).toEqual({
      files: [
        {
          filename: 'absent.jpg',
          imageId: null,
          path: join(directory, 'absent.jpg'),
          reason: null,
          status: 'absent',
        },
        {
          filename: 'failed.nef',
          imageId: null,
          path: join(directory, 'failed.nef'),
          reason: 'metadata-read-failed',
          status: 'unknown',
        },
        {
          filename: 'present.jpg',
          imageId: 42,
          path: join(directory, 'present.jpg'),
          reason: null,
          status: 'present',
        },
        {
          filename: 'unchecked.png',
          imageId: null,
          path: join(directory, 'unchecked.png'),
          reason: 'missing-capture-time',
          status: 'unknown',
        },
      ],
      summary: { total: 4, present: 1, absent: 1, unknown: 2 },
    })
  })

  test('reports every local path independently and renders a human summary', async () => {
    const directory = await temporaryDirectory()
    await Bun.write(join(directory, 'first', 'same.jpg'), 'first')
    await Bun.write(join(directory, 'second', 'same.jpg'), 'second')
    const requestedKeys: string[] = []
    const client = fakeClient((identities) => {
      requestedKeys.push(...identities.map(({ clientKey }) => clientKey))
      return {
        data: {
          existingUploadIdentities: identities.map(({ clientKey }) => ({
            clientKey,
            imageId: 99,
          })),
        },
      }
    })
    const identityExtractor: UploadIdentityExtractor = async (candidates) => ({
      identities: candidates.map((candidate) => ({ ...candidate, capturedAt })),
      failedClientKeys: [],
      uncheckedClientKeys: [],
    })
    const lines: string[] = []

    await runPhotoCheck({ path: directory }, jsonDependencies(client, identityExtractor, lines))

    expect(new Set(requestedKeys).size).toBe(2)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Local photo check')
    expect(lines[0]).toContain('Already in Rawback')
    expect(lines[0]).toContain('99')
    expect(lines[0]).toContain('Files')
    expect(lines[0]).toContain('2')
  })

  test('reports scanning, metadata, and Rawback progress without affecting JSON', async () => {
    const directory = await temporaryDirectory()
    for (const filename of ['first.jpg', 'notes.txt', 'second.jpg', 'unchecked.jpg']) {
      await Bun.write(join(directory, filename), filename)
    }
    const client = fakeClient(() => ({ data: { existingUploadIdentities: [] } }))
    const identityExtractor: UploadIdentityExtractor = async (candidates, options) => {
      options?.onProgress?.(1, candidates.length)
      options?.onProgress?.(2, candidates.length)
      return {
        identities: candidates.slice(0, 2).map((candidate) => ({ ...candidate, capturedAt })),
        failedClientKeys: [],
        uncheckedClientKeys: [candidates[2]!.clientKey],
      }
    }
    const lines: string[] = []
    const progress: Array<PhotoCheckProgress | null> = []

    await expect(
      runPhotoCheck(
        { json: true, path: directory },
        {
          ...jsonDependencies(client, identityExtractor, lines),
          onProgress: (next) => progress.push(next),
        },
      ),
    ).rejects.toThrow('1 local photo could not be checked')

    expect(lines).toHaveLength(1)
    expect(progress).toContainEqual({ stage: 'scanning', completed: 4 })
    expect(progress).toContainEqual({ stage: 'metadata', completed: 1, total: 3 })
    expect(progress).toContainEqual({ stage: 'metadata', completed: 3, total: 3 })
    expect(progress).toContainEqual({ stage: 'checking', completed: 1, total: 3 })
    expect(progress).toContainEqual({ stage: 'checking', completed: 3, total: 3 })
    expect(
      progress
        .filter((entry): entry is PhotoCheckProgress => entry !== null)
        .map(({ stage }) => stage)
        .filter((stage, index, stages) => stage !== stages[index - 1]),
    ).toEqual(['scanning', 'metadata', 'checking'])
    expect(progress.at(-1)).toBeNull()
  })

  test('uses 500-file batches and retains successful results after a batch failure', async () => {
    const directory = await temporaryDirectory()
    await Promise.all(
      Array.from({ length: 501 }, (_, index) =>
        Bun.write(join(directory, `photo-${index.toString().padStart(3, '0')}.jpg`), 'photo'),
      ),
    )
    const batchSizes: number[] = []
    const client = fakeClient((identities) => {
      batchSizes.push(identities.length)
      if (identities.length === 1) return { error: new Error('query unavailable') }
      return { data: { existingUploadIdentities: [] } }
    })
    const identityExtractor: UploadIdentityExtractor = async (candidates) => ({
      identities: candidates.map((candidate) => ({ ...candidate, capturedAt })),
      failedClientKeys: [],
      uncheckedClientKeys: [],
    })
    const lines: string[] = []
    const progress: Array<PhotoCheckProgress | null> = []

    await expect(
      runPhotoCheck(
        { json: true, path: directory },
        {
          ...jsonDependencies(client, identityExtractor, lines),
          onProgress: (next) => progress.push(next),
        },
      ),
    ).rejects.toThrow('1 local photo could not be checked')

    expect(batchSizes.sort((left, right) => left - right)).toEqual([1, 500])
    const report = parsedReport(lines)
    expect(report.summary).toEqual({ total: 501, present: 0, absent: 500, unknown: 1 })
    expect(report.files.at(-1)).toMatchObject({
      filename: 'photo-500.jpg',
      reason: 'remote-check-failed',
      status: 'unknown',
    })
    expect(progress).toContainEqual({ stage: 'checking', completed: 501, total: 501 })
    expect(progress.at(-1)).toBeNull()
  })

  test('reports a global metadata extraction failure without making an API request', async () => {
    const directory = await temporaryDirectory()
    await Bun.write(join(directory, 'photo.jpg'), 'photo')
    let requestCount = 0
    const client = fakeClient(() => {
      requestCount += 1
      return { data: { existingUploadIdentities: [] } }
    })
    const identityExtractor: UploadIdentityExtractor = async () => {
      throw new Error('ExifTool unavailable')
    }
    const lines: string[] = []

    await expect(
      runPhotoCheck(
        { json: true, path: directory },
        jsonDependencies(client, identityExtractor, lines),
      ),
    ).rejects.toThrow('1 local photo could not be checked')

    expect(requestCount).toBe(0)
    expect(parsedReport(lines).files[0]).toMatchObject({
      reason: 'metadata-check-failed',
      status: 'unknown',
    })
  })
})
