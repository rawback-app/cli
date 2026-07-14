#!/usr/bin/env bun

import packageJson from "../package.json" with { type: "json" };
import { hideBin } from "yargs/helpers";

import { createProgram } from "./cli.ts";

const args = hideBin(process.argv);
const parseArgs =
  args[0] === "upload"
    ? args.filter((argument) => argument !== "--help" && argument !== "-h")
    : args;

const program = createProgram(packageJson.version);

if (args.length === 0) {
  console.log(await program.getHelp());
} else {
  await program.parseAsync(parseArgs);
}
