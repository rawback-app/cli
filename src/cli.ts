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
      "photos",
      "list and upload photos",
      (command) =>
        command
          .command(
            "list",
            "list photos in the authenticated library",
            (list) =>
              list
                .option("search", {
                  describe: "search filenames and photo metadata",
                  type: "string",
                })
                .option("status", {
                  array: true,
                  describe: "filter by status (repeat or comma-separate)",
                  type: "string",
                })
                .option("camera-make", {
                  array: true,
                  describe: "filter by camera make (repeat or comma-separate)",
                  type: "string",
                })
                .option("camera-model", {
                  array: true,
                  describe: "filter by camera model (repeat or comma-separate)",
                  type: "string",
                })
                .option("lens-model", {
                  array: true,
                  describe: "filter by lens model (repeat or comma-separate)",
                  type: "string",
                })
                .option("captured-after", {
                  describe: "ISO date/time or Unix timestamp in seconds",
                  type: "string",
                })
                .option("captured-before", {
                  describe: "ISO date/time or Unix timestamp in seconds",
                  type: "string",
                })
                .option("aperture-min", {
                  describe: "minimum aperture",
                  type: "number",
                })
                .option("aperture-max", {
                  describe: "maximum aperture",
                  type: "number",
                })
                .option("focal-length-min", {
                  describe: "minimum focal length in millimeters",
                  type: "number",
                })
                .option("focal-length-max", {
                  describe: "maximum focal length in millimeters",
                  type: "number",
                })
                .option("rate", {
                  array: true,
                  describe: "ratings 0-5 (default: 3,4,5; repeat or comma-separate)",
                  type: "string",
                })
                .option("city", {
                  array: true,
                  describe: "filter by city (repeat or comma-separate)",
                  type: "string",
                })
                .option("country", {
                  array: true,
                  describe: "filter by country (repeat or comma-separate)",
                  type: "string",
                })
                .option("has-gps", {
                  default: false,
                  describe: "only include photos with GPS coordinates",
                  type: "boolean",
                })
                .option("page", {
                  default: 1,
                  describe: "result page",
                  type: "number",
                })
                .option("page-size", {
                  default: 24,
                  describe: "photos per page (1-100)",
                  type: "number",
                })
                .option("json", {
                  default: false,
                  describe: "output machine-readable JSON",
                  type: "boolean",
                }),
            async (args) => {
              if (process.exitCode !== undefined && process.exitCode !== 0) return;
              const { runPhotoList } = await import("./photos.ts");
              await runCommand(() =>
                runPhotoList({
                  page: args.page,
                  pageSize: args.pageSize,
                  json: args.json,
                  hasGps: args.hasGps,
                  ...(args.search !== undefined ? { search: args.search } : {}),
                  ...(args.status !== undefined ? { status: args.status } : {}),
                  ...(args.cameraMake !== undefined ? { cameraMake: args.cameraMake } : {}),
                  ...(args.cameraModel !== undefined ? { cameraModel: args.cameraModel } : {}),
                  ...(args.lensModel !== undefined ? { lensModel: args.lensModel } : {}),
                  ...(args.capturedAfter !== undefined
                    ? { capturedAfter: args.capturedAfter }
                    : {}),
                  ...(args.capturedBefore !== undefined
                    ? { capturedBefore: args.capturedBefore }
                    : {}),
                  ...(args.apertureMin !== undefined ? { apertureMin: args.apertureMin } : {}),
                  ...(args.apertureMax !== undefined ? { apertureMax: args.apertureMax } : {}),
                  ...(args.focalLengthMin !== undefined
                    ? { focalLengthMin: args.focalLengthMin }
                    : {}),
                  ...(args.focalLengthMax !== undefined
                    ? { focalLengthMax: args.focalLengthMax }
                    : {}),
                  ...(args.rate !== undefined ? { rate: args.rate } : {}),
                  ...(args.city !== undefined ? { city: args.city } : {}),
                  ...(args.country !== undefined ? { country: args.country } : {}),
                }),
              );
            },
          )
          .command(
            "upload",
            "upload photos and RAW files over SFTP",
            (upload) =>
              upload
                .option("path", {
                  demandOption: true,
                  describe: "image/RAW file or directory to scan recursively",
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
          .demandCommand(1, "Choose a photos command: list or upload")
          .strict(),
      () => {},
    )
    .command(
      "uploads",
      "list FTP and SFTP upload sessions",
      (command) =>
        command
          .option("status", {
            choices: ["in_progress", "completed", "failed"] as const,
            describe: "filter by upload status",
            type: "string",
          })
          .option("page", {
            default: 1,
            describe: "result page",
            type: "number",
          })
          .option("page-size", {
            default: 20,
            describe: "upload sessions per page (1-100)",
            type: "number",
          })
          .option("json", {
            default: false,
            describe: "output machine-readable JSON",
            type: "boolean",
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return;
        const { runUploadSessionList } = await import("./uploads.ts");
        await runCommand(() =>
          runUploadSessionList({
            page: args.page,
            pageSize: args.pageSize,
            json: args.json,
            ...(args.status !== undefined ? { status: args.status } : {}),
          }),
        );
      },
    )
    .command(
      "usage",
      "show storage, AI credit, and face recognition usage",
      (command) =>
        command.option("json", {
          default: false,
          describe: "output machine-readable JSON",
          type: "boolean",
        }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return;
        const { runUsage } = await import("./usage.ts");
        await runCommand(() => runUsage({ json: args.json }));
      },
    )
    .command(
      "pricing",
      "show Rawback plans and add-ons",
      (command) =>
        command
          .option("interval", {
            choices: ["all", "month", "year"] as const,
            default: "all" as const,
            describe: "filter plans by billing interval",
            type: "string",
          })
          .option("json", {
            default: false,
            describe: "output machine-readable JSON",
            type: "boolean",
          }),
      async (args) => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return;
        const { runPricing } = await import("./pricing.ts");
        await runCommand(() => runPricing({ interval: args.interval, json: args.json }));
      },
    )
    .command(
      "web",
      "open your Rawback profile in a web browser",
      () => {},
      async () => {
        if (process.exitCode !== undefined && process.exitCode !== 0) return;
        const { runWeb } = await import("./web.ts");
        await runCommand(() => runWeb());
      },
    )
    .strict()
    .fail((message, error, parser) => {
      parser.showHelp("error");
      console.error(error?.message ?? message);
      process.exitCode = 1;
    });
}
