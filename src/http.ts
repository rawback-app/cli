import packageJson from "../package.json" with { type: "json" };
import {
  HttpClient as SdkHttpClient,
  JsonResponseError,
  RawbackHttpError,
  resolveApiHost,
  resolveApiUrl,
  type ApiEnvelope,
  type JsonRequestOptions,
} from "@rawback/sdk";

export const DEFAULT_API_HOST = "https://api.rawback.app";
export const CLIENT_SOURCE = "cli";
export const CLIENT_VERSION = packageJson.version;
export const USER_AGENT = `rawback-cli@${CLIENT_VERSION}`;

export interface HttpClientOptions {
  apiHost?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export class HttpClient extends SdkHttpClient {
  readonly token: string | undefined;

  constructor(options: HttpClientOptions = {}) {
    super({
      identity: {
        source: CLIENT_SOURCE,
        version: CLIENT_VERSION,
        userAgent: USER_AGENT,
      },
      ...(options.apiHost ? { apiHost: options.apiHost } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.token ? { token: () => options.token } : {}),
    });
    this.token = options.token;
  }
}

export {
  JsonResponseError,
  RawbackHttpError,
  RawbackHttpError as HttpError,
  resolveApiHost,
  resolveApiUrl,
  type ApiEnvelope,
  type JsonRequestOptions,
};
