import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UploadState, migrateLegacyUploadState, type UploadStateFile } from '../src/upload-state.ts'

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
    await state.close()

    const readonly = await UploadState.openReadonly(path)
    expect(readonly?.isCompleted(file())).toBe(true)
    expect(readonly?.getFingerprint('ftp.rawback.app', 2222)).toBe('SHA256:first')
    await readonly?.close()
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
    await state.close()
  })

  test('imports completed identities and host keys from the legacy SQLite store', async () => {
    const legacyPath = await statePath()
    const targetPath = legacyPath + '.json'
    const database = new Database(legacyPath, { create: true })
    database.exec(`
      CREATE TABLE upload_files (
        account TEXT, endpoint TEXT, canonical_path TEXT, size INTEGER,
        mtime_ms REAL, status TEXT, error TEXT, updated_at INTEGER
      );
      CREATE TABLE known_hosts (host TEXT, port INTEGER, fingerprint TEXT);
    `)
    database
      .query('INSERT INTO upload_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        'annatarhe',
        'sftp://ftp.rawback.app:2222',
        '/photos/image.jpg',
        100,
        1234,
        'completed',
        null,
        Date.now(),
      )
    database
      .query('INSERT INTO known_hosts VALUES (?, ?, ?)')
      .run('ftp.rawback.app', 2222, 'SHA256:legacy')
    database.close()

    await migrateLegacyUploadState(legacyPath, targetPath)
    await migrateLegacyUploadState(legacyPath, targetPath)
    const migrated = await UploadState.openReadonly(targetPath)

    expect(migrated?.isCompleted(file())).toBe(true)
    expect(migrated?.getFingerprint('ftp.rawback.app', 2222)).toBe('SHA256:legacy')
    await migrated?.close()
  })
})
