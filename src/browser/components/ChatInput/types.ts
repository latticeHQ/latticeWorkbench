import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { TelemetryRuntimeType } from "@/common/telemetry/payload";
import type { Review } from "@/common/types/review";
import type { EditingMessageState, PendingUserMessage } from "@/browser/utils/chatEditing";

export interface ChatInputAPI {
  focus: () => void;
  send: () => Promise<void>;
  restoreText: (text: string) => void;
  restoreDraft: (pending: PendingUserMessage) => void;
  appendText: (text: string) => void;
  prependText: (text: string) => void;
}

export interface MinionCreatedOptions {
  /** When false, register metadata without navigating to the new minion. */
  autoNavigate?: boolean;
}

// Minion variant: full functionality for existing minions
export interface ChatInputMinionVariant {
  variant: "minion";
  minionId: string;
  /** Runtime type for the minion (for telemetry) - no sensitive details like SSH host */
  runtimeType?: TelemetryRuntimeType;
  onMessageSent?: () => void;
  onTruncateHistory: (percentage?: number) => Promise<void>;
  onModelChange?: (model: string) => void;
  isCompacting?: boolean;
  isStreamStarting?: boolean;
  editingMessage?: EditingMessageState;
  onCancelEdit?: () => void;
  onEditLastUserMessage?: () => void;
  canInterrupt?: boolean;
  disabled?: boolean;
  /** Optional explanation displayed when input is disabled */
  disabledReason?: string;
  onReady?: (api: ChatInputAPI) => void;
  /** Reviews currently attached to chat (from useReviews hook) */
  attachedReviews?: Review[];
  /** Detach a review from chat input (sets status to pending) */
  onDetachReview?: (reviewId: string) => void;
  /** Detach all attached reviews from chat input */
  onDetachAllReviews?: () => void;
  /** Mark a single review as checked (completed) */
  onCheckReview?: (reviewId: string) => void;
  /** Mark multiple reviews as checked after sending */
  onCheckReviews?: (reviewIds: string[]) => void;
  /** Permanently delete a review */
  onDeleteReview?: (reviewId: string) => void;
  /** Update a review's comment/note */
  onUpdateReviewNote?: (reviewId: string, newNote: string) => void;
}

// Creation variant: simplified for first message / minion creation
export interface ChatInputCreationVariant {
  variant: "creation";
  projectPath: string;
  projectName: string;
  /** Crew ID to pre-select (from sidebar crew "+" button) */
  pendingSectionId?: string | null;
  /** Draft ID for UI-only minion creation drafts (from URL) */
  pendingDraftId?: string | null;
  onMinionCreated: (
    metadata: FrontendMinionMetadata,
    options?: MinionCreatedOptions
  ) => void;
  onModelChange?: (model: string) => void;
  disabled?: boolean;
  onReady?: (api: ChatInputAPI) => void;
}

export type ChatInputProps = ChatInputMinionVariant | ChatInputCreationVariant;
