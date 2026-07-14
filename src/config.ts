import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";

export interface RawbackConfig {
  apiHost?: string;
}

export const DEFAULT_CONFIG_PATH = join(homedir(), ".rawback", "config.yml");

export class ConfigError extends Error {
  readonly path: string;

  constructor(message: string, path: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
    this.path = path;
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseConfig(value: unknown, path: string): RawbackConfig {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`Config at ${path} must contain a YAML mapping`, path);
  }

  if (!("apiHost" in value) || value.apiHost === undefined) {
    return {};
  }

  if (typeof value.apiHost !== "string" || value.apiHost.trim().length === 0) {
    throw new ConfigError(`Config apiHost at ${path} must be a non-empty string`, path);
  }

  const apiHost = value.apiHost.trim();
  let url: URL;

  try {
    url = new URL(apiHost);
  } catch (error) {
    throw new ConfigError(`Config apiHost at ${path} must be a valid URL`, path, {
      cause: error,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`Config apiHost at ${path} must use HTTP or HTTPS`, path);
  }

  return { apiHost };
}

export async function readConfig(path = DEFAULT_CONFIG_PATH): Promise<RawbackConfig> {
  let contents: string;

  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return {};
    }
    throw new ConfigError(`Unable to read config at ${path}`, path, { cause: error });
  }

  try {
    return parseConfig(parse(contents), path);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Config at ${path} contains invalid YAML`, path, {
      cause: error,
    });
  }
}
