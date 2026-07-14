import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";

export interface RawbackConfig {
  apiHost?: string;
  sftp?: SftpConfig;
}

export interface SftpConfig {
  endpoint?: string;
  username?: string;
  password?: string;
  hostFingerprint?: string;
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

  const result: RawbackConfig = {};
  if ("apiHost" in value && value.apiHost !== undefined) {
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
    result.apiHost = apiHost;
  }

  if ("sftp" in value && value.sftp !== undefined) {
    if (typeof value.sftp !== "object" || value.sftp === null || Array.isArray(value.sftp)) {
      throw new ConfigError(`Config sftp at ${path} must contain a YAML mapping`, path);
    }
    const sftpValue = value.sftp as Record<string, unknown>;
    const sftp: SftpConfig = {};
    for (const key of ["endpoint", "username", "password", "hostFingerprint"] as const) {
      const field = sftpValue[key];
      if (field === undefined) continue;
      if (typeof field !== "string" || field.trim().length === 0) {
        throw new ConfigError(`Config sftp.${key} at ${path} must be a non-empty string`, path);
      }
      sftp[key] = field.trim();
    }
    if (sftp.endpoint !== undefined) {
      let endpoint: URL;
      try {
        endpoint = new URL(sftp.endpoint);
      } catch (error) {
        throw new ConfigError(`Config sftp.endpoint at ${path} must be a valid URL`, path, {
          cause: error,
        });
      }
      if (endpoint.protocol !== "sftp:") {
        throw new ConfigError(`Config sftp.endpoint at ${path} must use SFTP`, path);
      }
      if (
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash ||
        (endpoint.pathname !== "" && endpoint.pathname !== "/")
      ) {
        throw new ConfigError(
          `Config sftp.endpoint at ${path} must only contain an SFTP host and optional port`,
          path,
        );
      }
    }
    result.sftp = sftp;
  }
  return result;
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
