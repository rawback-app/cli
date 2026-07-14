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
    expect(result.stdout).toContain("Usage: rawback");
    expect(result.stdout).toContain("Rawback CLI for humans and AI agents");
  });

  test.each(["--help", "-h"])("shows help for %s", (flag) => {
    const result = runCli(flag);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: rawback");
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
    expect(result.stderr).toContain("unknown option '--unknown'");
    expect(result.stderr).toContain("--help");
  });

  test("rejects unknown commands", () => {
    const result = runCli("unknown");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("too many arguments");
  });
});
