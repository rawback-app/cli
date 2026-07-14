import { type RawbackClient, createRawbackClient } from "./client.ts";
import {
  CreateSftpCredentialDocument,
  DeleteSftpCredentialDocument,
  SftpCredentialsDocument,
  type CreateSftpCredentialMutation,
  type SftpCredentialsQuery,
} from "./gql/graphql.ts";

type SftpCredential = SftpCredentialsQuery["sftpCredentials"][number];
type CreatedSftpCredential = CreateSftpCredentialMutation["createSFTPCredential"];

export interface SftpCredentialPrompts {
  confirm(message: string): Promise<boolean>;
  name(): Promise<string>;
}

export interface SftpCredentialCommandDependencies {
  configPath?: string;
  credentialsPath?: string;
  fetch?: typeof globalThis.fetch;
  prompts?: SftpCredentialPrompts;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}

export interface SftpCredentialListOptions {
  json?: boolean;
}

export interface SftpCredentialAddOptions {
  json?: boolean;
  name?: string;
  password?: string;
}

export interface SftpCredentialDeleteOptions {
  force?: boolean;
  id: number;
  json?: boolean;
}

function output(dependencies: SftpCredentialCommandDependencies, message: string): void {
  (dependencies.stdout ?? console.log)(message);
}

function warn(dependencies: SftpCredentialCommandDependencies, message: string): void {
  (dependencies.stderr ?? console.error)(message);
}

function ensureInteractive(message: string): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(message);
  }
}

function defaultPrompts(): SftpCredentialPrompts {
  return {
    async confirm(message) {
      ensureInteractive(
        "Deleting an SFTP credential requires an interactive terminal unless --force is provided.",
      );
      const { confirm } = await import("@inquirer/prompts");
      return confirm({ default: false, message });
    },
    async name() {
      ensureInteractive("An SFTP credential name is required in non-interactive mode; use --name.");
      const { input } = await import("@inquirer/prompts");
      return input({
        message: "Credential name:",
        validate(value) {
          try {
            validateName(value);
            return true;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      });
    },
  };
}

function validateName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new Error("Credential name is required");
  }
  if (name.length > 50) {
    throw new Error("Credential name must be at most 50 characters");
  }
  return name;
}

function validatePassword(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength < 8) {
    throw new Error("Custom password must be at least 8 bytes");
  }
  if (byteLength > 72) {
    throw new Error("Custom password must be at most 72 bytes");
  }
  return value;
}

function validateId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Credential ID must be a positive integer");
  }
  return value;
}

function createClient(dependencies: SftpCredentialCommandDependencies): Promise<RawbackClient> {
  return createRawbackClient({
    ...(dependencies.configPath !== undefined ? { configPath: dependencies.configPath } : {}),
    ...(dependencies.credentialsPath !== undefined
      ? { credentialsPath: dependencies.credentialsPath }
      : {}),
    ...(dependencies.fetch !== undefined ? { fetch: dependencies.fetch } : {}),
  });
}

async function queryCredentials(client: RawbackClient): Promise<SftpCredential[]> {
  const result = await client.graphql.query({ query: SftpCredentialsDocument });
  if (result.error) {
    throw result.error;
  }
  if (!result.data) {
    throw new Error("The SFTP credential response did not include credential data");
  }
  return result.data.sftpCredentials;
}

function serializeCredential(credential: SftpCredential) {
  return {
    id: credential.id,
    name: credential.name,
    enabled: credential.enabled,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt ?? null,
  };
}

function serializeCreatedCredential(credential: CreatedSftpCredential) {
  return {
    id: credential.id,
    name: credential.name,
    password: credential.password,
    createdAt: credential.createdAt,
  };
}

function formatTimestamp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString();
}

function sanitizeCell(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatCredentialTable(credentials: SftpCredential[]): string {
  const headers = ["ID", "NAME", "STATUS", "CREATED", "LAST USED"];
  const rows = credentials.map((credential) => [
    String(credential.id),
    sanitizeCell(credential.name),
    credential.enabled ? "enabled" : "disabled",
    formatTimestamp(credential.createdAt),
    formatTimestamp(credential.lastUsedAt),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

  return [
    formatRow(headers),
    formatRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(formatRow),
  ].join("\n");
}

export async function runSftpCredentialList(
  options: SftpCredentialListOptions = {},
  dependencies: SftpCredentialCommandDependencies = {},
): Promise<void> {
  const credentials = await queryCredentials(await createClient(dependencies));
  if (options.json) {
    output(dependencies, JSON.stringify(credentials.map(serializeCredential), null, 2));
    return;
  }

  if (credentials.length === 0) {
    output(dependencies, "No SFTP credentials found.");
    return;
  }
  output(dependencies, formatCredentialTable(credentials));
}

export async function runSftpCredentialAdd(
  options: SftpCredentialAddOptions = {},
  dependencies: SftpCredentialCommandDependencies = {},
): Promise<void> {
  const prompts = dependencies.prompts ?? defaultPrompts();
  const name = validateName(options.name ?? (await prompts.name()));
  const password = validatePassword(options.password);
  const client = await createClient(dependencies);
  const result = await client.graphql.mutate({
    mutation: CreateSftpCredentialDocument,
    variables: {
      name,
      ...(password !== undefined ? { password } : {}),
    },
  });
  if (result.error) {
    throw result.error;
  }
  const credential = result.data?.createSFTPCredential;
  if (!credential) {
    throw new Error("The create SFTP credential response did not include the credential");
  }

  if (options.json) {
    output(dependencies, JSON.stringify(serializeCreatedCredential(credential), null, 2));
  } else {
    output(dependencies, `Created SFTP credential ${credential.id} (${credential.name}).`);
    output(dependencies, `Password: ${credential.password}`);
  }
  warn(dependencies, "Save this password now. It will only be shown once.");
}

export async function runSftpCredentialDelete(
  options: SftpCredentialDeleteOptions,
  dependencies: SftpCredentialCommandDependencies = {},
): Promise<void> {
  const id = validateId(options.id);
  const client = await createClient(dependencies);
  if (!options.force) {
    const credentials = await queryCredentials(client);
    const credential = credentials.find((item) => item.id === id);
    if (!credential) {
      throw new Error(`SFTP credential ${id} not found`);
    }

    const prompts = dependencies.prompts ?? defaultPrompts();
    const confirmed = await prompts.confirm(
      `Delete SFTP credential "${credential.name}" (ID ${credential.id})?`,
    );
    if (!confirmed) {
      if (options.json) {
        output(dependencies, JSON.stringify({ deleted: false, id }, null, 2));
      } else {
        output(dependencies, "Deletion cancelled.");
      }
      return;
    }
  }

  const result = await client.graphql.mutate({
    mutation: DeleteSftpCredentialDocument,
    variables: { id },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.data?.deleteSFTPCredential !== true) {
    throw new Error("The delete SFTP credential response did not confirm deletion");
  }

  if (options.json) {
    output(dependencies, JSON.stringify({ deleted: true, id }, null, 2));
  } else {
    output(dependencies, `Deleted SFTP credential ${id}.`);
  }
}
