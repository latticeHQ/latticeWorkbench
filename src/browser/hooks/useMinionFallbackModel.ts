import { usePersistedState } from "./usePersistedState";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";
import { DEFAULT_MODEL_KEY, getModelKey } from "@/common/constants/storage";

/**
 * Resolves the effective model for a minion by combining the global default
 * model preference with the minion-scoped preference.
 *
 * This subscribes to both storage keys with `{ listener: true }` so changes
 * (including backend-seeded values on fresh origins) propagate immediately.
 */
export function useMinionFallbackModel(minionId: string): string {
  // Subscribe to the global default model preference so backend-seeded values
  // apply immediately on fresh origins (e.g., when switching ports).
  const [defaultModelPref] = usePersistedState<string>(
    DEFAULT_MODEL_KEY,
    MINION_DEFAULTS.model,
    {
      listener: true,
    }
  );
  const defaultModel = defaultModelPref.trim() || MINION_DEFAULTS.model;

  // Minion-scoped model preference. If unset, fall back to the global default model.
  // Note: we intentionally *don't* pass defaultModel as the usePersistedState initialValue;
  // initialValue is sticky and would lock in the fallback before startup seeding.
  const [preferredModel] = usePersistedState<string | null>(getModelKey(minionId), null, {
    listener: true,
  });

  if (typeof preferredModel === "string" && preferredModel.trim().length > 0) {
    return preferredModel.trim();
  }
  return defaultModel;
}
