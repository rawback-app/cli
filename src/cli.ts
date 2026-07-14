import yargs from "yargs";
import type { Argv } from "yargs";

export function createProgram(version: string): Argv {
  return yargs()
    .scriptName("rawback")
    .usage("$0 [options]\n\nRawback CLI for humans and AI agents")
    .help("help", "display help for command")
    .alias("help", "h")
    .version("version", "output the current version", version)
    .alias("version", "V")
    .strict()
    .fail((message, error, parser) => {
      parser.showHelp("error");
      console.error(error?.message ?? message);
      process.exitCode = 1;
    });
}
