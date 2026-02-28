import { useCallback } from "react";
import {
  trackMinionCreated,
  trackMinionSwitched,
  trackMessageSent,
  trackStatsTabOpened,
  trackStreamCompleted,
  trackProviderConfigured,
  trackCommandUsed,
  trackVoiceTranscription,
  trackErrorOccurred,
  trackExperimentOverridden,
} from "@/common/telemetry";
import type {
  ErrorContext,
  TelemetryRuntimeType,
  TelemetryThinkingLevel,
  TelemetryCommandType,
} from "@/common/telemetry/payload";

/**
 * Hook for clean telemetry integration in React components
 *
 * Provides stable callback references for telemetry tracking.
 * All numeric values are automatically rounded for privacy.
 *
 * Usage:
 *
 * ```tsx
 * const telemetry = useTelemetry();
 *
 * telemetry.minionSwitched(fromId, toId);
 * telemetry.minionCreated(minionId, runtimeType);
 * telemetry.messageSent(minionId, model, agentId, messageLength, runtimeType, thinkingLevel);
 * telemetry.streamCompleted(model, wasInterrupted, durationSecs, outputTokens);
 * telemetry.providerConfigured(provider, keyType);
 * telemetry.commandUsed(commandType);
 * telemetry.voiceTranscription(audioDurationSecs, success);
 * telemetry.errorOccurred(errorType, context);
 * telemetry.experimentOverridden(experimentId, assignedVariant, userChoice);
 * ```
 */
export function useTelemetry() {
  const minionSwitched = useCallback((fromMinionId: string, toMinionId: string) => {
    trackMinionSwitched(fromMinionId, toMinionId);
  }, []);

  const minionCreated = useCallback((minionId: string, runtimeType: TelemetryRuntimeType) => {
    trackMinionCreated(minionId, runtimeType);
  }, []);

  const messageSent = useCallback(
    (
      minionId: string,
      model: string,
      agentId: string,
      messageLength: number,
      runtimeType: TelemetryRuntimeType,
      thinkingLevel: TelemetryThinkingLevel
    ) => {
      trackMessageSent(minionId, model, agentId, messageLength, runtimeType, thinkingLevel);
    },
    []
  );

  const statsTabOpened = useCallback(
    (viewMode: "session" | "last-request", showModeBreakdown: boolean) => {
      trackStatsTabOpened(viewMode, showModeBreakdown);
    },
    []
  );
  const streamCompleted = useCallback(
    (model: string, wasInterrupted: boolean, durationSecs: number, outputTokens: number) => {
      trackStreamCompleted(model, wasInterrupted, durationSecs, outputTokens);
    },
    []
  );

  const providerConfigured = useCallback((provider: string, keyType: string) => {
    trackProviderConfigured(provider, keyType);
  }, []);

  const commandUsed = useCallback((command: TelemetryCommandType) => {
    trackCommandUsed(command);
  }, []);

  const voiceTranscription = useCallback((audioDurationSecs: number, success: boolean) => {
    trackVoiceTranscription(audioDurationSecs, success);
  }, []);

  const errorOccurred = useCallback((errorType: string, context: ErrorContext) => {
    trackErrorOccurred(errorType, context);
  }, []);

  const experimentOverridden = useCallback(
    (experimentId: string, assignedVariant: string | boolean | null, userChoice: boolean) => {
      trackExperimentOverridden(experimentId, assignedVariant, userChoice);
    },
    []
  );

  return {
    minionSwitched,
    minionCreated,
    messageSent,
    statsTabOpened,
    streamCompleted,
    providerConfigured,
    commandUsed,
    voiceTranscription,
    errorOccurred,
    experimentOverridden,
  };
}
