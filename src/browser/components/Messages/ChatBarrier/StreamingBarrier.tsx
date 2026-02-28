import React from "react";
import { StreamingBarrierView } from "./StreamingBarrierView";
import { getModelName } from "@/common/utils/ai/models";
import { formatKeybind, KEYBINDS } from "@/browser/utils/ui/keybinds";
import {
  VIM_ENABLED_KEY,
  getModelKey,
  PREFERRED_COMPACTION_MODEL_KEY,
} from "@/common/constants/storage";
import { readPersistedState, readPersistedString } from "@/browser/hooks/usePersistedState";
import {
  useMinionState,
  useMinionAggregator,
  useMinionStoreRaw,
} from "@/browser/stores/MinionStore";
import { getDefaultModel } from "@/browser/hooks/useModelsFromSettings";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useAPI } from "@/browser/contexts/API";

type StreamingPhase =
  | "starting" // Message sent, waiting for stream-start
  | "interrupting" // User triggered interrupt, waiting for stream-abort
  | "streaming" // Normal streaming
  | "compacting" // Compaction in progress
  | "awaiting-input"; // ask_user_question waiting for response

interface StreamingBarrierProps {
  minionId: string;
  className?: string;
  /**
   * Optional vim state from parent subscription.
   * Falls back to persisted value when omitted.
   */
  vimEnabled?: boolean;
  /**
   * Optional compaction-specific cancel hook.
   * When provided, this path should preserve compaction edit state + follow-up content.
   */
  onCancelCompaction?: () => void;
}

/**
 * Self-contained streaming status barrier.
 * Computes streaming state internally from minionId.
 * Returns null when there's nothing to show.
 */
export const StreamingBarrier: React.FC<StreamingBarrierProps> = ({
  minionId,
  className,
  vimEnabled: vimEnabledFromParent,
  onCancelCompaction,
}) => {
  const minionState = useMinionState(minionId);
  const aggregator = useMinionAggregator(minionId);
  const storeRaw = useMinionStoreRaw();
  const { api } = useAPI();
  const { open: openSettings } = useSettings();

  const {
    canInterrupt,
    isCompacting,
    awaitingUserQuestion,
    currentModel,
    pendingStreamStartTime,
    pendingStreamModel,
    runtimeStatus,
  } = minionState;

  // Determine if we're in "starting" phase (message sent, waiting for stream-start)
  const isStarting = pendingStreamStartTime !== null && !canInterrupt;

  // Compute streaming phase
  const phase: StreamingPhase | null = (() => {
    if (isStarting) return "starting";
    if (!canInterrupt) return null;
    if (aggregator?.hasInterruptingStream()) return "interrupting";
    if (awaitingUserQuestion) return "awaiting-input";
    if (isCompacting) return "compacting";
    return "streaming";
  })();

  // Only show token count during active streaming/compacting
  const showTokenCount = phase === "streaming" || phase === "compacting";

  // Get live streaming stats from minion state (updated on each stream-delta)
  const tokenCount = showTokenCount ? minionState.streamingTokenCount : undefined;
  const tps = showTokenCount ? minionState.streamingTPS : undefined;

  // Nothing to show
  if (!phase) return null;

  // Model to display:
  // - "starting" phase: prefer pendingStreamModel (from latticeMetadata), then localStorage
  // - Otherwise: use currentModel from active stream
  const model =
    phase === "starting"
      ? (pendingStreamModel ??
        readPersistedState<string | null>(getModelKey(minionId), null) ??
        getDefaultModel())
      : currentModel;
  const modelName = model ? getModelName(model) : null;

  // Prefer parent vim state (subscribed in ChatPane) so the hint updates immediately.
  const vimEnabled = vimEnabledFromParent ?? readPersistedState(VIM_ENABLED_KEY, false);
  const interruptKeybind = formatKeybind(
    vimEnabled ? KEYBINDS.INTERRUPT_STREAM_VIM : KEYBINDS.INTERRUPT_STREAM_NORMAL
  ).replace("Escape", "Esc");
  const interruptHint = `hit ${interruptKeybind} to cancel`;

  // Compute status text based on phase
  const statusText = (() => {
    switch (phase) {
      case "starting":
        // Show a runtime-specific message if the minion is still booting (e.g., Lattice/devcontainers).
        if (runtimeStatus?.phase === "starting" || runtimeStatus?.phase === "waiting") {
          return runtimeStatus.detail ?? "Starting minion...";
        }
        return modelName ? `${modelName} starting...` : "starting...";
      case "interrupting":
        return "interrupting...";
      case "awaiting-input":
        return "Awaiting your input...";
      case "compacting":
        return modelName ? `${modelName} compacting...` : "compacting...";
      case "streaming":
        return modelName ? `${modelName} streaming...` : "streaming...";
    }
  })();

  // Compute cancel hint based on phase
  const cancelText = (() => {
    switch (phase) {
      case "interrupting":
        return "";
      case "awaiting-input":
        return "type a message to respond";
      case "starting":
      case "compacting":
      case "streaming":
        return interruptHint;
    }
  })();

  const canTapCancel = phase === "starting" || phase === "streaming" || phase === "compacting";
  const handleCancelClick = () => {
    if (!api) {
      return;
    }

    if (phase !== "starting" && phase !== "streaming" && phase !== "compacting") {
      return;
    }

    void api.minion.setAutoRetryEnabled?.({ minionId, enabled: false });

    if (phase === "compacting") {
      // Reuse the established compaction-cancel flow from keyboard shortcuts so we keep
      // edit restoration + follow-up content behavior consistent across input methods.
      if (onCancelCompaction) {
        onCancelCompaction();
        return;
      }

      void api.minion.interruptStream({
        minionId,
        options: { abandonPartial: true },
      });
      return;
    }

    if (phase === "streaming") {
      storeRaw.setInterrupting(minionId);
    }

    void api.minion.interruptStream({ minionId });
  };

  // Show settings hint during compaction if no custom compaction model is configured
  const showCompactionHint =
    phase === "compacting" && !readPersistedString(PREFERRED_COMPACTION_MODEL_KEY);

  return (
    <StreamingBarrierView
      statusText={statusText}
      tokenCount={tokenCount}
      tps={tps}
      cancelText={cancelText}
      onCancel={canTapCancel ? handleCancelClick : undefined}
      cancelShortcutText={canTapCancel ? interruptKeybind : undefined}
      className={className}
      hintElement={
        showCompactionHint ? (
          <button
            onClick={() => openSettings("models")}
            className="text-muted hover:text-foreground text-[10px] underline decoration-dotted underline-offset-2"
          >
            configure
          </button>
        ) : undefined
      }
    />
  );
};
