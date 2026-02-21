import { useEffect, useState, useCallback } from "react";
import { useAPI } from "@/browser/contexts/API";
import {
  CLI_AGENT_DEFINITIONS,
  CLI_AGENT_SLUGS,
  type CliAgentDefinition,
} from "@/common/constants/cliAgents";
import type { CliAgentDetectionResult } from "@/common/orpc/types";

/**
 * Build the default (pre-detection) list of all known agents.
 * All are shown as undetected. This matches emdash's pattern of showing
 * agents immediately with no loading spinner, then updating in-place.
 */
function createDefaultAgents(): Map<string, CliAgentDetectionResult> {
  const map = new Map<string, CliAgentDetectionResult>();
  for (const slug of CLI_AGENT_SLUGS) {
    const def = CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS] as CliAgentDefinition;
    map.set(slug, {
      slug,
      displayName: def.displayName,
      description: def.description,
      detected: false,
      installUrl: def.installUrl,
      installCommand: def.installCommand,
      category: def.category,
      supportedModels: def.supportedModels ? [...def.supportedModels] : undefined,
    });
  }
  return map;
}

/**
 * Hook to detect installed CLI coding agents.
 *
 * When `workspaceId` is provided, detects agents on the workspace's runtime
 * (SSH/Docker) via the batch `detect` endpoint — so the UI reflects what's
 * actually available there.
 *
 * When omitted, uses the progressive `detectEach` stream for local detection:
 * - All agents appear **immediately** in the undetected state (no loading spinner).
 * - The stream updates each agent in-place as its probe resolves.
 * - Cache hits and fast probes arrive in ~100 ms; slow probes trickle in.
 *
 * @param workspaceId - Optional workspace ID for runtime-aware detection
 */
export function useCliAgentDetection(workspaceId?: string) {
  const { api } = useAPI();

  // Start with all agents visible as undetected — never blocks the UI
  const [agentMap, setAgentMap] = useState<Map<string, CliAgentDetectionResult>>(
    () => createDefaultAgents()
  );
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        if (workspaceId) {
          // Runtime-aware detection: batch detect on workspace runtime
          const results = await api.cliAgents.detect({ workspaceId });
          if (!cancelled) {
            setAgentMap((prev) => {
              const next = new Map(prev);
              for (const result of results) {
                next.set(result.slug, result);
              }
              return next;
            });
          }
        } else {
          // Local detection: progressive streaming
          const iterator = await api.cliAgents.detectEach();
          for await (const result of iterator) {
            if (cancelled) break;
            // Merge each arriving result into the map — existing entries update in-place
            setAgentMap((prev) => {
              const next = new Map(prev);
              next.set(result.slug, result);
              return next;
            });
          }
        }
      } catch {
        // Ignore errors — agents remain in their default (undetected) state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, refreshKey, workspaceId]);

  /**
   * Re-run detection (e.g. after installing an agent).
   * The server's `installAgent` already invalidates its cache, so this
   * just needs to re-subscribe to the stream.
   */
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const agents = [...agentMap.values()];
  const detectedAgents = agents.filter((a) => a.detected);
  const missingAgents = agents.filter((a) => !a.detected);

  return { agents, detectedAgents, missingAgents, loading, refresh };
}
