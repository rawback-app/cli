import {
  CredentialSession as SdkCredentialSession,
  FileCredentialsStore,
  type Credentials,
} from '@rawback/sdk'

import { CLIENT_SOURCE, CLIENT_VERSION, USER_AGENT } from './http.ts'

export interface CredentialSessionOptions {
  apiHost: string
  credentials: Credentials
  credentialsPath: string
  /** Which environment's slot in `credentials.json` a refresh writes back to. */
  environment?: string
  fetch?: typeof globalThis.fetch
}

export class CredentialSession {
  private readonly session: SdkCredentialSession

  constructor(options: CredentialSessionOptions) {
    this.session = new SdkCredentialSession({
      apiHost: options.apiHost,
      credentials: options.credentials,
      identity: {
        source: CLIENT_SOURCE,
        version: CLIENT_VERSION,
        userAgent: USER_AGENT,
      },
      store: new FileCredentialsStore(options.credentialsPath, options.environment),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  get credentials(): Credentials {
    return this.session.credentials
  }

  refresh(): Promise<boolean> {
    return this.session.refresh()
  }

  createFetch(): typeof globalThis.fetch {
    return this.session.createFetch()
  }
}
