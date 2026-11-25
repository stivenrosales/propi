#!/usr/bin/env node
// Entry point: `node apps/cli/src/main.ts <command> ...` (Node 24 runs the TypeScript directly).
import { runCli } from "./cli.ts";

process.exitCode = await runCli(process.argv.slice(2), (l) => console.log(l), (l) => console.error(l));
