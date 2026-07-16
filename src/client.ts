import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, from } from "@apollo/client";

import { type RawbackConfig, DEFAULT_CONFIG_PATH, readConfig } from "./config.ts";
import { type Credentials, DEFAULT_CREDENTIALS_PATH, readCredentials } from "./credentials.ts";
import {
  HttpClient,
  CLIENT_SOURCE,
  CLIENT_VERSION,
  type HttpClientOptions,
  resolveApiHost,
  resolveApiUrl,
  USER_AGENT,
} from "./http.ts";
import { CredentialSession } from "./session.ts";

declare module "@apollo/client" {
  namespace ApolloClient {
    namespace DeclareDefaultOptions {
      interface Mutate {
        errorPolicy: "all";
      }

      interface Query {
        errorPolicy: "all";
      }

      interface WatchQuery {
        errorPolicy: "all";
      }
    }
  }
}

export interface RawbackClientOptions {
  apiHost?: string;
  config?: RawbackConfig;
  configPath?: string;
  credentials?: Credentials | null;
  credentialsPath?: string;
  fetch?: typeof globalThis.fetch;
}

export interface RawbackClient {
  credentials: Credentials | null;
  config: RawbackConfig;
  http: HttpClient;
  graphql: ApolloClient;
}

function createAuthLink(token: string | undefined): ApolloLink {
  return new ApolloLink((operation, forward) => {
    operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
      headers: {
        ...Object.fromEntries(new Headers(headers)),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "user-agent": USER_AGENT,
        "x-rawback-client-source": CLIENT_SOURCE,
        "x-rawback-client-version": CLIENT_VERSION,
      },
    }));
    return forward(operation);
  });
}

export function createApolloClient(options: HttpClientOptions = {}): ApolloClient {
  const apiHost = resolveApiHost(options.apiHost);
  const httpLink = new HttpLink({
    uri: resolveApiUrl(apiHost, "/api/v2/graphql"),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return new ApolloClient({
    cache: new InMemoryCache(),
    defaultOptions: {
      mutate: {
        errorPolicy: "all",
      },
      query: {
        errorPolicy: "all",
        fetchPolicy: "no-cache",
      },
      watchQuery: {
        errorPolicy: "all",
        fetchPolicy: "no-cache",
      },
    },
    link: from([createAuthLink(options.token), httpLink]),
  });
}

export async function createRawbackClient(
  options: RawbackClientOptions = {},
): Promise<RawbackClient> {
  const config =
    options.config === undefined
      ? await readConfig(options.configPath ?? DEFAULT_CONFIG_PATH)
      : options.config;
  const credentials =
    options.credentials === undefined
      ? await readCredentials(options.credentialsPath ?? DEFAULT_CREDENTIALS_PATH)
      : options.credentials;
  const apiHost = resolveApiHost(options.apiHost ?? config.apiHost);
  const token = credentials?.token;
  const credentialsPath = options.credentialsPath ?? DEFAULT_CREDENTIALS_PATH;
  const session = credentials
    ? new CredentialSession({
        apiHost,
        credentials,
        credentialsPath,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : null;
  const transportOptions: HttpClientOptions = {
    apiHost,
    ...(token ? { token } : {}),
    ...(session ? { fetch: session.createFetch() } : options.fetch ? { fetch: options.fetch } : {}),
  };

  return {
    get credentials() {
      return session?.credentials ?? credentials;
    },
    config,
    graphql: createApolloClient(transportOptions),
    http: new HttpClient(transportOptions),
  };
}
