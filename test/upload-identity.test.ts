import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findBundledFfmpegPath, findBundledFfprobePath } from '../src/upload-identity.ts'

const directories: string[] = []

async function installation() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rawback-video-tools-')))
  directories.push(directory)
  const execPath = join(directory, 'rawback')
  await writeFile(execPath, '')
  await mkdir(join(directory, 'ffmpeg'))
  return { directory, execPath }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('bundled video tools', () => {
  test.each(['linux', 'darwin', 'win32'] as const)('finds sidecars for %s', async (platform) => {
    const { directory, execPath } = await installation()
    const suffix = platform === 'win32' ? '.exe' : ''
    const ffmpegPath = join(directory, 'ffmpeg', `ffmpeg${suffix}`)
    const ffprobePath = join(directory, 'ffmpeg', `ffprobe${suffix}`)
    await writeFile(ffmpegPath, '')
    await writeFile(ffprobePath, '')

    expect(await findBundledFfmpegPath({ execPath, platform })).toBe(ffmpegPath)
    expect(await findBundledFfprobePath({ execPath, platform })).toBe(ffprobePath)
  })

  test('returns undefined when sidecars are absent', async () => {
    const { execPath } = await installation()
    expect(await findBundledFfmpegPath({ execPath })).toBeUndefined()
    expect(await findBundledFfprobePath({ execPath })).toBeUndefined()
  })

  test.skipIf(process.platform === 'win32')(
    'finds sidecars through an executable symlink',
    async () => {
      const { directory, execPath } = await installation()
      const bin = join(directory, 'bin')
      await mkdir(bin)
      const link = join(bin, 'rawback')
      await symlink(execPath, link)
      const ffmpegPath = join(directory, 'ffmpeg', 'ffmpeg')
      const ffprobePath = join(directory, 'ffmpeg', 'ffprobe')
      await writeFile(ffmpegPath, '')
      await writeFile(ffprobePath, '')

      expect(await findBundledFfmpegPath({ execPath: link, platform: 'linux' })).toBe(ffmpegPath)
      expect(await findBundledFfprobePath({ execPath: link, platform: 'linux' })).toBe(ffprobePath)
    },
  )
})
