import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Writable } from 'node:stream'

import type { ContentDataKind, ContentType, ContentsOrder, GPSInfo } from '@rawback/ccapi-js'

import { CameraError } from './camera-errors.ts'
import { isDirectory, refuseOverwrite } from './camera-files.ts'
import { folderOption, parseContentLocator, resolveDirectory } from './camera-locators.ts'
import {
  withCameraSession,
  type CameraCommandDependencies,
  type CameraTargetOptions,
} from './camera-session.ts'
import { cameraPrompts } from './camera.ts'
import { commandOutput } from './command.ts'
import {
  contentsListDocument,
  pathListDocument,
  type ContentsListRow,
} from './features/camera/view.ts'

export { parseContentLocator } from './camera-locators.ts'

function listOptions(options: { type?: string; order?: string; page?: number }) {
  return {
    ...(options.type !== undefined && options.type !== 'all'
      ? { type: options.type as ContentType }
      : {}),
    ...(options.order !== undefined ? { order: options.order as ContentsOrder } : {}),
    ...(options.page !== undefined ? { page: options.page } : {}),
  }
}

function toRow(locator: string): ContentsListRow {
  return { locator, name: locator.split('/').filter(Boolean).pop() ?? locator }
}

export async function runCameraContentsStorages(
  options: CameraTargetOptions = {},
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const { paths } = await session.client.contents.listStorages()
    if (options.json === true) {
      ui.json({ storages: paths })
      return
    }
    ui.document(pathListDocument('Storages', 'Storage', paths, 'No storage mounted.'))
  })
}

export async function runCameraContentsDirs(
  options: CameraTargetOptions & { storage: string },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const { paths } = await session.client.contents.listDirectories(options.storage)
    if (options.json === true) {
      ui.json({ storage: options.storage, directories: paths })
      return
    }
    ui.document(
      pathListDocument('Directories', 'Directory', paths, 'No directories on that storage.'),
    )
  })
}

export interface ContentsListOptions extends CameraTargetOptions {
  storage: string
  directory: string
  type?: string
  order?: string
  page?: number
  all?: boolean
}

export async function runCameraContentsList(
  options: ContentsListOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  await withCameraSession(options, dependencies, async (session) => {
    const directory = await resolveDirectory(session, options.storage, options.directory)
    const where = { ...listOptions(options), ...folderOption(directory) }
    if (options.all === true) {
      // The chunked form streams the whole listing rather than one page.
      const locators: string[] = []
      for await (const page of session.client.contents.streamContents(
        directory.storage,
        directory.directory,
        where,
      )) {
        locators.push(...page)
      }
      if (options.json === true) {
        ui.json({ contents: locators, count: locators.length })
        return
      }
      ui.document(contentsListDocument(locators.map(toRow)))
      return
    }

    const page = options.page ?? 1
    // One after the other: a body serves one contents request at a time and
    // answers `503` to a second that overlaps it.
    const listing = await session.client.contents.listContents(
      directory.storage,
      directory.directory,
      { ...where, page },
    )
    const counts = await session.client.contents
      .getContentsNumber(directory.storage, directory.directory, where)
      .catch(() => undefined)

    if (options.json === true) {
      ui.json({
        contents: listing.paths,
        count: listing.paths.length,
        page,
        totalCount: counts?.contentsNumber ?? null,
        totalPages: counts?.pageNumber ?? null,
      })
      return
    }
    ui.document(
      contentsListDocument(listing.paths.map(toRow), {
        page,
        pageSize: 100,
        ...(counts?.contentsNumber !== undefined ? { totalCount: counts.contentsNumber } : {}),
        ...(counts?.pageNumber !== undefined ? { totalPages: counts.pageNumber } : {}),
      }),
    )
  })
}

export async function runCameraContentsInfo(
  options: CameraTargetOptions & { locator: string },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const locator = parseContentLocator(options.locator)
  await withCameraSession(options, dependencies, async (session) => {
    const info = await session.client.contents.getContentInfo(locator)
    if (options.json === true) {
      ui.json({ locator: options.locator, ...info })
      return
    }
    ui.document({
      title: locator.file,
      blocks: [
        {
          type: 'fields',
          fields: [
            { label: 'Size', value: `${info.fileSize} bytes` },
            { label: 'Protected', value: info.protect },
            { label: 'Archive', value: info.archive },
            { label: 'Rotation', value: info.rotate },
            { label: 'Rating', value: info.rating },
            { label: 'Modified', value: info.lastModifiedDate },
          ],
        },
      ],
    })
  })
}

export interface ContentsGetOptions extends CameraTargetOptions {
  locator: string
  output: string
  kind?: string
  overwrite?: boolean
}

export async function runCameraContentsGet(
  options: ContentsGetOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const locator = parseContentLocator(options.locator)

  // A directory target keeps the camera's own filename.
  const target = (await isDirectory(options.output))
    ? join(options.output, locator.file)
    : options.output

  await refuseOverwrite(target, options.overwrite)

  await withCameraSession(options, dependencies, async (session) => {
    // Streamed rather than buffered: a RAW file is tens of megabytes.
    const stream = await session.client.contents.streamContentData(locator, {
      signal: session.signal,
      ...(options.kind !== undefined ? { kind: options.kind as ContentDataKind } : {}),
    })

    await mkdir(dirname(target), { recursive: true })
    let bytes = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    await stream.pipeThrough(counter).pipeTo(Writable.toWeb(createWriteStream(target)))

    if (options.json === true) {
      ui.json({
        locator: options.locator,
        output: target,
        bytes,
        kind: options.kind ?? 'main',
      })
      return
    }
    ui.success(`Saved ${basename(target)} (${bytes} bytes) to ${target}.`)
  })
}

export async function runCameraContentsDelete(
  options: CameraTargetOptions & { locator: string; force?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const locator = parseContentLocator(options.locator)

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      `Delete ${locator.file} from the camera? This cannot be undone.`,
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ deleted: false, locator: options.locator })
      else ui.info('Left the file on the camera.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    await session.client.contents.deleteContent(locator)
    if (options.json === true) {
      ui.json({ deleted: true, locator: options.locator })
      return
    }
    ui.success(`Deleted ${locator.file}.`)
  })
}

export type ContentEdit =
  | { kind: 'protect'; enabled: boolean }
  | { kind: 'archive'; enabled: boolean }
  | { kind: 'rate'; rating: string }
  | { kind: 'rotate'; degrees: number }
  /** Raw attributes for the file's XMP `rdf:Description` tag (doc 4.7.6, ver130+). */
  | { kind: 'xmp'; attributes: string }
  | { kind: 'geotag'; latitude: number; longitude: number; altitude?: number; time?: Date }

export interface ContentsEditOptions extends CameraTargetOptions {
  locator: string
  edit: ContentEdit
  force?: boolean
}

/** A GPS angle in hundredths of an arcsecond, split into DMS rationals. */
function angleRational(degrees: number) {
  const hundredths = Math.round(Math.abs(degrees) * 3600 * 100)
  return {
    degree: [Math.floor(hundredths / 360_000), 1],
    minute: [Math.floor((hundredths % 360_000) / 6000), 1],
    second: [hundredths % 6000, 100],
  }
}

/**
 * The full EXIF GPS block the camera requires (doc 4.7.6) from a plain
 * position: WGS-84, a fix (`A`), and the UTC time and date of `time`.
 * Altitude is written as sea level when none is given.
 */
export function gpsInfo(
  latitude: number,
  longitude: number,
  altitude = 0,
  time = new Date(),
): GPSInfo {
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    latitude_ref: latitude < 0 ? 'S' : 'N',
    latitude: angleRational(latitude),
    longitude_ref: longitude < 0 ? 'W' : 'E',
    longitude: angleRational(longitude),
    altitude_ref: altitude < 0 ? 'M' : 'P',
    altitude: [Math.round(Math.abs(altitude) * 100), 100],
    timestamp: {
      hour: [time.getUTCHours(), 1],
      minute: [time.getUTCMinutes(), 1],
      second: [time.getUTCSeconds(), 1],
    },
    mapdatum: 'WGS-84',
    status: 'A',
    datestamp: `${time.getUTCFullYear()}:${pad(time.getUTCMonth() + 1)}:${pad(time.getUTCDate())}`,
  }
}

function editQuestion(file: string, edit: ContentEdit): string {
  switch (edit.kind) {
    case 'protect':
      return `${edit.enabled ? 'Protect' : 'Unprotect'} ${file} on the camera?`
    case 'archive':
      return `${edit.enabled ? 'Set' : 'Clear'} the archive flag on ${file}?`
    case 'rate':
      return edit.rating === 'off' ? `Clear the rating of ${file}?` : `Rate ${file} ${edit.rating}?`
    case 'rotate':
      return `Set the rotation of ${file} to ${edit.degrees}°?`
    case 'xmp':
      return `Write XMP attributes into ${file}?`
    case 'geotag':
      return `Write the location ${edit.latitude}, ${edit.longitude} into ${file}?`
  }
}

function editDone(file: string, edit: ContentEdit): string {
  switch (edit.kind) {
    case 'protect':
      return `${edit.enabled ? 'Protected' : 'Unprotected'} ${file}.`
    case 'archive':
      return `${edit.enabled ? 'Set' : 'Cleared'} the archive flag on ${file}.`
    case 'rate':
      return edit.rating === 'off'
        ? `Cleared the rating of ${file}.`
        : `Rated ${file} ${edit.rating}.`
    case 'rotate':
      return `Set the rotation of ${file} to ${edit.degrees}°.`
    case 'xmp':
      return `Wrote the XMP attributes into ${file}.`
    case 'geotag':
      return `Wrote the location ${edit.latitude}, ${edit.longitude} into ${file}.`
  }
}

/** Changes one file's protect, archive, rating, rotation, XMP attributes or location. */
export async function runCameraContentsEdit(
  options: ContentsEditOptions,
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)
  const locator = parseContentLocator(options.locator)
  const edit = options.edit

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(editQuestion(locator.file, edit))
    if (!confirmed) {
      if (options.json === true) ui.json({ changed: false, locator: options.locator })
      else ui.info('Left the file as it was.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    const contents = session.client.contents
    let value: unknown
    switch (edit.kind) {
      case 'protect':
        await contents.setContentProtect(locator, edit.enabled)
        value = edit.enabled
        break
      case 'archive':
        await contents.setContentArchive(locator, edit.enabled)
        value = edit.enabled
        break
      case 'rate':
        await contents.setContentRating(locator, edit.rating)
        value = edit.rating
        break
      case 'rotate':
        await contents.rotateContent(locator, edit.degrees)
        value = edit.degrees
        break
      case 'xmp':
        await contents.setContentXMPDescription(locator, edit.attributes)
        value = edit.attributes
        break
      case 'geotag': {
        const gps = gpsInfo(
          edit.latitude,
          edit.longitude,
          edit.altitude,
          edit.time ?? (dependencies.now ?? (() => new Date()))(),
        )
        await contents.setContentGPS(locator, gps)
        value = gps
        break
      }
    }

    if (options.json === true) {
      ui.json({ changed: true, locator: options.locator, action: edit.kind, value })
      return
    }
    ui.success(editDone(locator.file, edit))
  })
}

export async function runCameraContentsRmdir(
  options: CameraTargetOptions & { storage: string; directory: string; force?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  if (options.force !== true) {
    const confirmed = await cameraPrompts(dependencies).confirm(
      `Delete the directory ${options.directory} on ${options.storage}, and every file in it? This cannot be undone.`,
    )
    if (!confirmed) {
      if (options.json === true) ui.json({ deleted: false, directory: options.directory })
      else ui.info('Left the directory on the camera.')
      return
    }
  }

  await withCameraSession(options, dependencies, async (session) => {
    const directory = await resolveDirectory(session, options.storage, options.directory)
    await session.client.contents.deleteDirectory(
      directory.storage,
      directory.directory,
      directory.folder,
    )
    if (options.json === true) {
      ui.json({ deleted: true, storage: directory.storage, directory: directory.directory })
      return
    }
    ui.success(`Deleted ${directory.directory} from ${directory.storage}.`)
  })
}

/**
 * Formats a card (doc 4.5.6). The storage is checked against the camera's own
 * list first, and without `--force` its name must be typed back — a yes/no is
 * too easy to give for something that erases every file.
 */
export async function runCameraCardFormat(
  options: CameraTargetOptions & { storage: string; force?: boolean },
  dependencies: CameraCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies)

  await withCameraSession(options, dependencies, async (session) => {
    session.requireSupport('functions/cardformat', 'rawback camera card format')
    const storages = (await session.client.contents.listStorages()).paths.map(
      (path) => path.split('/').filter(Boolean).pop() ?? path,
    )
    if (!storages.includes(options.storage)) {
      throw new CameraError(
        storages.length > 0
          ? `The camera has no storage named ${options.storage}. It has: ${storages.join(', ')}.`
          : `The camera reports no storage; is a card inserted?`,
      )
    }

    if (options.force !== true) {
      const prompts = cameraPrompts(dependencies)
      if (prompts.input === undefined) {
        throw new CameraError(
          'Formatting a card needs an interactive terminal unless --force is provided.',
        )
      }
      const typed = await prompts.input(
        `Formatting ${options.storage} erases every file on it. Type ${options.storage} to continue:`,
      )
      if (typed.trim() !== options.storage) {
        if (options.json === true) ui.json({ formatted: false, storage: options.storage })
        else ui.info(`Left ${options.storage} untouched.`)
        return
      }
    }

    await session.client.settings.formatCard(options.storage)
    if (options.json === true) {
      ui.json({ formatted: true, storage: options.storage })
      return
    }
    ui.success(`Formatted ${options.storage}.`)
  })
}
