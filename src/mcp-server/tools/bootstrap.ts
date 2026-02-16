/**
 * Bootstrap MCP tools — high-level orchestration tools that combine
 * multiple operations into a single action.
 *
 * These are the "power" tools for an autonomous agent that needs to
 * spin up entire projects from scratch.
 */
import { z } from "zod";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

export function registerBootstrapTools(server: McpServer, client: WorkbenchClient): void {
  // ── Bootstrap project ─────────────────────────────────────────────

  server.tool(
    "workbench_bootstrap_project",
    "All-in-one: clone a git repo, register it as a project in the workbench, and create a workspace. Returns the workspace ID ready to use with workbench_send_message.",
    {
      gitUrl: z.string().describe("Git repository URL (HTTPS or SSH)"),
      targetDir: z
        .string()
        .optional()
        .describe("Where to clone (default: ~/projects/<repo-name>)"),
      branch: z.string().optional().describe("Branch to checkout"),
      workspaceTitle: z
        .string()
        .optional()
        .describe("Title for the workspace (default: auto-generated)"),
    },
    async ({ gitUrl, targetDir, branch, workspaceTitle }) => {
      try {
        const repoName = gitUrl
          .split("/")
          .pop()
          ?.replace(/\.git$/, "") ?? "repo";

        const projectPath = targetDir ?? path.join(os.homedir(), "projects", repoName);
        const steps: string[] = [];

        // Step 1: Clone if not exists
        if (!fs.existsSync(projectPath)) {
          const parentDir = path.dirname(projectPath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }

          const cloneResult = await shellExec(
            `git clone ${gitUrl} "${projectPath}"${branch ? ` --branch ${branch}` : ""}`,
            parentDir
          );

          if (cloneResult.exitCode !== 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Git clone failed:\n${cloneResult.stderr}\n${cloneResult.stdout}`,
                },
              ],
              isError: true,
            };
          }
          steps.push(`✅ Cloned ${gitUrl} → ${projectPath}`);
        } else {
          steps.push(`📁 Directory exists: ${projectPath} (skipping clone)`);

          // Pull latest if it's already a git repo
          if (fs.existsSync(path.join(projectPath, ".git"))) {
            await shellExec("git pull --ff-only 2>/dev/null || true", projectPath);
            steps.push("✅ Pulled latest changes");
          }
        }

        // Step 2: Register as project in workbench
        try {
          const createResult = await client.createProject(projectPath);
          if (createResult.success) {
            steps.push(`✅ Registered project in workbench`);
          } else {
            // Might already exist — that's fine
            steps.push(`📋 Project registration: ${createResult.error ?? "already exists"}`);
          }
        } catch (error) {
          steps.push(
            `⚠️ Project registration: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Step 3: Detect trunk branch
        let trunkBranch: string | undefined;
        try {
          const branchInfo = await client.listBranches(projectPath);
          trunkBranch = branchInfo.recommendedTrunk ?? undefined;
        } catch {
          trunkBranch = "main";
        }

        // Step 4: Create workspace
        const branchName =
          branch ?? `agent-${Date.now().toString(36)}`;
        const title = workspaceTitle ?? `${repoName} workspace`;

        const wsResult = await client.createWorkspace({
          projectPath,
          branchName,
          trunkBranch,
          title,
        });

        if (!wsResult.success) {
          steps.push(`❌ Failed to create workspace: ${wsResult.error}`);
          return {
            content: [{ type: "text" as const, text: steps.join("\n") }],
            isError: true,
          };
        }

        const workspaceId = wsResult.data?.metadata?.id ?? "unknown";
        steps.push(`✅ Created workspace: ${workspaceId}`);
        steps.push("");
        steps.push(`🎯 Ready! Use workbench_send_message with workspaceId: ${workspaceId}`);

        return {
          content: [{ type: "text" as const, text: steps.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Init new project from scratch ─────────────────────────────────

  server.tool(
    "workbench_init_project",
    "Create a brand new project directory with git init, register it, and create a workspace. For starting fresh — no cloning needed.",
    {
      projectPath: z.string().describe("Path where the new project should be created"),
      workspaceTitle: z.string().optional().describe("Title for the workspace"),
    },
    async ({ projectPath, workspaceTitle }) => {
      try {
        const steps: string[] = [];

        // Create directory
        if (!fs.existsSync(projectPath)) {
          fs.mkdirSync(projectPath, { recursive: true });
          steps.push(`✅ Created directory: ${projectPath}`);
        } else {
          steps.push(`📁 Directory exists: ${projectPath}`);
        }

        // Git init if not already a repo
        if (!fs.existsSync(path.join(projectPath, ".git"))) {
          await shellExec("git init", projectPath);
          // Create initial commit so branches work
          await shellExec(
            'git commit --allow-empty -m "Initial commit"',
            projectPath
          );
          steps.push("✅ Initialized git repository");
        }

        // Register project
        try {
          await client.createProject(projectPath);
          steps.push("✅ Registered project in workbench");
        } catch {
          steps.push("📋 Project already registered");
        }

        // Create workspace
        const dirName = path.basename(projectPath);
        const title = workspaceTitle ?? `${dirName} workspace`;
        const branchName = `agent-${Date.now().toString(36)}`;

        const wsResult = await client.createWorkspace({
          projectPath,
          branchName,
          trunkBranch: "main",
          title,
        });

        if (!wsResult.success) {
          steps.push(`❌ Failed to create workspace: ${wsResult.error}`);
          return {
            content: [{ type: "text" as const, text: steps.join("\n") }],
            isError: true,
          };
        }

        const workspaceId = wsResult.data?.metadata?.id ?? "unknown";
        steps.push(`✅ Created workspace: ${workspaceId}`);
        steps.push("");
        steps.push(`🎯 Ready! Use workbench_send_message with workspaceId: ${workspaceId}`);

        return {
          content: [{ type: "text" as const, text: steps.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Init failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Install dependencies ──────────────────────────────────────────

  server.tool(
    "system_install_deps",
    "Detect and install project dependencies (npm, yarn, pip, cargo, etc.). Auto-detects the package manager from the project files.",
    {
      projectPath: z.string().describe("Path to the project directory"),
    },
    async ({ projectPath }) => {
      try {
        // Detect package manager
        const checks: Array<{ file: string; command: string; name: string }> = [
          { file: "package-lock.json", command: "npm install", name: "npm" },
          { file: "yarn.lock", command: "yarn install", name: "yarn" },
          { file: "pnpm-lock.yaml", command: "pnpm install", name: "pnpm" },
          { file: "bun.lockb", command: "bun install", name: "bun" },
          { file: "package.json", command: "npm install", name: "npm (default)" },
          { file: "requirements.txt", command: "pip install -r requirements.txt", name: "pip" },
          { file: "Pipfile", command: "pipenv install", name: "pipenv" },
          { file: "pyproject.toml", command: "pip install -e .", name: "pip (pyproject)" },
          { file: "Cargo.toml", command: "cargo build", name: "cargo" },
          { file: "go.mod", command: "go mod download", name: "go" },
          { file: "Gemfile", command: "bundle install", name: "bundler" },
        ];

        for (const check of checks) {
          if (fs.existsSync(path.join(projectPath, check.file))) {
            const result = await shellExec(check.command, projectPath, 300);
            const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
            const truncated =
              output.length > 3000 ? output.slice(-3000) + "\n...(truncated)" : output;

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Detected: ${check.name} (${check.file})\nCommand: ${check.command}\nExit code: ${result.exitCode}\n\n${truncated}`,
                },
              ],
              isError: result.exitCode !== 0,
            };
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: "No recognized package manager files found in the project directory.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ── Helper ──────────────────────────────────────────────────────────────

function shellExec(
  command: string,
  cwd: string,
  timeoutSec = 120
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutSec * 1000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, HOME: os.homedir() },
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error?.code ?? (error ? 1 : 0),
        });
      }
    );
  });
}
