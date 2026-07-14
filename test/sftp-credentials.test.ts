import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeCredentials } from "../src/credentials.ts";
import {
  type SftpCredentialCommandDependencies,
  type SftpCredentialPrompts,
  runSftpCredentialAdd,
  runSftpCredentialDelete,
  runSftpCredentialList,
} from "../src/sftp-credentials.ts";

const temporaryDirectories: string[] = [];

async function temporaryDependencies(
  handler: (body: Record<string, unknown>, init?: RequestInit) => Response | Promise<Response>,
  overrides: Partial<SftpCredentialCommandDependencies> = {},
): Promise<SftpCredentialCommandDependencies> {
  const directory = await mkdtemp(join(tmpdir(), "rawback-sftp-credentials-"));
  temporaryDirectories.push(directory);
  const credentialsPath = join(directory, ".rawback", "credentials.json");
  await writeCredentials({ token: "access-token", refreshToken: "refresh-token" }, credentialsPath);

  return {
    configPath: join(directory, "config.yml"),
    credentialsPath,
    fetch: (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      return handler(JSON.parse(String(init?.body)) as Record<string, unknown>, init);
    }) as typeof fetch,
    ...overrides,
  };
}

function unexpectedPrompts(): SftpCredentialPrompts {
  return {
    async confirm() {
      throw new Error("Unexpected confirmation prompt");
    },
    async name() {
      throw new Error("Unexpected name prompt");
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("SFTP credential commands", () => {
  test("lists credentials as a deterministic human-readable table", async () => {
    const output: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe("SftpCredentials");
        return Response.json({
          data: {
            sftpCredentials: [
              {
                id: 7,
                name: "Home\nPC",
                enabled: true,
                createdAt: 1_704_067_200,
                lastUsedAt: 1_704_153_600,
              },
              {
                id: 3,
                name: "Old camera",
                enabled: false,
                createdAt: 1_703_980_800,
                lastUsedAt: null,
              },
            ],
          },
        });
      },
      { stdout: (message) => output.push(message) },
    );

    await runSftpCredentialList({}, dependencies);

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("ID  NAME");
    expect(output[0]).toContain("7   Home PC");
    expect(output[0]).toContain("enabled");
    expect(output[0]).toContain("disabled");
    expect(output[0]).toContain("2024-01-01T00:00:00.000Z");
    expect(output[0]).toContain("2024-01-02T00:00:00.000Z");
    expect(output[0]).toContain("—");
  });

  test("lists credentials as stable JSON and reports an empty human list", async () => {
    const jsonOutput: string[] = [];
    const jsonDependencies = await temporaryDependencies(
      () =>
        Response.json({
          data: {
            sftpCredentials: [
              {
                id: 9,
                name: "Camera",
                enabled: true,
                createdAt: 100,
                lastUsedAt: null,
                __typename: "SFTPCredential",
              },
            ],
          },
        }),
      { stdout: (message) => jsonOutput.push(message) },
    );

    await runSftpCredentialList({ json: true }, jsonDependencies);
    expect(JSON.parse(jsonOutput.join("\n"))).toEqual([
      {
        id: 9,
        name: "Camera",
        enabled: true,
        createdAt: 100,
        lastUsedAt: null,
      },
    ]);

    const emptyOutput: string[] = [];
    const emptyDependencies = await temporaryDependencies(
      () => Response.json({ data: { sftpCredentials: [] } }),
      { stdout: (message) => emptyOutput.push(message) },
    );
    await runSftpCredentialList({}, emptyDependencies);
    expect(emptyOutput).toEqual(["No SFTP credentials found."]);
  });

  test("creates a credential with a generated password and prompts for a missing name", async () => {
    const output: string[] = [];
    const warnings: string[] = [];
    const promptCalls: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe("CreateSftpCredential");
        expect(body.variables).toEqual({ name: "Home PC" });
        return Response.json({
          data: {
            createSFTPCredential: {
              id: 11,
              name: "Home PC",
              password: "generated-secret",
              createdAt: 123,
            },
          },
        });
      },
      {
        prompts: {
          async confirm() {
            throw new Error("Unexpected confirmation prompt");
          },
          async name() {
            promptCalls.push("name");
            return "  Home PC  ";
          },
        },
        stderr: (message) => warnings.push(message),
        stdout: (message) => output.push(message),
      },
    );

    await runSftpCredentialAdd({}, dependencies);

    expect(promptCalls).toEqual(["name"]);
    expect(output).toEqual(["Created SFTP credential 11 (Home PC).", "Password: generated-secret"]);
    expect(warnings).toEqual(["Save this password now. It will only be shown once."]);
  });

  test("creates a credential with a custom password and emits clean JSON", async () => {
    const output: string[] = [];
    const warnings: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.variables).toEqual({
          name: "Camera",
          password: "custom-password",
        });
        return Response.json({
          data: {
            createSFTPCredential: {
              id: 12,
              name: "Camera",
              password: "custom-password",
              createdAt: 456,
              __typename: "SFTPCredentialWithPassword",
            },
          },
        });
      },
      {
        prompts: unexpectedPrompts(),
        stderr: (message) => warnings.push(message),
        stdout: (message) => output.push(message),
      },
    );

    await runSftpCredentialAdd(
      { json: true, name: "Camera", password: "custom-password" },
      dependencies,
    );

    expect(JSON.parse(output.join("\n"))).toEqual({
      id: 12,
      name: "Camera",
      password: "custom-password",
      createdAt: 456,
    });
    expect(warnings).toEqual(["Save this password now. It will only be shown once."]);
  });

  test("validates add input before creating an API client", async () => {
    let requests = 0;
    const dependencies = await temporaryDependencies(
      () => {
        requests += 1;
        return Response.json({});
      },
      { prompts: unexpectedPrompts() },
    );

    expect(runSftpCredentialAdd({ name: "   " }, dependencies)).rejects.toThrow(
      "Credential name is required",
    );
    expect(runSftpCredentialAdd({ name: "x".repeat(51) }, dependencies)).rejects.toThrow(
      "at most 50 characters",
    );
    expect(
      runSftpCredentialAdd({ name: "Camera", password: "1234567" }, dependencies),
    ).rejects.toThrow("at least 8 bytes");
    expect(
      runSftpCredentialAdd({ name: "Camera", password: "界".repeat(25) }, dependencies),
    ).rejects.toThrow("at most 72 bytes");
    expect(requests).toBe(0);
  });

  test("declines deletion without sending a mutation", async () => {
    const output: string[] = [];
    const confirmations: string[] = [];
    let requests = 0;
    const dependencies = await temporaryDependencies(
      () => {
        requests += 1;
        return Response.json({
          data: {
            sftpCredentials: [
              { id: 8, name: "Laptop", enabled: true, createdAt: 100, lastUsedAt: null },
            ],
          },
        });
      },
      {
        prompts: {
          async confirm(message) {
            confirmations.push(message);
            return false;
          },
          async name() {
            throw new Error("Unexpected name prompt");
          },
        },
        stdout: (message) => output.push(message),
      },
    );

    await runSftpCredentialDelete({ id: 8, json: true }, dependencies);

    expect(requests).toBe(1);
    expect(confirmations).toEqual(['Delete SFTP credential "Laptop" (ID 8)?']);
    expect(JSON.parse(output.join("\n"))).toEqual({ deleted: false, id: 8 });
  });

  test("confirms and deletes a named credential", async () => {
    const output: string[] = [];
    const operations: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        operations.push(String(body.operationName));
        if (body.operationName === "SftpCredentials") {
          return Response.json({
            data: {
              sftpCredentials: [
                { id: 8, name: "Laptop", enabled: true, createdAt: 100, lastUsedAt: null },
              ],
            },
          });
        }
        expect(body.variables).toEqual({ id: 8 });
        return Response.json({ data: { deleteSFTPCredential: true } });
      },
      {
        prompts: {
          async confirm() {
            return true;
          },
          async name() {
            throw new Error("Unexpected name prompt");
          },
        },
        stdout: (message) => output.push(message),
      },
    );

    await runSftpCredentialDelete({ id: 8 }, dependencies);

    expect(operations).toEqual(["SftpCredentials", "DeleteSftpCredential"]);
    expect(output).toEqual(["Deleted SFTP credential 8."]);
  });

  test("force deletes without listing or prompting", async () => {
    const output: string[] = [];
    let requests = 0;
    const dependencies = await temporaryDependencies(
      (body) => {
        requests += 1;
        expect(body.operationName).toBe("DeleteSftpCredential");
        expect(body.variables).toEqual({ id: 21 });
        return Response.json({ data: { deleteSFTPCredential: true } });
      },
      {
        prompts: unexpectedPrompts(),
        stdout: (message) => output.push(message),
      },
    );

    await runSftpCredentialDelete({ force: true, id: 21, json: true }, dependencies);

    expect(requests).toBe(1);
    expect(JSON.parse(output.join("\n"))).toEqual({ deleted: true, id: 21 });
  });

  test("rejects invalid and unknown delete targets safely", async () => {
    let requests = 0;
    const dependencies = await temporaryDependencies(
      () => {
        requests += 1;
        return Response.json({ data: { sftpCredentials: [] } });
      },
      { prompts: unexpectedPrompts() },
    );

    expect(runSftpCredentialDelete({ force: true, id: 0 }, dependencies)).rejects.toThrow(
      "positive integer",
    );
    expect(requests).toBe(0);

    expect(runSftpCredentialDelete({ id: 99 }, dependencies)).rejects.toThrow(
      "SFTP credential 99 not found",
    );
    expect(requests).toBe(1);
  });

  test("requires force for deletion without an interactive terminal", async () => {
    const dependencies = await temporaryDependencies(() =>
      Response.json({
        data: {
          sftpCredentials: [
            { id: 4, name: "Camera", enabled: true, createdAt: 100, lastUsedAt: null },
          ],
        },
      }),
    );

    expect(runSftpCredentialDelete({ id: 4 }, dependencies)).rejects.toThrow(
      "requires an interactive terminal unless --force",
    );
  });

  test("surfaces GraphQL errors and missing mutation confirmations", async () => {
    const listDependencies = await temporaryDependencies(() =>
      Response.json({ data: null, errors: [{ message: "not authorized" }] }),
    );
    expect(runSftpCredentialList({}, listDependencies)).rejects.toThrow("not authorized");

    const deleteDependencies = await temporaryDependencies(() =>
      Response.json({ data: { deleteSFTPCredential: false } }),
    );
    expect(runSftpCredentialDelete({ force: true, id: 5 }, deleteDependencies)).rejects.toThrow(
      "did not confirm deletion",
    );
  });
});
