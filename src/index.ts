#!/usr/bin/env bun

import packageJson from "../package.json" with { type: "json" };
import { hideBin } from "yargs/helpers";

import { runCli } from "./features/cli/runtime.ts";

const args = hideBin(process.argv);

await runCli(args, packageJson.version);
