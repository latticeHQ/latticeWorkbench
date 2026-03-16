/**
 * Code execution tools: Anthropic's recommended "Code Execution with MCP" pattern.
 *
 * Instead of calling 200+ individual MCP tools, LLMs write TypeScript code that
 * imports and calls SDK functions. This reduces context usage dramatically:
 * - 1 tool call replaces chains of 5-10 sequential tool calls
 * - Data processing happens in code, not context
 * - Complex workflows compose naturally
 *
 * The SDK is pre-imported: agents can call any function from any module.
 *
 * Reference: https://www.anthropic.com/engineering/code-execution-with-mcp
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";
import path from "node:path";
import fs from "node:fs";

/** Directory where saved skills are stored. */
const SKILLS_DIR = path.join(
  process.env.HOME ?? "/tmp",
  ".lattice",
  "skills",
  "code-execution",
);

export function registerCodeExecutionTools(
  server: McpServer,
  _client: RouterClient<AppRouter>,
): void {
  // ── Execute TypeScript code with pre-imported SDK ─────────────────────
  server.tool(
    "execute_code",
    "Execute TypeScript code with the full Lattice SDK pre-imported. " +
      "Use this instead of chaining multiple tool calls — write code that " +
      "imports SDK modules, calls functions, and processes results.\n\n" +
      "The SDK client is pre-initialized as `c` (RouterClient<AppRouter>).\n" +
      "All SDK modules are available as named imports.\n\n" +
      "Example:\n" +
      "```typescript\n" +
      "// Get all projects and their minion counts\n" +
      "const projects = await project.listProjects(c);\n" +
      "const results = [];\n" +
      "for (const [path, config] of projects) {\n" +
      "  const minions = await minion.listMinions(c);\n" +
      "  const projectMinions = minions.filter(m => m.projectPath === path);\n" +
      "  results.push({ path, name: config.name, minionCount: projectMinions.length });\n" +
      "}\n" +
      "return results;\n" +
      "```\n\n" +
      "Available SDK modules: minion, project, terminal, terminalProfiles, browser, " +
      "config, agents, tasks, analytics, tokenizer, serverMgmt, mcpManagement, " +
      "secrets, general, oauth, inbox, kanban, scheduler, sync, researchTerminal.\n\n" +
      "Use `read_sdk_module` to see the full API for any module before writing code.\n\n" +
      "IMPORTANT: Your code runs in an async context. Use `return` to output results. " +
      "Console.log output is captured separately.",
    {
      code: z
        .string()
        .describe(
          "TypeScript code to execute. The SDK client `c` and all SDK modules are pre-imported. " +
            "Use `return` to output results.",
        ),
      timeout_ms: z
        .number()
        .optional()
        .describe("Execution timeout in milliseconds (default: 30000, max: 300000)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const timeout = Math.min(params.timeout_ms ?? 30_000, 300_000);

        // Build the execution wrapper that pre-imports all SDK modules
        const wrapper = buildCodeWrapper(params.code);

        // Execute via Bun subprocess for isolation
        const result = await executeInSubprocess(wrapper, timeout);

        return {
          content: [
            jsonContent({
              success: result.success,
              result: result.output,
              ...(result.logs.length > 0 && { console: result.logs }),
              ...(result.error && { error: result.error }),
              executionTime: result.durationMs,
            }),
          ],
        };
      }),
  );

  // ── Read an SDK module's source ──────────────────────────────────────
  server.tool(
    "read_sdk_module",
    "Read the source code of an SDK module to understand available functions, " +
      "their signatures, and JSDoc comments. Use this before writing execute_code " +
      "calls to understand the exact API.\n\n" +
      "Available modules: minion, project, terminal, terminal-profiles, browser, " +
      "config, agents, tasks, analytics, tokenizer, server-mgmt, mcp-management, " +
      "secrets, general, oauth, inbox, kanban, scheduler, sync, " +
      "research-terminal, client, index, SKILL",
    {
      module: z
        .string()
        .describe("SDK module name (e.g. 'browser', 'minion', 'project', 'openbb')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const sdkDir = path.resolve(__dirname, "../sdk");
        const moduleName = params.module.replace(/\.ts$/, "");
        const filePath = path.join(sdkDir, `${moduleName}.ts`);

        // Also check for .md files (SKILL.md)
        const mdPath = path.join(sdkDir, `${moduleName}.md`);

        let content: string;
        if (fs.existsSync(filePath)) {
          content = fs.readFileSync(filePath, "utf-8");
        } else if (fs.existsSync(mdPath)) {
          content = fs.readFileSync(mdPath, "utf-8");
        } else {
          // List available modules
          const files = fs
            .readdirSync(sdkDir)
            .filter((f) => f.endsWith(".ts") || f.endsWith(".md"))
            .map((f) => f.replace(/\.(ts|md)$/, ""));
          return {
            content: [
              jsonContent({
                error: `Module '${moduleName}' not found`,
                availableModules: [...new Set(files)],
              }),
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: content,
            },
          ],
        };
      }),
  );

  // ── Save a reusable skill (code snippet) ─────────────────────────────
  server.tool(
    "save_skill",
    "Save a reusable code snippet (skill) for future use. Skills are stored " +
      "persistently and can be loaded by name in execute_code calls.\n\n" +
      "Good candidates for skills:\n" +
      "- Multi-step workflows you'll repeat\n" +
      "- Data processing pipelines\n" +
      "- Complex queries across multiple SDK modules",
    {
      name: z.string().describe("Unique skill name (e.g. 'deploy-check', 'cost-summary')"),
      description: z.string().describe("What this skill does"),
      code: z.string().describe("The TypeScript code (same format as execute_code)"),
      parameters: z
        .array(
          z.object({
            name: z.string(),
            description: z.string(),
            required: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Parameters the skill accepts (available as `params` object in code)"),
    },
    (params) =>
      withErrorHandling(async () => {
        fs.mkdirSync(SKILLS_DIR, { recursive: true });

        const skill = {
          name: params.name,
          description: params.description,
          code: params.code,
          parameters: params.parameters ?? [],
          createdAt: new Date().toISOString(),
        };

        const filePath = path.join(SKILLS_DIR, `${params.name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(skill, null, 2));

        return {
          content: [
            jsonContent({
              saved: true,
              name: params.name,
              path: filePath,
              hint: `Use run_skill({ name: '${params.name}' }) to execute this skill.`,
            }),
          ],
        };
      }),
  );

  // ── List saved skills ────────────────────────────────────────────────
  server.tool(
    "list_skills",
    "List all saved code execution skills.",
    {},
    () =>
      withErrorHandling(async () => {
        if (!fs.existsSync(SKILLS_DIR)) {
          return {
            content: [jsonContent({ skills: [], hint: "No skills saved yet. Use save_skill to create one." })],
          };
        }

        const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".json"));
        const skills = files.map((f) => {
          const raw = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, f), "utf-8"));
          return {
            name: raw.name,
            description: raw.description,
            parameters: raw.parameters ?? [],
            createdAt: raw.createdAt,
          };
        });

        return {
          content: [jsonContent({ count: skills.length, skills })],
        };
      }),
  );

  // ── Run a saved skill ────────────────────────────────────────────────
  server.tool(
    "run_skill",
    "Execute a previously saved skill by name, optionally passing parameters.",
    {
      name: z.string().describe("Skill name to run"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Parameters to pass to the skill (available as `params` object)"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Execution timeout in milliseconds (default: 30000, max: 300000)"),
    },
    (input) =>
      withErrorHandling(async () => {
        const filePath = path.join(SKILLS_DIR, `${input.name}.json`);
        if (!fs.existsSync(filePath)) {
          // List available
          const available = fs.existsSync(SKILLS_DIR)
            ? fs
                .readdirSync(SKILLS_DIR)
                .filter((f) => f.endsWith(".json"))
                .map((f) => f.replace(".json", ""))
            : [];
          return {
            content: [
              jsonContent({
                error: `Skill '${input.name}' not found`,
                available,
              }),
            ],
          };
        }

        const skill = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const timeout = Math.min(input.timeout_ms ?? 30_000, 300_000);

        // Inject params into the code context
        const paramsJson = JSON.stringify(input.params ?? {});
        const codeWithParams = `const params = ${paramsJson};\n${skill.code}`;
        const wrapper = buildCodeWrapper(codeWithParams);

        const result = await executeInSubprocess(wrapper, timeout);

        return {
          content: [
            jsonContent({
              skill: input.name,
              success: result.success,
              result: result.output,
              ...(result.logs.length > 0 && { console: result.logs }),
              ...(result.error && { error: result.error }),
              executionTime: result.durationMs,
            }),
          ],
        };
      }),
  );

  // ── Delete a saved skill ─────────────────────────────────────────────
  server.tool(
    "delete_skill",
    "Delete a saved code execution skill by name.",
    {
      name: z.string().describe("Skill name to delete"),
    },
    (params) =>
      withErrorHandling(async () => {
        const filePath = path.join(SKILLS_DIR, `${params.name}.json`);
        if (!fs.existsSync(filePath)) {
          return {
            content: [jsonContent({ error: `Skill '${params.name}' not found` })],
          };
        }

        fs.unlinkSync(filePath);
        return {
          content: [jsonContent({ deleted: true, name: params.name })],
        };
      }),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface ExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  logs: string[];
  durationMs: number;
}

/**
 * Build the TypeScript wrapper that pre-imports the SDK and executes user code.
 * The wrapper creates an async IIFE that:
 * 1. Imports the SDK client and all modules
 * 2. Captures console.log output
 * 3. Executes user code in the SDK context
 * 4. Returns results as JSON on stdout
 */
function buildCodeWrapper(userCode: string): string {
  // Resolve the SDK directory relative to this file
  const sdkDir = path.resolve(__dirname, "../sdk");

  return `
// Auto-generated Lattice SDK code execution wrapper
import { RPCLink as HTTPRPCLink } from "@orpc/client/fetch";
import { createORPCClient } from "@orpc/client";

// Import all SDK modules
import * as minion from "${sdkDir}/minion";
import * as project from "${sdkDir}/project";
import * as terminal from "${sdkDir}/terminal";
import * as terminalProfiles from "${sdkDir}/terminal-profiles";
import * as browser from "${sdkDir}/browser";
import * as configMod from "${sdkDir}/config";
import * as agents from "${sdkDir}/agents";
import * as tasks from "${sdkDir}/tasks";
import * as analytics from "${sdkDir}/analytics";
import * as tokenizer from "${sdkDir}/tokenizer";
import * as serverMgmt from "${sdkDir}/server-mgmt";
import * as mcpManagement from "${sdkDir}/mcp-management";
import * as secrets from "${sdkDir}/secrets";
import * as general from "${sdkDir}/general";
import * as oauth from "${sdkDir}/oauth";
import * as inbox from "${sdkDir}/inbox";
import * as kanban from "${sdkDir}/kanban";
import * as scheduler from "${sdkDir}/scheduler";
import * as sync from "${sdkDir}/sync";
import * as researchTerminal from "${sdkDir}/research-terminal";

// Alias config to avoid conflict with node:config
const config = configMod;
// Alias for backwards compatibility
const openbb = researchTerminal;

// Capture console output
const __logs: string[] = [];
const __origLog = console.log;
const __origWarn = console.warn;
const __origError = console.error;
console.log = (...args: unknown[]) => __logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
console.warn = (...args: unknown[]) => __logs.push('[warn] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
console.error = (...args: unknown[]) => __logs.push('[error] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));

// Discover server and create client
async function __initClient() {
  // Try env vars first
  const url = process.env.LATTICE_SERVER_URL;
  const token = process.env.LATTICE_SERVER_AUTH_TOKEN;
  if (url) {
    const link = new HTTPRPCLink({
      url: url + '/orpc',
      headers: token ? { Authorization: 'Bearer ' + token } : undefined,
    });
    return createORPCClient(link);
  }

  // Try lockfile
  const lockPath = (process.env.HOME ?? '/tmp') + '/.lattice/server.lock';
  try {
    const lockfile = await Bun.file(lockPath).text();
    const lock = JSON.parse(lockfile);
    const link = new HTTPRPCLink({
      url: (lock.url ?? 'http://127.0.0.1:' + (lock.port ?? 3000)) + '/orpc',
      headers: lock.authToken ? { Authorization: 'Bearer ' + lock.authToken } : undefined,
    });
    return createORPCClient(link);
  } catch {}

  // Fallback
  const link = new HTTPRPCLink({ url: 'http://127.0.0.1:3000/orpc' });
  return createORPCClient(link);
}

// Execute
const __start = performance.now();
try {
  const c = await __initClient() as any;

  const __userFn = async () => {
    ${userCode}
  };

  const __result = await __userFn();
  const __duration = Math.round(performance.now() - __start);

  // Restore console
  console.log = __origLog;
  console.warn = __origWarn;
  console.error = __origError;

  // Output result as JSON to stdout
  const __output = {
    success: true,
    output: __result,
    logs: __logs,
    durationMs: __duration,
  };
  process.stdout.write(JSON.stringify(__output));
} catch (err: unknown) {
  const __duration = Math.round(performance.now() - __start);
  console.log = __origLog;
  console.warn = __origWarn;
  console.error = __origError;

  const __output = {
    success: false,
    output: null,
    error: err instanceof Error ? err.message + '\\n' + (err.stack ?? '') : String(err),
    logs: __logs,
    durationMs: __duration,
  };
  process.stdout.write(JSON.stringify(__output));
}
`;
}

/**
 * Execute code in a Bun subprocess for isolation.
 * Writes a temp file and runs it with `bun run`.
 */
async function executeInSubprocess(
  code: string,
  timeoutMs: number,
): Promise<ExecutionResult> {
  const tmpDir = path.join(
    process.env.HOME ?? "/tmp",
    ".lattice",
    "tmp",
    "code-execution",
  );
  fs.mkdirSync(tmpDir, { recursive: true });

  const tmpFile = path.join(tmpDir, `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ts`);
  fs.writeFileSync(tmpFile, code);

  const start = performance.now();

  try {
    const proc = Bun.spawn(["bun", "run", tmpFile], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Ensure SDK can find the Lattice server
        NODE_ENV: process.env.NODE_ENV ?? "development",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timeoutId);

    const durationMs = Math.round(performance.now() - start);

    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {}

    if (exitCode !== 0 && !stdout.trim()) {
      return {
        success: false,
        output: null,
        error: stderr || `Process exited with code ${exitCode}`,
        logs: [],
        durationMs,
      };
    }

    // Parse the JSON output from the wrapper
    try {
      const result = JSON.parse(stdout);
      return {
        success: result.success ?? false,
        output: result.output,
        error: result.error,
        logs: result.logs ?? [],
        durationMs: result.durationMs ?? durationMs,
      };
    } catch {
      // If JSON parse fails, return raw output
      return {
        success: exitCode === 0,
        output: stdout.trim() || null,
        error: stderr || undefined,
        logs: [],
        durationMs,
      };
    }
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {}

    return {
      success: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
      logs: [],
      durationMs,
    };
  }
}
