import { CombinedGraphQLErrors, ServerError } from "@apollo/client";
import { commandOutput, type ReadCommandDependencies } from "./command.ts";
import { authStatusDocument } from "./features/auth/view.ts";
import { type RawbackClient, createRawbackClient } from "./client.ts";
import { type RawbackConfig, readConfig } from "./config.ts";
import {
  type Credentials,
  CredentialsError,
  DEFAULT_CREDENTIALS_PATH,
  readCredentials,
  writeCredentials,
} from "./credentials.ts";
import { AuthStatusDocument, type AuthStatusQuery } from "./gql/graphql.ts";
import { type ApiEnvelope } from "./http.ts";

interface LoginUser {
  id: number;
  name: string;
  email: string;
}

interface LoginResponse {
  user: LoginUser;
  accessToken: string;
  refreshToken: string;
}

export interface AuthPrompts {
  confirm(message: string): Promise<boolean>;
  email(defaultValue?: string): Promise<string>;
  password(): Promise<string>;
}

export interface AuthCommandDependencies extends ReadCommandDependencies {
  prompts?: AuthPrompts;
}

export interface AuthCommandOptions {
  email?: string;
  force?: boolean;
  password?: string;
}

type AuthUser = AuthStatusQuery["me"];

type StatusResult =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "invalid" }
  | { kind: "missing" };

function defaultPrompts(): AuthPrompts {
  const ensureInteractive = (message: string) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(message);
    }
  };

  return {
    async confirm(message) {
      ensureInteractive(
        "A valid session already exists. Re-run with --force to reauthenticate non-interactively.",
      );
      const { confirm } = await import("@inquirer/prompts");
      return confirm({ default: false, message });
    },
    async email(defaultValue) {
      ensureInteractive(
        "Authentication requires an interactive terminal unless --email and --password are provided.",
      );
      const { input } = await import("@inquirer/prompts");
      return input({
        ...(defaultValue ? { default: defaultValue } : {}),
        message: "Email:",
        validate(value) {
          return value.trim().length > 0 || "Email is required";
        },
      });
    },
    async password() {
      ensureInteractive(
        "Authentication requires an interactive terminal unless --email and --password are provided.",
      );
      const { password } = await import("@inquirer/prompts");
      return password({
        mask: "*",
        message: "Password:",
        validate(value) {
          return value.length > 0 || "Password is required";
        },
      });
    },
  };
}

function createClient(
  config: RawbackConfig,
  credentials: Credentials | null,
  dependencies: AuthCommandDependencies,
): Promise<RawbackClient> {
  return createRawbackClient({
    config,
    credentials,
    credentialsPath: dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  });
}

function isUnauthorizedError(error: unknown): boolean {
  if (ServerError.is(error)) {
    return error.statusCode === 401;
  }
  if (!CombinedGraphQLErrors.is(error)) {
    return false;
  }
  return error.errors.some((item) => {
    const code = item.extensions?.code;
    return code === 401 || code === "401" || code === "UNAUTHENTICATED";
  });
}

async function queryStatus(
  config: RawbackConfig,
  credentials: Credentials | null,
  dependencies: AuthCommandDependencies,
): Promise<StatusResult> {
  if (!credentials) {
    return { kind: "missing" };
  }

  const client = await createClient(config, credentials, dependencies);
  const result = await client.graphql.query({ query: AuthStatusDocument });

  if (result.error) {
    if (isUnauthorizedError(result.error)) {
      return { kind: "invalid" };
    }
    throw result.error;
  }
  if (!result.data?.me) {
    throw new Error("The account status response did not include user information");
  }

  return { kind: "authenticated", user: result.data.me };
}

async function readStoredCredentials(
  dependencies: AuthCommandDependencies,
  tolerateInvalid: boolean,
): Promise<Credentials | null> {
  try {
    return await readCredentials(dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH);
  } catch (error) {
    if (tolerateInvalid && error instanceof CredentialsError) {
      commandOutput(dependencies).warning(error.message + "; continuing with authentication.");
      return null;
    }
    throw error;
  }
}

function validateEmail(value: string): string {
  const email = value.trim();
  if (email.length === 0) {
    throw new Error("Email is required");
  }
  return email;
}

function validatePassword(value: string): string {
  if (value.length === 0) {
    throw new Error("Password is required");
  }
  return value;
}

function parseLoginResponse(value: unknown): LoginResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("user" in value) ||
    typeof value.user !== "object" ||
    value.user === null ||
    !("id" in value.user) ||
    typeof value.user.id !== "number" ||
    !("name" in value.user) ||
    typeof value.user.name !== "string" ||
    !("email" in value.user) ||
    typeof value.user.email !== "string" ||
    !("accessToken" in value) ||
    typeof value.accessToken !== "string" ||
    value.accessToken.length === 0 ||
    !("refreshToken" in value) ||
    typeof value.refreshToken !== "string" ||
    value.refreshToken.length === 0
  ) {
    throw new Error("The login response did not contain valid user information and tokens");
  }

  return {
    user: {
      id: value.user.id,
      name: value.user.name,
      email: value.user.email,
    },
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
  };
}

export async function runAuth(
  options: AuthCommandOptions,
  dependencies: AuthCommandDependencies = {},
): Promise<void> {
  const config = await readConfig(dependencies.configPath);
  const ui = commandOutput(dependencies);
  const prompts = dependencies.prompts ?? defaultPrompts();
  let existingUser: AuthUser | undefined;

  if (!options.force) {
    const credentials = await readStoredCredentials(dependencies, true);
    const status = await ui.withActivity("Checking authentication…", () =>
      queryStatus(config, credentials, dependencies),
    );

    if (status.kind === "authenticated") {
      existingUser = status.user;
      const shouldReauthenticate = await prompts.confirm(
        "Already authenticated as " +
          status.user.name +
          " (" +
          status.user.email +
          "). Reauthenticate?",
      );
      if (!shouldReauthenticate) {
        ui.info("Authentication unchanged.");
        return;
      }
    } else if (status.kind === "invalid") {
      ui.warning("Stored credentials are expired or invalid; continuing with authentication.");
    }
  }

  const email = validateEmail(options.email ?? (await prompts.email(existingUser?.email)));
  const password = validatePassword(options.password ?? (await prompts.password()));
  const client = await createClient(config, null, dependencies);
  const envelope = await ui.withActivity("Signing in…", () =>
    client.http.requestJson<ApiEnvelope<LoginResponse>>("/api/v1/auth/login", {
      authenticated: false,
      body: { email, password },
      method: "POST",
    }),
  );
  const response = parseLoginResponse(envelope.data);
  await writeCredentials(
    {
      token: response.accessToken,
      refreshToken: response.refreshToken,
    },
    dependencies.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
  );
  ui.success("Authenticated as " + response.user.name + " (" + response.user.email + ").");
}

export async function runAuthStatus(dependencies: AuthCommandDependencies = {}): Promise<void> {
  const config = await readConfig(dependencies.configPath);
  const ui = commandOutput(dependencies);
  let credentials: Credentials | null;
  try {
    credentials = await readStoredCredentials(dependencies, false);
  } catch (error) {
    if (error instanceof CredentialsError) {
      throw new Error(error.message + ". Run 'rawback auth --force' to sign in again.", {
        cause: error,
      });
    }
    throw error;
  }
  const status = await ui.withActivity("Checking authentication…", () =>
    queryStatus(config, credentials, dependencies),
  );

  if (status.kind === "missing") {
    throw new Error("Not authenticated. Run 'rawback auth' to sign in.");
  }
  if (status.kind === "invalid") {
    throw new Error("Authentication has expired. Run 'rawback auth --force' to sign in again.");
  }

  ui.document(authStatusDocument(status.user));
}
