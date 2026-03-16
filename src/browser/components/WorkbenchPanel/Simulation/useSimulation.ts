/**
 * Simulation service hooks for the Simulation tab.
 *
 * Follows the same pattern as Research/useOpenBB.ts:
 * - useSimulationStatus() — subscribes to status changes via oRPC
 * - useSimulationScenarios() — lists existing scenarios
 * - useSimulationRun() — streams live round results
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAPI } from "@/browser/contexts/API";
import type { z } from "zod";
import type {
  SimulationStatusSchema,
  SimulationScenarioSchema,
  SimulationRoundResultSchema,
  CreateScenarioInputSchema,
  SimulationSetupStatusSchema,
} from "@/common/orpc/schemas/api";

export type SimulationStatus = z.infer<typeof SimulationStatusSchema>;
export type SimulationScenario = z.infer<typeof SimulationScenarioSchema>;
export type SimulationRoundResult = z.infer<typeof SimulationRoundResultSchema>;
export type CreateScenarioInput = z.infer<typeof CreateScenarioInputSchema>;
export type SimulationSetupStatus = z.infer<typeof SimulationSetupStatusSchema>;

// ---------------------------------------------------------------------------
// Status hook
// ---------------------------------------------------------------------------

export function useSimulationStatus(): SimulationStatus | null {
  const { api } = useAPI();
  const [status, setStatus] = useState<SimulationStatus | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await (api as any).simulation.getStatus();
        if (!cancelled) setStatus(result as SimulationStatus);
      } catch (err) {
        if (!cancelled) setStatus({ status: "error", message: String(err) });
      }
    }

    async function subscribe() {
      try {
        const stream = await (api as any).simulation.subscribe(
          undefined,
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setStatus(snapshot as SimulationStatus);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Simulation: subscription error:", err);
        }
      }
    }

    void load();
    void subscribe();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api]);

  return status;
}

// ---------------------------------------------------------------------------
// Scenarios hook
// ---------------------------------------------------------------------------

export function useSimulationScenarios() {
  const { api } = useAPI();
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await (api as any).simulation.listScenarios();
      setScenarios(result as SimulationScenario[]);
    } catch (err) {
      console.error("Failed to load scenarios:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { scenarios, loading, refresh };
}

// ---------------------------------------------------------------------------
// Create scenario
// ---------------------------------------------------------------------------

export function useCreateScenario() {
  const { api } = useAPI();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createScenario = useCallback(
    async (input: CreateScenarioInput): Promise<SimulationScenario | null> => {
      if (!api) return null;
      setCreating(true);
      setError(null);
      try {
        const result = await (api as any).simulation.createScenario(input);
        return result as SimulationScenario;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [api],
  );

  return { createScenario, creating, error };
}

// ---------------------------------------------------------------------------
// Run simulation (streaming)
// ---------------------------------------------------------------------------

export function useSimulationRun() {
  const { api } = useAPI();
  const [rounds, setRounds] = useState<SimulationRoundResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (scenarioId: string) => {
      if (!api) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRounds([]);
      setRunning(true);
      setError(null);

      try {
        const stream = await (api as any).simulation.runSimulation(
          { scenarioId },
          { signal: controller.signal },
        );
        for await (const result of stream) {
          if (controller.signal.aborted) break;
          setRounds((prev) => [...prev, result as SimulationRoundResult]);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setRunning(false);
      }
    },
    [api],
  );

  const stop = useCallback(
    async (scenarioId: string) => {
      if (!api) return;
      abortRef.current?.abort();
      try {
        await (api as any).simulation.stopSimulation({ scenarioId });
      } catch {
        // Ignore stop errors
      }
    },
    [api],
  );

  return { rounds, running, error, run, stop };
}

// ---------------------------------------------------------------------------
// Setup / dependency check
// ---------------------------------------------------------------------------

export function useSimulationSetup() {
  const { api } = useAPI();
  const [setup, setSetup] = useState<SimulationSetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [startingFalkorDb, setStartingFalkorDb] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const checkSetup = useCallback(async () => {
    if (!api) return;
    setChecking(true);
    try {
      const result = await (api as any).simulation.checkSetup();
      setSetup(result as SimulationSetupStatus);
    } catch (err) {
      console.error("Simulation setup check failed:", err);
    } finally {
      setChecking(false);
    }
  }, [api]);

  const startFalkorDb = useCallback(async () => {
    if (!api) return;
    setStartingFalkorDb(true);
    setStartError(null);
    try {
      const result = await (api as any).simulation.startFalkorDb();
      if (result?.error) {
        setStartError(result.error);
      } else {
        // Re-check setup after starting
        await checkSetup();
      }
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingFalkorDb(false);
    }
  }, [api, checkSetup]);

  // Auto-check on mount
  useEffect(() => {
    void checkSetup();
  }, [checkSetup]);

  return { setup, checking, checkSetup, startFalkorDb, startingFalkorDb, startError };
}
