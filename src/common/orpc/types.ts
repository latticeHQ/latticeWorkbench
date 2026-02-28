import type { z } from "zod";
import type * as schemas from "./schemas";
import type {
  OnChatCursorSchema,
  OnChatHistoryCursorSchema,
  OnChatModeSchema,
  OnChatStreamCursorSchema,
} from "./schemas/stream";

import type {
  StreamStartEvent,
  StreamDeltaEvent,
  StreamEndEvent,
  StreamAbortEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  BashOutputEvent,
  TaskCreatedEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  UsageDeltaEvent,
  RuntimeStatusEvent,
} from "@/common/types/stream";

export type BranchListResult = z.infer<typeof schemas.BranchListResultSchema>;
export type SendMessageOptions = z.infer<typeof schemas.SendMessageOptionsSchema>;

// Provider types (single source of truth - derived from schemas)
export type AWSCredentialStatus = z.infer<typeof schemas.AWSCredentialStatusSchema>;
export type ProviderModelEntry = z.infer<typeof schemas.ProviderModelEntrySchema>;
export type ProviderConfigInfo = z.infer<typeof schemas.ProviderConfigInfoSchema>;
export type ProvidersConfigMap = z.infer<typeof schemas.ProvidersConfigMapSchema>;
export type FilePart = z.infer<typeof schemas.FilePartSchema>;
export type MinionChatMessage = z.infer<typeof schemas.MinionChatMessageSchema>;
export type CaughtUpMessage = z.infer<typeof schemas.CaughtUpMessageSchema>;
export type OnChatHistoryCursor = z.infer<typeof OnChatHistoryCursorSchema>;
export type OnChatStreamCursor = z.infer<typeof OnChatStreamCursorSchema>;
export type OnChatCursor = z.infer<typeof OnChatCursorSchema>;
export type OnChatMode = z.infer<typeof OnChatModeSchema>;
export type StreamErrorMessage = z.infer<typeof schemas.StreamErrorMessageSchema>;
export type DeleteMessage = z.infer<typeof schemas.DeleteMessageSchema>;
export type MinionInitEvent = z.infer<typeof schemas.MinionInitEventSchema>;
export type UpdateStatus = z.infer<typeof schemas.UpdateStatusSchema>;
export type ChatLatticeMessage = z.infer<typeof schemas.ChatLatticeMessageSchema>;
export type MinionStatsSnapshot = z.infer<typeof schemas.MinionStatsSnapshotSchema>;
export type MinionActivitySnapshot = z.infer<typeof schemas.MinionActivitySnapshotSchema>;
export type FrontendMinionMetadataSchemaType = z.infer<
  typeof schemas.FrontendMinionMetadataSchema
>;

// Server types (single source of truth - derived from schemas)
export type ApiServerStatus = z.infer<typeof schemas.ApiServerStatusSchema>;
export type ServerAuthSession = z.infer<typeof schemas.ServerAuthSessionSchema>;
// Experiment types (single source of truth - derived from schemas)

// Policy types (single source of truth - derived from schemas)
export type PolicyGetResponse = z.infer<typeof schemas.PolicyGetResponseSchema>;
export type PolicyStatus = z.infer<typeof schemas.PolicyStatusSchema>;
export type PolicySource = z.infer<typeof schemas.PolicySourceSchema>;
export type EffectivePolicy = z.infer<typeof schemas.EffectivePolicySchema>;
export type PolicyRuntimeId = z.infer<typeof schemas.PolicyRuntimeIdSchema>;
export type ExperimentValue = z.infer<typeof schemas.ExperimentValueSchema>;

// Type guards for common chat message variants
export function isCaughtUpMessage(msg: MinionChatMessage): msg is CaughtUpMessage {
  return (msg as { type?: string }).type === "caught-up";
}

export function isStreamError(msg: MinionChatMessage): msg is StreamErrorMessage {
  return (msg as { type?: string }).type === "stream-error";
}

export function isDeleteMessage(msg: MinionChatMessage): msg is DeleteMessage {
  return (msg as { type?: string }).type === "delete";
}

export function isStreamStart(msg: MinionChatMessage): msg is StreamStartEvent {
  return (msg as { type?: string }).type === "stream-start";
}

export function isStreamDelta(msg: MinionChatMessage): msg is StreamDeltaEvent {
  return (msg as { type?: string }).type === "stream-delta";
}

export function isStreamEnd(msg: MinionChatMessage): msg is StreamEndEvent {
  return (msg as { type?: string }).type === "stream-end";
}

export function isStreamAbort(msg: MinionChatMessage): msg is StreamAbortEvent {
  return (msg as { type?: string }).type === "stream-abort";
}

export function isToolCallStart(msg: MinionChatMessage): msg is ToolCallStartEvent {
  return (msg as { type?: string }).type === "tool-call-start";
}

export function isToolCallDelta(msg: MinionChatMessage): msg is ToolCallDeltaEvent {
  return (msg as { type?: string }).type === "tool-call-delta";
}

export function isBashOutputEvent(msg: MinionChatMessage): msg is BashOutputEvent {
  return (msg as { type?: string }).type === "bash-output";
}

export function isTaskCreatedEvent(msg: MinionChatMessage): msg is TaskCreatedEvent {
  return (msg as { type?: string }).type === "task-created";
}
export function isToolCallEnd(msg: MinionChatMessage): msg is ToolCallEndEvent {
  return (msg as { type?: string }).type === "tool-call-end";
}

export function isReasoningDelta(msg: MinionChatMessage): msg is ReasoningDeltaEvent {
  return (msg as { type?: string }).type === "reasoning-delta";
}

export function isReasoningEnd(msg: MinionChatMessage): msg is ReasoningEndEvent {
  return (msg as { type?: string }).type === "reasoning-end";
}

export function isUsageDelta(msg: MinionChatMessage): msg is UsageDeltaEvent {
  return (msg as { type?: string }).type === "usage-delta";
}

export function isLatticeMessage(msg: MinionChatMessage): msg is ChatLatticeMessage {
  return (msg as { type?: string }).type === "message";
}

export function isInitStart(
  msg: MinionChatMessage
): msg is Extract<MinionInitEvent, { type: "init-start" }> {
  return (msg as { type?: string }).type === "init-start";
}

export function isInitOutput(
  msg: MinionChatMessage
): msg is Extract<MinionInitEvent, { type: "init-output" }> {
  return (msg as { type?: string }).type === "init-output";
}

export function isInitEnd(
  msg: MinionChatMessage
): msg is Extract<MinionInitEvent, { type: "init-end" }> {
  return (msg as { type?: string }).type === "init-end";
}

export function isQueuedMessageChanged(
  msg: MinionChatMessage
): msg is Extract<MinionChatMessage, { type: "queued-message-changed" }> {
  return (msg as { type?: string }).type === "queued-message-changed";
}

export function isRestoreToInput(
  msg: MinionChatMessage
): msg is Extract<MinionChatMessage, { type: "restore-to-input" }> {
  return (msg as { type?: string }).type === "restore-to-input";
}

export function isRuntimeStatus(msg: MinionChatMessage): msg is RuntimeStatusEvent {
  return (msg as { type?: string }).type === "runtime-status";
}
