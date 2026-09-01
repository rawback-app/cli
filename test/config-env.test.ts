import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectEnvironments, runConfigEnvList, runConfigUse } from '../src/config-env.ts'
import { writeCredentials } from '../src/credentials.ts'

const temporaryDirectories: string[] = []

const source = [
  '# shared with Desktop',
  'current: production',
  'metadata:',
  '  concurrency: 8',
  'sftp:',
  '  username: photographer',
  'environments:',
  '  production:',
  '    apiHost: https://api.rawback.app',
  '  local:',
  '    apiHost: http://localhost:23164',
  '',
].join('\n')

async function fixture(): Promise<{ configPath: string; credentialsPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-config-env-'))
  temporaryDirectories.push(directory)
  const configPath = join(directory, 'config.yml')
  await writeFile(configPath, source, { mode: 0o600 })
  return { configPath, credentialsPath: join(directory, 'credentials.json') }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('config env', () => {
  test('reports which environments exist, are signed in, and are selected', async () => {
    const { configPath, credentialsPath } = await fixture()
    await writeCredentials({ token: 'a', refreshToken: 'b' }, credentialsPath, 'local')

    expect(await collectEnvironments({ configPath, credentialsPath })).toEqual([
      {
        name: 'default',
        apiHost: 'https://api.rawback.app',
        webHost: undefined,
        current: false,
        authenticated: false,
        selected: false,
      },
      {
        name: 'production',
        apiHost: 'https://api.rawback.app',
        webHost: undefined,
        current: true,
        authenticated: false,
        selected: true,
      },
      {
        name: 'local',
        apiHost: 'http://localhost:23164',
        webHost: undefined,
        current: false,
        authenticated: true,
        selected: false,
      },
    ])
  })

  test('marks the requested environment as selected instead of the saved one', async () => {
    const { configPath, credentialsPath } = await fixture()
    const environments = await collectEnvironments({ configPath, credentialsPath, env: 'local' })

    expect(environments.map((environment) => environment.selected)).toEqual([false, false, true])
    expect(environments.map((environment) => environment.current)).toEqual([false, true, false])
  })

  test('emits machine-readable JSON', async () => {
    const { configPath, credentialsPath } = await fixture()
    const lines: string[] = []

    await runConfigEnvList(
      { json: true },
      { configPath, credentialsPath, stdout: (message) => lines.push(message) },
    )

    expect(JSON.parse(lines.join('\n')).environments).toHaveLength(3)
  })

  test('repoints current while preserving comments, and rejects unknown names', async () => {
    const { configPath, credentialsPath } = await fixture()

    await runConfigUse('local', { configPath, credentialsPath, stdout: () => {} })

    const contents = await readFile(configPath, 'utf8')
    expect(contents).toContain('# shared with Desktop')
    expect(contents).toContain('current: local')

    await expect(
      runConfigUse('staging', { configPath, credentialsPath, stdout: () => {} }),
    ).rejects.toThrow('Unknown environment "staging"')
  })

  test('accepts the reserved default name', async () => {
    const { configPath, credentialsPath } = await fixture()
    await runConfigUse('default', { configPath, credentialsPath, stdout: () => {} })

    expect(await readFile(configPath, 'utf8')).toContain('current: default')
  })
})
