import yargs from "yargs";
import type { Argv } from "yargs";

async function runCommand(
  action: () => Promise<void>,
  cancellationMessage = "Authentication cancelled.",
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      console.error(cancellationMessage);
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
        if (process.exitCode !== undefined && process.exitCode !== 0) {
          return;
        }
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
    .command(
      ["credentials <subcommand> [id]", "cred <subcommand> [id]"],
      "manage SFTP credentials",
      (command) =>
        command
          .positional("subcommand", {
            choices: ["list", "add", "delete", "del"] as const,
            describe: "credential action",
            type: "string",
          })
          .positional("id", {
            describe: "SFTP credential ID",
            type: "number",
          })
          .option("name", {
            describe: "credential name (prompted when omitted)",
            type: "string",
          })
          .option("force", {
            default: false,
            describe: "delete without confirmation",
            type: "boolean",
          })
          .option("json", {
            default: false,
            describe: "output machine-readable JSON",
            type: "boolean",
          })
          .check((args) => {
            if (args.subcommand === "list") {
              if (args.id !== undefined || args.name !== undefined || args.force) {
                throw new Error("rawback cred list only accepts --json");
              }
              return true;
            }

            if (args.subcommand === "add") {
              if (args.id !== undefined || args.force) {
                throw new Error("rawback cred add does not accept an ID or --force");
              }
              return true;
            }

            if (args.id === undefined) {
              throw new Error(`rawback cred ${args.subcommand} requires a credential ID`);
            }
            if (args.name !== undefined) {
              throw new Error(`rawback cred ${args.subcommand} does not accept add options`);
            }
            return true;
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) {
          return;
        }
        const { runSftpCredentialAdd, runSftpCredentialDelete, runSftpCredentialList } =
          await import("./sftp-credentials.ts");

        if (args.subcommand === "list") {
          await runCommand(
            () => runSftpCredentialList({ json: args.json }),
            "Credential operation cancelled.",
          );
          return;
        }
        if (args.subcommand === "add") {
          await runCommand(
            () =>
              runSftpCredentialAdd({
                json: args.json,
                ...(args.name !== undefined ? { name: args.name } : {}),
              }),
            "Credential operation cancelled.",
          );
          return;
        }

        await runCommand(
          () =>
            runSftpCredentialDelete({
              force: args.force,
              id: args.id as number,
              json: args.json,
            }),
          "Credential operation cancelled.",
        );
      },
    )
    .command(
      "upload",
      "upload photos and RAW files over SFTP",
      (command) =>
        command
          .option("path", {
            demandOption: true,
            describe: "file or directory to upload recursively",
            type: "string",
          })
          .option("concurrency", {
            default: 4,
            describe: "number of parallel uploads",
            type: "number",
          })
          .option("dry-run", {
            default: false,
            describe: "show upload count, size, and estimated time without uploading",
            type: "boolean",
          })
          .check((args) => {
            if (
              !Number.isInteger(args.concurrency) ||
              args.concurrency < 1 ||
              args.concurrency > 16
            ) {
              throw new Error("--concurrency must be an integer between 1 and 16");
            }
            return true;
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return;
        const { runUpload } = await import("./upload.ts");
        await runCommand(() =>
          runUpload({
            concurrency: args.concurrency,
            dryRun: args.dryRun,
            path: args.path,
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
