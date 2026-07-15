import { commandOutput, createCommandClient, type ReadCommandDependencies } from "./command.ts";
import { DEFAULT_CONFIG_PATH, DEFAULT_WEB_HOST, readConfig } from "./config.ts";
import { AuthStatusDocument } from "./gql/graphql.ts";

export interface WebCommandDependencies extends ReadCommandDependencies {
  open?: (command: string, args: string[]) => Promise<number>;
  platform?: NodeJS.Platform;
}

async function defaultOpen(command: string, args: string[]): Promise<number> {
  const process = Bun.spawn([command, ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  return process.exited;
}

export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

export async function runWeb(dependencies: WebCommandDependencies = {}): Promise<void> {
  const config = await readConfig(dependencies.configPath ?? DEFAULT_CONFIG_PATH);
  const ui = commandOutput(dependencies);
  const result = await ui.withActivity("Loading profile…", async () => {
    const client = await createCommandClient(dependencies);
    return client.graphql.query({ query: AuthStatusDocument });
  });
  if (result.error) throw result.error;
  if (!result.data?.me?.slug) {
    throw new Error("The account response did not include a profile slug");
  }

  const webHost = (config.webHost ?? DEFAULT_WEB_HOST).replace(/\/$/, "");
  const url = `${webHost}/users/${encodeURIComponent(result.data.me.slug)}`;
  const [command, args] = browserCommand(dependencies.platform ?? process.platform, url);
  let exitCode: number;
  try {
    exitCode = await (dependencies.open ?? defaultOpen)(command, args);
  } catch (error) {
    throw new Error(`Unable to open ${url}`, { cause: error });
  }
  if (exitCode !== 0) {
    throw new Error(`Unable to open ${url}: ${command} exited with status ${exitCode}`);
  }
  ui.success(`Opened ${url}.`);
}
