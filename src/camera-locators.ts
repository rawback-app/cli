import {
  parseContentLocator as parseCameraLocator,
  parseDirectoryLocator,
  type ContentLocator,
  type DirectoryLocator,
} from '@rawback/ccapi-js'

import { CameraError } from './camera-errors.ts'
import type { CameraSession } from './camera-session.ts'

/**
 * Locators are the strings the camera itself returns, so the ver140 folder
 * (`DCIM` for stills) never has to be typed by hand. Accepts what `contents
 * list` prints — a path or a full URL — and a bare `storage/[folder/]directory/file`.
 */
export function parseContentLocator(locator: string): ContentLocator {
  const trimmed = locator.trim()
  for (const candidate of [trimmed, `/contents/${trimmed.replace(/^\/+/, '')}`]) {
    try {
      return parseCameraLocator(candidate)
    } catch {
      // Try the bare form, then give up with a message that says what to pass.
    }
  }
  throw new CameraError(
    `Not a content locator: ${JSON.stringify(locator)}. ` +
      'Use one printed by rawback camera contents list.',
  )
}

/**
 * Where a directory argument lives on the card, with its ver140 folder.
 *
 * Accepts a locator printed by `contents dirs`
 * (`/ccapi/ver140/contents/card1/DCIM/100CANON`), a `folder/directory` pair
 * (`DCIM/100CANON`), or a bare directory name. A ver140 body files every
 * directory under a folder that each contents path must include, so a bare
 * name is looked up on the storage — preferring `DCIM`, where stills live —
 * and passed through unchanged when the listing has no folders (ver130 and
 * earlier) or does not contain it.
 *
 * `storage` is always the one the user chose: a locator naming another card is
 * refused rather than followed, since `deleteDirectory` acts on whatever this
 * returns. A failed lookup is reported as itself — a busy or unreachable
 * camera must not turn into a folderless request that 404s for another reason.
 */
export async function resolveDirectory(
  session: CameraSession,
  storage: string,
  directory: string,
): Promise<DirectoryLocator> {
  const trimmed = directory.trim().replace(/^\/+|\/+$/g, '')
  if (trimmed.includes('contents/')) {
    let located: DirectoryLocator
    try {
      located = parseDirectoryLocator(trimmed)
    } catch {
      throw new CameraError(
        `Not a directory locator: ${JSON.stringify(directory)}. ` +
          'Use one printed by rawback camera contents dirs.',
      )
    }
    if (located.storage !== storage) {
      throw new CameraError(
        `${JSON.stringify(directory)} is on ${located.storage}, not ${storage}. ` +
          'Pass the storage the locator names, or a directory name.',
      )
    }
    return located
  }

  const parts = trimmed.split('/').filter((part) => part.length > 0)
  if (parts.length === 2) {
    const [folder, name] = parts as [string, string]
    return { storage, folder, directory: name }
  }
  if (parts.length !== 1) {
    throw new CameraError(
      `Not a directory: ${JSON.stringify(directory)}. ` +
        'Pass a name like 100CANON, or DCIM/100CANON.',
    )
  }

  const name = parts[0] as string
  const { paths } = await session.client.contents.listDirectories(storage)
  const matches = paths.flatMap((path) => {
    try {
      const located = parseDirectoryLocator(path)
      return located.directory === name ? [located] : []
    } catch {
      return []
    }
  })
  const match = matches.find((located) => located.folder === 'DCIM') ?? matches[0]
  return match ?? { storage, directory: name }
}

/** The `folder` option a contents call takes, when the directory has one. */
export function folderOption(directory: DirectoryLocator): { folder?: string } {
  return directory.folder !== undefined ? { folder: directory.folder } : {}
}
