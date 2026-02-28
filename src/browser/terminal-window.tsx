/**
 * Terminal Window Entry Point
 *
 * Separate entry point for pop-out terminal windows.
 * Each window connects to a terminal session via WebSocket.
 */

import ReactDOM from "react-dom/client";
import { TerminalView } from "@/browser/components/TerminalView";
import { APIProvider, useAPI } from "@/browser/contexts/API";
import { TerminalRouterProvider } from "@/browser/terminal/TerminalRouterContext";
import "./styles/globals.css";

function TerminalWindowContent(props: { minionId: string; sessionId: string }) {
  const { api } = useAPI();

  return (
    <TerminalView
      minionId={props.minionId}
      sessionId={props.sessionId}
      visible={true}
      onExit={() => {
        api?.terminal.closeWindow({ minionId: props.minionId }).catch((err) => {
          console.warn("[TerminalWindow] Failed to close terminal window:", err);
        });
      }}
    />
  );
}

// Get minion ID from query parameter
const params = new URLSearchParams(window.location.search);
const minionId = params.get("minionId");
const sessionId = params.get("sessionId");

if (!minionId || !sessionId) {
  document.body.innerHTML = `
    <div style="color: #f44; padding: 20px; font-family: monospace;">
      Error: Missing minion ID or session ID
    </div>
  `;
} else {
  document.title = `Terminal — ${minionId}`;

  // Don't use StrictMode for terminal windows to avoid double-mounting issues
  // StrictMode intentionally double-mounts components in dev, which causes
  // race conditions with WebSocket connections and terminal lifecycle
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <APIProvider>
      <TerminalRouterProvider>
        <TerminalWindowContent minionId={minionId} sessionId={sessionId} />
      </TerminalRouterProvider>
    </APIProvider>
  );
}
