import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Writable } from 'node:stream'

import type { ContentDataKind, ContentType, ContentsOrder } from '@rawback/ccapi-js'

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
