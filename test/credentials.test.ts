import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CredentialsError,
  deleteCredentials,
  readCredentials,
  writeCredentials,
} from '../src/credentials.ts'

const temporaryDirectories: string[] = []

async function temporaryCredentialsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-credentials-'))
  temporaryDirectories.push(directory)
  return join(directory, '.rawback', 'credentials.json')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('credentials', () => {
  test('returns null when the credentials file does not exist', async () => {
    const path = await temporaryCredentialsPath()

    expect(await readCredentials(path)).toBeNull()
  })

  test('writes and reads the token pair', async () => {
    const path = await temporaryCredentialsPath()
    const credentials = {
      refreshToken: 'refresh-token',
      token: 'access-token',
    }

    await writeCredentials(credentials, path)

    expect(await readCredentials(path)).toEqual(credentials)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(credentials)

    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
    }
  })

  test('atomically replaces existing credentials', async () => {
    const path = await temporaryCredentialsPath()

    await writeCredentials({ token: 'old', refreshToken: 'old-refresh' }, path)
    await writeCredentials({ token: 'new', refreshToken: 'new-refresh' }, path)

    expect(await readCredentials(path)).toEqual({
      token: 'new',
      refreshToken: 'new-refresh',
    })
  })

  test('reports invalid JSON', async () => {
    const path = await temporaryCredentialsPath()
    await writeCredentials({ token: 'old', refreshToken: 'old-refresh' }, path)
    await writeFile(path, 'not json')

    expect(readCredentials(path)).rejects.toBeInstanceOf(CredentialsError)
  })

  test('reports missing credential fields', async () => {
    const path = await temporaryCredentialsPath()
    await writeCredentials({ token: 'old', refreshToken: 'old-refresh' }, path)
    await writeFile(path, JSON.stringify({ token: 'only-access' }))

    expect(readCredentials(path)).rejects.toThrow('token and refreshToken')
  })

  test('deletes credentials idempotently', async () => {
    const path = await temporaryCredentialsPath()
    await writeCredentials({ token: 'token', refreshToken: 'refresh' }, path)

    await deleteCredentials(path)
    await deleteCredentials(path)

    expect(await readCredentials(path)).toBeNull()
  })
})
