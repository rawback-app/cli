import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Credentials {
  token: string;
  refreshToken: string;
}

export const DEFAULT_CREDENTIALS_PATH = join(homedir(), ".rawback", "credentials.json");

export class CredentialsError extends Error {
  readonly path: string;

  constructor(message: string, path: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialsError";
    this.path = path;
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseCredentials(value: unknown, path: string): Credentials {
  if (
    typeof value !== "object" ||
    value === null ||
    !("token" in value) ||
    typeof value.token !== "string" ||
    value.token.length === 0 ||
    !("refreshToken" in value) ||
    typeof value.refreshToken !== "string" ||
    value.refreshToken.length === 0
  ) {
    throw new CredentialsError(
      `Credentials at ${path} must contain non-empty token and refreshToken fields`,
      path,
    );
  }

  return {
    token: value.token,
    refreshToken: value.refreshToken,
  };
}

export async function readCredentials(
  path = DEFAULT_CREDENTIALS_PATH,
): Promise<Credentials | null> {
  let contents: string;

  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return null;
    }
    throw new CredentialsError(`Unable to read credentials at ${path}`, path, {
      cause: error,
    });
  }

  try {
    return parseCredentials(JSON.parse(contents), path);
  } catch (error) {
    if (error instanceof CredentialsError) {
      throw error;
    }
    throw new CredentialsError(`Credentials at ${path} contain invalid JSON`, path, {
      cause: error,
    });
  }
}

export async function writeCredentials(
  credentials: Credentials,
  path = DEFAULT_CREDENTIALS_PATH,
): Promise<void> {
  const validated = parseCredentials(credentials, path);
  const directory = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;

  await mkdir(directory, { mode: 0o700, recursive: true });
  if (process.platform !== "win32") {
    await chmod(directory, 0o700);
  }

  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    if (process.platform !== "win32") {
      await chmod(temporaryPath, 0o600);
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw new CredentialsError(`Unable to write credentials at ${path}`, path, {
      cause: error,
    });
  }
}

export async function deleteCredentials(path = DEFAULT_CREDENTIALS_PATH): Promise<void> {
  try {
    await rm(path);
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return;
    }
    throw new CredentialsError(`Unable to delete credentials at ${path}`, path, {
      cause: error,
    });
  }
}
