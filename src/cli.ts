import yargs from "yargs";
import type { Argv } from "yargs";

async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      console.error("Authentication cancelled.");
      process.exitCode = 130;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function createProgram(version: string): Argv {
  return yargs()
    .scriptName("rawback")
    .usage("$0 [options]\n\nRawback CLI for humans and AI agents")
    .help("help", "display help for command")
    .alias("help", "h")
    .version("version", "output the current version", version)
    .alias("version", "V")
    .command(
      "auth [subcommand]",
      "authenticate with Rawback",
      (command) =>
        command
          .positional("subcommand", {
            choices: ["status"] as const,
            describe: "authentication action",
            type: "string",
          })
          .option("email", {
            describe: "email address",
            type: "string",
          })
          .option("password", {
            describe: "password (may be visible in shell history and process listings)",
            type: "string",
          })
          .option("force", {
            default: false,
            describe: "reauthenticate without checking or confirming the current session",
            type: "boolean",
          })
          .check((args) => {
            if (
              args.subcommand === "status" &&
              (args.email !== undefined || args.password !== undefined || args.force)
            ) {
              throw new Error("rawback auth status does not accept login options");
            }
            return true;
          }),
      async (args) => {
        const { runAuth, runAuthStatus } = await import("./auth.ts");
        if (args.subcommand === "status") {
          await runCommand(() => runAuthStatus());
          return;
        }

        await runCommand(() =>
          runAuth({
            force: args.force,
            ...(args.email !== undefined ? { email: args.email } : {}),
            ...(args.password !== undefined ? { password: args.password } : {}),
          }),
        );
      },
    )
    .strict()
    .fail((message, error, parser) => {
      parser.showHelp("error");
      console.error(error?.message ?? message);
      process.exitCode = 1;
    });
}
