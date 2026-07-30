import { describe, expect, test } from "bun:test";
import { AuthStatusDocument } from "@rawback/sdk";

import packageJson from "../package.json" with { type: "json" };
import { createGraphqlClient, createRawbackClient } from "../src/client.ts";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function graphqlFetch(inspect: (input: FetchInput, init: FetchInit) => void): typeof fetch {
  return (async (input: FetchInput, init: FetchInit) => {
    inspect(input, init);
    return Response.json({
      data: {
        me: {
          id: 7,
          name: "Raw Back",
          email: "user@example.com",
          slug: "raw-back",
          tier: "free",
          subscriptionStatus: "active",
          accountStatus: "active",
        },
      },
      errors: [
        {
          extensions: { code: 400 },
          message: "partial failure",
          path: ["me"],
        },
      ],
    });
  }) as typeof fetch;
}

describe("SDK GraphQL integration", () => {
  test("posts GraphQL operations with auth and returns partial data", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGraphqlClient({
      apiHost: "https://example.com/",
      token: "access-token",
      fetch: graphqlFetch((input, init) => {
        requests.push({ url: input.toString(), ...(init ? { init } : {}) });
      }),
    });

    const first = await client.query({
      query: AuthStatusDocument,
    });
    await client.query({ query: AuthStatusDocument });

    expect(first.data?.me?.id).toBe(7);
    expect(first.error?.message).toContain("partial failure");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://example.com/api/v2/graphql");

    const headers = new Headers(requests[0]?.init?.headers);
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("user-agent")).toBe(`rawback-cli@${packageJson.version}`);
    expect(headers.get("x-rawback-client-source")).toBe("cli");
    expect(headers.get("x-rawback-client-version")).toBe(packageJson.version);
    expect(body.operationName).toBe("AuthStatus");
    expect(body.variables).toEqual({});
    expect(body.query).toContain("query AuthStatus");
  });

  test("loads credentials for both transports", async () => {
    const requests: RequestInit[] = [];
    const client = await createRawbackClient({
      apiHost: "https://example.com",
      credentials: {
        refreshToken: "refresh-token",
        token: "stored-token",
      },
      fetch: graphqlFetch((_input, init) => {
        if (init) requests.push(init);
      }),
    });

    await client.http.requestJson("/api/test");
    await client.graphql.query({ query: AuthStatusDocument });

    expect(client.credentials?.refreshToken).toBe("refresh-token");
    expect(new Headers(requests[0]?.headers).get("authorization")).toBe("Bearer stored-token");
    expect(new Headers(requests[1]?.headers).get("authorization")).toBe("Bearer stored-token");
  });

  test("uses config apiHost unless an explicit option overrides it", async () => {
    const urls: string[] = [];
    const fetch = (async (input: FetchInput) => {
      urls.push(input.toString());
      return Response.json({});
    }) as typeof globalThis.fetch;
    const configured = await createRawbackClient({
      config: { apiHost: "https://configured.example" },
      credentials: null,
      fetch,
    });
    const overridden = await createRawbackClient({
      apiHost: "https://override.example",
      config: { apiHost: "https://configured.example" },
      credentials: null,
      fetch,
    });

    await configured.http.requestJson("/api/test");
    await overridden.http.requestJson("/api/test");

    expect(urls).toEqual([
      "https://configured.example/api/test",
      "https://override.example/api/test",
    ]);
  });
});
