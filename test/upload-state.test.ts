import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UploadState, type UploadStateFile } from '../src/upload-state.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-upload-state-'))
  temporaryDirectories.push(directory)
  return join(directory, 'progress.sqlite')
}

function file(size = 100): UploadStateFile {
  return {
    account: 'annatarhe',
    endpoint: 'sftp://ftp.rawback.app:2222',
    path: '/photos/image.jpg',
    size,
    mtimeMs: 1234,
  }
}

describe('upload progress state', () => {
  test('persists completed-file identity and trusted host keys', async () => {
    const path = await statePath()
    const state = await UploadState.open(path)
    state.prepareFile(file())
    expect(state.isCompleted(file())).toBe(false)
    state.setFileStatus(file(), 'completed')
    expect(state.isCompleted(file())).toBe(true)
    expect(state.isCompleted(file(101))).toBe(false)

    state.trustFingerprint('ftp.rawback.app', 2222, 'SHA256:first')
    state.trustFingerprint('ftp.rawback.app', 2222, 'SHA256:first')
    expect(state.getFingerprint('ftp.rawback.app', 2222)).toBe('SHA256:first')
    expect(() => state.trustFingerprint('ftp.rawback.app', 2222, 'SHA256:changed')).toThrow(
      'host key changed',
    )
    state.close()

    const readonly = await UploadState.openReadonly(path)
    expect(readonly?.isCompleted(file())).toBe(true)
    expect(readonly?.getFingerprint('ftp.rawback.app', 2222)).toBe('SHA256:first')
    readonly?.close()
  })

  test('records throughput history for dry-run estimates', async () => {
    const path = await statePath()
    const state = await UploadState.open(path)
    const runId = state.beginRun('annatarhe', 'sftp://ftp.rawback.app:2222', 4)
    await Bun.sleep(5)
    state.finishRun(runId, 10_000, 'completed')

    const estimate = state.throughput('annatarhe', 'sftp://ftp.rawback.app:2222', 4)
    expect(estimate?.source).toBe('matching concurrency history')
    expect(estimate?.bytesPerSecond).toBeGreaterThan(0)
    state.close()
  })
})
