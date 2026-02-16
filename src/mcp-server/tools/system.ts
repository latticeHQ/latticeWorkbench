/**
 * System-level MCP tools — direct machine access for autonomous agents.
 *
 * These tools give the agent full control over the host machine:
 * shell commands, file I/O, git operations, process management, system info.
 *
 * Designed for autonomous octopus agents running on their own Mac Mini/Studio
 * with full permissions — no sandboxing, no babysitting.
 */
import { z } from "zod";
import { exec, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSystemTools(server: McpServer): void {
  // ── Shell command execution ───────────────────────────────────────

  server.tool(
    "system_shell",
    "Execute a shell command on the host machine. Full access — runs as the current user with all permissions. Use for git, npm, brew, system admin, anything.",
    {
      command: z.string().describe("The shell command to execute"),
      cwd: z.string().optional().describe("Working directory (default: home directory)"),
      timeout: z.number().optional().describe("Timeout in seconds (default: 120)"),
    },
    async ({ command, cwd, timeout }) => {
      const timeoutMs = (timeout ?? 120) * 1000;
      const workDir = cwd ?? os.homedir();

      return new Promise((resolve) => {
        exec(
          command,
          {
            cwd: workDir,
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
            env: { ...process.env, HOME: os.homedir() },
          },
          (error, stdout, stderr) => {
            const parts: string[] = [];
            if (stdout) parts.push(`STDOUT:\n${stdout}`);
            if (stderr) parts.push(`STDERR:\n${stderr}`);
            if (error) parts.push(`Exit code: ${error.code ?? 1}`);
            else parts.push("Exit code: 0");

            resolve({
              content: [
                {
                  type: "text" as const,
                  text: parts.join("\n\n") || "Command completed (no output)",
                },
              ],
              isError: !!error,
            });
          }
        );
      });
    }
  );

  // ── Git clone ─────────────────────────────────────────────────────

  server.tool(
    "system_git_clone",
    "Clone a git repository to the local machine. Returns the path where it was cloned.",
    {
      url: z.string().describe("Git repository URL (HTTPS or SSH)"),
      targetDir: z
        .string()
        .optional()
        .describe("Target directory (default: ~/projects/<repo-name>)"),
      branch: z.string().optional().describe("Branch to checkout after clone"),
    },
    async ({ url, targetDir, branch }) => {
      // Extract repo name from URL
      const repoName =
        url
          .split("/")
          .pop()
          ?.replace(/\.git$/, "") ?? "repo";

      const cloneDir = targetDir ?? path.join(os.homedir(), "projects", repoName);

      // Ensure parent directory exists
      const parentDir = path.dirname(cloneDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Check if directory already exists
      if (fs.existsSync(cloneDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Directory already exists: ${cloneDir}\nUse system_shell to pull updates or delete it first.`,
            },
          ],
        };
      }

      return new Promise((resolve) => {
        const args = ["clone", url, cloneDir];
        if (branch) args.push("--branch", branch);

        const git = spawn("git", args, {
          cwd: parentDir,
          env: { ...process.env, HOME: os.homedir() },
        });

        let stdout = "";
        let stderr = "";
        git.stdout.on("data", (d) => (stdout += d.toString()));
        git.stderr.on("data", (d) => (stderr += d.toString()));

        git.on("close", (code) => {
          if (code === 0) {
            resolve({
              content: [
                {
                  type: "text" as const,
                  text: `Cloned successfully to: ${cloneDir}\n${stderr}`.trim(),
                },
              ],
            });
          } else {
            resolve({
              content: [
                {
                  type: "text" as const,
                  text: `Git clone failed (exit ${code}):\n${stderr}\n${stdout}`,
                },
              ],
              isError: true,
            });
          }
        });
      });
    }
  );

  // ── File read ─────────────────────────────────────────────────────

  server.tool(
    "system_read_file",
    "Read a file from the filesystem. Returns the file contents as text.",
    {
      path: z.string().describe("Absolute path to the file"),
      encoding: z.string().optional().describe("File encoding (default: utf-8)"),
    },
    async ({ path: filePath, encoding }) => {
      try {
        const content = fs.readFileSync(filePath, (encoding as BufferEncoding) ?? "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── File write ────────────────────────────────────────────────────

  server.tool(
    "system_write_file",
    "Write content to a file. Creates parent directories if they don't exist.",
    {
      path: z.string().describe("Absolute path to write to"),
      content: z.string().describe("File content to write"),
      append: z.boolean().optional().describe("Append instead of overwrite (default: false)"),
    },
    async ({ path: filePath, content, append }) => {
      try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (append) {
          fs.appendFileSync(filePath, content, "utf-8");
        } else {
          fs.writeFileSync(filePath, content, "utf-8");
        }

        return {
          content: [
            { type: "text" as const, text: `Written ${content.length} bytes to ${filePath}` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── List directory ────────────────────────────────────────────────

  server.tool(
    "system_list_directory",
    "List files and directories at a given path.",
    {
      path: z.string().describe("Directory path to list"),
      recursive: z.boolean().optional().describe("List recursively (default: false, max depth: 3)"),
    },
    async ({ path: dirPath, recursive }) => {
      try {
        if (!fs.existsSync(dirPath)) {
          return {
            content: [{ type: "text" as const, text: `Directory not found: ${dirPath}` }],
            isError: true,
          };
        }

        if (!recursive) {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const lines = entries.map((e) => {
            const prefix = e.isDirectory() ? "📁" : "📄";
            return `${prefix} ${e.name}`;
          });
          return {
            content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
          };
        }

        // Recursive with max depth
        const lines: string[] = [];
        function walk(dir: string, depth: number) {
          if (depth > 3) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith(".") || e.name === "node_modules") continue;
            const indent = "  ".repeat(depth);
            const prefix = e.isDirectory() ? "📁" : "📄";
            lines.push(`${indent}${prefix} ${e.name}`);
            if (e.isDirectory()) {
              walk(path.join(dir, e.name), depth + 1);
            }
          }
        }
        walk(dirPath, 0);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
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

  // ── System info ───────────────────────────────────────────────────

  server.tool(
    "system_info",
    "Get system information: OS, CPU, memory, disk, hostname, uptime.",
    {},
    async () => {
      const info = {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        totalMemoryGB: (os.totalmem() / 1024 ** 3).toFixed(1),
        freeMemoryGB: (os.freemem() / 1024 ** 3).toFixed(1),
        uptimeHours: (os.uptime() / 3600).toFixed(1),
        homeDir: os.homedir(),
        user: os.userInfo().username,
        nodeVersion: process.version,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // ── Process management ────────────────────────────────────────────

  server.tool(
    "system_processes",
    "List running processes, optionally filtered by name.",
    {
      filter: z.string().optional().describe("Filter processes by name (grep pattern)"),
    },
    async ({ filter }) => {
      return new Promise((resolve) => {
        const command = filter
          ? `ps aux | head -1 && ps aux | grep -i "${filter}" | grep -v grep`
          : "ps aux | head -20";

        exec(command, { maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
          resolve({
            content: [{ type: "text" as const, text: stdout || "No matching processes." }],
          });
        });
      });
    }
  );
}
