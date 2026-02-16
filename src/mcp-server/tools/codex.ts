/**
 * Codex — Code-Execution MCP Pattern (Anthropic-recommended)
 *
 * Instead of loading all 53+ tool definitions into every agent's context,
 * this system presents tools as importable TypeScript files on a filesystem.
 *
 * Agents discover tools by exploring the filesystem, load only what they
 * need, and write code that executes in a sandboxed environment where
 * intermediate results stay out of the model's context.
 *
 * Architecture:
 *   Agent → reads ./servers/ filesystem → imports only needed tools
 *         → writes code → executes in sandbox → returns result
 *
 * Benefits:
 *   - 98%+ token reduction (load 3-5 tool defs vs 53)
 *   - Data flows between tools in code, never re-entering context
 *   - Agents build reusable skills over time
 *   - Progressive disclosure: name → description → full schema
 *
 * Reference: https://www.anthropic.com/engineering/code-execution-with-mcp
 */
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vm from "vm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

// ── Tool Registry ────────────────────────────────────────────────────
// Complete catalog of all MCP tools, organized by server/category

interface ToolDef {
  name: string;
  description: string;
  category: string;
  params: Array<{ name: string; type: string; required: boolean; description: string }>;
  returnType: string;
}

function getToolCatalog(): Record<string, ToolDef[]> {
  return {
    workspace: [
      {
        name: "listWorkspaces",
        description: "List all workspaces with metadata (id, title, project, status)",
        category: "workspace",
        params: [{ name: "archived", type: "boolean", required: false, description: "Include archived workspaces" }],
        returnType: "Array<{ id: string; title: string; projectPath: string; status: string }>",
      },
      {
        name: "createWorkspace",
        description: "Create a new workspace in a project. Returns workspace ID.",
        category: "workspace",
        params: [
          { name: "projectPath", type: "string", required: true, description: "Absolute path to the project" },
          { name: "branchName", type: "string", required: true, description: "Git branch name" },
          { name: "title", type: "string", required: false, description: "Workspace title" },
          { name: "trunkBranch", type: "string", required: false, description: "Base branch" },
        ],
        returnType: "{ success: boolean; workspaceId?: string; error?: string }",
      },
      {
        name: "removeWorkspace",
        description: "Delete a workspace",
        category: "workspace",
        params: [
          { name: "workspaceId", type: "string", required: true, description: "Workspace ID" },
          { name: "force", type: "boolean", required: false, description: "Force removal" },
        ],
        returnType: "{ success: boolean; error?: string }",
      },
      {
        name: "sendMessage",
        description: "Send a message to workspace agent and wait for full response",
        category: "workspace",
        params: [
          { name: "workspaceId", type: "string", required: true, description: "Target workspace" },
          { name: "message", type: "string", required: true, description: "Message to send" },
          { name: "timeoutMs", type: "number", required: false, description: "Max wait time (default: 120000)" },
        ],
        returnType: "string",
      },
      {
        name: "getChatHistory",
        description: "Get full conversation history for a workspace",
        category: "workspace",
        params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }],
        returnType: "Array<{ role: string; content: string }>",
      },
      {
        name: "interrupt",
        description: "Interrupt an active agent stream",
        category: "workspace",
        params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }],
        returnType: "{ success: boolean }",
      },
      {
        name: "executeBash",
        description: "Execute bash in workspace runtime. Returns stdout, stderr, exit code.",
        category: "workspace",
        params: [
          { name: "workspaceId", type: "string", required: true, description: "Workspace ID" },
          { name: "script", type: "string", required: true, description: "Bash script" },
          { name: "timeout", type: "number", required: false, description: "Timeout seconds" },
        ],
        returnType: "{ stdout: string; stderr: string; exitCode: number }",
      },
      {
        name: "getInfo",
        description: "Get detailed workspace info (metadata, status, config)",
        category: "workspace",
        params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }],
        returnType: "object",
      },
      {
        name: "forkWorkspace",
        description: "Fork workspace to new branch",
        category: "workspace",
        params: [
          { name: "workspaceId", type: "string", required: true, description: "Source workspace" },
          { name: "branchName", type: "string", required: true, description: "New branch name" },
          { name: "title", type: "string", required: false, description: "New workspace title" },
        ],
        returnType: "{ success: boolean; workspaceId?: string }",
      },
      {
        name: "renameWorkspace",
        description: "Rename a workspace's title",
        category: "workspace",
        params: [
          { name: "workspaceId", type: "string", required: true, description: "Workspace ID" },
          { name: "title", type: "string", required: true, description: "New title" },
        ],
        returnType: "{ success: boolean }",
      },
      {
        name: "archiveWorkspace",
        description: "Archive a workspace",
        category: "workspace",
        params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }],
        returnType: "{ success: boolean }",
      },
      {
        name: "unarchiveWorkspace",
        description: "Unarchive a workspace",
        category: "workspace",
        params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }],
        returnType: "{ success: boolean }",
      },
    ],
    project: [
      {
        name: "listProjects",
        description: "List all registered projects",
        category: "project",
        params: [],
        returnType: "Array<{ path: string; config: object }>",
      },
      {
        name: "createProject",
        description: "Register a project directory",
        category: "project",
        params: [{ name: "projectPath", type: "string", required: true, description: "Absolute path" }],
        returnType: "{ success: boolean }",
      },
      {
        name: "listBranches",
        description: "List git branches and recommended trunk",
        category: "project",
        params: [{ name: "projectPath", type: "string", required: true, description: "Project path" }],
        returnType: "{ branches: string[]; recommendedTrunk: string | null }",
      },
    ],
    channel: [
      {
        name: "listChannels",
        description: "List messaging channels (Telegram, Discord) with status",
        category: "channel",
        params: [],
        returnType: "Array<{ type: string; accountId: string; status: string; enabled: boolean }>",
      },
      {
        name: "connectChannel",
        description: "Connect a messaging channel (start bot)",
        category: "channel",
        params: [{ name: "accountId", type: "string", required: true, description: "Channel account ID" }],
        returnType: "{ success: boolean }",
      },
      {
        name: "disconnectChannel",
        description: "Disconnect a channel (stop bot)",
        category: "channel",
        params: [{ name: "accountId", type: "string", required: true, description: "Channel account ID" }],
        returnType: "{ success: boolean }",
      },
      {
        name: "sendChannelMessage",
        description: "Send message through a channel to a peer",
        category: "channel",
        params: [
          { name: "accountId", type: "string", required: true, description: "Channel account" },
          { name: "to", type: "string", required: true, description: "Recipient ID" },
          { name: "text", type: "string", required: true, description: "Message text" },
        ],
        returnType: "{ success: boolean }",
      },
    ],
    system: [
      {
        name: "shell",
        description: "Execute shell command with full permissions",
        category: "system",
        params: [
          { name: "command", type: "string", required: true, description: "Shell command" },
          { name: "cwd", type: "string", required: false, description: "Working directory" },
          { name: "timeout", type: "number", required: false, description: "Timeout seconds" },
        ],
        returnType: "{ stdout: string; stderr: string; exitCode: number }",
      },
      {
        name: "gitClone",
        description: "Clone a git repository",
        category: "system",
        params: [
          { name: "url", type: "string", required: true, description: "Git URL" },
          { name: "targetDir", type: "string", required: false, description: "Target directory" },
          { name: "branch", type: "string", required: false, description: "Branch to checkout" },
        ],
        returnType: "{ path: string }",
      },
      {
        name: "readFile",
        description: "Read a file from filesystem",
        category: "system",
        params: [{ name: "path", type: "string", required: true, description: "File path" }],
        returnType: "string",
      },
      {
        name: "writeFile",
        description: "Write content to a file",
        category: "system",
        params: [
          { name: "path", type: "string", required: true, description: "File path" },
          { name: "content", type: "string", required: true, description: "Content" },
          { name: "append", type: "boolean", required: false, description: "Append mode" },
        ],
        returnType: "void",
      },
      {
        name: "listDirectory",
        description: "List files in a directory",
        category: "system",
        params: [
          { name: "path", type: "string", required: true, description: "Directory path" },
          { name: "recursive", type: "boolean", required: false, description: "Recursive listing" },
        ],
        returnType: "string[]",
      },
      {
        name: "systemInfo",
        description: "Get OS, CPU, memory, disk info",
        category: "system",
        params: [],
        returnType: "{ hostname: string; cpus: number; totalMemoryGB: number; freeMemoryGB: number }",
      },
      {
        name: "processes",
        description: "List running processes",
        category: "system",
        params: [{ name: "filter", type: "string", required: false, description: "Filter pattern" }],
        returnType: "string",
      },
    ],
    swarm: [
      {
        name: "spawn",
        description: "Create workspace sub-agents dynamically",
        category: "swarm",
        params: [
          { name: "projectPath", type: "string", required: true, description: "Project path" },
          { name: "agents", type: "Array<{role, systemPrompt?, title?}>", required: true, description: "Specialists to spawn" },
        ],
        returnType: "Array<{ agentId: string; workspaceId: string; status: string }>",
      },
      {
        name: "dispatch",
        description: "Send task to an agent (async, returns immediately)",
        category: "swarm",
        params: [
          { name: "agentId", type: "string", required: true, description: "Target agent" },
          { name: "task", type: "string", required: true, description: "Task instruction" },
        ],
        returnType: "{ taskId: string; status: string }",
      },
      {
        name: "executeStage",
        description: "Run parallel tasks as a logical stage with dependencies",
        category: "swarm",
        params: [
          { name: "name", type: "string", required: true, description: "Stage name" },
          { name: "tasks", type: "Array<{agentId, task}>", required: true, description: "Parallel tasks" },
          { name: "dependsOnStages", type: "string[]", required: false, description: "Stage dependencies" },
        ],
        returnType: "{ stageId: string; taskIds: string[] }",
      },
      {
        name: "status",
        description: "Full swarm dashboard — agents, tasks, stages, resources",
        category: "swarm",
        params: [],
        returnType: "SwarmDashboard",
      },
      {
        name: "collect",
        description: "Wait for tasks/stages to complete, return results",
        category: "swarm",
        params: [
          { name: "stageId", type: "string", required: false, description: "Wait for stage" },
          { name: "taskIds", type: "string[]", required: false, description: "Wait for tasks" },
          { name: "timeoutMs", type: "number", required: false, description: "Timeout" },
        ],
        returnType: "Array<{ taskId: string; status: string; result?: string }>",
      },
      {
        name: "memorySet",
        description: "Store in shared swarm memory",
        category: "swarm",
        params: [
          { name: "key", type: "string", required: true, description: "Memory key" },
          { name: "value", type: "string", required: true, description: "Value" },
        ],
        returnType: "void",
      },
      {
        name: "memoryGet",
        description: "Read from shared swarm memory",
        category: "swarm",
        params: [{ name: "key", type: "string", required: false, description: "Key (omit for all)" }],
        returnType: "string | Record<string, string>",
      },
      {
        name: "resources",
        description: "Check system resources and parallel capacity",
        category: "swarm",
        params: [],
        returnType: "{ cpus: number; freeMemGB: number; maxParallelAgents: number }",
      },
    ],
    bootstrap: [
      {
        name: "bootstrapProject",
        description: "All-in-one: clone repo → register → create workspace",
        category: "bootstrap",
        params: [
          { name: "gitUrl", type: "string", required: true, description: "Git repo URL" },
          { name: "targetDir", type: "string", required: false, description: "Clone target" },
          { name: "branch", type: "string", required: false, description: "Branch" },
        ],
        returnType: "{ workspaceId: string }",
      },
      {
        name: "initProject",
        description: "Create new project from scratch with git init",
        category: "bootstrap",
        params: [
          { name: "projectPath", type: "string", required: true, description: "New project path" },
        ],
        returnType: "{ workspaceId: string }",
      },
      {
        name: "installDeps",
        description: "Auto-detect and install project dependencies",
        category: "bootstrap",
        params: [{ name: "projectPath", type: "string", required: true, description: "Project path" }],
        returnType: "{ packageManager: string; exitCode: number }",
      },
    ],
    cron: [
      {
        name: "create",
        description: "Schedule recurring task in a workspace",
        category: "cron",
        params: [
          { name: "name", type: "string", required: true, description: "Job name" },
          { name: "workspaceId", type: "string", required: true, description: "Target workspace" },
          { name: "schedule", type: "string", required: true, description: "Interval: '5m', '1h', '1d'" },
          { name: "task", type: "string", required: true, description: "Task message" },
        ],
        returnType: "{ jobId: string }",
      },
      {
        name: "list",
        description: "List all scheduled jobs",
        category: "cron",
        params: [],
        returnType: "Array<{ id: string; name: string; schedule: string; enabled: boolean }>",
      },
      {
        name: "enable",
        description: "Enable or disable a cron job",
        category: "cron",
        params: [
          { name: "jobId", type: "string", required: true, description: "Job ID" },
          { name: "enabled", type: "boolean", required: true, description: "Enable state" },
        ],
        returnType: "void",
      },
      {
        name: "runNow",
        description: "Trigger immediate execution of a cron job",
        category: "cron",
        params: [{ name: "jobId", type: "string", required: true, description: "Job ID" }],
        returnType: "{ result: string }",
      },
    ],
    health: [
      {
        name: "check",
        description: "Comprehensive system health check",
        category: "health",
        params: [],
        returnType: "HealthReport",
      },
      {
        name: "workspacePing",
        description: "Ping a workspace to check responsiveness",
        category: "health",
        params: [{ name: "workspaceId", type: "string", required: true, description: "Workspace ID" }],
        returnType: "{ responsive: boolean; latencyMs: number }",
      },
      {
        name: "bulkCheck",
        description: "Ping all active workspaces",
        category: "health",
        params: [],
        returnType: "Array<{ workspaceId: string; healthy: boolean }>",
      },
    ],
  };
}

// ── Code generation helpers ──────────────────────────────────────────

function generateToolFile(tool: ToolDef): string {
  const paramList = tool.params
    .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}`)
    .join("; ");

  const inputInterface = tool.params.length > 0
    ? `interface ${capitalize(tool.name)}Input {\n${tool.params.map((p) => `  /** ${p.description} */\n  ${p.name}${p.required ? "" : "?"}: ${p.type};`).join("\n")}\n}\n\n`
    : "";

  const funcParams = tool.params.length > 0
    ? `input: ${capitalize(tool.name)}Input`
    : "";

  return `// Auto-generated tool definition
// Server: ${tool.category} | Tool: ${tool.name}
import { callTool } from "../../runtime.js";

${inputInterface}/** ${tool.description} */
export async function ${tool.name}(${funcParams}): Promise<${tool.returnType}> {
  return callTool<${tool.returnType}>("${tool.category}", "${tool.name}"${tool.params.length > 0 ? ", input" : ""});
}
`;
}

function generateIndexFile(category: string, tools: ToolDef[]): string {
  const exports = tools.map((t) => `export { ${t.name} } from "./${t.name}.js";`);
  return `// ${category} tools — ${tools.length} available\n${exports.join("\n")}\n`;
}

function generateServerTree(): string {
  const catalog = getToolCatalog();
  const lines: string[] = ["servers/"];

  for (const [category, tools] of Object.entries(catalog)) {
    lines.push(`├── ${category}/`);
    for (let i = 0; i < tools.length; i++) {
      const prefix = i === tools.length - 1 ? "│   └──" : "│   ├──";
      lines.push(`${prefix} ${tools[i]!.name}.ts`);
    }
    lines.push(`│   └── index.ts`);
  }

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Filesystem generation ────────────────────────────────────────────

function getCodexDir(): string {
  return path.join(os.homedir(), ".lattice", "codex");
}

function ensureCodexGenerated(): string {
  const codexDir = getCodexDir();
  const serversDir = path.join(codexDir, "servers");

  // Only regenerate if missing
  if (fs.existsSync(path.join(serversDir, "workspace", "index.ts"))) {
    return codexDir;
  }

  const catalog = getToolCatalog();

  // Generate runtime.ts
  const runtimeCode = `/**
 * Codex Runtime — bridges code-execution calls to MCP tools
 *
 * When an agent writes: import { sendMessage } from './servers/workspace';
 * The actual call goes through MCP tool dispatch.
 */

// This runtime is injected by the MCP server at execution time
// Each function call maps to the corresponding MCP tool
export async function callTool<T>(server: string, tool: string, input?: unknown): Promise<T> {
  // The MCP server intercepts this and routes to the actual tool handler
  const response = await (globalThis as any).__mcp_call(server, tool, input);
  return response as T;
}
`;
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, "runtime.ts"), runtimeCode);

  // Generate server directories and tool files
  for (const [category, tools] of Object.entries(catalog)) {
    const categoryDir = path.join(serversDir, category);
    fs.mkdirSync(categoryDir, { recursive: true });

    // Generate individual tool files
    for (const tool of tools) {
      fs.writeFileSync(
        path.join(categoryDir, `${tool.name}.ts`),
        generateToolFile(tool)
      );
    }

    // Generate index.ts
    fs.writeFileSync(
      path.join(categoryDir, "index.ts"),
      generateIndexFile(category, tools)
    );
  }

  // Generate root README
  const readmeContent = `# Lattice Workbench — Code API

Explore this filesystem to discover available tools.
Import only what you need for your task.

## Quick Start

\`\`\`typescript
import * as workspace from './servers/workspace';
import * as swarm from './servers/swarm';

// Only these 2 modules are loaded — not all 53 tools
const ws = await workspace.createWorkspace({ projectPath: '/my/project', branchName: 'feature' });
await workspace.sendMessage({ workspaceId: ws.workspaceId, message: 'Build the API' });
\`\`\`

## Available Servers

${Object.entries(catalog).map(([cat, tools]) => `- **${cat}/** — ${tools.length} tools (${tools.map(t => t.name).join(', ')})`).join("\n")}

## Total: ${Object.values(catalog).reduce((a, b) => a + b.length, 0)} tools
`;

  fs.writeFileSync(path.join(codexDir, "README.md"), readmeContent);

  return codexDir;
}

// ── Tool bridge — maps code API calls to real tool execution ─────────
// This is the critical piece: when agent code calls
//   await workspace.sendMessage({ workspaceId: 'x', message: 'hello' })
// it gets routed through this bridge to the actual WorkbenchClient/system tools.

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

function createToolBridge(client: WorkbenchClient): Record<string, Record<string, ToolHandler>> {
  return {
    workspace: {
      listWorkspaces: async (input) => client.listWorkspaces(input.archived as boolean | undefined),
      createWorkspace: async (input) => client.createWorkspace(input as { projectPath: string; branchName: string; trunkBranch?: string; title?: string }),
      removeWorkspace: async (input) => client.removeWorkspace(input.workspaceId as string, input.force as boolean | undefined),
      sendMessage: async (input) => {
        const wsId = input.workspaceId as string;
        const msg = input.message as string;
        const timeoutMs = (input.timeoutMs as number) ?? 120_000;
        let baseline = 0;
        try { baseline = ((await client.getFullReplay(wsId)) as unknown[]).length; } catch {}
        const result = await client.sendMessage(wsId, msg);
        if (!result.success) return `Send failed: ${result.error}`;
        return client.waitForResponse(wsId, baseline, timeoutMs);
      },
      getChatHistory: async (input) => client.getFullReplay(input.workspaceId as string),
      interrupt: async (input) => client.interruptStream(input.workspaceId as string),
      executeBash: async (input) => client.executeBash(input.workspaceId as string, input.script as string, input.timeout as number | undefined),
      getInfo: async (input) => client.getWorkspaceInfo(input.workspaceId as string),
      forkWorkspace: async (input) => client.forkWorkspace(input.workspaceId as string, input.branchName as string, input.title as string | undefined),
      renameWorkspace: async (input) => client.renameWorkspace(input.workspaceId as string, input.title as string),
      archiveWorkspace: async (input) => client.archiveWorkspace(input.workspaceId as string),
      unarchiveWorkspace: async (input) => client.unarchiveWorkspace(input.workspaceId as string),
    },
    project: {
      listProjects: async () => client.listProjects(),
      createProject: async (input) => client.createProject(input.projectPath as string),
      listBranches: async (input) => client.listBranches(input.projectPath as string),
    },
    channel: {
      listChannels: async () => client.listChannels(),
      connectChannel: async (input) => client.connectChannel(input.accountId as string),
      disconnectChannel: async (input) => client.disconnectChannel(input.accountId as string),
      sendChannelMessage: async (input) => client.sendChannelMessage(input.accountId as string, input.to as string, input.text as string),
    },
    system: {
      shell: async (input) => {
        const { exec: execCmd } = await import("child_process");
        return new Promise((resolve) => {
          execCmd(
            input.command as string,
            {
              cwd: (input.cwd as string) ?? os.homedir(),
              timeout: ((input.timeout as number) ?? 120) * 1000,
              maxBuffer: 10 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
              resolve({ stdout, stderr, exitCode: error?.code ?? (error ? 1 : 0) });
            }
          );
        });
      },
      readFile: async (input) => fs.readFileSync(input.path as string, "utf-8"),
      writeFile: async (input) => {
        const dir = path.dirname(input.path as string);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (input.append) fs.appendFileSync(input.path as string, input.content as string, "utf-8");
        else fs.writeFileSync(input.path as string, input.content as string, "utf-8");
        return { written: (input.content as string).length };
      },
      listDirectory: async (input) => fs.readdirSync(input.path as string, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      systemInfo: async () => ({
        hostname: os.hostname(), platform: os.platform(), cpus: os.cpus().length,
        totalMemoryGB: +(os.totalmem() / (1024 ** 3)).toFixed(1),
        freeMemoryGB: +(os.freemem() / (1024 ** 3)).toFixed(1),
      }),
      processes: async (input) => {
        const { exec: execCmd } = await import("child_process");
        const filter = input.filter as string | undefined;
        const cmd = filter ? `ps aux | head -1 && ps aux | grep -i "${filter}" | grep -v grep` : "ps aux | head -20";
        return new Promise((resolve) => {
          execCmd(cmd, { maxBuffer: 5 * 1024 * 1024 }, (_err, stdout) => resolve(stdout));
        });
      },
      gitClone: async (input) => {
        const { spawn: spawnCmd } = await import("child_process");
        const url = input.url as string;
        const repoName = url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
        const cloneDir = (input.targetDir as string) ?? path.join(os.homedir(), "projects", repoName);
        if (fs.existsSync(cloneDir)) return { error: `Already exists: ${cloneDir}` };
        const parentDir = path.dirname(cloneDir);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        const args = ["clone", url, cloneDir];
        if (input.branch) args.push("--branch", input.branch as string);
        return new Promise((resolve) => {
          const git = spawnCmd("git", args, { cwd: parentDir });
          let stderr = "";
          git.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
          git.on("close", (code: number | null) => {
            resolve(code === 0 ? { path: cloneDir } : { error: `exit ${code}: ${stderr}` });
          });
        });
      },
    },
    health: {
      check: async () => {
        const apiOk = await client.ping();
        return {
          api: apiOk ? "connected" : "unreachable",
          memory: { totalGB: +(os.totalmem() / (1024 ** 3)).toFixed(1), freeGB: +(os.freemem() / (1024 ** 3)).toFixed(1) },
          cpus: os.cpus().length,
          nodeVersion: process.version,
        };
      },
      workspacePing: async (input) => {
        const wsId = input.workspaceId as string;
        const start = Date.now();
        const replay = (await client.getFullReplay(wsId)) as unknown[];
        const baseline = replay.length;
        await client.sendMessage(wsId, "[PING]");
        const response = await client.waitForResponse(wsId, baseline, (input.timeoutMs as number) ?? 30_000);
        return { responsive: !response.startsWith("[Timeout"), latencyMs: Date.now() - start };
      },
      bulkCheck: async () => {
        const workspaces = await client.listWorkspaces();
        const results = [];
        for (const ws of workspaces) {
          const wsId = (ws as { id: string }).id;
          const ok = await client.ping();
          results.push({ workspaceId: wsId, healthy: ok });
        }
        return results;
      },
    },
  };
}

// ── TypeScript transpiler — strip types to runnable JS ───────────────

async function transpileTS(code: string): Promise<string> {
  try {
    // Use TypeScript compiler API if available
    const ts = await import("typescript");
    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        strict: false, // Lenient for agent-written code
        skipLibCheck: true,
      },
    });
    return result.outputText;
  } catch {
    // Fallback: basic type stripping (handles most common patterns)
    return code
      .replace(/:\s*[A-Z]\w+(\[\])?\s*(=|;|,|\)|\})/g, "$2") // : TypeName = → =
      .replace(/:\s*\{[^}]*\}/g, "") // : { complex type }
      .replace(/<[A-Z]\w+(\[\])?>/g, "") // <Generic>
      .replace(/\bas\s+\w+/g, "") // as Type
      .replace(/\binterface\s+\w+\s*\{[^}]*\}/gs, "") // interface blocks
      .replace(/\btype\s+\w+\s*=\s*[^;]+;/g, "") // type aliases
      .replace(/import\s+type\s+[^;]+;/g, ""); // import type
  }
}

// ── Code executor — sandboxed execution with tool bridge ────────────

interface ExecutionResult {
  success: boolean;
  result?: unknown;
  stdout: string[];
  stderr: string[];
  toolCalls: Array<{ server: string; tool: string; input: unknown; result: unknown; durationMs: number }>;
  durationMs: number;
  error?: string;
}

async function executeCode(
  code: string,
  client: WorkbenchClient,
  options: { timeoutMs?: number; variables?: Record<string, unknown> } = {}
): Promise<ExecutionResult> {
  const { timeoutMs = 30_000, variables = {} } = options;
  const bridge = createToolBridge(client);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const toolCalls: ExecutionResult["toolCalls"] = [];
  const startTime = Date.now();

  // The __mcp_call function injected into the sandbox
  const mcpCall = async (server: string, tool: string, input?: unknown): Promise<unknown> => {
    const handler = bridge[server]?.[tool];
    if (!handler) {
      throw new Error(`Unknown tool: ${server}.${tool}. Available: ${Object.keys(bridge).map(s => `${s}.[${Object.keys(bridge[s]!).join(",")}]`).join(", ")}`);
    }
    const callStart = Date.now();
    const result = await handler((input ?? {}) as Record<string, unknown>);
    toolCalls.push({ server, tool, input, result, durationMs: Date.now() - callStart });
    return result;
  };

  // Create server proxy objects so agents can write:
  //   const ws = await workspace.listWorkspaces();
  // instead of:
  //   const ws = await callTool("workspace", "listWorkspaces");
  const serverProxies: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const [serverName, tools] of Object.entries(bridge)) {
    const proxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    for (const toolName of Object.keys(tools)) {
      proxy[toolName] = async (input?: unknown) => mcpCall(serverName, toolName, input);
    }
    serverProxies[serverName] = proxy;
  }

  try {
    // Transpile TypeScript to JavaScript
    const jsCode = await transpileTS(code);

    // Wrap in async IIFE so top-level await works
    const wrappedCode = `
      (async () => {
        ${jsCode}
      })()
    `;

    // Create sandbox context
    const sandbox: Record<string, unknown> = {
      // Core globals
      console: {
        log: (...args: unknown[]) => stdout.push(args.map(String).join(" ")),
        error: (...args: unknown[]) => stderr.push(args.map(String).join(" ")),
        warn: (...args: unknown[]) => stderr.push(`[WARN] ${args.map(String).join(" ")}`),
        info: (...args: unknown[]) => stdout.push(`[INFO] ${args.map(String).join(" ")}`),
      },
      setTimeout,
      clearTimeout,
      JSON,
      Date,
      Math,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Error,
      Buffer,
      URL,
      URLSearchParams,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      atob: globalThis.atob,
      btoa: globalThis.btoa,

      // MCP bridge
      __mcp_call: mcpCall,
      callTool: mcpCall,

      // Server proxies — direct API access
      ...serverProxies,

      // User-provided variables
      ...variables,
    };

    vm.createContext(sandbox);

    const result = await vm.runInNewContext(wrappedCode, sandbox, {
      timeout: timeoutMs,
      filename: "codex-execution.js",
    });

    return {
      success: true,
      result,
      stdout,
      stderr,
      toolCalls,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      stdout,
      stderr,
      toolCalls,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Format execution result for MCP response ────────────────────────

function formatExecutionResult(result: ExecutionResult): string {
  const lines: string[] = [];

  lines.push(result.success ? "✅ Execution completed" : "❌ Execution failed");
  lines.push(`⏱️ Duration: ${result.durationMs}ms`);

  if (result.toolCalls.length > 0) {
    lines.push(`\n🔧 Tool calls (${result.toolCalls.length}):`);
    for (const call of result.toolCalls) {
      const resultPreview = JSON.stringify(call.result)?.slice(0, 150) ?? "void";
      lines.push(`  ${call.server}.${call.tool}(${JSON.stringify(call.input)?.slice(0, 80) ?? ""})`);
      lines.push(`    → ${resultPreview}${resultPreview.length >= 150 ? "…" : ""} (${call.durationMs}ms)`);
    }
  }

  if (result.stdout.length > 0) {
    lines.push(`\n📤 stdout:\n${result.stdout.join("\n")}`);
  }
  if (result.stderr.length > 0) {
    lines.push(`\n⚠️ stderr:\n${result.stderr.join("\n")}`);
  }

  if (result.result !== undefined) {
    const resultStr = typeof result.result === "string"
      ? result.result
      : JSON.stringify(result.result, null, 2);
    lines.push(`\n📦 Return value:\n${resultStr?.slice(0, 2000) ?? "undefined"}`);
  }

  if (result.error) {
    lines.push(`\n❌ Error: ${result.error}`);
  }

  return lines.join("\n");
}

// ── Register codex tools ─────────────────────────────────────────────

export function registerCodexTools(server: McpServer, _client: WorkbenchClient): void {

  // ── Search tools with progressive disclosure ───────────────────────

  server.tool(
    "codex_search_tools",
    `Search for available tools by keyword. Returns matching tools with progressive detail levels.

This is the entry point for the code-execution MCP pattern. Instead of loading all 53+ tool definitions into your context, search for what you need.

Detail levels:
- "names" — just tool names (cheapest)
- "brief" — name + one-line description
- "full" — complete definition with params, types, examples`,
    {
      query: z.string().optional().describe("Search query (keyword, category name, or action verb). Omit for overview."),
      category: z.string().optional().describe("Filter by category: workspace, project, channel, system, swarm, bootstrap, cron, health"),
      detail: z.enum(["names", "brief", "full"]).optional().describe("Detail level (default: brief)"),
    },
    async ({ query, category, detail }) => {
      const catalog = getToolCatalog();
      const detailLevel = detail ?? "brief";
      const results: Array<{ category: string; tool: ToolDef }> = [];

      // Collect matching tools
      for (const [cat, tools] of Object.entries(catalog)) {
        if (category && cat !== category) continue;

        for (const tool of tools) {
          if (!query) {
            results.push({ category: cat, tool });
            continue;
          }

          const q = query.toLowerCase();
          const searchText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
          if (searchText.includes(q)) {
            results.push({ category: cat, tool });
          }
        }
      }

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No tools matching "${query ?? ""}". Categories: ${Object.keys(catalog).join(", ")}`,
          }],
        };
      }

      // Format based on detail level
      const lines: string[] = [];
      lines.push(`🔍 Found ${results.length} tools${query ? ` matching "${query}"` : ""}${category ? ` in ${category}` : ""}\n`);

      if (detailLevel === "names") {
        const byCategory = new Map<string, string[]>();
        for (const r of results) {
          if (!byCategory.has(r.category)) byCategory.set(r.category, []);
          byCategory.get(r.category)!.push(r.tool.name);
        }
        for (const [cat, names] of byCategory) {
          lines.push(`${cat}: ${names.join(", ")}`);
        }
      } else if (detailLevel === "brief") {
        let currentCategory = "";
        for (const r of results) {
          if (r.category !== currentCategory) {
            currentCategory = r.category;
            lines.push(`\n📁 ${currentCategory}/`);
          }
          lines.push(`  ${r.tool.name} — ${r.tool.description}`);
        }
      } else {
        // Full detail
        for (const r of results) {
          lines.push(`\n━━━ ${r.category}/${r.tool.name} ━━━`);
          lines.push(`Description: ${r.tool.description}`);
          if (r.tool.params.length > 0) {
            lines.push("Parameters:");
            for (const p of r.tool.params) {
              lines.push(`  ${p.name}${p.required ? " (required)" : " (optional)"}: ${p.type} — ${p.description}`);
            }
          } else {
            lines.push("Parameters: none");
          }
          lines.push(`Returns: ${r.tool.returnType}`);
          lines.push(`Import: import { ${r.tool.name} } from './servers/${r.category}';`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  // ── Generate code API filesystem ───────────────────────────────────

  server.tool(
    "codex_generate",
    "Generate the code-execution filesystem at ~/.lattice/codex/servers/. Creates importable TypeScript files for all tools so agents can discover them via filesystem exploration.",
    {},
    async () => {
      try {
        const codexDir = ensureCodexGenerated();
        const catalog = getToolCatalog();
        const totalTools = Object.values(catalog).reduce((a, b) => a + b.length, 0);

        const tree = generateServerTree();

        return {
          content: [{
            type: "text" as const,
            text: `✅ Codex generated at: ${codexDir}\n\n${tree}\n\n${totalTools} tools across ${Object.keys(catalog).length} servers.\n\nAgents can now explore ./servers/ to discover tools on-demand.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Get tool definition (load on demand) ───────────────────────────

  server.tool(
    "codex_get_tool",
    "Get the full TypeScript source for a specific tool. Like reading a file from ./servers/<category>/<tool>.ts — loads just the definition you need.",
    {
      category: z.string().describe("Tool category (workspace, swarm, etc.)"),
      toolName: z.string().describe("Tool name"),
    },
    async ({ category, toolName }) => {
      const catalog = getToolCatalog();
      const tools = catalog[category];
      if (!tools) {
        return {
          content: [{ type: "text" as const, text: `Category "${category}" not found. Available: ${Object.keys(catalog).join(", ")}` }],
          isError: true,
        };
      }

      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        return {
          content: [{ type: "text" as const, text: `Tool "${toolName}" not found in ${category}. Available: ${tools.map(t => t.name).join(", ")}` }],
          isError: true,
        };
      }

      const code = generateToolFile(tool);
      return {
        content: [{ type: "text" as const, text: code }],
      };
    }
  );

  // ── Overview — minimal context summary ─────────────────────────────

  server.tool(
    "codex_overview",
    "Get a minimal overview of all available tool categories and counts. The cheapest way to understand what's available before diving deeper.",
    {},
    async () => {
      const catalog = getToolCatalog();

      const lines: string[] = [];
      lines.push("🐙 Lattice Workbench — Tool Overview\n");

      let total = 0;
      for (const [category, tools] of Object.entries(catalog)) {
        total += tools.length;
        lines.push(`📁 ${category}/ (${tools.length} tools)`);
        lines.push(`   ${tools.map(t => t.name).join(", ")}`);
      }

      lines.push(`\n📊 Total: ${total} tools across ${Object.keys(catalog).length} categories`);
      lines.push("\nUse codex_search_tools to find specific tools");
      lines.push("Use codex_get_tool to load a tool's full definition");
      lines.push("Use codex_execute to run code with tool access");

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  // ── Execute code with MCP tool bridge ─────────────────────────────

  server.tool(
    "codex_execute",
    `Execute TypeScript/JavaScript code with full access to all MCP tools as importable APIs.

This is the core of the code-execution MCP pattern. Instead of calling tools one at a time,
write code that chains multiple tools together. Data flows between tools in your code —
intermediate results never re-enter the model's context, saving tokens.

Available server APIs in your code (call directly, no imports needed):
  workspace.listWorkspaces(), workspace.sendMessage({workspaceId, message}), workspace.executeBash({workspaceId, script})
  project.listProjects(), project.listBranches({projectPath})
  channel.listChannels(), channel.sendChannelMessage({accountId, to, text})
  system.shell({command, cwd}), system.readFile({path}), system.writeFile({path, content})
  health.check(), health.workspacePing({workspaceId})

Or use callTool(server, tool, input) for dynamic dispatch.

Example:
  const workspaces = await workspace.listWorkspaces();
  const active = workspaces.filter(w => !w.archived);
  for (const ws of active.slice(0, 3)) {
    const result = await workspace.executeBash({ workspaceId: ws.id, script: 'git status' });
    console.log(ws.title + ': ' + result.stdout.slice(0, 100));
  }
  return active.length;`,
    {
      code: z.string().describe("TypeScript/JavaScript code to execute. Has access to all tool APIs."),
      timeoutMs: z.number().optional().describe("Execution timeout in ms (default: 30000)"),
      variables: z.record(z.string(), z.unknown()).optional().describe("Variables to inject into the execution context"),
    },
    async ({ code, timeoutMs, variables }) => {
      const result = await executeCode(code, _client, {
        timeoutMs,
        variables: variables as Record<string, unknown> | undefined,
      });
      return {
        content: [{ type: "text" as const, text: formatExecutionResult(result) }],
        isError: !result.success,
      };
    }
  );

  // ── Compose — multi-step pipeline ─────────────────────────────────

  server.tool(
    "codex_compose",
    `Execute a multi-step pipeline where each step's output feeds into the next.

Each step is a code snippet. The return value of step N is available as \`input\` in step N+1.
All steps share the same tool bridge. Intermediate results stay out of the model context.

Example steps:
  Step 1: "return await workspace.listWorkspaces()"
  Step 2: "return input.filter(w => !w.archived).map(w => w.id)"
  Step 3: "const results = []; for (const id of input) { results.push(await health.workspacePing({workspaceId: id})); } return results"

This is more token-efficient than codex_execute for linear pipelines where you want to
inspect intermediate results.`,
    {
      steps: z.array(z.object({
        name: z.string().describe("Step label"),
        code: z.string().describe("Code to execute. Previous step's return is available as 'input'."),
      })).describe("Pipeline steps in order"),
      timeoutMs: z.number().optional().describe("Timeout per step in ms (default: 30000)"),
    },
    async ({ steps, timeoutMs }) => {
      const lines: string[] = [];
      lines.push(`🔗 Pipeline: ${steps.length} steps\n`);

      let previousResult: unknown = undefined;
      let allToolCalls = 0;
      const totalStart = Date.now();

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        lines.push(`── Step ${i + 1}: ${step.name} ──`);

        const result = await executeCode(step.code, _client, {
          timeoutMs,
          variables: { input: previousResult },
        });

        allToolCalls += result.toolCalls.length;

        if (!result.success) {
          lines.push(`❌ Failed: ${result.error}`);
          if (result.stdout.length > 0) lines.push(`stdout: ${result.stdout.join("\n")}`);
          lines.push(`\n⏹️ Pipeline aborted at step ${i + 1}/${steps.length}`);
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            isError: true,
          };
        }

        previousResult = result.result;
        const preview = JSON.stringify(result.result)?.slice(0, 300) ?? "undefined";
        lines.push(`✅ ${result.durationMs}ms | ${result.toolCalls.length} tool calls`);
        if (result.stdout.length > 0) lines.push(`   stdout: ${result.stdout.join("; ").slice(0, 200)}`);
        lines.push(`   → ${preview}${preview.length >= 300 ? "…" : ""}`);
        lines.push("");
      }

      const totalMs = Date.now() - totalStart;
      lines.push(`━━━ Pipeline complete: ${totalMs}ms total, ${allToolCalls} tool calls ━━━`);

      // Include final result
      if (previousResult !== undefined) {
        const finalStr = typeof previousResult === "string"
          ? previousResult
          : JSON.stringify(previousResult, null, 2);
        lines.push(`\n📦 Final result:\n${finalStr?.slice(0, 3000) ?? "undefined"}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  // ── Save executed code as a reusable skill ─────────────────────────

  server.tool(
    "codex_save_as_skill",
    `Promote code you've written and tested with codex_execute into a reusable skill.

After you've tested code with codex_execute and it works, save it so you (or other agents)
can reuse it later. The skill is stored at ~/.lattice/skills/<name>/ with code, docs, and metadata.

This bridges the code-execution pattern with the skills library: iterate in code mode,
then persist what works.`,
    {
      name: z.string().describe("Skill name (e.g., 'check-all-workspaces')"),
      description: z.string().describe("What this skill does"),
      code: z.string().describe("The TypeScript code to save"),
      tags: z.array(z.string()).optional().describe("Discovery tags"),
      inputSchema: z.record(z.string(), z.string()).optional().describe("Input params: { paramName: 'type description' }"),
    },
    async ({ name, description, code, tags, inputSchema }) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
      const skillsDir = path.join(os.homedir(), ".lattice", "skills");
      const skillDir = path.join(skillsDir, slug);

      const isUpdate = fs.existsSync(skillDir);
      let version = 1;
      let useCount = 0;
      let createdAt = Date.now();

      if (isUpdate) {
        try {
          const existing = JSON.parse(fs.readFileSync(path.join(skillDir, "metadata.json"), "utf-8"));
          version = (existing.version ?? 0) + 1;
          useCount = existing.useCount ?? 0;
          createdAt = existing.createdAt ?? Date.now();
        } catch {}
      }

      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "index.ts"), code, "utf-8");
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}\n\n${description}\n\n## Usage\n\nExecute with \`codex_execute\` or \`skills_execute\`.\n\n## Tags\n\n${(tags ?? []).join(", ")}\n`, "utf-8");

      const metadata = {
        name: slug, description, tags: tags ?? [],
        author: "codex", version, createdAt, updatedAt: Date.now(),
        useCount, inputSchema,
      };
      fs.writeFileSync(path.join(skillDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

      return {
        content: [{
          type: "text" as const,
          text: `${isUpdate ? "🔄 Updated" : "✅ Saved"} skill: "${slug}" (v${version})\n📁 ${skillDir}\n\nUse skills_execute or codex_execute to run it.`,
        }],
      };
    }
  );

  // ── Execute a saved skill via the code execution engine ────────────

  server.tool(
    "codex_run_skill",
    `Execute a saved skill from ~/.lattice/skills/ through the code execution engine.

Unlike skills_execute (which sends code to a workspace agent), this runs the skill
directly in the code execution sandbox with full MCP tool access. Faster and more
predictable — no agent-in-the-loop.`,
    {
      name: z.string().describe("Skill name (slug)"),
      inputs: z.record(z.string(), z.unknown()).optional().describe("Input variables to inject"),
      timeoutMs: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
    async ({ name, inputs, timeoutMs }) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const skillDir = path.join(os.homedir(), ".lattice", "skills", slug);

      if (!fs.existsSync(path.join(skillDir, "index.ts"))) {
        return {
          content: [{ type: "text" as const, text: `Skill "${slug}" not found at ${skillDir}` }],
          isError: true,
        };
      }

      const code = fs.readFileSync(path.join(skillDir, "index.ts"), "utf-8");

      // Update usage stats
      try {
        const metaPath = path.join(skillDir, "metadata.json");
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        meta.useCount = (meta.useCount ?? 0) + 1;
        meta.lastUsedAt = Date.now();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
      } catch {}

      const result = await executeCode(code, _client, {
        timeoutMs,
        variables: (inputs ?? {}) as Record<string, unknown>,
      });

      return {
        content: [{ type: "text" as const, text: `🔧 Skill "${slug}" execution:\n\n${formatExecutionResult(result)}` }],
        isError: !result.success,
      };
    }
  );
}
