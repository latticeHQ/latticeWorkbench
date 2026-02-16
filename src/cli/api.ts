/**
 * API CLI subcommand - delegates to a running lattice server via HTTP.
 *
 * This module is loaded lazily to avoid pulling in ESM-only dependencies
 * (trpc-cli) when running other commands like the desktop app.
 *
 * Server discovery priority:
 * 1. LATTICE_SERVER_URL env var (explicit override)
 * 2. Lockfile at ~/.lattice/server.lock (running Electron or lattice server)
 * 3. Fallback to http://localhost:3000
 */

import { createCli } from "trpc-cli";
import { router } from "@/node/orpc/router";
import { proxifyOrpc } from "./proxifyOrpc";
import { ServerLockfile } from "@/node/services/serverLockfile";
import { getLatticeHome } from "@/common/constants/paths";
import { getArgsAfterSplice } from "./argv";

// index.ts already splices "api" from argv before importing this module,
// so we just need to get the remaining args after the splice point.
const args = getArgsAfterSplice();

interface ServerDiscovery {
  baseUrl: string;
  authToken: string | undefined;
}

async function discoverServer(): Promise<ServerDiscovery> {
  // Priority 1: Explicit env vars override everything
  if (process.env.LATTICE_SERVER_URL) {
    return {
      baseUrl: process.env.LATTICE_SERVER_URL,
      authToken: process.env.LATTICE_SERVER_AUTH_TOKEN ?? process.env.LATTICE_SERVER_AUTH_TOKEN,
    };
  }

  // Priority 2: Try lockfile discovery (running Electron or lattice server)
  try {
    const lockfile = new ServerLockfile(getLatticeHome());
    const data = await lockfile.read();
    if (data) {
      return {
        baseUrl: data.baseUrl,
        authToken: data.token,
      };
    }
  } catch {
    // Ignore lockfile errors
  }

  // Priority 3: Default fallback (standalone server on default port)
  return {
    baseUrl: "http://localhost:3000",
    authToken: process.env.LATTICE_SERVER_AUTH_TOKEN ?? process.env.LATTICE_SERVER_AUTH_TOKEN,
  };
}

// Run async discovery then start CLI
(async () => {
  const { baseUrl, authToken } = await discoverServer();

  const proxiedRouter = proxifyOrpc(router(), { baseUrl, authToken });

  // Use trpc-cli's run() method instead of buildProgram().parse()
  // run() sets exitOverride on root, uses parseAsync, and handles process exit properly
  const { run } = createCli({
    router: proxiedRouter,
    name: "lattice api",
    description: "Interact with the lattice API via a running server",
  });

  try {
    await run({ argv: args });
  } catch (error) {
    // trpc-cli throws FailedToExitError after calling process.exit()
    // In Electron, process.exit() doesn't immediately terminate, so the error surfaces.
    // This is expected and safe to ignore since exit was already requested.
    if (error instanceof Error && error.constructor.name === "FailedToExitError") {
      return;
    }
    throw error;
  }
})();
