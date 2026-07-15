import { type RawbackClient, createRawbackClient } from "./client.ts";
import { commandOutput, type ReadCommandDependencies } from "./command.ts";
import { credentialListDocument, createdCredentialDocument } from "./features/credentials/view.ts";
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

export interface SftpCredentialCommandDependencies extends ReadCommandDependencies {
  prompts?: SftpCredentialPrompts;
}

export interface SftpCredentialListOptions {
  json?: boolean;
}

export interface SftpCredentialAddOptions {
  json?: boolean;
  name?: string;
}

export interface SftpCredentialDeleteOptions {
  force?: boolean;
  id: number;
  json?: boolean;
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

export async function runSftpCredentialList(
  options: SftpCredentialListOptions = {},
  dependencies: SftpCredentialCommandDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies);
  const credentials = await ui.withActivity(
    "Loading SFTP credentials…",
    async () => queryCredentials(await createClient(dependencies)),
    !options.json,
  );
  if (options.json) {
    ui.json(credentials.map(serializeCredential));
    return;
  }
  ui.document(credentialListDocument(credentials));
}

export async function runSftpCredentialAdd(
  options: SftpCredentialAddOptions = {},
  dependencies: SftpCredentialCommandDependencies = {},
): Promise<void> {
  const prompts = dependencies.prompts ?? defaultPrompts();
  const ui = commandOutput(dependencies);
  const name = validateName(options.name ?? (await prompts.name()));
  const result = await ui.withActivity(
    "Creating SFTP credential…",
    async () => {
      const client = await createClient(dependencies);
      return client.graphql.mutate({
        mutation: CreateSftpCredentialDocument,
        variables: { name },
      });
    },
    !options.json,
  );
  if (result.error) {
    throw result.error;
  }
  const credential = result.data?.createSFTPCredential;
  if (!credential) {
    throw new Error("The create SFTP credential response did not include the credential");
  }

  if (options.json) {
    ui.json(serializeCreatedCredential(credential));
  } else {
    ui.document(createdCredentialDocument(credential));
  }
  ui.warning("Save this password now. It will only be shown once.");
}

export async function runSftpCredentialDelete(
  options: SftpCredentialDeleteOptions,
  dependencies: SftpCredentialCommandDependencies = {},
): Promise<void> {
  const id = validateId(options.id);
  const client = await createClient(dependencies);
  const ui = commandOutput(dependencies);
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
        ui.json({ deleted: false, id });
      } else {
        ui.info("Deletion cancelled.");
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
    ui.json({ deleted: true, id });
  } else {
    ui.success(`Deleted SFTP credential ${id}.`);
  }
}
