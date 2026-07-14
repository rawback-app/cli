import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError, readConfig } from "../src/config.ts";

const temporaryDirectories: string[] = [];

async function temporaryConfigPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rawback-config-"));
  temporaryDirectories.push(directory);
  return join(directory, "config.yml");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("config", () => {
  test("accepts missing and empty config files", async () => {
    const path = await temporaryConfigPath();
    expect(await readConfig(path)).toEqual({});

    await writeFile(path, "");
    expect(await readConfig(path)).toEqual({});
  });

  test("loads apiHost and ignores unknown keys", async () => {
    const path = await temporaryConfigPath();
    await writeFile(path, 'apiHost: " https://staging.rawback.app/ "\nfutureSetting: enabled\n');

    expect(await readConfig(path)).toEqual({
      apiHost: "https://staging.rawback.app/",
    });
  });

  test.each([
    ["invalid YAML", "apiHost: [", "invalid YAML"],
    ["a non-mapping document", "- value", "YAML mapping"],
    ["an empty host", 'apiHost: ""', "non-empty string"],
    ["an invalid URL", "apiHost: not-a-url", "valid URL"],
    ["an unsupported protocol", "apiHost: file:///tmp/rawback", "HTTP or HTTPS"],
  ])("rejects %s", async (_description, contents, expectedMessage) => {
    const path = await temporaryConfigPath();
    await writeFile(path, contents);

    try {
      await readConfig(path);
      throw new Error("Expected config parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ path });
      expect((error as Error).message).toContain(expectedMessage);
    }
  });
});

describe("SFTP config", () => {
  test("loads nested endpoint and credentials", async () => {
    const path = await temporaryConfigPath();
    await writeFile(
      path,
      [
        "sftp:",
        "  endpoint: sftp://ftp.rawback.app:2222",
        "  username: annatarhe",
        '  password: "secret"',
        "  hostFingerprint: SHA256:known-host",
        "",
      ].join("\n"),
    );

    expect(await readConfig(path)).toEqual({
      sftp: {
        endpoint: "sftp://ftp.rawback.app:2222",
        username: "annatarhe",
        password: "secret",
        hostFingerprint: "SHA256:known-host",
      },
    });
  });

  test.each([
    ["a non-mapping SFTP value", "sftp: value", "YAML mapping"],
    ["an HTTP endpoint", "sftp:\n  endpoint: https://ftp.rawback.app", "must use SFTP"],
    [
      "credentials embedded in the endpoint",
      "sftp:\n  endpoint: sftp://user:secret@ftp.rawback.app:2222",
      "only contain an SFTP host",
    ],
    [
      "a path in the endpoint",
      "sftp:\n  endpoint: sftp://ftp.rawback.app:2222/uploads",
      "only contain an SFTP host",
    ],
    ["an empty username", 'sftp:\n  username: ""', "non-empty string"],
  ])("rejects %s", async (_description, contents, expectedMessage) => {
    const path = await temporaryConfigPath();
    await writeFile(path, contents);

    await expect(readConfig(path)).rejects.toThrow(expectedMessage);
  });

  test("does not include invalid credential values in validation errors", async () => {
    const path = await temporaryConfigPath();
    await writeFile(path, "sftp:\n  password: 123456\n");

    try {
      await readConfig(path);
      throw new Error("Expected config parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("sftp.password");
      expect((error as Error).message).not.toContain("123456");
    }
  });
});
