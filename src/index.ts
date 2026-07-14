#!/usr/bin/env bun

import packageJson from "../package.json" with { type: "json" };

import { createProgram } from "./cli.ts";

await createProgram(packageJson.version).parseAsync();
