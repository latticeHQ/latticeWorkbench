/**
 * Custom Event Constants & Types
 * These are window-level custom events used for cross-component communication
 *
 * Each event has a corresponding type in CustomEventPayloads for type safety
 */

import type { ThinkingLevel } from "@/common/types/thinking";
import type { ReviewNoteDataForDisplay } from "@/common/types/message";
import type { FilePart } from "@/common/orpc/schemas";

export const CUSTOM_EVENTS = {
  /**
   * Event to show a toast notification when thinking level changes
   * Detail: { minionId: string, level: ThinkingLevel }
   */
  THINKING_LEVEL_TOAST: "lattice:thinkingLevelToast",

  /**
   * Event to insert text into the chat input
   * Detail: { text: string, mode?: "replace" | "append", fileParts?: FilePart[], reviews?: ReviewNoteDataForDisplay[] }
   */
  UPDATE_CHAT_INPUT: "lattice:updateChatInput",

  /**
   * Event to open the model selector
   * No detail
   */
  OPEN_MODEL_SELECTOR: "lattice:openModelSelector",

  /**
   * Event to open the agent picker (AgentModePicker)
   * No detail
   */
  OPEN_AGENT_PICKER: "lattice:openAgentPicker",

  /**
   * Event to close the agent picker (AgentModePicker)
   * No detail
   */
  CLOSE_AGENT_PICKER: "lattice:closeAgentPicker",

  /**
   * Event to request a refresh of the agent definition list (AgentContext).
   * No detail.
   */
  AGENTS_REFRESH_REQUESTED: "lattice:agentsRefreshRequested",

  /**
   * Event to switch to a different minion after fork
   * Detail: { minionId: string, projectPath: string, projectName: string, minionPath: string, branch: string }
   */
  MINION_FORK_SWITCH: "lattice:minionForkSwitch",

  /**
   * Event to request AI title regeneration for a minion.
   * Detail: { minionId: string }
   */
  MINION_GENERATE_TITLE_REQUESTED: "lattice:minionGenerateTitleRequested",

  /**
   * Event to execute a command from the command palette
   * Detail: { commandId: string }
   */
  EXECUTE_COMMAND: "lattice:executeCommand",
  /**
   * Event to enter the chat-based minion creation experience.
   * Detail: { projectPath: string, startMessage?: string, model?: string, trunkBranch?: string, runtime?: string }
   */
  START_MINION_CREATION: "lattice:startMinionCreation",

  /**
   * Event to toggle voice input (dictation) mode
   * No detail
   */
  TOGGLE_VOICE_INPUT: "lattice:toggleVoiceInput",

  /**
   * Event to show toast feedback for analytics database rebuild commands.
   * Detail: { type: "success" | "error", message: string, title?: string }
   */
  ANALYTICS_REBUILD_TOAST: "lattice:analyticsRebuildToast",

  /**
   * Event to open the debug LLM request modal
   * No detail
   */
  OPEN_DEBUG_LLM_REQUEST: "lattice:openDebugLlmRequest",
} as const;

/**
 * Payload types for custom events
 * Maps event names to their detail payload structure
 */
export interface CustomEventPayloads {
  [CUSTOM_EVENTS.THINKING_LEVEL_TOAST]: {
    minionId: string;
    level: ThinkingLevel;
  };
  [CUSTOM_EVENTS.UPDATE_CHAT_INPUT]: {
    text: string;
    mode?: "replace" | "append";
    fileParts?: FilePart[];
    reviews?: ReviewNoteDataForDisplay[];
  };
  [CUSTOM_EVENTS.OPEN_AGENT_PICKER]: never; // No payload
  [CUSTOM_EVENTS.CLOSE_AGENT_PICKER]: never; // No payload
  [CUSTOM_EVENTS.AGENTS_REFRESH_REQUESTED]: never; // No payload
  [CUSTOM_EVENTS.OPEN_MODEL_SELECTOR]: never; // No payload
  [CUSTOM_EVENTS.MINION_FORK_SWITCH]: {
    minionId: string;
    projectPath: string;
    projectName: string;
    minionPath: string;
    branch: string;
  };
  [CUSTOM_EVENTS.MINION_GENERATE_TITLE_REQUESTED]: {
    minionId: string;
  };
  [CUSTOM_EVENTS.EXECUTE_COMMAND]: {
    commandId: string;
  };
  [CUSTOM_EVENTS.START_MINION_CREATION]: {
    projectPath: string;
    startMessage?: string;
    model?: string;
    trunkBranch?: string;
    runtime?: string;
  };
  [CUSTOM_EVENTS.TOGGLE_VOICE_INPUT]: never; // No payload
  [CUSTOM_EVENTS.ANALYTICS_REBUILD_TOAST]: {
    type: "success" | "error";
    message: string;
    title?: string;
  };
  [CUSTOM_EVENTS.OPEN_DEBUG_LLM_REQUEST]: never; // No payload
}

/**
 * Type-safe custom event type
 * Usage: CustomEventType<typeof CUSTOM_EVENTS.THINKING_LEVEL_TOAST>
 */
export type CustomEventType<K extends keyof CustomEventPayloads> = CustomEvent<
  CustomEventPayloads[K]
>;

/**
 * Helper to create a typed custom event
 *
 * @example
 * ```typescript
 * const event = createCustomEvent(CUSTOM_EVENTS.THINKING_LEVEL_TOAST, {
 *   minionId: "abc123",
 *   level: "high",
 * });
 * window.dispatchEvent(event);
 * ```
 */
export function createCustomEvent<K extends keyof CustomEventPayloads>(
  eventName: K,
  ...args: CustomEventPayloads[K] extends never ? [] : [detail: CustomEventPayloads[K]]
): CustomEvent<CustomEventPayloads[K]> {
  const [detail] = args;
  return new CustomEvent(eventName, { detail } as CustomEventInit<CustomEventPayloads[K]>);
}

/**
 * Helper to create a storage change event name for a specific key
 * Used by usePersistedState for same-tab synchronization
 */
export const getStorageChangeEvent = (key: string): string => `storage-change:${key}`;
