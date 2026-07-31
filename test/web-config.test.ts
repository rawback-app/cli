import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_WEB_HOST, readConfig } from '../src/config.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('web host config', () => {
  test('exports the production default and reads a custom HTTP host', async () => {
    expect(DEFAULT_WEB_HOST).toBe('https://rawback.app')
    const directory = await mkdtemp(join(tmpdir(), 'rawback-web-config-'))
    directories.push(directory)
    const path = join(directory, 'config.yml')
    await Bun.write(path, 'webHost: http://localhost:3407/\n')
    expect(await readConfig(path)).toEqual({ webHost: 'http://localhost:3407/' })
  })

  test.each([
    ['webHost: ""', 'non-empty string'],
    ['webHost: file:///tmp/rawback', 'HTTP or HTTPS'],
    ['webHost: not a URL', 'valid URL'],
  ])('rejects invalid webHost values', async (contents, expected) => {
    const directory = await mkdtemp(join(tmpdir(), 'rawback-web-config-'))
    directories.push(directory)
    const path = join(directory, 'config.yml')
    await Bun.write(path, `${contents}\n`)
    await expect(readConfig(path)).rejects.toThrow(expected)
  })
})
