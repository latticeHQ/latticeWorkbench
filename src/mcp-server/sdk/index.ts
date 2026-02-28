/**
 * Lattice SDK — Barrel export
 *
 * Typed TypeScript SDK for controlling Lattice programmatically.
 * Each module mirrors an oRPC router namespace and exports typed async functions
 * that take a RouterClient<AppRouter> as the first argument.
 *
 * Usage:
 *   import { getClient } from './sdk/client';
 *   import { createMinion, sendMessage } from './sdk/minion';
 *
 *   const c = await getClient();
 *   const ws = await createMinion(c, 'feat/my-feature', '/path/to/project');
 *   await sendMessage(c, ws.minionId, 'Implement the login page');
 */

// Client
export { getClient } from "./client";

// Core modules
export * as minion from "./minion";
export * as project from "./project";
export * as terminal from "./terminal";
export * as terminalProfiles from "./terminal-profiles";
export * as config from "./config";
export * as agents from "./agents";
export * as tasks from "./tasks";

// Analytics & monitoring
export * as analytics from "./analytics";
export * as tokenizer from "./tokenizer";

// Server management
export * as serverMgmt from "./server-mgmt";
export * as mcpManagement from "./mcp-management";
export * as secrets from "./secrets";
export * as general from "./general";

// Authentication
export * as oauth from "./oauth";
