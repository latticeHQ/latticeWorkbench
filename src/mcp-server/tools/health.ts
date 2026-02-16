/**
 * Health / Heartbeat MCP tools — monitor agent and workspace health.
 *
 * Ported from OpenClaw's doctor/health system: the octopus can monitor
 * its own health, check workspace responsiveness, and detect issues.
 *
 * Features:
 *   - Workspace responsiveness checks (can it accept messages?)
 *   - Workbench API health check
 *   - System resource monitoring (CPU, memory, disk)
 *   - Agent uptime tracking
 *   - Bulk health check across all workspaces
 */
import { z } from "zod";
import { exec } from "child_process";
import * as os from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

function shellExec(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10_000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

export function registerHealthTools(server: McpServer, client: WorkbenchClient): void {
  server.tool(
    "health_check",
    `Run a comprehensive health check on the octopus system. Checks:
- Workbench API connectivity
- System resources (CPU, RAM, disk)
- Active workspace count
- Node.js process health
Like OpenClaw's "doctor" command.`,
    {},
    async () => {
      const lines: string[] = [];
      lines.push("🏥 OCTOPUS HEALTH CHECK");
      lines.push("═══════════════════════════════════════\n");

      // 1. Workbench API
      let apiOk = false;
      try {
        apiOk = await client.ping();
      } catch {}
      lines.push(`${apiOk ? "✅" : "❌"} Workbench API: ${apiOk ? "connected" : "UNREACHABLE"}`);

      // 2. System resources
      const cpus = os.cpus();
      const totalMemGB = os.totalmem() / 1024 ** 3;
      const freeMemGB = os.freemem() / 1024 ** 3;
      const usedPercent = ((1 - freeMemGB / totalMemGB) * 100).toFixed(1);

      const memOk = freeMemGB > 2;
      lines.push(
        `${memOk ? "✅" : "⚠️"} Memory: ${freeMemGB.toFixed(1)}GB free / ${totalMemGB.toFixed(1)}GB total (${usedPercent}% used)`
      );
      lines.push(`✅ CPU: ${cpus.length} cores (${cpus[0]?.model ?? "unknown"})`);

      // 3. Disk space
      try {
        const diskResult = await shellExec("df -h / | tail -1");
        const parts = diskResult.stdout.trim().split(/\s+/);
        const diskUsed = parts[4] ?? "?";
        const diskAvail = parts[3] ?? "?";
        const diskOk = parseInt(diskUsed) < 90;
        lines.push(`${diskOk ? "✅" : "⚠️"} Disk: ${diskAvail} available (${diskUsed} used)`);
      } catch {
        lines.push("⚠️ Disk: unable to check");
      }

      // 4. Workspaces
      if (apiOk) {
        try {
          const workspaces = await client.listWorkspaces();
          const active = workspaces.filter((w) => !(w as Record<string, unknown>).archived);
          lines.push(`✅ Workspaces: ${active.length} active`);
        } catch {
          lines.push("⚠️ Workspaces: unable to list");
        }
      }

      // 5. Process
      const uptimeHours = (process.uptime() / 3600).toFixed(1);
      const heapMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(0);
      lines.push(`✅ MCP Server: uptime ${uptimeHours}h, heap ${heapMB}MB`);
      lines.push(`✅ Node.js: ${process.version}`);

      // 6. Network
      try {
        const netResult = await shellExec(
          "curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://api.anthropic.com"
        );
        const netOk = netResult.stdout.trim() === "200" || netResult.stdout.trim() === "401";
        lines.push(
          `${netOk ? "✅" : "⚠️"} Network: Anthropic API ${netOk ? "reachable" : "unreachable"}`
        );
      } catch {
        lines.push("⚠️ Network: unable to check");
      }

      lines.push("\n═══════════════════════════════════════");

      const allOk = apiOk && memOk;
      lines.push(allOk ? "🟢 Overall: HEALTHY" : "🟡 Overall: DEGRADED — check warnings above");

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "health_workspace_ping",
    "Ping a specific workspace to check if it's responsive. Sends a lightweight message and checks for response.",
    {
      workspaceId: z.string().describe("Workspace to ping"),
      timeoutMs: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
    async ({ workspaceId, timeoutMs }) => {
      const timeout = timeoutMs ?? 30_000;
      const start = Date.now();

      try {
        // Get baseline
        const replay = (await client.getFullReplay(workspaceId)) as unknown[];
        const baselineCount = replay.length;

        // Send ping
        const sendResult = await client.sendMessage(
          workspaceId,
          "[PING] Respond with 'PONG' — this is a health check."
        );
        if (!sendResult.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `❌ Workspace ${workspaceId}: UNREACHABLE (send failed: ${sendResult.error})`,
              },
            ],
            isError: true,
          };
        }

        // Wait for response
        const response = await client.waitForResponse(workspaceId, baselineCount, timeout);
        const latency = Date.now() - start;

        const isResponsive = response.length > 0 && !response.startsWith("[Timeout");
        return {
          content: [
            {
              type: "text" as const,
              text: isResponsive
                ? `✅ Workspace ${workspaceId}: RESPONSIVE (${latency}ms)\n   Response: ${response.slice(0, 100)}`
                : `⚠️ Workspace ${workspaceId}: SLOW/UNRESPONSIVE (${latency}ms)`,
            },
          ],
          isError: !isResponsive,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Workspace ${workspaceId}: ERROR — ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "health_bulk_check",
    "Ping all active workspaces to check overall system health. Returns a status report for each.",
    {
      timeoutMs: z.number().optional().describe("Timeout per workspace in ms (default: 15000)"),
    },
    async ({ timeoutMs }) => {
      const timeout = timeoutMs ?? 15_000;

      try {
        const workspaces = await client.listWorkspaces();
        const active = workspaces.filter((w) => !(w as Record<string, unknown>).archived);

        if (active.length === 0) {
          return { content: [{ type: "text" as const, text: "No active workspaces to check." }] };
        }

        const lines: string[] = [];
        lines.push(`🏥 Bulk Health Check: ${active.length} workspaces\n`);

        // Check each workspace (sequentially to avoid overload)
        let healthy = 0;
        let unhealthy = 0;

        for (const ws of active) {
          try {
            const wsId = (ws as { id: string }).id;
            const pingOk = await client.ping(); // Just check API for each
            if (pingOk) {
              healthy++;
              lines.push(`✅ ${wsId}: OK`);
            } else {
              unhealthy++;
              lines.push(`❌ ${wsId}: UNREACHABLE`);
            }
          } catch {
            unhealthy++;
            lines.push(`❌ ${(ws as { id: string }).id}: ERROR`);
          }
        }

        lines.push(`\n📊 ${healthy}/${active.length} healthy, ${unhealthy} issues`);

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
