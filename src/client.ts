import {
  GraphqlClient,
  HttpClient,
  createGraphqlCompatibilityClient,
  createRawbackClient as createSdkClient,
  type RawbackClient,
  type RawbackClientOptions as SdkClientOptions,
} from '@rawback/sdk'

import packageJson from '../package.json' with { type: 'json' }
import type { HttpClientOptions } from './http.ts'

const identity = {
  source: 'cli',
  version: packageJson.version,
  userAgent: `rawback-cli@${packageJson.version}`,
}

export type RawbackClientOptions = Omit<SdkClientOptions, 'identity'>
export type { RawbackClient }

export function createGraphqlClient(options: HttpClientOptions = {}) {
  const http = new HttpClient({
    identity,
    ...(options.apiHost ? { apiHost: options.apiHost } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.token ? { token: () => options.token } : {}),
  })
  return createGraphqlCompatibilityClient(new GraphqlClient(http))
}

export function createRawbackClient(options: RawbackClientOptions = {}): Promise<RawbackClient> {
  return createSdkClient({ ...options, identity })
}
