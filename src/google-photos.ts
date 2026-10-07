import { readFile } from 'node:fs/promises'

import {
  type GooglePhotosAccountSummary,
  GooglePhotosErrorReason,
  type GooglePhotosExportInput,
  type GooglePhotosExportPreviewSummary,
  type GooglePhotosJobDetail,
  GooglePhotosJobNotFoundError,
  type GooglePhotosJobSummary,
  type GooglePhotosPickedItemSummary,
  GooglePhotosService,
  type GooglePhotosServiceOptions,
  type GooglePhotosStatusSummary,
  GooglePhotosTimeoutError,
  googlePhotosErrorReason,
  googlePhotosUnavailableError,
  isGooglePhotosJobFinished,
  RawbackGraphqlError,
} from '@rawback/sdk'

import { parsePositiveIds, validatePositiveId } from './albums.ts'
import { commandOutput, createCommandClient, type ReadCommandDependencies } from './command.ts'
import {
  describeGoogleErrorLabel,
  exportPreviewDocument,
  googleStatusDocument,
  jobDetailDocument,
  jobDocument,
  jobListDocument,
  jobProgressLabel,
  pickedItemsDocument,
  type PickedItemsSummary,
} from './features/google-photos/view.ts'
import { formatBytes, formatCount } from './ui/format.ts'
import type { UiTone } from './ui/model.ts'
import { type CommandOutput, noticeDocument } from './ui/output.tsx'
import { browserCommand, defaultOpen } from './web.ts'

export interface GooglePhotosPrompts {
  confirm(message: string, defaultAnswer: boolean): Promise<boolean>
}

export interface GooglePhotosCommandDependencies extends ReadCommandDependencies {
  prompts?: GooglePhotosPrompts
  open?: (command: string, args: string[]) => Promise<number>
  platform?: NodeJS.Platform
  /** The SDK's polling clock and timer; tests make waiting instant. */
  polling?: GooglePhotosServiceOptions
  /** Subscribes to Ctrl-C and returns the unsubscribe. */
  onInterrupt?: (handler: () => void) => () => void
  /** Reads `--images-file -`. */
  readStdin?: () => Promise<string>
  /** Wall clock that paces plain progress lines. */
  now?: () => number
}

/**
 * Ctrl-C while waiting: the command stops, explains what is left behind, and
 * exits 130. `runCommand` recognises it by name, which keeps the SDK out of
 * `cli.ts`'s startup path.
 */
export class CommandInterruptedError extends Error {
  override readonly name = 'CommandInterruptedError'
}

export const GOOGLE_EXPORT_FILES = ['original', 'fullsize'] as const
export const GOOGLE_JOB_KINDS = ['import', 'export'] as const
export const GOOGLE_JOB_ITEM_STATUSES = ['pending', 'done', 'skipped', 'failed'] as const
export const DEFAULT_GOOGLE_ALBUM_TITLE = 'Rawback'

/** The server's cap on albums in one export selection. */
const MAX_EXPORT_ALBUMS = 100
/** Without a terminal, one progress line at most this often, plus one per state change. */
const PLAIN_PROGRESS_INTERVAL_MS = 30_000

const REASON_MESSAGES: Record<GooglePhotosErrorReason, string> = {
  [GooglePhotosErrorReason.Unavailable]: 'Google Photos is not enabled on this server.',
  [GooglePhotosErrorReason.NotConnected]:
    "Google Photos is not connected. Run 'rawback google connect' to link your Google account.",
  [GooglePhotosErrorReason.NeedsReauth]:
    "Google no longer accepts Rawback's saved access. Run 'rawback google connect' to reconnect.",
  [GooglePhotosErrorReason.MissingScope]:
    "Google Photos permission was not granted. Run 'rawback google connect' and allow access on Google's consent screen.",
  [GooglePhotosErrorReason.JobActive]:
    "Another Google Photos transfer of this kind is already running. See 'rawback google jobs'.",
  [GooglePhotosErrorReason.NothingPicked]:
    "Nothing was picked in Google Photos. Run 'rawback import google' and pick at least one photo.",
}

/**
 * Turns the server's Google Photos reasons, and the SDK's polling errors, into
 * a message that says what to run next. Anything else passes through as is.
 */
export function describeGooglePhotosError(error: unknown): unknown {
  if (error instanceof GooglePhotosTimeoutError) {
    return new Error(
      error.waitingFor === 'connection'
        ? "Timed out waiting for Google authorization. Run 'rawback google connect' to try again."
        : "The Google Photos picker closed before anything was picked. Run 'rawback import google' to start again.",
      { cause: error },
    )
  }
  if (error instanceof GooglePhotosJobNotFoundError) {
    return new Error(`Google Photos job ${String(error.jobId)} was not found.`, { cause: error })
  }
  const reason = googlePhotosErrorReason(error)
  if (reason === undefined) return error
  // The trace ID lives on the original error's headers, which the wrapper
  // does not carry, so it is put into the message instead.
  const traceId = error instanceof RawbackGraphqlError ? error.traceId : undefined
  const message = REASON_MESSAGES[reason] + (traceId ? ` Trace ID: ${traceId}.` : '')
  return new Error(message, { cause: error })
}

async function translated<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw describeGooglePhotosError(error)
  }
}

/** Runs one waiting step, turning an abort into the message for that step. */
async function stage<T>(signal: AbortSignal, message: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (signal.aborted) throw new CommandInterruptedError(message, { cause: error })
    throw error
  }
}

function defaultOnInterrupt(handler: () => void): () => void {
  let count = 0
  const listener = () => {
    count += 1
    if (count === 1) {
      handler()
      return
    }
    // A second Ctrl-C means stop now, whatever is still being cleaned up.
    process.off('SIGINT', listener)
    process.exitCode = 130
    process.kill(process.pid, 'SIGINT')
  }
  process.on('SIGINT', listener)
  return () => process.off('SIGINT', listener)
}

function defaultPrompts(nonInteractiveMessage: string): GooglePhotosPrompts {
  return {
    async confirm(message, defaultAnswer) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(nonInteractiveMessage)
      const { confirm } = await import('@inquirer/prompts')
      return confirm({ default: defaultAnswer, message })
    },
  }
}

async function googlePhotosClient(
  dependencies: GooglePhotosCommandDependencies,
): Promise<GooglePhotosService> {
  const client = await createCommandClient(dependencies)
  return new GooglePhotosService(client.graphql, dependencies.polling ?? {})
}

/** Prose goes to stdout for people and to stderr under `--json`, which owns stdout. */
function say(ui: CommandOutput, json: boolean, message: string, tone: UiTone = 'info'): void {
  const document = noticeDocument(message, tone)
  if (json) ui.documentError(document)
  else ui.document(document)
}

/** Shows a link on stderr — raw, so it stays copyable — and tries to open it. */
async function openInBrowser(
  ui: CommandOutput,
  dependencies: GooglePhotosCommandDependencies,
  intro: string,
  url: string,
): Promise<void> {
  ui.documentError(noticeDocument(intro, 'info'))
  ui.rawError(url)
  const [command, args] = browserCommand(dependencies.platform ?? process.platform, url)
  try {
    const exitCode = await (dependencies.open ?? defaultOpen)(command, args)
    if (exitCode !== 0) {
      ui.warning('Could not open the browser automatically. Use the link shown above.')
    }
  } catch {
    ui.warning('Could not open the browser automatically. Use the link shown above.')
  }
}

/** A spinner on a terminal; one stderr line otherwise. */
async function waiting<T>(
  ui: CommandOutput,
  json: boolean,
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const live = !json && ui.interactive
  if (!live) ui.documentError(noticeDocument(label, 'info'))
  return ui.withActivity(label, run, live)
}

export function serializeGoogleAccount(account: GooglePhotosAccountSummary) {
  return {
    email: account.email,
    name: account.name,
    avatar: account.avatar,
    canImport: account.canImport,
    canExport: account.canExport,
    needsReauth: account.needsReauth,
    connectedAt: account.connectedAt,
  }
}

export function serializeGoogleJob(job: GooglePhotosJobSummary) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    totalItems: job.totalItems,
    doneItems: job.doneItems,
    skippedItems: job.skippedItems,
    failedItems: job.failedItems,
    transferredBytes: job.transferredBytes,
    albumTitle: job.albumTitle ?? null,
    albumUrl: job.albumUrl ?? null,
    exportFile: job.exportFile,
    error: job.error ?? null,
    pausedUntil: job.pausedUntil ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    upload: job.upload
      ? { id: job.upload.id, sessionId: job.upload.sessionId, status: job.upload.status }
      : null,
  }
}

function serializeJobDetail(job: GooglePhotosJobDetail) {
  return {
    ...serializeGoogleJob(job),
    items: job.items.map((item) => ({
      id: item.id,
      status: item.status,
      filename: item.filename,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      imageId: item.image?.id ?? null,
      googleUrl: item.googleUrl ?? null,
      error: item.error ?? null,
    })),
  }
}

function serializeStatus(status: GooglePhotosStatusSummary) {
  return {
    available: status.available,
    account: status.account ? serializeGoogleAccount(status.account) : null,
    activeImport: status.activeImport ? serializeGoogleJob(status.activeImport) : null,
    activeExport: status.activeExport ? serializeGoogleJob(status.activeExport) : null,
    maxPickerItems: status.maxPickerItems,
    maxExportItems: status.maxExportItems,
  }
}

function serializePreview(preview: GooglePhotosExportPreviewSummary) {
  return {
    count: preview.count,
    totalBytes: preview.totalBytes,
    alreadyExported: preview.alreadyExported,
  }
}

type Direction = 'import' | 'export'

function allows(account: GooglePhotosAccountSummary, direction: Direction): boolean {
  return direction === 'import' ? account.canImport : account.canExport
}

function isUsable(account: GooglePhotosAccountSummary, direction: Direction): boolean {
  return !account.needsReauth && allows(account, direction)
}

function permissionName(direction: Direction): string {
  return direction === 'import' ? 'read photos you pick' : 'add photos to your library'
}

interface FlowContext {
  dependencies: GooglePhotosCommandDependencies
  google: GooglePhotosService
  json: boolean
  signal: AbortSignal
  ui: CommandOutput
}

/** Sends the user through Google's consent screen and waits until it is done. */
async function connectAccount(
  context: FlowContext,
  direction: Direction | undefined,
  why: string,
): Promise<GooglePhotosAccountSummary> {
  const { google, json, signal, ui } = context
  ui.documentError(noticeDocument(why, 'info'))
  const start = await google.connect({ client: 'cli', signal })
  await openInBrowser(
    ui,
    context.dependencies,
    'Allow Rawback to use Google Photos in your browser:',
    start.authorizationUrl,
  )
  const account = await stage(signal, 'Stopped waiting for Google authorization.', () =>
    waiting(ui, json, 'Waiting for Google authorization…', () =>
      google.waitForConnection({
        expiresAt: start.expiresAt,
        signal,
        ...(direction ? { require: direction } : {}),
      }),
    ),
  )
  say(ui, json, `Connected Google Photos as ${account.email}.`, 'success')
  return account
}

async function ensureConnected(
  context: FlowContext,
  status: GooglePhotosStatusSummary,
  direction: Direction,
): Promise<GooglePhotosAccountSummary> {
  const account = status.account
  if (account && isUsable(account, direction)) return account
  const why = !account
    ? 'Connect a Google account to continue.'
    : account.needsReauth
      ? 'Google needs to be reconnected.'
      : `Rawback is not allowed to ${permissionName(direction)}; allow it on Google's consent screen.`
  return connectAccount(context, direction, why)
}

function activeJobError(job: GooglePhotosJobSummary): Error {
  const id = String(job.id)
  return new Error(
    `A Google Photos ${job.kind} is already running (job ${id}). Follow it with 'rawback google job ${id} --watch' or stop it with 'rawback google cancel ${id}'.`,
  )
}

interface JobProgress {
  report(job: GooglePhotosJobSummary): void
  latest(): GooglePhotosJobSummary
  stop(): Promise<void>
}

function startJobProgress(context: FlowContext, initial: GooglePhotosJobSummary): JobProgress {
  const { json, ui } = context
  const now = context.dependencies.now ?? Date.now
  const live = !json && ui.interactive
  const activity = ui.startActivity(jobProgressLabel(initial), live)
  let latest = initial
  let lastState: string | undefined
  let lastAt = 0
  const report = (job: GooglePhotosJobSummary) => {
    latest = job
    if (live) {
      activity.update(jobProgressLabel(job))
      return
    }
    // The summary printed at the end covers the final state.
    if (isGooglePhotosJobFinished(job)) return
    const state = `${job.status}|${job.pausedUntil ?? ''}`
    if (state === lastState && now() - lastAt < PLAIN_PROGRESS_INTERVAL_MS) return
    lastState = state
    lastAt = now()
    ui.documentError(noticeDocument(jobProgressLabel(job), 'info'))
  }
  report(initial)
  return { report, latest: () => latest, stop: () => activity.stop() }
}

function followHint(job: GooglePhotosJobSummary): string {
  return `Follow it with 'rawback google job ${String(job.id)} --watch'.`
}

/**
 * Watches a job to the end, or — on Ctrl-C — reports where it got to and
 * leaves it running on the server.
 */
async function watchToEnd(
  context: FlowContext,
  job: GooglePhotosJobSummary,
  report: (job: GooglePhotosJobSummary, finished: boolean) => void,
): Promise<GooglePhotosJobSummary> {
  const progress = startJobProgress(context, job)
  let final: GooglePhotosJobSummary
  try {
    final = await context.google.watchJob(job.id, {
      signal: context.signal,
      onProgress: progress.report,
    })
  } catch (error) {
    await progress.stop()
    if (!context.signal.aborted) throw error
    report(progress.latest(), false)
    throw new CommandInterruptedError(
      `Stopped watching. The ${job.kind} continues on the server as job ${String(job.id)}. ${followHint(job)}`,
      { cause: error },
    )
  }
  await progress.stop()
  return final
}

/** A finished job that did not do everything it was asked exits nonzero. */
function assertJobSucceeded(job: GooglePhotosJobSummary): void {
  const id = String(job.id)
  if (job.status === 'failed') {
    const label = describeGoogleErrorLabel(job.error)
    throw new Error(`Google Photos ${job.kind} job ${id} failed${label ? `: ${label}` : ''}.`)
  }
  if (job.status === 'cancelled') {
    throw new Error(`Google Photos ${job.kind} job ${id} was cancelled.`)
  }
  if (job.failedItems > 0) {
    throw new Error(
      `${formatCount(job.failedItems)} item${job.failedItems === 1 ? '' : 's'} failed. List them with 'rawback google job ${id} --items failed'.`,
    )
  }
}

function jobHints(job: GooglePhotosJobSummary): string[] {
  if (!isGooglePhotosJobFinished(job)) return [followHint(job)]
  if (job.kind === 'import' && job.upload && job.doneItems > 0) {
    return [
      `Imported photos arrive as upload session ${String(job.upload.id)}; follow processing with 'rawback uploads'.`,
    ]
  }
  return []
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`
}

function withInterrupts<T>(
  dependencies: GooglePhotosCommandDependencies,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const unsubscribe = (dependencies.onInterrupt ?? defaultOnInterrupt)(() => controller.abort())
  return run(controller.signal).finally(unsubscribe)
}

export function summarizePicks(items: GooglePhotosPickedItemSummary[]): PickedItemsSummary {
  const videos = items.filter((item) => item.type.toUpperCase() === 'VIDEO').length
  return { total: items.length, photos: items.length - videos, videos }
}

export interface GoogleImportOptions {
  json?: boolean
  /** `false` (`--no-wait`) prints the started job instead of watching it. */
  wait?: boolean
  yes?: boolean
}

/**
 * `rawback import google`: connect if needed, let the user pick in Google's
 * own picker, confirm, then import through the same pipeline as an SFTP upload.
 */
export async function runGoogleImport(
  options: GoogleImportOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const json = options.json ?? false
  const wait = options.wait ?? true
  if (json && !options.yes) {
    throw new Error('rawback import google --json also needs --yes, because it cannot prompt')
  }
  const ui = commandOutput(dependencies)
  const prompts =
    dependencies.prompts ??
    defaultPrompts('rawback import google needs an interactive terminal unless --yes is provided')

  await withInterrupts(dependencies, (signal) =>
    translated(async () => {
      const google = await googlePhotosClient(dependencies)
      const context: FlowContext = { dependencies, google, json, signal, ui }
      const status = await ui.withActivity(
        'Checking Google Photos…',
        () => google.status({ signal }),
        !json,
      )
      if (!status.available) throw googlePhotosUnavailableError()
      if (status.activeImport) throw activeJobError(status.activeImport)
      await stage(signal, 'Stopped before connecting; nothing was imported.', () =>
        ensureConnected(context, status, 'import'),
      )

      const session = await google.createPickerSession({ signal })
      // Ours to clean up until the server starts importing from it.
      let owned = true
      try {
        await openInBrowser(
          ui,
          dependencies,
          `Pick up to ${formatCount(status.maxPickerItems)} photos in Google Photos, then select Done:`,
          session.pickerUri,
        )
        await stage(signal, 'Import cancelled; nothing was imported.', () =>
          waiting(ui, json, 'Waiting for you to pick photos in Google Photos…', () =>
            google.waitForPicks(session, { signal }),
          ),
        )
        const items = await stage(signal, 'Import cancelled; nothing was imported.', () =>
          ui.withActivity(
            'Reading your picks…',
            () => google.listPickedItems(session.id, { signal }),
            !json,
          ),
        )
        const picked = summarizePicks(items)
        if (picked.photos === 0) {
          throw new Error(
            picked.total === 0
              ? REASON_MESSAGES[GooglePhotosErrorReason.NothingPicked]
              : `Nothing to import: the ${plural(picked.total, 'picked item')} ${picked.total === 1 ? 'is a video' : 'are all videos'}, and videos are not imported.`,
          )
        }
        if (json) {
          ui.documentError(
            noticeDocument(
              `Picked ${plural(picked.photos, 'photo')}` +
                (picked.videos > 0 ? `; ${plural(picked.videos, 'video')} will be skipped.` : '.'),
              'info',
            ),
          )
        } else {
          ui.document(pickedItemsDocument(picked))
        }
        if (!options.yes) {
          const confirmed = await prompts.confirm(
            `Import ${plural(picked.photos, 'photo')} from Google Photos?`,
            true,
          )
          if (!confirmed) {
            say(ui, json, 'Import cancelled; nothing was imported.')
            return
          }
        }

        let job: GooglePhotosJobSummary
        try {
          job = await google.startImport(session.id, { signal })
        } catch (error) {
          // Only a refusal leaves the session unused; after a dropped
          // connection the import may have started, and needs it.
          owned = error instanceof RawbackGraphqlError
          throw error
        }
        owned = false

        const report = (current: GooglePhotosJobSummary, finished: boolean) => {
          if (json) ui.json({ picked, job: serializeGoogleJob(current), finished })
          else ui.document(jobDocument(current, jobHints(current)))
        }
        if (!wait) {
          report(job, isGooglePhotosJobFinished(job))
          return
        }
        const final = await watchToEnd(context, job, report)
        report(final, true)
        assertJobSucceeded(final)
      } finally {
        if (owned) await google.deletePickerSession(session.id).catch(() => false)
      }
    }),
  )
}

export interface GoogleExportOptions {
  all?: boolean
  /** Album IDs whose photos to export. */
  albums?: ReadonlyArray<string | number>
  /** Google Photos album to add the photos to; defaults to "Rawback". */
  albumTitle?: string
  dryRun?: boolean
  file?: string
  from?: string
  images?: ReadonlyArray<string | number>
  /** A file of photo IDs, one per line; `-` reads standard input. */
  imagesFile?: string
  includeArchived?: boolean
  includeSecret?: boolean
  json?: boolean
  /** `--no-album`: add the photos to the library only. */
  libraryOnly?: boolean
  /** `false` (`--no-skip-exported`) sends photos an earlier export already sent. */
  skipExported?: boolean
  to?: string
  wait?: boolean
  yes?: boolean
}

export interface ResolvedGoogleExport {
  input: GooglePhotosExportInput
  /** The selection in words, for the preview. */
  selection: string
}

/** A date-only bound covers its whole UTC day; a timestamp is taken as given. */
function parseExportDate(value: string, option: string, bound: 'start' | 'end'): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const start = Date.parse(`${trimmed}T00:00:00Z`)
    if (Number.isFinite(start) && new Date(start).toISOString().slice(0, 10) === trimmed) {
      return bound === 'start' ? `${trimmed}T00:00:00Z` : `${trimmed}T23:59:59Z`
    }
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  throw new Error(`${option} must be a valid YYYY-MM-DD date or RFC3339 timestamp`)
}

async function readImagesFile(
  path: string,
  dependencies: GooglePhotosCommandDependencies,
): Promise<number[]> {
  let text: string
  try {
    text =
      path === '-'
        ? await (dependencies.readStdin ?? (() => Bun.stdin.text()))()
        : await readFile(path, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read --images-file ${path}: ${detail}`, { cause: error })
  }
  return parsePositiveIds(text.split(/[\s,]+/), '--images-file')
}

/**
 * Validates the export flags into the server's input, before any network call:
 * one selection, valid dates and IDs, and an album title or `--no-album`.
 */
export async function resolveGoogleExport(
  options: GoogleExportOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<ResolvedGoogleExport> {
  const file = options.file ?? 'original'
  if (!(GOOGLE_EXPORT_FILES as readonly string[]).includes(file)) {
    throw new Error(`--file must be one of: ${GOOGLE_EXPORT_FILES.join(', ')}`)
  }
  const albumIds = parsePositiveIds(options.albums, '--album')
  const flagImageIds = parsePositiveIds(options.images, '--image')
  const dated = options.from !== undefined || options.to !== undefined
  const byImage = flagImageIds.length > 0 || options.imagesFile !== undefined
  const chosen = [
    options.all ? '--all' : undefined,
    dated ? '--from/--to' : undefined,
    albumIds.length > 0 ? '--album' : undefined,
    byImage ? '--image/--images-file' : undefined,
  ].filter((flag): flag is string => flag !== undefined)
  if (chosen.length > 1) {
    throw new Error(
      `Choose one selection, not ${chosen.join(' and ')}: --all, --from/--to, --album, or --image/--images-file`,
    )
  }
  if (albumIds.length > MAX_EXPORT_ALBUMS) {
    throw new Error(`--album accepts at most ${String(MAX_EXPORT_ALBUMS)} albums`)
  }
  if (options.libraryOnly && options.albumTitle !== undefined) {
    throw new Error('--album-title and --no-album cannot be combined')
  }
  const albumTitle = options.libraryOnly
    ? undefined
    : (options.albumTitle ?? DEFAULT_GOOGLE_ALBUM_TITLE).trim()
  if (albumTitle === '') {
    throw new Error(
      '--album-title must not be empty; pass --no-album to add the photos to the library only',
    )
  }
  const from =
    options.from === undefined ? undefined : parseExportDate(options.from, '--from', 'start')
  const to = options.to === undefined ? undefined : parseExportDate(options.to, '--to', 'end')
  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) {
    throw new Error('--from must not be later than --to')
  }

  let imageIds = flagImageIds
  if (options.imagesFile !== undefined) {
    const fileIds = await readImagesFile(options.imagesFile, dependencies)
    imageIds = [...new Set([...flagImageIds, ...fileIds])]
    if (imageIds.length === 0) throw new Error('--images-file lists no photo IDs')
  }

  const scope = dated ? 'date_range' : albumIds.length > 0 ? 'albums' : byImage ? 'images' : 'all'
  const selection =
    scope === 'date_range'
      ? `photos from ${from?.slice(0, 10) ?? 'the beginning'} to ${to?.slice(0, 10) ?? 'now'}`
      : scope === 'albums'
        ? `${plural(albumIds.length, 'album')} (${albumIds.join(', ')})`
        : scope === 'images'
          ? plural(imageIds.length, 'chosen photo')
          : 'all photos'
  const extras = [
    options.includeSecret ? 'secret albums included' : undefined,
    options.includeArchived ? 'archived included' : undefined,
  ].filter(Boolean)

  return {
    input: {
      scope,
      file: file as GooglePhotosExportInput['file'],
      includeSecret: options.includeSecret ?? false,
      includeArchived: options.includeArchived ?? false,
      skipExported: options.skipExported ?? true,
      ...(albumTitle !== undefined ? { albumTitle } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(scope === 'albums' ? { albumIds } : {}),
      ...(scope === 'images' ? { imageIds } : {}),
    },
    selection: extras.length > 0 ? `${selection} (${extras.join(', ')})` : selection,
  }
}

/** `rawback export google`: preview a selection, confirm, export, and watch it. */
export async function runGoogleExport(
  options: GoogleExportOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const json = options.json ?? false
  const wait = options.wait ?? true
  if (json && !options.yes && !options.dryRun) {
    throw new Error(
      'rawback export google --json also needs --yes (or --dry-run), because it cannot prompt',
    )
  }
  const plan = await resolveGoogleExport(options, dependencies)
  const ui = commandOutput(dependencies)
  const prompts =
    dependencies.prompts ??
    defaultPrompts('rawback export google needs an interactive terminal unless --yes is provided')
  const albumTitle = plan.input.albumTitle ?? null

  await withInterrupts(dependencies, (signal) =>
    translated(async () => {
      const google = await googlePhotosClient(dependencies)
      const context: FlowContext = { dependencies, google, json, signal, ui }
      const status = await ui.withActivity(
        'Checking Google Photos…',
        () => google.status({ signal }),
        !json,
      )
      if (!status.available) throw googlePhotosUnavailableError()
      if (!options.dryRun) {
        if (status.activeExport) throw activeJobError(status.activeExport)
        await stage(signal, 'Stopped before connecting; nothing was exported.', () =>
          ensureConnected(context, status, 'export'),
        )
      }

      const preview = await ui.withActivity(
        'Counting photos…',
        () => google.previewExport(plan.input, { signal }),
        !json,
      )
      const output = (job: GooglePhotosJobSummary | null, finished: boolean) =>
        ui.json({
          dryRun: options.dryRun ?? false,
          input: plan.input,
          preview: serializePreview(preview),
          job: job ? serializeGoogleJob(job) : null,
          finished,
        })
      const view = {
        selection: plan.selection,
        albumTitle,
        file: plan.input.file ?? 'original',
        preview,
        skipExported: plan.input.skipExported !== false,
      }
      if (!json) ui.document(exportPreviewDocument(view))

      if (options.dryRun) {
        if (json) output(null, false)
        return
      }
      if (preview.count === 0) {
        say(
          ui,
          json,
          preview.alreadyExported > 0
            ? `Nothing to export: ${plural(preview.alreadyExported, 'matching photo')} ${preview.alreadyExported === 1 ? 'was' : 'were'} already exported to this Google account. Pass --no-skip-exported to send them again.`
            : 'Nothing to export: no photos match this selection.',
        )
        if (json) output(null, false)
        return
      }
      if (preview.count > status.maxExportItems) {
        throw new Error(
          `This selection has ${plural(preview.count, 'photo')}; one export sends at most ${formatCount(status.maxExportItems)}. Narrow it with --from/--to, --album or --image.`,
        )
      }
      if (!options.yes) {
        const destination = albumTitle ? ` album "${albumTitle}"` : ''
        const confirmed = await prompts.confirm(
          `Export ${plural(preview.count, 'photo')} (${formatBytes(preview.totalBytes)}) to Google Photos${destination}?`,
          false,
        )
        if (!confirmed) {
          say(ui, json, 'Export cancelled; nothing was sent.')
          return
        }
      }

      const job = await google.startExport(plan.input, { signal })
      const report = (current: GooglePhotosJobSummary, finished: boolean) => {
        if (json) output(current, finished)
        else ui.document(jobDocument(current, jobHints(current)))
      }
      if (!wait) {
        report(job, isGooglePhotosJobFinished(job))
        return
      }
      const final = await watchToEnd(context, job, report)
      report(final, true)
      assertJobSucceeded(final)
    }),
  )
}

export interface GoogleJsonOptions {
  json?: boolean
}

/** `rawback google status`. A server without the feature is reported, not an error. */
export async function runGoogleStatus(
  options: GoogleJsonOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const status = await translated(async () => {
    const google = await googlePhotosClient(dependencies)
    return ui.withActivity('Checking Google Photos…', () => google.status(), !options.json)
  })
  if (options.json) ui.json(serializeStatus(status))
  else ui.document(googleStatusDocument(status))
}

/** `rawback google connect`: link a Google account, or repair one that cannot do both directions. */
export async function runGoogleConnect(
  options: GoogleJsonOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const json = options.json ?? false
  const ui = commandOutput(dependencies)
  await withInterrupts(dependencies, (signal) =>
    translated(async () => {
      const google = await googlePhotosClient(dependencies)
      const context: FlowContext = { dependencies, google, json, signal, ui }
      const status = await ui.withActivity(
        'Checking Google Photos…',
        () => google.status({ signal }),
        !json,
      )
      if (!status.available) throw googlePhotosUnavailableError()
      const current = status.account
      if (current && isUsable(current, 'import') && isUsable(current, 'export')) {
        say(
          ui,
          json,
          `Already connected as ${current.email}. To use another Google account, run 'rawback google disconnect' first.`,
        )
        if (json) ui.json({ account: serializeGoogleAccount(current), connected: false })
        return
      }
      // A linked account missing one permission waits for that one; anything
      // else just waits for a working link.
      const missing =
        current && !current.needsReauth
          ? (['import', 'export'] as const).find((direction) => !allows(current, direction))
          : undefined
      const why = !current
        ? 'Link a Google account to Rawback.'
        : current.needsReauth
          ? 'Google needs to be reconnected.'
          : `Rawback is not allowed to ${permissionName(missing ?? 'import')}; allow it on Google's consent screen.`
      const account = await connectAccount(context, missing, why)
      for (const direction of ['import', 'export'] as const) {
        if (!allows(account, direction)) {
          ui.warning(
            `Google did not grant permission to ${permissionName(direction)}. Run 'rawback google connect' again and allow it.`,
          )
        }
      }
      if (json) ui.json({ account: serializeGoogleAccount(account), connected: true })
    }),
  )
}

export interface GoogleDisconnectOptions extends GoogleJsonOptions {
  yes?: boolean
}

/** `rawback google disconnect`: revoke Rawback's access and cancel running jobs. */
export async function runGoogleDisconnect(
  options: GoogleDisconnectOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const json = options.json ?? false
  if (json && !options.yes) {
    throw new Error('rawback google disconnect --json also needs --yes, because it cannot prompt')
  }
  const ui = commandOutput(dependencies)
  const prompts =
    dependencies.prompts ??
    defaultPrompts(
      'rawback google disconnect needs an interactive terminal unless --yes is provided',
    )
  await translated(async () => {
    const google = await googlePhotosClient(dependencies)
    const status = await ui.withActivity('Checking Google Photos…', () => google.status(), !json)
    if (!status.available) throw googlePhotosUnavailableError()
    const account = status.account
    if (!account) {
      if (json) ui.json({ disconnected: false })
      else ui.info('No Google account is connected.')
      return
    }
    if (!options.yes) {
      const confirmed = await prompts.confirm(
        `Disconnect Google account ${account.email}? Rawback's access is revoked and running imports and exports are cancelled.`,
        false,
      )
      if (!confirmed) {
        ui.info('Google Photos stays connected.')
        return
      }
    }
    const disconnected = await google.disconnect()
    if (json) ui.json({ disconnected })
    else if (disconnected) ui.success(`Disconnected Google account ${account.email}.`)
    else ui.info('No Google account was connected.')
  })
}

export interface GoogleJobsOptions extends GoogleJsonOptions {
  kind?: string
  limit?: number
  offset?: number
}

function validateCount(value: number, option: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${option} must be an integer between ${String(min)} and ${String(max)}`)
  }
  return value
}

function validateOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('--offset must be a non-negative integer')
  }
  return value
}

/** `rawback google jobs`: imports and exports, newest first. */
export async function runGoogleJobs(
  options: GoogleJobsOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  if (
    options.kind !== undefined &&
    !(GOOGLE_JOB_KINDS as readonly string[]).includes(options.kind)
  ) {
    throw new Error(`--kind must be one of: ${GOOGLE_JOB_KINDS.join(', ')}`)
  }
  const limit = validateCount(options.limit ?? 20, '--limit', 1, 100)
  const offset = validateOffset(options.offset ?? 0)
  const ui = commandOutput(dependencies)
  const jobs = await translated(async () => {
    const google = await googlePhotosClient(dependencies)
    return ui.withActivity(
      'Loading Google Photos jobs…',
      () =>
        google.listJobs({
          limit,
          offset,
          ...(options.kind !== undefined
            ? { kind: options.kind as (typeof GOOGLE_JOB_KINDS)[number] }
            : {}),
        }),
      !options.json,
    )
  })
  if (options.json) ui.json({ jobs: jobs.map(serializeGoogleJob) })
  else ui.document(jobListDocument(jobs))
}

export interface GoogleJobOptions extends GoogleJsonOptions {
  id: number
  /** Only items in this state. */
  items?: string
  limit?: number
  offset?: number
  /** Follow the job until it finishes first. */
  watch?: boolean
}

/** `rawback google job <id>`: one job and a page of its items, optionally watched to the end. */
export async function runGoogleJob(
  options: GoogleJobOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const id = validatePositiveId(options.id, 'Job ID')
  if (
    options.items !== undefined &&
    !(GOOGLE_JOB_ITEM_STATUSES as readonly string[]).includes(options.items)
  ) {
    throw new Error(`--items must be one of: ${GOOGLE_JOB_ITEM_STATUSES.join(', ')}`)
  }
  const limit = validateCount(options.limit ?? 50, '--limit', 1, 200)
  const offset = validateOffset(options.offset ?? 0)
  const json = options.json ?? false
  const ui = commandOutput(dependencies)

  await withInterrupts(dependencies, (signal) =>
    translated(async () => {
      const google = await googlePhotosClient(dependencies)
      const read = () =>
        google.getJob(id, {
          signal,
          itemLimit: limit,
          itemOffset: offset,
          ...(options.items !== undefined
            ? { itemStatus: options.items as (typeof GOOGLE_JOB_ITEM_STATUSES)[number] }
            : {}),
        })
      let detail = await ui.withActivity('Loading Google Photos job…', read, !json)
      if (!detail) throw new GooglePhotosJobNotFoundError(id)
      const report = (current: GooglePhotosJobSummary | GooglePhotosJobDetail) => {
        if (json)
          ui.json({
            job: 'items' in current ? serializeJobDetail(current) : serializeGoogleJob(current),
          })
        else ui.document('items' in current ? jobDetailDocument(current) : jobDocument(current))
      }
      if (options.watch && !isGooglePhotosJobFinished(detail)) {
        const context: FlowContext = { dependencies, google, json, signal, ui }
        await watchToEnd(context, detail, (current) => report(current))
        detail = await read()
        if (!detail) throw new GooglePhotosJobNotFoundError(id)
      }
      report(detail)
      if (options.watch) assertJobSucceeded(detail)
    }),
  )
}

export interface GoogleCancelOptions extends GoogleJsonOptions {
  id: number
}

/** `rawback google cancel <id>`: stop a running import or export. */
export async function runGoogleCancel(
  options: GoogleCancelOptions,
  dependencies: GooglePhotosCommandDependencies = {},
): Promise<void> {
  const id = validatePositiveId(options.id, 'Job ID')
  const ui = commandOutput(dependencies)
  const job = await translated(async () => {
    const google = await googlePhotosClient(dependencies)
    return ui.withActivity(
      'Cancelling Google Photos job…',
      () => google.cancelJob(id),
      !options.json,
    )
  })
  if (options.json) {
    ui.json({ job: serializeGoogleJob(job) })
    return
  }
  ui.document(jobDocument(job))
  if (job.status === 'cancelled')
    ui.success(`Cancelled Google Photos ${job.kind} job ${String(id)}.`)
  else ui.info(`Job ${String(id)} is ${job.status}; nothing was cancelled.`)
}
