import { RawbackGraphqlError } from '@rawback/sdk'
import { AuthStatusDocument, type AuthStatusQuery } from '@rawback/sdk'

import { type RawbackClient, createRawbackClient } from './client.ts'
import { commandOutput, type ReadCommandDependencies } from './command.ts'
import { DEFAULT_WEB_HOST, type RawbackConfig, readConfig } from './config.ts'
import {
  type Credentials,
  CredentialsError,
  DEFAULT_CREDENTIALS_PATH,
  readCredentials,
  writeCredentials,
} from './credentials.ts'
import { authStatusDocument } from './features/auth/view.ts'
import { type ApiEnvelope, HttpError, JsonResponseError } from './http.ts'
import { browserCommand, defaultOpen } from './web.ts'

interface LoginUser {
  id: number
  name: string
  email: string
}

interface DeviceSessionResponse {
  sessionId: string
  pollToken: string
  expiresAt: string
  pollIntervalSeconds: number
}

interface ApprovedDeviceResponse {
  user: LoginUser
  accessToken: string
  refreshToken: string
}

type DevicePollResponse =
  | { status: 'pending' | 'denied' }
  | ({ status: 'approved' } & ApprovedDeviceResponse)

const DEVICE_SESSION_CREATE_ATTEMPTS = 3
const DEVICE_SESSION_CREATE_RETRY_DELAYS = [1_000, 2_000] as const
const MAX_RETRY_AFTER_MILLISECONDS = 10_000
const operatingSystem = () => process.platform
const systemArchitecture = () => process.arch

export interface AuthPrompts {
  confirm(message: string): Promise<boolean>
}

export interface AuthCommandDependencies extends ReadCommandDependencies {
  prompts?: AuthPrompts
  open?: (command: string, args: string[]) => Promise<number>
  platform?: NodeJS.Platform
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  operatingSystem?: () => string
  architecture?: () => string
}

export interface AuthCommandOptions {
  force?: boolean
}

type AuthUser = AuthStatusQuery['me']

type StatusResult =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'invalid' }
  | { kind: 'missing' }

function defaultPrompts(): AuthPrompts {
  const ensureInteractive = (message: string) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(message)
    }
  }

  return {
    async confirm(message) {
      ensureInteractive(
        'A valid session already exists. Re-run with --force to reauthenticate non-interactively.',
      )
      const { confirm } = await import('@inquirer/prompts')
      return confirm({ default: false, message })
    },
  }
}

function createClient(
  config: RawbackConfig,
  credentials: Credentials | null,
  dependencies: AuthCommandDependencies,
): Promise<RawbackClient> {
  return createRawbackClient({
    config,
    credentials,
    credentialsPath: dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  })
}

function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof RawbackGraphqlError)) return false
  return error.errors.some((item) => {
    const code = item.extensions?.code
    return code === 401 || code === '401' || code === 'UNAUTHENTICATED'
  })
}

async function queryStatus(
  config: RawbackConfig,
  credentials: Credentials | null,
  dependencies: AuthCommandDependencies,
): Promise<StatusResult> {
  if (!credentials) {
    return { kind: 'missing' }
  }

  const client = await createClient(config, credentials, dependencies)
  const result = await client.graphql.query({ query: AuthStatusDocument })

  if (result.error) {
    if (isUnauthorizedError(result.error)) {
      return { kind: 'invalid' }
    }
    throw result.error
  }
  if (!result.data?.me) {
    throw new Error('The account status response did not include user information')
  }

  return { kind: 'authenticated', user: result.data.me }
}

async function readStoredCredentials(
  dependencies: AuthCommandDependencies,
  tolerateInvalid: boolean,
): Promise<Credentials | null> {
  try {
    return await readCredentials(dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH)
  } catch (error) {
    if (tolerateInvalid && error instanceof CredentialsError) {
      commandOutput(dependencies).warning(error.message + '; continuing with authentication.')
      return null
    }
    throw error
  }
}

function parseDeviceSessionResponse(value: unknown): DeviceSessionResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('sessionId' in value) ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    !('pollToken' in value) ||
    typeof value.pollToken !== 'string' ||
    value.pollToken.length === 0 ||
    !('expiresAt' in value) ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !('pollIntervalSeconds' in value) ||
    typeof value.pollIntervalSeconds !== 'number' ||
    !Number.isInteger(value.pollIntervalSeconds) ||
    value.pollIntervalSeconds < 1 ||
    value.pollIntervalSeconds > 60
  ) {
    throw new Error('The device session response was invalid')
  }
  return {
    sessionId: value.sessionId,
    pollToken: value.pollToken,
    expiresAt: value.expiresAt,
    pollIntervalSeconds: value.pollIntervalSeconds,
  }
}

function parseDevicePollResponse(value: unknown): DevicePollResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('status' in value) ||
    !['pending', 'approved', 'denied'].includes(String(value.status))
  ) {
    throw new Error('The device authorization response was invalid')
  }
  if (value.status !== 'approved') {
    return { status: value.status as 'pending' | 'denied' }
  }
  const approved = parseApprovedDeviceResponse(value)
  return { status: 'approved', ...approved }
}

function parseApprovedDeviceResponse(value: Record<string, unknown>): ApprovedDeviceResponse {
  const user = value.user
  if (
    typeof user !== 'object' ||
    user === null ||
    !('id' in user) ||
    typeof user.id !== 'number' ||
    !('name' in user) ||
    typeof user.name !== 'string' ||
    !('email' in user) ||
    typeof user.email !== 'string' ||
    typeof value.accessToken !== 'string' ||
    value.accessToken.length === 0 ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length === 0
  ) {
    throw new Error(
      'The approved device response did not contain valid user information and tokens',
    )
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
  }
}

function isRetriablePollError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500
  }
  return !(error instanceof JsonResponseError)
}

function retryAfterMilliseconds(error: unknown, fallback: number, now: () => number): number {
  if (!(error instanceof HttpError)) {
    return fallback
  }

  const value = error.headers.get('retry-after')?.trim()
  if (!value) {
    return fallback
  }

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MILLISECONDS)
  }

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) {
    return fallback
  }
  return Math.min(Math.max(retryAt - now(), 0), MAX_RETRY_AFTER_MILLISECONDS)
}

function exhaustedDeviceSessionError(error: unknown): Error {
  const traceID = error instanceof HttpError ? error.headers.get('x-trace-id')?.trim() : undefined
  const traceSuffix = traceID ? ` Trace ID: ${traceID}.` : ''

  if (error instanceof HttpError) {
    return new Error(
      `Device authorization failed after ${DEVICE_SESSION_CREATE_ATTEMPTS} attempts: ${error.message}${traceSuffix}`,
      { cause: error },
    )
  }

  const detail = error instanceof Error && error.message ? `: ${error.message}` : ''
  return new Error(
    `Unable to create a device authorization session after ${DEVICE_SESSION_CREATE_ATTEMPTS} attempts${detail}.${traceSuffix}`,
    { cause: error },
  )
}

function exhaustedDevicePollError(error: unknown): Error {
  const detail = error instanceof Error && error.message ? error.message : String(error)
  const traceID = error instanceof HttpError ? error.headers.get('x-trace-id')?.trim() : undefined
  const traceSuffix = traceID ? ` Trace ID: ${traceID}.` : ''
  return new Error(
    `Device authorization could not be completed before the session expired: ${detail}${traceSuffix}`,
    { cause: error },
  )
}

async function createDeviceSession(
  client: RawbackClient,
  dependencies: AuthCommandDependencies,
): Promise<DeviceSessionResponse> {
  const sleep = dependencies.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds))
  const now = dependencies.now ?? Date.now
  const body = {
    operatingSystem: (dependencies.operatingSystem ?? operatingSystem)(),
    architecture: (dependencies.architecture ?? systemArchitecture)(),
  }

  for (let attempt = 0; attempt < DEVICE_SESSION_CREATE_ATTEMPTS; attempt += 1) {
    try {
      const envelope = await client.http.requestJson<ApiEnvelope<DeviceSessionResponse>>(
        '/api/v1/auth/device/sessions',
        {
          authenticated: false,
          body,
          method: 'POST',
        },
      )
      return parseDeviceSessionResponse(envelope.data)
    } catch (error) {
      if (!isRetriablePollError(error)) {
        throw error
      }
      const fallback = DEVICE_SESSION_CREATE_RETRY_DELAYS[attempt]
      if (fallback === undefined) {
        throw exhaustedDeviceSessionError(error)
      }
      await sleep(retryAfterMilliseconds(error, fallback, now))
    }
  }

  throw new Error('Unable to create a device authorization session')
}

async function pollDeviceSession(
  client: RawbackClient,
  session: DeviceSessionResponse,
  dependencies: AuthCommandDependencies,
): Promise<ApprovedDeviceResponse> {
  const now = dependencies.now ?? Date.now
  const sleep = dependencies.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds))
  const expiresAt = Date.parse(session.expiresAt)
  const interval = session.pollIntervalSeconds * 1_000
  let lastRetriableError: unknown

  while (now() < expiresAt) {
    let envelope: ApiEnvelope<DevicePollResponse>
    try {
      envelope = await client.http.requestJson<ApiEnvelope<DevicePollResponse>>(
        `/api/v1/auth/device/sessions/${encodeURIComponent(session.sessionId)}/token`,
        {
          authenticated: false,
          body: { pollToken: session.pollToken },
          method: 'POST',
        },
      )
    } catch (error) {
      if (!isRetriablePollError(error)) {
        if (error instanceof HttpError && error.status === 404) {
          throw new Error('Device authorization expired or was already used.', { cause: error })
        }
        throw error
      }
      lastRetriableError = error
      await sleep(interval)
      continue
    }

    const response = parseDevicePollResponse(envelope.data)
    lastRetriableError = undefined
    if (response.status === 'approved') {
      return {
        user: response.user,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      }
    }
    if (response.status === 'denied') {
      throw new Error('Device authorization was denied.')
    }
    await sleep(interval)
  }

  if (lastRetriableError !== undefined) {
    throw exhaustedDevicePollError(lastRetriableError)
  }
  throw new Error("Device authorization expired. Run 'rawback auth' to try again.")
}

export async function runAuth(
  options: AuthCommandOptions,
  dependencies: AuthCommandDependencies = {},
): Promise<void> {
  const config = await readConfig(dependencies.configPath)
  const ui = commandOutput(dependencies)
  const prompts = dependencies.prompts ?? defaultPrompts()

  if (!options.force) {
    const credentials = await readStoredCredentials(dependencies, true)
    const status = await ui.withActivity('Checking authentication…', () =>
      queryStatus(config, credentials, dependencies),
    )

    if (status.kind === 'authenticated') {
      const shouldReauthenticate = await prompts.confirm(
        'Already authenticated as ' +
          status.user.name +
          ' (' +
          status.user.email +
          '). Reauthenticate?',
      )
      if (!shouldReauthenticate) {
        ui.info('Authentication unchanged.')
        return
      }
    } else if (status.kind === 'invalid') {
      ui.warning('Stored credentials are expired or invalid; continuing with authentication.')
    }
  }

  const client = await createClient(config, null, dependencies)
  const session = await ui.withActivity('Creating device session…', () =>
    createDeviceSession(client, dependencies),
  )
  const webHost = (config.webHost ?? DEFAULT_WEB_HOST).replace(/\/$/, '')
  const url = `${webHost}/auth/device/${encodeURIComponent(session.sessionId)}`
  ui.info('Authorize this CLI session in your browser:')
  ui.raw(url)

  const [command, args] = browserCommand(dependencies.platform ?? process.platform, url)
  try {
    const exitCode = await (dependencies.open ?? defaultOpen)(command, args)
    if (exitCode !== 0) {
      ui.warning(`Could not open the browser automatically. Use the link shown above.`)
    }
  } catch {
    ui.warning('Could not open the browser automatically. Use the link shown above.')
  }

  const activity = ui.startActivity('Waiting for browser authorization…')
  let response: ApprovedDeviceResponse
  try {
    response = await pollDeviceSession(client, session, dependencies)
  } finally {
    await activity.stop()
  }
  await writeCredentials(
    {
      token: response.accessToken,
      refreshToken: response.refreshToken,
    },
    dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
  )
  ui.success('Authenticated as ' + response.user.name + ' (' + response.user.email + ').')
}

export async function runAuthStatus(dependencies: AuthCommandDependencies = {}): Promise<void> {
  const config = await readConfig(dependencies.configPath)
  const ui = commandOutput(dependencies)
  let credentials: Credentials | null
  try {
    credentials = await readStoredCredentials(dependencies, false)
  } catch (error) {
    if (error instanceof CredentialsError) {
      throw new Error(error.message + ". Run 'rawback auth --force' to sign in again.", {
        cause: error,
      })
    }
    throw error
  }
  const status = await ui.withActivity('Checking authentication…', () =>
    queryStatus(config, credentials, dependencies),
  )

  if (status.kind === 'missing') {
    throw new Error("Not authenticated. Run 'rawback auth' to sign in.")
  }
  if (status.kind === 'invalid') {
    throw new Error("Authentication has expired. Run 'rawback auth --force' to sign in again.")
  }

  ui.document(authStatusDocument(status.user))
}
