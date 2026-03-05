import React from "react";
import { Loader2 } from "lucide-react";
import { TerminalView } from "@/browser/components/TerminalView";
import type { TabType } from "@/browser/types/workbenchPanel";
import { getTerminalSessionId } from "@/browser/types/workbenchPanel";

interface TerminalTabProps {
  minionId: string;
  /** The tab type (e.g., "terminal:ws-123-1704567890") */
  tabType: TabType;
  visible: boolean;
  /** Called when terminal title changes (from shell OSC sequences) */
  onTitleChange?: (title: string) => void;
  /** Whether to auto-focus the terminal when it becomes visible (e.g., when opened via keybind) */
  autoFocus?: boolean;
  /** Called when autoFocus has been consumed (to clear the parent state) */
  onAutoFocusConsumed?: () => void;
  /** Called when the terminal session exits. */
  onExit?: () => void;
}

/**
 * Terminal tab component that renders a terminal view.
 *
 * Session ID is extracted directly from the tabType ("terminal:<sessionId>").
 * Sessions are created by WorkbenchPanel before adding the tab, so tabType
 * always contains a valid sessionId (never the placeholder "terminal").
 *
 * When the tab type is a bare "terminal" placeholder (no session yet), this
 * component shows a loading spinner while the promotion effect in
 * WorkbenchPanel creates the backend session and swaps in the real tab type.
 */
export const TerminalTab: React.FC<TerminalTabProps> = (props) => {
  // Extract session ID from tab type - must exist (sessions created before tab added)
  const sessionId = getTerminalSessionId(props.tabType);

  if (!sessionId) {
    // Bare "terminal" placeholder is being promoted to a real session by the
    // WorkbenchPanel promotion effect. Show a loading spinner instead of an
    // error so the user sees a smooth transition.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-xs">Starting terminal…</span>
      </div>
    );
  }

  return (
    <TerminalView
      minionId={props.minionId}
      sessionId={sessionId}
      visible={props.visible}
      setDocumentTitle={false}
      onTitleChange={props.onTitleChange}
      onAutoFocusConsumed={props.onAutoFocusConsumed}
      autoFocus={props.autoFocus ?? false}
      onExit={props.onExit}
    />
  );
};
