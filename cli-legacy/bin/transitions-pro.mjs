#!/usr/bin/env node
// Compatibility shim for the old package name.
//
// The CLI installs the free transitions too, so "pro" in every command read as
// if an account were required; it now ships as `transitions-dev`. Anyone still
// running the old name keeps working: this prints the new command once, then
// forwards the arguments unchanged. Credentials carry over, because
// transitions-dev falls back to reading ~/.transitions-pro.json.

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

console.error(yellow("transitions-pro is now transitions-dev."));
console.error(dim(`Run:  npx transitions-dev ${args.join(" ")}`) + "\n");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npx, ["-y", "transitions-dev@latest", ...args], { stdio: "inherit" });
child.on("error", (e) => {
  console.error("Couldn't run transitions-dev: " + e.message);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
