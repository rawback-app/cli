import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'yaml'
import * as z from 'zod'

const nonEmptyStringSchema = z
  .string({ error: 'must be a non-empty string' })
  .trim()
  .min(1, { error: 'must be a non-empty string' })

const httpHostSchema = nonEmptyStringSchema.pipe(z.url({ error: 'must be a valid URL' })).refine(
  (value) => {
    const url = URL.parse(value)
    return url === null || ['http:', 'https:'].includes(url.protocol)
  },
  { error: 'must use HTTP or HTTPS' },
)

const sftpEndpointSchema = nonEmptyStringSchema
  .pipe(z.url({ error: 'must be a valid URL' }))
  .refine(
    (value) => {
      const endpoint = URL.parse(value)
      return endpoint === null || endpoint.protocol === 'sftp:'
    },
    { error: 'must use SFTP' },
  )
  .refine(
    (value) => {
      const endpoint = URL.parse(value)
      return (
        endpoint === null ||
        (!endpoint.username &&
          !endpoint.password &&
          !endpoint.search &&
          !endpoint.hash &&
          (endpoint.pathname === '' || endpoint.pathname === '/'))
      )
    },
    { error: 'must only contain an SFTP host and optional port' },
  )

const sftpConfigSchema = z.object(
  {
    endpoint: sftpEndpointSchema.optional(),
    username: nonEmptyStringSchema.optional(),
    password: nonEmptyStringSchema.optional(),
    hostFingerprint: nonEmptyStringSchema.optional(),
  },
  { error: 'must contain a YAML mapping' },
)

const rawbackConfigSchema = z.preprocess(
  (value) => value ?? {},
  z.object(
    {
      apiHost: httpHostSchema.optional(),
      webHost: httpHostSchema.optional(),
      sftp: sftpConfigSchema.optional(),
    },
    { error: 'must contain a YAML mapping' },
  ),
)

export type RawbackConfig = z.infer<typeof rawbackConfigSchema>
export type SftpConfig = z.infer<typeof sftpConfigSchema>

export const DEFAULT_CONFIG_PATH = join(homedir(), '.rawback', 'config.yml')
export const DEFAULT_WEB_HOST = 'https://rawback.app'

export class ConfigError extends Error {
  readonly path: string

  constructor(message: string, path: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigError'
    this.path = path
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export async function readConfig(path = DEFAULT_CONFIG_PATH): Promise<RawbackConfig> {
  let contents: string

  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (isFileSystemError(error) && error.code === 'ENOENT') {
      return {}
    }
    throw new ConfigError(`Unable to read config at ${path}`, path, { cause: error })
  }

  let parsed: unknown
  try {
    parsed = parse(contents)
  } catch (error) {
    throw new ConfigError(`Config at ${path} contains invalid YAML`, path, {
      cause: error,
    })
  }

  const result = rawbackConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new ConfigError(`Config at ${path} is invalid:\n${z.prettifyError(result.error)}`, path, {
      cause: result.error,
    })
  }
  return result.data
}
