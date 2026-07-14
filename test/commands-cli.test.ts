import { describe, expect, test } from "bun:test";

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

describe("new command hierarchy", () => {
  test("documents rich photo list filters", () => {
    const result = runCli("photos", "list", "--help");
    expect(result.exitCode).toBe(0);
    for (const flag of [
      "--search",
      "--status",
      "--camera-make",
      "--camera-model",
      "--lens-model",
      "--captured-after",
      "--captured-before",
      "--aperture-min",
      "--focal-length-min",
      "--rate",
      "--city",
      "--country",
      "--has-gps",
      "--page-size",
      "--json",
    ]) {
      expect(result.stdout).toContain(flag);
    }
  });

  test("documents upload sessions, usage, pricing, and web", () => {
    expect(runCli("uploads", "--help").stdout).toContain("--status");
    expect(runCli("usage", "--help").stdout).toContain("--json");
    expect(runCli("pricing", "--help").stdout).toContain("--interval");
    expect(runCli("web", "--help").stdout).toContain("open your Rawback profile");
  });

  test("requires a photos subcommand", () => {
    const result = runCli("photos");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Choose a photos command");
  });

  test("removes the old top-level upload command", () => {
    for (const result of [runCli("upload"), runCli("upload", "--help")]) {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Unknown argument: upload");
    }
  });

  test("validates photo pagination and ranges before authentication", () => {
    const page = runCli("photos", "list", "--page", "0");
    expect(page.exitCode).toBe(1);
    expect(page.stderr).toContain("--page must be a positive integer");
    expect(page.stderr).not.toContain("Authentication credentials");

    const range = runCli("photos", "list", "--aperture-min", "8", "--aperture-max", "2");
    expect(range.exitCode).toBe(1);
    expect(range.stderr).toContain("must not be greater");
  });
});
