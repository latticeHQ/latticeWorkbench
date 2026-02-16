import type { LatticeMessage } from "../../../src/common/types/message";

export interface SharedConversationMetadata {
  workspaceId?: string;
  projectName?: string;
  model?: string;
  exportedAt: number;
  totalTokens?: number;
  sharedBy?: string;
}

/**
 * Conversation format stored in openagent.md (client-side encrypted).
 *
 * NOTE: This intentionally stores raw LatticeMessage[] so that openagent.md can render
 * conversations using the same transformation + UI components as Lattice.
 */
export interface SharedConversation {
  version: 1;
  messages: LatticeMessage[];
  metadata: SharedConversationMetadata;
}
