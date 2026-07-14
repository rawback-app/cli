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

  test("documents the album command hierarchy", () => {
    const album = runCli("album", "--help");
    for (const command of ["list", "view", "create", "edit", "delete", "image", "tag", "article"]) {
      expect(album.stdout).toContain(command);
    }

    const create = runCli("album", "create", "--help");
    for (const flag of [
      "--name",
      "--description",
      "--permission",
      "--tag-id",
      "--date-from",
      "--timezone",
      "--camera-id",
      "--json",
    ]) {
      expect(create.stdout).toContain(flag);
    }

    const article = runCli("album", "article", "--help");
    for (const command of ["list", "view", "edit", "publish", "unpublish", "delete"]) {
      expect(article.stdout).toContain(command);
    }
    const articleEdit = runCli("album", "article", "edit", "7", "--help");
    expect(articleEdit.stdout).toContain("--title");
    expect(articleEdit.stdout).toContain("--content-file");
  });

  test("requires album, membership, and article subcommands", () => {
    const album = runCli("album");
    expect(album.exitCode).toBe(1);
    expect(album.stderr).toContain("Choose an album command");

    const image = runCli("album", "image");
    expect(image.exitCode).toBe(1);
    expect(image.stderr).toContain("Choose an album image command");

    const article = runCli("album", "article");
    expect(article.exitCode).toBe(1);
    expect(article.stderr).toContain("Choose an album article command");
  });

  test("validates album edits and article inputs before authentication", () => {
    const albumEdit = runCli("album", "edit", "7");
    expect(albumEdit.exitCode).toBe(1);
    expect(albumEdit.stderr).toContain("requires at least one change option");
    expect(albumEdit.stderr).not.toContain("Authentication credentials");

    const articleEdit = runCli("album", "article", "edit", "7");
    expect(articleEdit.exitCode).toBe(1);
    expect(articleEdit.stderr).toContain("requires --title or --content-file");
    expect(articleEdit.stderr).not.toContain("Authentication credentials");

    const badId = runCli("album", "view", "0");
    expect(badId.exitCode).toBe(1);
    expect(badId.stderr).toContain("Album ID must be a positive integer");
    expect(badId.stderr).not.toContain("Authentication credentials");
  });

  test("rejects incompatible album and article options", () => {
    const clearConflict = runCli("album", "edit", "7", "--camera-id", "2", "--clear-camera");
    expect(clearConflict.exitCode).toBe(1);
    expect(clearConflict.stderr).toContain("cannot be used together");

    const outputConflict = runCli("album", "article", "view", "7", "--content-only", "--json");
    expect(outputConflict.exitCode).toBe(1);
    expect(outputConflict.stderr).toContain("mutually exclusive");
  });
});
