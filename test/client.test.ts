import { describe, expect, test } from "bun:test";
import { gql } from "@apollo/client";

import packageJson from "../package.json" with { type: "json" };
import { createApolloClient, createRawbackClient } from "../src/client.ts";

const TestDocument = gql`
  query Test($id: Int!) {
    test(id: $id)
  }
`;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function graphqlFetch(inspect: (input: FetchInput, init: FetchInit) => void): typeof fetch {
  return (async (input: FetchInput, init: FetchInit) => {
    inspect(input, init);
    return Response.json({
      data: { test: "partial" },
      errors: [
        {
          extensions: { code: 400 },
          message: "partial failure",
          path: ["test"],
        },
      ],
    });
  }) as typeof fetch;
}

describe("Apollo integration", () => {
  test("posts GraphQL operations with auth and returns partial data", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createApolloClient({
      apiHost: "https://example.com/",
      token: "access-token",
      fetch: graphqlFetch((input, init) => {
        requests.push({ url: input.toString(), ...(init ? { init } : {}) });
      }),
    });

    const first = await client.query({
      query: TestDocument,
      variables: { id: 7 },
    });
    await client.query({ query: TestDocument, variables: { id: 7 } });

    expect(first.data).toEqual({ test: "partial" });
    expect(first.error?.message).toContain("partial failure");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://example.com/api/v2/graphql");

    const headers = new Headers(requests[0]?.init?.headers);
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("user-agent")).toBe(`rawback-cli@${packageJson.version}`);
    expect(body.operationName).toBe("Test");
    expect(body.variables).toEqual({ id: 7 });
    expect(body.query).toContain("query Test");
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
    await client.graphql.query({ query: TestDocument, variables: { id: 1 } });

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
