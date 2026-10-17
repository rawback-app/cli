import { dirname, join } from 'node:path'

import {
  type GraphqlCompatibilityClient,
  matchUploadIdentities,
  type UploadAck,
  UploadLedger,
  type UploadLedgerChange,
  type UploadLedgerEntry,
  type UploadLedgerSource,
  uploadLedgerScope,
} from '@rawback/sdk'

export const UPLOAD_LEDGER_FILENAME = 'upload-ledger.jsonl'

/**
 * The ledger lives beside the upload state — `~/.rawback/upload-ledger.jsonl`,
 * the file Desktop reads too — so a test that points the state elsewhere never
 * touches the real one.
 */
export function ledgerPathFor(statePath: string): string {
  return join(dirname(statePath), UPLOAD_LEDGER_FILENAME)
}

/** The fields of an upload candidate the ledger reads and writes. */
export interface LedgerFile {
  basename: string
  canonicalPath: string
  capturedAt?: string
  clientKey?: string
  mtimeMs: number
  size: number
}

export interface LedgerReview<File extends LedgerFile> {
  /** Files the ledger settles: skipped without reading metadata or asking the server. */
  skipped: File[]
  /**
   * Files sent before whose confirmation never came back. Their capture time
   * comes from the ledger, so they skip the metadata read but still go to the
   * server's check.
   */
  recheck: File[]
  /** Files the ledger knows nothing about. */
  unknown: File[]
}

export interface Confirmation {
  confirmed: number
  unconfirmed: number
}

/**
 * Whether an entry is enough to skip a file without asking the server — the
 * same rule `UploadManager` applies. A `server` acknowledgement is; a
 * `transfer` one only when the photo has no capture time, because the server
 * can neither confirm nor deduplicate such a photo. A `transfer`
 * acknowledgement with a capture time means the confirmation failed, and the
 * gateway answers OK even when it failed to record a photo, so it is checked
 * again.
 */
export function isSettled(entry: Pick<UploadLedgerEntry, 'ack' | 'capturedAt'>): boolean {
  return entry.ack === 'server' || !entry.capturedAt
}

/**
 * This run's view of the upload ledger shared with Desktop: which files are
 * already in the account's library, and the acknowledgements this run adds.
 *
 * Every failure here is a warning, never an error: the ledger only saves work,
 * and the gateway and the server's identity check still stop duplicates
 * without it.
 */
export class UploadAcknowledgements {
  private pending: UploadLedgerChange[] = []

  private constructor(
    private readonly ledger: UploadLedger | undefined,
    private readonly scope: string | undefined,
    private readonly warn: (message: string) => void,
  ) {}

  static async open(options: {
    path: string
    apiHost: string | undefined
    accountId: number | string
    warn: (message: string) => void
  }): Promise<UploadAcknowledgements> {
    let scope: string
    try {
      scope = uploadLedgerScope({ apiHost: options.apiHost ?? '', accountId: options.accountId })
    } catch {
      options.warn('The API host is not an http(s) URL; uploads will not be remembered locally.')
      return new UploadAcknowledgements(undefined, undefined, options.warn)
    }
    const ledger = new UploadLedger({ path: options.path })
    try {
      await ledger.load()
    } catch {
      options.warn(
        `The upload ledger at ${options.path} could not be read; every file will be checked.`,
      )
      return new UploadAcknowledgements(undefined, undefined, options.warn)
    }
    return new UploadAcknowledgements(ledger, scope, options.warn)
  }

  /** Sorts files by what the ledger knows about them, before any metadata is read. */
  review<File extends LedgerFile>(files: File[]): LedgerReview<File> {
    const review: LedgerReview<File> = { skipped: [], recheck: [], unknown: [] }
    for (const file of files) {
      const entry = this.ledger && this.scope ? this.ledger.findByFile(this.scope, file) : undefined
      if (!entry) review.unknown.push(file)
      else if (isSettled(entry)) review.skipped.push(file)
      else {
        review.recheck.push({
          ...file,
          capturedAt: entry.capturedAt!,
          clientKey: crypto.randomUUID(),
        })
      }
    }
    return review
  }

  /**
   * Whether the server has confirmed this photo at another path — a moved
   * folder or a second copy. A match is recorded under the new path so the
   * next run takes the fast path for it.
   */
  skipByIdentity(file: LedgerFile): boolean {
    if (!this.ledger || !this.scope || !file.capturedAt) return false
    const entry = this.ledger.findByIdentity(this.scope, {
      name: file.basename,
      capturedAt: file.capturedAt,
    })
    if (!entry || !isSettled(entry)) return false
    this.record(file, entry.ack, entry.source, entry.imageId)
    return true
  }

  record(file: LedgerFile, ack: UploadAck, source: UploadLedgerSource, imageId?: number): void {
    if (!this.scope) return
    this.pending.push({
      kind: 'record',
      record: {
        scope: this.scope,
        path: file.canonicalPath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        name: file.basename,
        ...(file.capturedAt ? { capturedAt: file.capturedAt } : {}),
        ...(imageId === undefined ? {} : { imageId }),
        ack,
        source,
      },
    })
  }

  forget(file: LedgerFile): void {
    if (!this.scope) return
    this.pending.push({ kind: 'forget', scope: this.scope, path: file.canonicalPath })
  }

  /** Writes what this run has learned. A failed write is a warning. */
  async flush(): Promise<void> {
    const changes = this.pending.splice(0)
    if (!this.ledger || changes.length === 0) return
    try {
      await this.ledger.apply(changes)
    } catch {
      this.warn('Uploaded files could not be recorded in the local upload ledger.')
    }
  }

  /**
   * Acknowledges files the SFTP server accepted: a `transfer` acknowledgement,
   * then the server's own answer for every photo with a capture time. The
   * gateway answers a close with OK for a new photo, a duplicate and one it
   * failed to record alike, so only that answer tells them apart. A photo the
   * server does not have is forgotten so the next run uploads it again; a
   * failed request keeps the transfer acknowledgement, which the next run
   * checks again.
   *
   * Everything is written in one append once the answer is in, so a confirmed
   * photo costs one ledger line. Nothing is lost by waiting: until then the
   * upload state's resume record covers a photo, and a transfer
   * acknowledgement would not have let a photo with a capture time be skipped
   * anyway.
   */
  async acknowledge(
    graphql: GraphqlCompatibilityClient,
    uploaded: LedgerFile[],
  ): Promise<Confirmation> {
    for (const file of uploaded) this.record(file, 'transfer', 'upload')
    const candidates = uploaded.filter(
      (file): file is LedgerFile & { capturedAt: string; clientKey: string } =>
        Boolean(file.capturedAt && file.clientKey),
    )
    const confirmation: Confirmation = { confirmed: 0, unconfirmed: 0 }
    if (candidates.length === 0) {
      await this.flush()
      return confirmation
    }

    let matches: Map<string, number>
    try {
      matches = await matchUploadIdentities(
        graphql,
        candidates.map((file) => ({
          clientKey: file.clientKey,
          originalFilename: file.basename,
          capturedAt: file.capturedAt,
        })),
      )
    } catch {
      this.warn('Rawback could not confirm the uploaded photos; they will be checked next time.')
      await this.flush()
      return confirmation
    }
    for (const file of candidates) {
      const imageId = matches.get(file.clientKey)
      if (imageId === undefined) {
        this.forget(file)
        confirmation.unconfirmed += 1
      } else {
        this.record(file, 'server', 'upload', imageId)
        confirmation.confirmed += 1
      }
    }
    await this.flush()
    return confirmation
  }
}
