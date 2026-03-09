import { tool } from "ai";
import type { ParallelMonitorToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { PARALLEL_MONITOR_TIMEOUT_MS } from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

const MONITOR_API_BASE = "https://api.parallel.ai/v1alpha/monitors";

/**
 * Helper for raw HTTP calls to the Parallel AI Monitor alpha API.
 */
async function monitorFetch(
  apiKey: string,
  path: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `${MONITOR_API_BASE}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });

  let data: any;
  if (response.ok) {
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  } else {
    data = await response.text().catch(() => null);
  }

  return { ok: response.ok, status: response.status, data };
}

export const createParallelMonitorTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_monitor.description,
    inputSchema: TOOL_DEFINITIONS.parallel_monitor.schema,
    execute: async ({
      action,
      query,
      frequency,
      monitor_id,
    }): Promise<ParallelMonitorToolResult> => {
      const apiKey = config.secrets?.PARALLEL_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error:
            "PARALLEL_API_KEY secret is not configured. " +
            "Go to Settings → Integrations to add your Parallel AI API key.",
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        PARALLEL_MONITOR_TIMEOUT_MS
      );

      try {
        switch (action) {
          case "create": {
            if (!query) {
              return {
                success: false,
                error: "query is required for 'create' action",
              };
            }
            const result = await monitorFetch(
              apiKey,
              "",
              "POST",
              { query, frequency: frequency ?? "1d" },
              controller.signal
            );
            if (!result.ok) {
              return {
                success: false,
                error: `Monitor create failed (${result.status}): ${JSON.stringify(result.data)}`,
              };
            }
            return {
              success: true,
              action: "create",
              monitor_id:
                result.data?.id ?? result.data?.monitor_id ?? "unknown",
              message:
                "Monitor created successfully. Use action 'check' with this monitor_id to retrieve events.",
            };
          }

          case "check": {
            if (!monitor_id) {
              return {
                success: false,
                error: "monitor_id is required for 'check' action",
              };
            }
            const result = await monitorFetch(
              apiKey,
              `/${monitor_id}/events`,
              "GET",
              undefined,
              controller.signal
            );
            if (!result.ok) {
              return {
                success: false,
                error: `Monitor check failed (${result.status}): ${JSON.stringify(result.data)}`,
              };
            }
            const events = Array.isArray(result.data?.events ?? result.data)
              ? (result.data?.events ?? result.data).map((e: any) => ({
                  timestamp: e.timestamp ?? e.created_at,
                  summary: e.summary ?? e.description ?? e.title,
                  url: e.url,
                }))
              : [];
            return {
              success: true,
              action: "check",
              monitor_id,
              events,
            };
          }

          case "list": {
            const result = await monitorFetch(
              apiKey,
              "",
              "GET",
              undefined,
              controller.signal
            );
            if (!result.ok) {
              return {
                success: false,
                error: `Monitor list failed (${result.status}): ${JSON.stringify(result.data)}`,
              };
            }
            const rawMonitors = result.data?.monitors ?? result.data;
            const monitors = Array.isArray(rawMonitors)
              ? rawMonitors.map((m: any) => ({
                  id: m.id ?? m.monitor_id,
                  query: m.query,
                  frequency: m.frequency,
                  status: m.status,
                }))
              : [];
            return {
              success: true,
              action: "list",
              monitors,
            };
          }

          case "delete": {
            if (!monitor_id) {
              return {
                success: false,
                error: "monitor_id is required for 'delete' action",
              };
            }
            const result = await monitorFetch(
              apiKey,
              `/${monitor_id}`,
              "DELETE",
              undefined,
              controller.signal
            );
            if (!result.ok) {
              return {
                success: false,
                error: `Monitor delete failed (${result.status}): ${JSON.stringify(result.data)}`,
              };
            }
            return {
              success: true,
              action: "delete",
              monitor_id,
              message: "Monitor deleted successfully.",
            };
          }

          default:
            return {
              success: false,
              error: `Unknown action: ${action}`,
            };
        }
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI Monitor failed: ${getErrorMessage(err)}`,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  });
