import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import {
  DEFAULT_UPLOAD_STATE_PATH,
  type PortableUploadState,
  type StoredUploadTask,
  UploadStateStore,
} from '@rawback/sdk'

export { DEFAULT_UPLOAD_STATE_PATH }
export const LEGACY_UPLOAD_STATE_PATH = join(homedir(), '.rawback', 'upload-progress.sqlite')

export type UploadFileStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface UploadStateFile {
  account: string
  endpoint: string
  path: string
  size: number
  mtimeMs: number
}

interface ThroughputRow {
  bytes: number
  durationMs: number
}

interface CliRun {
  id: number
  account: string
  endpoint: string
  concurrency: number
  startedAt: number
  finishedAt?: number
  bytes: number
  status: 'running' | 'completed' | 'partial' | 'cancelled'
}

interface CliMetadata {
  nextRunId: number
  runs: CliRun[]
}

export interface ThroughputEstimate {
  bytesPerSecond: number
  source: 'matching concurrency history' | 'endpoint history'
}

export class UploadStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UploadStateError'
  }
}

function terminalStatus(status: StoredUploadTask['status']): boolean {
  return ['success', 'failed', 'cancelled', 'skipped'].includes(status)
}

function taskStatus(status: UploadFileStatus): StoredUploadTask['status'] {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'failed'
    case 'in_progress':
      return 'uploading'
    case 'pending':
      return 'queued'
  }
}

function metadata(state: PortableUploadState): CliMetadata {
  const value = state.metadata?.cli
  if (typeof value !== 'object' || value === null) return { nextRunId: 1, runs: [] }
  const candidate = value as Partial<CliMetadata>
  return {
    nextRunId:
      typeof candidate.nextRunId === 'number' && candidate.nextRunId > 0 ? candidate.nextRunId : 1,
    runs: Array.isArray(candidate.runs) ? candidate.runs : [],
  }
}

function withMetadata(state: PortableUploadState, cli: CliMetadata): void {
  state.metadata = { ...state.metadata, cli }
}

function sameFile(task: StoredUploadTask, file: UploadStateFile): boolean {
  return (
    task.accountId === file.account &&
    task.endpoint === file.endpoint &&
    task.canonicalPath === file.path
  )
}

export class UploadState {
  private pendingWrite: Promise<void> = Promise.resolve()
  private releaseLease: (() => Promise<void>) | undefined

  private constructor(
    private readonly store: UploadStateStore,
    private state: PortableUploadState,
    readonly path: string,
    readonly readonly: boolean,
  ) {}

  static async open(path = DEFAULT_UPLOAD_STATE_PATH): Promise<UploadState> {
    const store = new UploadStateStore(path)
    if (path === DEFAULT_UPLOAD_STATE_PATH) await migrateLegacySqlite(store)
    return new UploadState(store, await store.read(), path, false)
  }

  static async openReadonly(path = DEFAULT_UPLOAD_STATE_PATH): Promise<UploadState | null> {
    if (path === DEFAULT_UPLOAD_STATE_PATH) await migrateLegacySqlite(new UploadStateStore(path))
    try {
      await Bun.file(path).stat()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const store = new UploadStateStore(path)
    return new UploadState(store, await store.read(), path, true)
  }

  async close(): Promise<void> {
    await this.pendingWrite
    if (this.releaseLease) {
      await this.releaseLease()
      this.releaseLease = undefined
    }
  }

  private assertWritable(): void {
    if (this.readonly) throw new UploadStateError('Upload progress is read-only')
  }

  isCompleted(file: UploadStateFile): boolean {
    return this.state.tasks.some(
      (task) =>
        sameFile(task, file) &&
        task.size === file.size &&
        task.mtimeMs === file.mtimeMs &&
        task.status === 'success',
    )
  }

  prepareFile(file: UploadStateFile): void {
    this.assertWritable()
    const existing = this.state.tasks.find((task) => sameFile(task, file))
    const preserve =
      existing?.status === 'success' &&
      existing.size === file.size &&
      existing.mtimeMs === file.mtimeMs
    if (existing) {
      existing.size = file.size
      existing.mtimeMs = file.mtimeMs
      existing.status = preserve ? 'success' : 'queued'
      existing.progress = preserve ? 100 : 0
      existing.transferredBytes = preserve ? file.size : 0
      delete existing.error
      if (!preserve) delete existing.finishedAt
    } else {
      this.state.tasks.push({
        id: crypto.randomUUID(),
        accountId: file.account,
        batchId: `cli:${file.account}:${file.endpoint}`,
        canonicalPath: file.path,
        endpoint: file.endpoint,
        path: file.path,
        mtimeMs: file.mtimeMs,
        name: basename(file.path),
        size: file.size,
        status: 'queued',
        progress: 0,
        transferredBytes: 0,
        addedAt: new Date().toISOString(),
      })
    }
    this.persist()
  }

  setFileStatus(file: UploadStateFile, status: UploadFileStatus, error?: string): void {
    this.assertWritable()
    const task = this.state.tasks.find((candidate) => sameFile(candidate, file))
    if (!task) return
    task.status = taskStatus(status)
    task.progress = status === 'completed' ? 100 : 0
    task.transferredBytes = status === 'completed' ? file.size : 0
    if (error) task.error = error
    else delete task.error
    if (terminalStatus(task.status)) task.finishedAt = new Date().toISOString()
    else delete task.finishedAt
    this.persist()
  }

  resetInterrupted(account: string, endpoint: string): void {
    this.assertWritable()
    for (const task of this.state.tasks) {
      if (
        task.accountId === account &&
        task.endpoint === endpoint &&
        ['uploading', 'failed', 'interrupted'].includes(task.status)
      ) {
        task.status = 'queued'
        task.progress = 0
        task.transferredBytes = 0
        delete task.error
        delete task.finishedAt
      }
    }
    this.persist()
  }

  async acquireLock(account: string, endpoint: string): Promise<void> {
    this.assertWritable()
    if (this.releaseLease) return
    try {
      this.releaseLease = await this.store.acquireLease(`upload:${account}:${endpoint}`)
    } catch (error) {
      throw new UploadStateError(
        `Another upload is already running for ${account} on ${endpoint}`,
        {
          cause: error,
        },
      )
    }
  }

  async releaseLock(_account: string, _endpoint: string): Promise<void> {
    if (!this.releaseLease) return
    await this.releaseLease()
    this.releaseLease = undefined
  }

  beginRun(account: string, endpoint: string, concurrency: number): number {
    this.assertWritable()
    const cli = metadata(this.state)
    const id = cli.nextRunId++
    cli.runs.push({
      id,
      account,
      endpoint,
      concurrency,
      startedAt: Date.now(),
      bytes: 0,
      status: 'running',
    })
    withMetadata(this.state, cli)
    this.persist()
    return id
  }

  finishRun(runId: number, bytes: number, status: 'completed' | 'partial' | 'cancelled'): void {
    this.assertWritable()
    const cli = metadata(this.state)
    const run = cli.runs.find(({ id }) => id === runId)
    if (!run) return
    run.finishedAt = Date.now()
    run.bytes = bytes
    run.status = status
    withMetadata(this.state, cli)
    this.persist()
  }

  throughput(account: string, endpoint: string, concurrency: number): ThroughputEstimate | null {
    const runs = metadata(this.state).runs.filter(
      (run) =>
        run.account === account &&
        run.endpoint === endpoint &&
        ['completed', 'partial'].includes(run.status) &&
        run.bytes > 0 &&
        run.finishedAt !== undefined &&
        run.finishedAt > run.startedAt,
    )
    const estimate = (rows: CliRun[], source: ThroughputEstimate['source']) => {
      const aggregate = rows.reduce<ThroughputRow>(
        (total, run) => ({
          bytes: total.bytes + run.bytes,
          durationMs: total.durationMs + (run.finishedAt! - run.startedAt),
        }),
        { bytes: 0, durationMs: 0 },
      )
      return aggregate.bytes > 0 && aggregate.durationMs > 0
        ? { bytesPerSecond: (aggregate.bytes * 1_000) / aggregate.durationMs, source }
        : null
    }
    return (
      estimate(
        runs.filter((run) => run.concurrency === concurrency),
        'matching concurrency history',
      ) ?? estimate(runs, 'endpoint history')
    )
  }

  getFingerprint(host: string, port: number): string | null {
    return this.state.knownHosts[`${host}:${port}`] ?? null
  }

  trustFingerprint(host: string, port: number, fingerprint: string): void {
    this.assertWritable()
    const key = `${host}:${port}`
    const existing = this.state.knownHosts[key]
    if (existing && existing !== fingerprint) {
      throw new UploadStateError(
        `SFTP host key changed for ${host}:${port}: expected ${existing}, received ${fingerprint}`,
      )
    }
    if (!existing) {
      this.state.knownHosts[key] = fingerprint
      this.persist()
    }
  }

  private persist(): void {
    const snapshot = structuredClone(this.state)
    this.pendingWrite = this.pendingWrite.then(() => this.store.write(snapshot))
  }
}

export async function migrateLegacyUploadState(
  legacyPath: string,
  targetPath: string,
): Promise<void> {
  await migrateLegacySqlite(new UploadStateStore(targetPath), legacyPath)
}

async function migrateLegacySqlite(
  store: UploadStateStore,
  legacyPath = LEGACY_UPLOAD_STATE_PATH,
): Promise<void> {
  const current = await store.read()
  if (current.migratedFrom?.includes('rawback-cli-sqlite-v1')) return
  try {
    await Bun.file(legacyPath).stat()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  let database: Database | undefined
  try {
    database = new Database(legacyPath, { readonly: true, strict: true })
    const rows = database
      .query(
        'SELECT account, endpoint, canonical_path, size, mtime_ms, status, error, updated_at FROM upload_files',
      )
      .all() as Array<{
      account: string
      endpoint: string
      canonical_path: string
      size: number
      mtime_ms: number
      status: UploadFileStatus
      error: string | null
      updated_at: number
    }>
    const tasks = rows.map((row): StoredUploadTask => {
      const status =
        row.status === 'completed' ? 'success' : row.status === 'failed' ? 'failed' : 'interrupted'
      const at = new Date(row.updated_at).toISOString()
      return {
        id: crypto.randomUUID(),
        accountId: row.account,
        batchId: `cli:${row.account}:${row.endpoint}`,
        canonicalPath: row.canonical_path,
        endpoint: row.endpoint,
        path: row.canonical_path,
        mtimeMs: row.mtime_ms,
        name: basename(row.canonical_path),
        size: row.size,
        status,
        progress: status === 'success' ? 100 : 0,
        transferredBytes: status === 'success' ? row.size : 0,
        addedAt: at,
        ...(row.error ? { error: row.error } : {}),
        ...(terminalStatus(status) ? { finishedAt: at } : {}),
      }
    })
    let knownHosts: Record<string, string> = {}
    try {
      const hostRows = database
        .query('SELECT host, port, fingerprint FROM known_hosts')
        .all() as Array<{
        host: string
        port: number
        fingerprint: string
      }>
      knownHosts = Object.fromEntries(
        hostRows.map(({ host, port, fingerprint }) => [`${host}:${port}`, fingerprint]),
      )
    } catch {
      // Older databases may not contain host-key state.
    }
    await store.importLegacy('rawback-cli-sqlite-v1', { tasks, knownHosts })
  } catch (error) {
    throw new UploadStateError(`Unable to migrate upload progress from ${legacyPath}`, {
      cause: error,
    })
  } finally {
    database?.close()
  }
}
