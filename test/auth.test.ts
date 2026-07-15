import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AuthPrompts, runAuth, runAuthStatus } from "../src/auth.ts";
import { readCredentials, writeCredentials } from "../src/credentials.ts";
import { HttpError } from "../src/http.ts";

const temporaryDirectories: string[] = [];

async function temporaryPaths(): Promise<{ configPath: string; credentialsPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "rawback-auth-"));
  temporaryDirectories.push(directory);
  return {
    configPath: join(directory, "config.yml"),
    credentialsPath: join(directory, ".rawback", "credentials.json"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function createFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    handler(input.toString(), init)) as typeof fetch;
}

function unexpectedPrompts(): AuthPrompts {
  return {
    async confirm() {
      throw new Error("Unexpected confirmation prompt");
    },
    async email() {
      throw new Error("Unexpected email prompt");
    },
    async password() {
      throw new Error("Unexpected password prompt");
    },
  };
}

const authUser = {
  id: 7,
  name: "Raw Back",
  email: "user@example.com",
  slug: "raw-back",
  tier: "free",
  subscriptionStatus: "active",
  accountStatus: "active",
};

describe("auth commands", () => {
  test("logs in from flags without prompting and saves credentials", async () => {
    const paths = await temporaryPaths();
    const output: string[] = [];
    let loginBody: unknown;

    await runAuth(
      {
        email: " user@example.com ",
        force: true,
        password: "secret-password",
      },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        stdout: (message) => output.push(message),
        fetch: createFetch((url, init) => {
          expect(url).toBe("https://api.rawback.app/api/v1/auth/login");
          expect(new Headers(init?.headers).get("authorization")).toBeNull();
          loginBody = JSON.parse(String(init?.body));
          return Response.json({
            code: 200,
            data: {
              user: { id: 7, name: "Raw Back", email: "user@example.com" },
              accessToken: "access-token",
              refreshToken: "refresh-token",
            },
            msg: "",
          });
        }),
      },
    );

    expect(loginBody).toEqual({
      email: "user@example.com",
      password: "secret-password",
    });
    expect(await readCredentials(paths.credentialsPath)).toEqual({
      token: "access-token",
      refreshToken: "refresh-token",
    });
    expect(output).toEqual(["✓ Authenticated as Raw Back (user@example.com)."]);
    expect(output.join("\n")).not.toContain("secret-password");
  });

  test("prompts only for missing values", async () => {
    const paths = await temporaryPaths();
    const calls: string[] = [];

    await runAuth(
      { email: "user@example.com", force: true },
      {
        ...paths,
        prompts: {
          async confirm() {
            calls.push("confirm");
            return true;
          },
          async email() {
            calls.push("email");
            return "prompt@example.com";
          },
          async password() {
            calls.push("password");
            return "prompted-password";
          },
        },
        fetch: createFetch((_url, init) => {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            email: "user@example.com",
            password: "prompted-password",
          });
          return Response.json({
            code: 200,
            data: {
              user: { id: 7, name: "Raw Back", email: "user@example.com" },
              accessToken: "access-token",
              refreshToken: "refresh-token",
            },
            msg: "",
          });
        }),
        stdout() {},
      },
    );

    expect(calls).toEqual(["password"]);
  });

  test("keeps a valid session when reauthentication is declined", async () => {
    const paths = await temporaryPaths();
    await writeCredentials(
      { token: "access-token", refreshToken: "refresh-token" },
      paths.credentialsPath,
    );
    const output: string[] = [];
    const confirmations: string[] = [];
    let requests = 0;

    await runAuth(
      {},
      {
        ...paths,
        prompts: {
          async confirm(message) {
            confirmations.push(message);
            return false;
          },
          async email() {
            throw new Error("Unexpected email prompt");
          },
          async password() {
            throw new Error("Unexpected password prompt");
          },
        },
        stdout: (message) => output.push(message),
        fetch: createFetch(() => {
          requests += 1;
          return Response.json({ data: { me: authUser } });
        }),
      },
    );

    expect(requests).toBe(1);
    expect(confirmations).toEqual([
      "Already authenticated as Raw Back (user@example.com). Reauthenticate?",
    ]);
    expect(output).toEqual(["ℹ Authentication unchanged."]);
    expect(await readCredentials(paths.credentialsPath)).toEqual({
      token: "access-token",
      refreshToken: "refresh-token",
    });
  });

  test("preserves existing credentials when forced login fails", async () => {
    const paths = await temporaryPaths();
    const oldCredentials = { token: "old-token", refreshToken: "old-refresh" };
    await writeCredentials(oldCredentials, paths.credentialsPath);

    expect(
      runAuth(
        { email: "user@example.com", force: true, password: "wrong-password" },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          fetch: createFetch(() =>
            Response.json(
              { code: 401, data: null, msg: "invalid email or password" },
              { status: 401 },
            ),
          ),
        },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(await readCredentials(paths.credentialsPath)).toEqual(oldCredentials);
  });

  test("allows authentication to replace malformed credentials", async () => {
    const paths = await temporaryPaths();
    await writeCredentials(
      { token: "old-token", refreshToken: "old-refresh" },
      paths.credentialsPath,
    );
    await writeFile(paths.credentialsPath, "not json");
    const warnings: string[] = [];

    await runAuth(
      { email: "user@example.com", password: "secret-password" },
      {
        ...paths,
        prompts: unexpectedPrompts(),
        stderr: (message) => warnings.push(message),
        stdout() {},
        fetch: createFetch(() =>
          Response.json({
            code: 200,
            data: {
              user: { id: 7, name: "Raw Back", email: "user@example.com" },
              accessToken: "new-token",
              refreshToken: "new-refresh",
            },
            msg: "",
          }),
        ),
      },
    );

    expect(warnings.join("\n")).toContain("invalid JSON");
    expect(await readCredentials(paths.credentialsPath)).toEqual({
      token: "new-token",
      refreshToken: "new-refresh",
    });
  });

  test("prints basic account information for auth status", async () => {
    const paths = await temporaryPaths();
    await writeCredentials(
      { token: "access-token", refreshToken: "refresh-token" },
      paths.credentialsPath,
    );
    const output: string[] = [];

    await runAuthStatus({
      ...paths,
      stdout: (message) => output.push(message),
      fetch: createFetch(() => Response.json({ data: { me: authUser } })),
    });

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("✓ Authenticated");
    expect(output[0]).toContain("Name          Raw Back");
    expect(output[0]).toContain("Email         user@example.com");
    expect(output[0]).toContain("Profile       @raw-back");
  });

  test("reports missing, malformed, and expired authentication", async () => {
    const missingPaths = await temporaryPaths();
    expect(runAuthStatus(missingPaths)).rejects.toThrow("Not authenticated");

    const malformedPaths = await temporaryPaths();
    await writeFile(malformedPaths.credentialsPath, "not json").catch(async () => {
      await writeCredentials(
        { token: "temporary", refreshToken: "temporary" },
        malformedPaths.credentialsPath,
      );
      await writeFile(malformedPaths.credentialsPath, "not json");
    });
    expect(runAuthStatus(malformedPaths)).rejects.toThrow("rawback auth --force");

    const expiredPaths = await temporaryPaths();
    await writeCredentials(
      { token: "expired-token", refreshToken: "expired-refresh" },
      expiredPaths.credentialsPath,
    );
    expect(
      runAuthStatus({
        ...expiredPaths,
        fetch: createFetch((url) => {
          if (url.endsWith("/api/v1/auth/refresh")) {
            return Response.json(
              { code: 401, data: null, msg: "invalid refresh token" },
              { status: 401 },
            );
          }
          return Response.json({
            data: null,
            errors: [{ message: "unauthorized", extensions: { code: 401 } }],
          });
        }),
      }),
    ).rejects.toThrow("Authentication has expired");
  });

  test("rejects empty credential options before making a request", async () => {
    const paths = await temporaryPaths();
    let requests = 0;

    expect(
      runAuth(
        { email: "", force: true, password: "" },
        {
          ...paths,
          prompts: unexpectedPrompts(),
          fetch: createFetch(() => {
            requests += 1;
            return Response.json({});
          }),
        },
      ),
    ).rejects.toThrow("Email is required");
    expect(requests).toBe(0);
  });
});
