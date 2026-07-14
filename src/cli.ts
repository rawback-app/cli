import { Command } from "commander";

export function createProgram(version: string): Command {
  return new Command()
    .name("rawback")
    .description("Rawback CLI for humans and AI agents")
    .version(version, "-V, --version", "output the current version")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .action(function showRootHelp() {
      this.outputHelp();
    });
}
