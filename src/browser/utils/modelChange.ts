import { getModelKey } from "@/common/constants/storage";
import { readPersistedString, updatePersistedState } from "@/browser/hooks/usePersistedState";

export type ModelChangeOrigin = "user" | "agent" | "sync";

interface ExplicitModelChange {
  model: string;
  origin: ModelChangeOrigin;
  previousModel: string | null;
}

// User request: keep origin tracking in-memory so UI-only warnings don't add persistence complexity.
const pendingExplicitChanges = new Map<string, ExplicitModelChange>();

const normalizeExplicitModel = (model: string): string => model.trim();

export function recordMinionModelChange(
  minionId: string,
  model: string,
  origin: ModelChangeOrigin
): void {
  if (origin === "sync") return;

  const normalized = normalizeExplicitModel(model);
  const current = readPersistedString(getModelKey(minionId));
  const normalizedCurrent = current ? normalizeExplicitModel(current) : null;

  // Avoid leaving stale explicit-change entries when the effective model doesn't change
  // (ex: user re-selects the current model).
  // Without this guard, a later sync-driven away→back transition could incorrectly consume the
  // lingering entry and surface a warning that wasn't explicitly triggered.
  if (normalizedCurrent === normalized) {
    return;
  }

  pendingExplicitChanges.set(minionId, {
    model: normalized,
    origin,
    previousModel: normalizedCurrent,
  });
}

export function consumeMinionModelChange(
  minionId: string,
  model: string
): ModelChangeOrigin | null {
  const entry = pendingExplicitChanges.get(minionId);
  if (!entry) return null;

  const normalized = normalizeExplicitModel(model);

  if (entry.model === normalized) {
    pendingExplicitChanges.delete(minionId);
    return entry.origin;
  }

  // If the store reports the model from before the explicit change (e.g., rapid A→B selection
  // where we briefly observe A while tracking B), keep the newest entry.
  if (entry.previousModel === normalized) {
    return null;
  }

  // Model diverged somewhere else; the entry is stale and should not be consumed later.
  pendingExplicitChanges.delete(minionId);
  return null;
}

export function setMinionModelWithOrigin(
  minionId: string,
  model: string,
  origin: ModelChangeOrigin
): void {
  recordMinionModelChange(minionId, model, origin);
  updatePersistedState(getModelKey(minionId), model);
}
