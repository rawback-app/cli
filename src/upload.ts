import { lstat, readdir, realpath } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import {
  UploadPreflightDocument,
  extractUploadIdentities,
  matchUploadIdentities,
  type UploadIdentityExtractor,
  type UploadPreflightQuery,
} from '@rawback/sdk'

import type { RawbackClient } from './client.ts'
import { createRawbackClient } from './client.ts'
import { commandOutput, type ReadCommandDependencies } from './command.ts'
import {
  DEFAULT_CONFIG_PATH,
  environmentName,
  readConfig,
  resolveEnvironment,
  type SftpConfig,
} from './config.ts'
import { DEFAULT_CREDENTIALS_PATH } from './credentials.ts'
import { UploadProgressController } from './features/upload/progress.tsx'
import { uploadDryRunDocument, uploadSummaryDocument } from './features/upload/view.ts'
import { CLIENT_SOURCE, CLIENT_VERSION } from './http.ts'
import {
  createSftpClient,
  isConnectionFailure,
  type SftpClientOptions,
  type UploadTransport,
  type UploadTransportFactory,
} from './sftp-client.ts'
import { formatBytes } from './ui/format.ts'
import { findBundledExiftoolPath } from './upload-identity.ts'
import { ledgerPathFor, UploadAcknowledgements } from './upload-ledger.ts'
import { DEFAULT_UPLOAD_STATE_PATH, UploadState, type UploadStateFile } from './upload-state.ts'

export const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.bmp',
  '.avif',
  '.cr2',
  '.cr3',
  '.nef',
  '.arw',
  '.dng',
  '.raf',
  '.orf',
  '.pef',
  '.rw2',
  '.srw',
  '.x3f',
])

export interface UploadCommandOptions {
  concurrency: number
  dryRun: boolean
  path: string
  /** Ignore what this computer remembers uploading and ask the server about every file. */
  recheck?: boolean
}

export interface UploadCommandDependencies extends ReadCommandDependencies {
  client?: RawbackClient
  /** Defaults to `upload-ledger.jsonl` beside the upload state. */
  ledgerPath?: string
  sleep?: (milliseconds: number) => Promise<void>
  statePath?: string
  transportFactory?: UploadTransportFactory
  identityExtractor?: UploadIdentityExtractor
}

export interface UploadFile {
  basename: string
  canonicalPath: string
  clientKey?: string
  capturedAt?: string
  mtimeMs: number
  path: string
  size: number
}

interface UploadPreflight {
  account: string
  /** Part of the ledger scope, with the numeric user id. */
  apiHost: string
  client: RawbackClient
  endpoint: string
  files: UploadFile[]
  password: string
  quotaBytes: number
  usedBytes: number
  userId: number | string
  username: string
}

interface UploadFailure {
  error: Error
  file: UploadFile
}

const FALLBACK_BYTES_PER_SECOND = 10_000_000 / 8

function canonicalEndpoint(value: string): string {
  const url = new URL(value)
  return `sftp://${url.hostname}:${url.port || '22'}`
}

type RequiredSftpConfig = {
  [Key in 'endpoint' | 'username' | 'password']: NonNullable<SftpConfig[Key]>
} & {
  hostFingerprint?: NonNullable<SftpConfig['hostFingerprint']>
}

function requiredSftpConfig(
  config: SftpConfig | undefined,
  configPath: string,
  environment: string,
): RequiredSftpConfig {
  const missing = (['endpoint', 'username', 'password'] as const).filter((key) => !config?.[key])
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.map((key) => `sftp.${key}`).join(', ')} for the ${environment} environment in ${configPath}`,
    )
  }
  return {
    endpoint: config!.endpoint!,
    username: config!.username!,
    password: config!.password!,
    ...(config!.hostFingerprint ? { hostFingerprint: config!.hostFingerprint } : {}),
  }
}

async function checkConfigPermissions(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const information = await Bun.file(path).stat()
  if ((information.mode & 0o077) !== 0) {
    throw new Error(
      `Config ${path} contains an SFTP password and must not be accessible by group or others; run chmod 600 ${path}`,
    )
  }
}

export async function scanUploadPath(
  path: string,
  onScanned?: (completed: number) => void,
): Promise<UploadFile[]> {
  const root = resolve(path)
  const rootInfo = await lstat(root)
  if (rootInfo.isSymbolicLink()) throw new Error(`Upload path must not be a symbolic link: ${path}`)

  const files: UploadFile[] = []
  let scanned = 0
  const reportScanned = () => {
    scanned += 1
    try {
      onScanned?.(scanned)
    } catch {
      // Scanning progress is observational and must not interrupt file discovery.
    }
  }
  const addFile = async (filePath: string) => {
    const name = basename(filePath)
    const extensionIndex = name.lastIndexOf('.')
    const extension = extensionIndex < 0 ? '' : name.slice(extensionIndex).toLowerCase()
    if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) return
    const information = await Bun.file(filePath).stat()
    files.push({
      basename: name,
      canonicalPath: await realpath(filePath),
      mtimeMs: information.mtimeMs,
      path: filePath,
      size: information.size,
    })
  }

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(entryPath)
      else if (entry.isFile()) {
        try {
          await addFile(entryPath)
        } finally {
          reportScanned()
        }
      }
    }
  }

  if (rootInfo.isDirectory()) await walk(root)
  else if (rootInfo.isFile()) {
    try {
      await addFile(root)
    } finally {
      reportScanned()
    }
  } else throw new Error(`Upload path is not a regular file or directory: ${path}`)

  if (files.length === 0) {
    throw new Error(
      `No supported image or RAW files found at ${path}. Supported extensions: ${[...SUPPORTED_UPLOAD_EXTENSIONS].join(', ')}`,
    )
  }

  files.sort((left, right) => left.canonicalPath.localeCompare(right.canonicalPath))
  return files
}

async function readUploadEnvironment(dependencies: UploadCommandDependencies) {
  const configPath = dependencies.configPath ?? DEFAULT_CONFIG_PATH
  return resolveEnvironment(await readConfig(configPath), environmentName(dependencies), configPath)
}

async function createClient(dependencies: UploadCommandDependencies): Promise<RawbackClient> {
  if (dependencies.client) return dependencies.client
  const env = environmentName(dependencies)
  return createRawbackClient({
    configPath: dependencies.configPath ?? DEFAULT_CONFIG_PATH,
    credentialsPath: dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
    ...(env !== undefined ? { env } : {}),
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  })
}

function requireAccount(data: UploadPreflightQuery): NonNullable<UploadPreflightQuery['me']> {
  if (!data.me) throw new Error('Authentication check did not return an account; run rawback auth')
  return data.me
}

async function preflight(
  options: UploadCommandOptions,
  dependencies: UploadCommandDependencies,
): Promise<UploadPreflight> {
  const configPath = dependencies.configPath ?? DEFAULT_CONFIG_PATH
  const environment = await readUploadEnvironment(dependencies)
  const sftp = requiredSftpConfig(environment.sftp, configPath, environment.name)
  await checkConfigPermissions(configPath)
  const client = await createClient(dependencies)
  if (!client.credentials)
    throw new Error('Authentication credentials are missing; run rawback auth')

  const result = await client.graphql.query({ query: UploadPreflightDocument })
  if (result.error) throw result.error
  if (!result.data) throw new Error('Upload preflight did not return account data')
  const account = requireAccount(result.data)
  if (sftp.username !== account.slug) {
    throw new Error(
      `Config sftp.username is ${sftp.username}, but the authenticated account username is ${account.slug}`,
    )
  }
  if (!result.data.sftpCredentials.some((credential) => credential.enabled)) {
    throw new Error(
      'The authenticated account has no enabled SFTP credential; run rawback cred add',
    )
  }

  return {
    account: account.slug,
    apiHost: client.http.apiHost,
    client,
    endpoint: canonicalEndpoint(sftp.endpoint),
    files: await scanUploadPath(options.path),
    password: sftp.password,
    quotaBytes: Number(account.storageQuotaBytes),
    usedBytes: Number(account.storageUsedBytes),
    userId: account.id,
    username: sftp.username,
  }
}

/** The server's image id for each file it already holds, keyed by client key. */
async function remoteIdentities(
  client: RawbackClient,
  files: UploadFile[],
  dependencies: UploadCommandDependencies,
): Promise<Map<string, number>> {
  const candidates = files.filter(
    (file): file is UploadFile & { capturedAt: string; clientKey: string } =>
      Boolean(file.capturedAt && file.clientKey),
  )
  try {
    return await matchUploadIdentities(
      client.graphql,
      candidates.map((file) => ({
        clientKey: file.clientKey,
        originalFilename: file.basename,
        capturedAt: file.capturedAt,
      })),
    )
  } catch {
    commandOutput(dependencies).warning(
      'Remote duplicate checking is unavailable; continuing with SFTP verification.',
    )
    return new Map()
  }
}

async function identifyFiles(
  files: UploadFile[],
  dependencies: UploadCommandDependencies,
  metadataConcurrency?: number,
): Promise<UploadFile[]> {
  if (files.length === 0) return []
  const sidecarPath = await findBundledExiftoolPath()
  const extractor = dependencies.identityExtractor ?? extractUploadIdentities
  const keyed = files.map((file) => ({ file, clientKey: crypto.randomUUID() }))
  try {
    const extracted = await extractor(
      keyed.map(({ file, clientKey }) => ({
        clientKey,
        originalFilename: file.basename,
        path: file.path,
      })),
      {
        ...(metadataConcurrency !== undefined ? { concurrency: metadataConcurrency } : {}),
        ...(sidecarPath ? { exiftoolPath: sidecarPath } : {}),
      },
    )
    if (extracted.failedClientKeys.length > 0) {
      commandOutput(dependencies).warning(
        'Some photo metadata could not be read; those files will upload normally.',
      )
    }
    const capturedAt = new Map(
      extracted.identities.map((identity) => [identity.clientKey, identity.capturedAt]),
    )
    return keyed.map(({ file, clientKey }) => {
      const timestamp = capturedAt.get(clientKey)
      return {
        ...file,
        clientKey,
        ...(timestamp ? { capturedAt: timestamp } : {}),
      }
    })
  } catch {
    commandOutput(dependencies).warning(
      'Photo duplicate checking is unavailable; files will upload normally.',
    )
    return files
  }
}

function collapseLocalIdentities(files: UploadFile[]): UploadFile[] {
  const seen = new Set<string>()
  return files.filter((file) => {
    if (!file.capturedAt) return true
    const identity = `${file.basename}\0${file.capturedAt}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function stateFile(preflightResult: UploadPreflight, file: UploadFile): UploadStateFile {
  return {
    account: preflightResult.account,
    endpoint: preflightResult.endpoint,
    path: file.canonicalPath,
    size: file.size,
    mtimeMs: file.mtimeMs,
  }
}

async function retryConnect(
  transport: UploadTransport,
  dependencies: UploadCommandDependencies,
): Promise<void> {
  const sleep = dependencies.sleep ?? ((milliseconds) => Bun.sleep(milliseconds))
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await transport.connect()
      return
    } catch (error) {
      lastError = error
      if (!isConnectionFailure(error) || attempt === 2) throw error
      await sleep(attempt === 0 ? 250 : 1_000)
    }
  }
  throw lastError
}

async function uploadRound(
  files: UploadFile[],
  concurrency: number,
  transport: UploadTransport,
  state: UploadState,
  preflightResult: UploadPreflight,
  dependencies: UploadCommandDependencies,
  progress: UploadProgressController,
  shouldStop: () => boolean,
  uploaded: UploadFile[],
): Promise<{ failures: UploadFailure[]; uploadedBytes: number }> {
  const failures: UploadFailure[] = []
  let uploadedBytes = 0
  let next = 0
  const worker = async () => {
    while (!shouldStop()) {
      const file = files[next++]
      if (!file) return
      const persisted = stateFile(preflightResult, file)
      state.setFileStatus(persisted, 'in_progress')
      progress.start(file)
      try {
        await transport.upload(file.path, `/${file.basename}`, (bytes) => {
          progress.update(file, bytes)
        })
        state.setFileStatus(persisted, 'completed')
        uploaded.push(file)
        uploadedBytes += file.size
        progress.complete(file)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        progress.fail(file)
        state.setFileStatus(persisted, 'failed', failure.message)
        failures.push({ error: failure, file })
        commandOutput(dependencies).warning(`Failed ${file.basename}: ${failure.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return { failures, uploadedBytes }
}

function transportOptions(
  preflightResult: UploadPreflight,
  state: UploadState,
  configured: SftpConfig,
  channelCount: number,
): SftpClientOptions {
  return {
    channelCount,
    endpoint: preflightResult.endpoint,
    username: preflightResult.username,
    password: preflightResult.password,
    knownHosts: state,
    identity: { source: CLIENT_SOURCE, version: CLIENT_VERSION },
    ...(configured.hostFingerprint ? { hostFingerprint: configured.hostFingerprint } : {}),
  }
}

export async function runUpload(
  options: UploadCommandOptions,
  dependencies: UploadCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const preflightResult = await ui.withActivity('Preparing upload…', () =>
    preflight(options, dependencies),
  )
  const environment = await readUploadEnvironment(dependencies)
  const statePath = dependencies.statePath ?? DEFAULT_UPLOAD_STATE_PATH
  const state = options.dryRun
    ? await UploadState.openReadonly(statePath)
    : await UploadState.open(statePath)
  const acks = await UploadAcknowledgements.open({
    path: dependencies.ledgerPath ?? ledgerPathFor(statePath),
    apiHost: preflightResult.apiHost,
    accountId: preflightResult.userId,
    warn: (message) => ui.warning(message),
  })

  try {
    // What this computer already uploaded is settled before any metadata is
    // read, so re-selecting a mostly uploaded card costs a stat per file.
    const review = options.recheck
      ? { skipped: [], recheck: [], unknown: preflightResult.files }
      : acks.review(preflightResult.files)
    let alreadyUploaded = review.skipped.length
    const identified: UploadFile[] = [...review.recheck]
    for (const file of await identifyFiles(
      review.unknown,
      dependencies,
      environment.metadata?.concurrency,
    )) {
      if (!options.recheck && acks.skipByIdentity(file)) {
        alreadyUploaded += 1
      } else if (
        // The upload-state resume record predates the ledger. Like a transfer
        // acknowledgement, it is only trusted for photos without a capture
        // time; the rest go to the server's check, and are recorded from there.
        !options.recheck &&
        !file.capturedAt &&
        state?.isCompleted(stateFile(preflightResult, file))
      ) {
        acks.record(file, 'transfer', 'upload')
        alreadyUploaded += 1
      } else {
        identified.push(file)
      }
    }
    const localPending = collapseLocalIdentities(identified)
    const remote = await remoteIdentities(preflightResult.client, localPending, dependencies)
    const pending: UploadFile[] = []
    for (const file of localPending) {
      const imageId = file.clientKey ? remote.get(file.clientKey) : undefined
      if (imageId === undefined) pending.push(file)
      else acks.record(file, 'server', 'remote', imageId)
    }
    const pendingBytes = pending.reduce((sum, file) => sum + file.size, 0)
    const remainingQuota = Math.max(0, preflightResult.quotaBytes - preflightResult.usedBytes)
    if (pendingBytes > remainingQuota) {
      throw new Error(
        `Upload needs ${formatBytes(pendingBytes)}, but the account only has ${formatBytes(remainingQuota)} remaining`,
      )
    }

    if (options.dryRun) {
      const estimate = state?.throughput(
        preflightResult.account,
        preflightResult.endpoint,
        options.concurrency,
      )
      const rate = estimate?.bytesPerSecond ?? FALLBACK_BYTES_PER_SECOND
      const source = estimate?.source ?? '10 Mbps fallback'
      ui.document(
        uploadDryRunDocument({
          alreadyUploaded,
          estimatedSeconds: pendingBytes / rate,
          existingRemote: remote.size,
          files: pending.length,
          rate,
          rateSource: source,
          totalBytes: pendingBytes,
        }),
      )
      return
    }

    if (!state) throw new Error('Unable to open upload progress database')
    await acks.flush()
    if (pending.length === 0) {
      ui.info('Nothing to upload; all supported files are already uploaded or remote.')
      return
    }

    await state.acquireLock(preflightResult.account, preflightResult.endpoint)
    let transport: UploadTransport | null = null
    let interrupted = false
    let signalCount = 0
    const onInterrupt = () => {
      signalCount += 1
      interrupted = true
      if (signalCount === 1) {
        ui.warning(
          'Interrupt received; finishing active uploads. Press Ctrl-C again to disconnect.',
        )
      } else void transport?.close()
    }
    process.on('SIGINT', onInterrupt)

    try {
      state.resetInterrupted(preflightResult.account, preflightResult.endpoint)
      for (const file of pending) state.prepareFile(stateFile(preflightResult, file))
      const runId = state.beginRun(
        preflightResult.account,
        preflightResult.endpoint,
        options.concurrency,
      )
      const factory = dependencies.transportFactory ?? createSftpClient
      transport = factory(
        transportOptions(
          preflightResult,
          state,
          environment.sftp ?? {},
          Math.min(options.concurrency, pending.length),
        ),
      )
      await retryConnect(transport, dependencies)

      let remaining = pending
      let totalUploaded = 0
      const progress = new UploadProgressController(pendingBytes, pending.length, ui)
      const permanentFailures: UploadFailure[] = []
      const uploaded: UploadFile[] = []
      for (let round = 0; round < 3 && remaining.length > 0 && !interrupted; round += 1) {
        const result = await uploadRound(
          remaining,
          options.concurrency,
          transport,
          state,
          preflightResult,
          dependencies,
          progress,
          () => interrupted,
          uploaded,
        )
        totalUploaded += result.uploadedBytes
        const reconnectable = result.failures.filter(({ error }) => isConnectionFailure(error))
        permanentFailures.push(
          ...result.failures.filter(({ error }) => !isConnectionFailure(error)),
        )
        remaining = reconnectable.map(({ file }) => file)
        if (remaining.length > 0 && round < 2 && !interrupted) {
          ui.warning(`Connection dropped; reconnecting to retry ${remaining.length} file(s).`)
          await transport.close()
          await retryConnect(transport, dependencies)
        }
      }
      if (!interrupted) {
        permanentFailures.push(
          ...remaining.map((file) => ({
            file,
            error: new Error('SFTP connection retry limit reached'),
          })),
        )
      }
      await progress.finish()
      const confirmation = await acks.acknowledge(preflightResult.client.graphql, uploaded)
      if (confirmation.unconfirmed > 0) {
        ui.warning(
          `Rawback did not confirm ${confirmation.unconfirmed} uploaded photo${confirmation.unconfirmed === 1 ? '' : 's'}; ${confirmation.unconfirmed === 1 ? 'it' : 'they'} will be uploaded again next time.`,
        )
      }
      for (const failure of permanentFailures) {
        state.setFileStatus(
          stateFile(preflightResult, failure.file),
          'failed',
          failure.error.message,
        )
      }

      const status = interrupted
        ? 'cancelled'
        : permanentFailures.length > 0
          ? 'partial'
          : 'completed'
      state.finishRun(runId, totalUploaded, status)
      ui.document(
        uploadSummaryDocument({
          cancelled: interrupted,
          confirmed: confirmation.confirmed,
          failedFiles: permanentFailures.length,
          totalBytes: totalUploaded,
          unconfirmed: confirmation.unconfirmed,
        }),
      )
      if (interrupted) throw new Error('Upload cancelled')
      if (permanentFailures.length > 0) {
        throw new Error(`Upload completed with ${permanentFailures.length} failed file(s)`)
      }
    } finally {
      process.removeListener('SIGINT', onInterrupt)
      await transport?.close()
      await state.releaseLock(preflightResult.account, preflightResult.endpoint)
    }
  } finally {
    await state?.close()
  }
}
