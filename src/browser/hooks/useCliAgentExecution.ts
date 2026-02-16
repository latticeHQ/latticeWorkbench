import { useState, useCallback } from "react";
import { useAPI } from "@/browser/contexts/API";
import type { AgentRunResult, AgentSession } from "@/common/orpc/types";

/**
 * Hook for executing CLI agents and managing their sessions.
 */
export function useCliAgentExecution() {
  const { api } = useAPI();
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [lastResult, setLastResult] = useState<AgentRunResult | null>(null);

  const run = useCallback(
    async (options: {
      slug: string;
      prompt: string;
      cwd: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    }): Promise<AgentRunResult | null> => {
      if (!api || running) return null;
      setRunning(true);
      setLastResult(null);
      try {
        const result = await api.cliAgents.run(options);
        setLastResult(result);
        return result;
      } catch (error) {
        const errorResult: AgentRunResult = {
          sessionId: "",
          success: false,
          output: error instanceof Error ? error.message : "Execution failed",
          durationMs: 0,
        };
        setLastResult(errorResult);
        return errorResult;
      } finally {
        setRunning(false);
      }
    },
    [api, running]
  );

  const stop = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (!api) return false;
      try {
        const result = await api.cliAgents.stop({ sessionId });
        return result.success;
      } catch {
        return false;
      }
    },
    [api]
  );

  const refreshSessions = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.cliAgents.listSessions();
      setSessions(result);
    } catch {
      // Ignore
    }
  }, [api]);

  return { run, stop, running, sessions, refreshSessions, lastResult };
}
