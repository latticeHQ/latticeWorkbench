/**
 * BrowserTab — Tab wrapper for the per-minion browser panel.
 *
 * Mirrors the TerminalTab pattern: thin wrapper that renders
 * BrowserView with the correct props.
 */

import React from "react";
import { BrowserView } from "./BrowserView";

interface BrowserTabProps {
  minionId: string;
  visible: boolean;
}

/**
 * Browser tab component that renders the browser view.
 *
 * Unlike terminal tabs (which are multi-instance with session IDs),
 * the browser tab is a single-instance panel per tabset — each minion
 * has at most one browser tab.
 */
export const BrowserTab: React.FC<BrowserTabProps> = ({ minionId, visible }) => {
  return <BrowserView minionId={minionId} visible={visible} />;
};
