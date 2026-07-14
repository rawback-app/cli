import { describe, expect, test } from "bun:test";

import packageJson from "../package.json" with { type: "json" };

const entrypoint = new URL("../src/index.ts", import.meta.url).pathname;

function runCli(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, "run", entrypoint, ...args], {
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("rawback CLI", () => {
  test("shows help with no arguments", () => {
    const result = runCli();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("rawback [options]");
    expect(result.stdout).toContain("Rawback CLI for humans and AI agents");
    expect(result.stdout).toContain("auth [subcommand]");
    expect(result.stdout).toContain("credentials <subcommand> [id]");
    expect(result.stdout).toContain("upload");
  });

  test.each(["--help", "-h"])("shows help for %s", (flag) => {
    const result = runCli(flag);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("rawback [options]");
  });

  test.each(["--version", "-V"])("shows the package version for %s", (flag) => {
    const result = runCli(flag);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("rejects unknown options", () => {
    const result = runCli("--unknown");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown argument: unknown");
    expect(result.stderr).toContain("-h, --help");
  });

  test("rejects unknown commands", () => {
    const result = runCli("unknown");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown argument: unknown");
  });

  test("documents auth login options", () => {
    const result = runCli("auth", "--help");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--email");
    expect(result.stdout).toContain("--password");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("shell history");
  });

  test("rejects login options for auth status", () => {
    const result = runCli("auth", "status", "--force");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("does not accept login options");
  });

  test.each(["credentials", "cred"])("documents SFTP options through %s", (command) => {
    const result = runCli(command, "add", "--help");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("manage SFTP credentials");
    expect(result.stdout).toContain('choices: "list", "add", "delete", "del"');
    expect(result.stdout).toContain("--name");
    expect(result.stdout).not.toContain("--password");
    expect(result.stdout).toContain("--force");
    expect(result.stdout).toContain("--json");
  });

  test("rejects custom SFTP passwords without making a request", () => {
    const result = runCli("cred", "add", "--name", "Camera", "--password", "custom-password");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown argument: password");
    expect(result.stderr).not.toContain("unauthorized");
  });

  test("rejects options that do not belong to list without making a request", () => {
    const result = runCli("cred", "list", "--force");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cred list only accepts --json");
    expect(result.stderr).not.toContain("unauthorized");
  });

  test("requires an ID for delete aliases", () => {
    for (const subcommand of ["delete", "del"]) {
      const result = runCli("cred", subcommand);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`cred ${subcommand} requires a credential ID`);
      expect(result.stderr).not.toContain("unauthorized");
    }
  });

  test("rejects an ID and force option for add", () => {
    const result = runCli("credentials", "add", "7", "--force");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cred add does not accept an ID or --force");
    expect(result.stderr).not.toContain("unauthorized");
  });
});

describe("rawback upload CLI", () => {
  test("documents upload options", () => {
    const result = runCli("upload", "--help");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--path");
    expect(result.stdout).toContain("--concurrency");
    expect(result.stdout).toContain("--dry-run");
  });

  test("requires an upload path before running preflight", () => {
    const result = runCli("upload");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument: path");
  });

  test.each(["0", "17", "1.5"])("rejects invalid upload concurrency %s", (concurrency) => {
    const result = runCli("upload", "--path", ".", "--concurrency", concurrency);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("integer between 1 and 16");
  });
});
