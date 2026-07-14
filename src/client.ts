import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, from } from "@apollo/client";

import { type Credentials, DEFAULT_CREDENTIALS_PATH, readCredentials } from "./credentials.ts";
import {
  HttpClient,
  type HttpClientOptions,
  resolveApiHost,
  resolveApiUrl,
  USER_AGENT,
} from "./http.ts";

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
  credentials?: Credentials | null;
  credentialsPath?: string;
  fetch?: typeof globalThis.fetch;
}

export interface RawbackClient {
  credentials: Credentials | null;
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
  const credentials =
    options.credentials === undefined
      ? await readCredentials(options.credentialsPath ?? DEFAULT_CREDENTIALS_PATH)
      : options.credentials;
  const apiHost = resolveApiHost(options.apiHost);
  const token = credentials?.token;
  const transportOptions: HttpClientOptions = {
    apiHost,
    ...(token ? { token } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  return {
    credentials,
    graphql: createApolloClient(transportOptions),
    http: new HttpClient(transportOptions),
  };
}
