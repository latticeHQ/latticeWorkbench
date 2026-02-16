#!/usr/bin/env node
/**
 * Build-and-serve script for dev-server watch mode.
 *
 * Runs tsgo → tsc-alias (sequential, no race) then exec's the server.
 * Nodemon watches `src/` and re-runs this entire script on changes,
 * guaranteeing the server NEVER starts with unresolved @/ aliases.
 *
 * Uses child_process.execSync for the server so the process stays alive
 * and nodemon can track it properly (SIGTERM kills it cleanly).
 */

const { execSync } = require("child_process");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const tsgoPath = path.join(rootDir, "node_modules/@typescript/native-preview/bin/tsgo.js");
const tscAliasPath = path.join(rootDir, "node_modules/tsc-alias/dist/bin/index.js");

// Extract server args: everything after "--"
const rawArgs = process.argv.slice(2);
const dashDashIdx = rawArgs.indexOf("--");
const serverArgs = dashDashIdx >= 0 ? rawArgs.slice(dashDashIdx + 1) : [];

// ── Step 1: Build ────────────────────────────────────────────────────
try {
  console.log("[build-and-serve] Building main process...");

  execSync(`node "${tsgoPath}" -p tsconfig.main.json`, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });

  execSync(`node "${tscAliasPath}" -p tsconfig.main.json`, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });

  console.log("[build-and-serve] ✓ Build complete");
} catch (error) {
  console.error("[build-and-serve] Build failed:", error.message);
  process.exit(1);
}

// ── Step 2: Start server (blocking — keeps process alive for nodemon) ─
const entryPoint = path.join(rootDir, "dist/cli/index.js");
const serverCmd = `node "${entryPoint}" server ${serverArgs.join(" ")}`;

console.log(`[build-and-serve] Starting server...`);

try {
  execSync(serverCmd, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
} catch (error) {
  // Server was killed (SIGTERM from nodemon) or crashed — both are fine
  // Exit code 143 = SIGTERM (normal shutdown by nodemon)
  if (error.status === 143 || error.signal === "SIGTERM") {
    process.exit(0);
  }
  console.error("[build-and-serve] Server exited:", error.message);
  process.exit(error.status ?? 1);
}
