/**
 * Singleton oRPC client for the Lattice SDK.
 *
 * Auto-discovers the running Lattice backend using the same resolution order
 * as the MCP server (env vars → lockfile → fallback).
 *
 * Usage:
 *   import { getClient } from './client';
 *   const client = await getClient();
 *   const projects = await client.projects.list();
 */

import { RPCLink as HTTPRPCLink } from "@orpc/client/fetch";
import { createORPCClient } from "@orpc/client";
import type { AppRouter } from "@/node/orpc/router";
import type { RouterClient } from "@orpc/server";
import { discoverServer } from "../utils";

let _client: RouterClient<AppRouter> | null = null;

/** Get or create the singleton oRPC client. */
export async function getClient(): Promise<RouterClient<AppRouter>> {
  if (_client != null) return _client;

  const connection = await discoverServer();
  const link = new HTTPRPCLink({
    url: `${connection.baseUrl}/orpc`,
    headers: connection.authToken != null
      ? { Authorization: `Bearer ${connection.authToken}` }
      : undefined,
  });

  _client = createORPCClient(link) as unknown as RouterClient<AppRouter>;
  return _client;
}
