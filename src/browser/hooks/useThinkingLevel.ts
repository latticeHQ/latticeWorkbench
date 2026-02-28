import { useThinking } from "@/browser/contexts/ThinkingContext";

/**
 * Custom hook for thinking level state.
 * Must be used within a ThinkingProvider (typically at minion level).
 *
 * @returns [thinkingLevel, setThinkingLevel] tuple
 */
export function useThinkingLevel() {
  const { thinkingLevel, setThinkingLevel } = useThinking();
  return [thinkingLevel, setThinkingLevel] as const;
}
