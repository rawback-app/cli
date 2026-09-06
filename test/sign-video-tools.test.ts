import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { signVideoTools } from '../scripts/sign-video-tools.ts'

const directories: string[] = []
// Deliberately invalid credentials; these tests never invoke Apple or Quill.
const env = {
  MACOS_SIGN_P12: 'test-certificate',
  MACOS_SIGN_PASSWORD: 'test-password',
  MACOS_NOTARY_KEY: 'test-key',
  MACOS_NOTARY_KEY_ID: 'test-key-id',
  MACOS_NOTARY_ISSUER_ID: 'test-issuer',
  PATH: '/test/bin',
}

async function stagedTools() {
  const root = await mkdtemp(join(tmpdir(), 'rawback-sign-video-'))
  directories.push(root)
  const paths: string[] = []
  for (const arch of ['x64', 'arm64']) {
    await mkdir(join(root, 'darwin', arch), { recursive: true })
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const path = join(root, 'darwin', arch, tool)
      await writeFile(path, 'unsigned fixture')
      paths.push(path)
    }
  }
  return { root, paths }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe('macOS video tool signing', () => {
  test('snapshots skip signing even when credentials are present', async () => {
    const logs: string[] = []
    await signVideoTools(true, {
      root: '/does-not-exist',
      env,
      log: (message) => logs.push(message),
      run: async () => {
        throw new Error('must not sign snapshots')
      },
    })
    expect(logs).toEqual([
      'Snapshot: skipping Developer ID signing and notarization of video tools',
    ])
  })

  test('production requires all credentials without exposing their values', async () => {
    const { MACOS_NOTARY_KEY: _key, ...incomplete } = env
    await expect(signVideoTools(false, { env: incomplete })).rejects.toThrow(
      'Missing macOS signing secrets: MACOS_NOTARY_KEY',
    )
    await expect(signVideoTools(false, { env: {} })).rejects.toThrow(
      'Missing macOS signing secrets:',
    )
  })

  test('signs and waits for both tools on both macOS architectures in place', async () => {
    const { root, paths } = await stagedTools()
    const commands: string[][] = []
    const logs: string[] = []
    await signVideoTools(false, {
      root,
      env,
      log: (message) => logs.push(message),
      run: async (command, signingEnv) => {
        commands.push(command)
        expect(signingEnv).toMatchObject({
          QUILL_SIGN_P12: env.MACOS_SIGN_P12,
          QUILL_SIGN_PASSWORD: env.MACOS_SIGN_PASSWORD,
          QUILL_NOTARY_KEY: env.MACOS_NOTARY_KEY,
          QUILL_NOTARY_KEY_ID: env.MACOS_NOTARY_KEY_ID,
          QUILL_NOTARY_ISSUER: env.MACOS_NOTARY_ISSUER_ID,
          QUILL_LOG_LEVEL: 'info',
          PATH: env.PATH,
        })
      },
    })
    expect(commands).toEqual(paths.map((path) => ['quill', 'sign-and-notarize', path, '--wait']))
    expect(logs.filter((line) => line.startsWith('Signed and notarized'))).toHaveLength(4)
    for (const secret of Object.values(env).filter((value) => value !== env.PATH)) {
      expect(JSON.stringify(commands)).not.toContain(secret)
      expect(logs.join('\n')).not.toContain(secret)
    }
  })

  test.each(['missing', 'directory'])('rejects a %s helper before any signing', async (kind) => {
    const { root } = await stagedTools()
    const last = join(root, 'darwin', 'arm64', 'ffprobe')
    await rm(last)
    if (kind === 'directory') await mkdir(last)
    let called = false
    await expect(
      signVideoTools(false, {
        root,
        env,
        run: async () => {
          called = true
        },
      }),
    ).rejects.toThrow('Missing staged video tool: darwin/arm64/ffprobe')
    expect(called).toBe(false)
  })

  test('waits for every helper and fails the release on any signing or notary error', async () => {
    const { root } = await stagedTools()
    let finished = 0
    await expect(
      signVideoTools(false, {
        root,
        env,
        log: () => {},
        run: async (command) => {
          await Bun.sleep(5)
          finished += 1
          if (command[2]?.endsWith('ffprobe')) throw new Error('notarization rejected')
        },
      }),
    ).rejects.toThrow(
      'Signing or notarization failed for darwin/x64/ffprobe, darwin/arm64/ffprobe; release stopped',
    )
    expect(finished).toBe(4)
  })

  test('script requires an explicit snapshot mode', () => {
    const script = new URL('../scripts/sign-video-tools.ts', import.meta.url).pathname
    const result = Bun.spawnSync([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('--snapshot=true|false')
  })
})
