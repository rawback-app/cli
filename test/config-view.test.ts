import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runConfigView } from '../src/config-view.ts'

const temporaryDirectories: string[] = []

async function temporaryConfigPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-config-view-'))
  temporaryDirectories.push(directory)
  return join(directory, 'config.yml')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('config view', () => {
  test('shows redacted YAML without changing the source file', async () => {
    const configPath = await temporaryConfigPath()
    const source = [
      '# shared with Desktop',
      'apiHost: https://staging.rawback.app',
      'futureSetting: enabled',
      'sftp:',
      '  username: photographer',
      '  password: secret-password',
      '',
    ].join('\n')
    await writeFile(configPath, source)
    const lines: string[] = []

    await runConfigView({}, { configPath, stdout: (message) => lines.push(message) })

    expect(lines.join('\n')).toContain('# shared with Desktop')
    expect(lines.join('\n')).toContain('futureSetting: enabled')
    expect(lines.join('\n')).toContain('[REDACTED]')
    expect(lines.join('\n')).not.toContain('secret-password')
    expect(await readFile(configPath, 'utf8')).toBe(source)
  })

  test('emits only redacted JSON including unknown keys', async () => {
    const configPath = await temporaryConfigPath()
    await writeFile(
      configPath,
      'webHost: https://rawback.test\nfutureSetting: enabled\nsftp:\n  password: secret\n',
    )
    const lines: string[] = []

    await runConfigView({ json: true }, { configPath, stdout: (message) => lines.push(message) })

    expect(JSON.parse(lines.join('\n'))).toEqual({
      webHost: 'https://rawback.test',
      futureSetting: 'enabled',
      sftp: { password: '[REDACTED]' },
    })
  })

  test('treats missing and empty optional files as empty config', async () => {
    const configPath = await temporaryConfigPath()
    const missing: string[] = []
    await runConfigView({}, { configPath, stdout: (message) => missing.push(message) })
    expect(missing.join('\n')).toContain('No config file found')

    const json: string[] = []
    await runConfigView({ json: true }, { configPath, stdout: (message) => json.push(message) })
    expect(JSON.parse(json.join('\n'))).toEqual({})

    await writeFile(configPath, '')
    const empty: string[] = []
    await runConfigView({}, { configPath, stdout: (message) => empty.push(message) })
    expect(empty.join('\n')).toContain('{}')
  })

  test('rejects invalid YAML without printing its contents', async () => {
    const configPath = await temporaryConfigPath()
    await writeFile(configPath, 'sftp:\n  password: secret\napiHost: [')

    await expect(runConfigView({}, { configPath })).rejects.toThrow('invalid YAML')
    await expect(runConfigView({}, { configPath })).rejects.not.toThrow('secret')
  })
})
