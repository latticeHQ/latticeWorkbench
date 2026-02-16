/**
 * BrowserTab — Live, interactive embedded browser in the right sidebar.
 *
 * Embeds the agent's actual browser session so the user can:
 * - See what the agent is doing in real time
 * - Interact directly (enter credentials, click, type, etc.)
 * - Work collaboratively with the agent on the same browser instance
 *
 * Uses Chromium's remote debugging port to connect a <webview> to the
 * same browser instance that Playwright controls. Both the agent and
 * the human share the same session, cookies, and page state.
 *
 * Falls back to screenshot view when webview is not available
 * (e.g. in non-Electron environments or headless sessions).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe,
  Monitor,
  RefreshCw,
  Play,
  ExternalLink,
  Image as ImageIcon,
  Eye,
} from "lucide-react";
import { cn } from "@/common/lib/utils";
import { useAPI } from "@/browser/contexts/API";

interface BrowserTabProps {
  workspaceId: string;
}

interface SessionInfo {
  id: string;
  workspaceId: string;
  status: string;
  headless: boolean;
  pageCount: number;
  activePageId: string;
  createdAt: number;
  lastActivity: number;
  cdpUrl: string | null;
  debugUrl: string | null;
}

interface Snapshot {
  screenshot: string;
  url: string;
  title: string;
  timestamp: number;
  lastAction: string;
}

interface BrowserState {
  sessions: (SessionInfo | null)[];
  snapshot: Snapshot | null;
  activePageUrl: string | null;
}

/** CDP /json response for a page target */
interface CDPTarget {
  description: string;
  devtoolsFrontendUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export const BrowserTab: React.FC<BrowserTabProps> = ({ workspaceId }) => {
  const { api } = useAPI();
  const [state, setState] = useState<BrowserState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageTargets, setPageTargets] = useState<CDPTarget[]>([]);
  const [viewMode, setViewMode] = useState<"live" | "screenshot">("live");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch session state from backend
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (api as any).browser.state({
        workspaceId,
      })) as BrowserState;
      setState(result);

      // If we have a debug URL, fetch the page list from CDP
      const activeSession = result.sessions?.find((s) => s && s.status === "active" && s.debugUrl);
      if (activeSession?.debugUrl) {
        try {
          const resp = await fetch(`${activeSession.debugUrl}/json`);
          if (resp.ok) {
            const targets = (await resp.json()) as CDPTarget[];
            setPageTargets(targets.filter((t) => t.type === "page"));
          }
        } catch {
          // Debug endpoint may not be reachable from renderer — that's okay
        }
      }
    } catch {
      // Endpoint may not exist yet — not an error
    } finally {
      setLoading(false);
    }
  }, [api, workspaceId]);

  // Poll every 2s
  useEffect(() => {
    void refresh();
    pollRef.current = setInterval(() => void refresh(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const activeSessions = (state?.sessions ?? []).filter(
    (s): s is SessionInfo => s !== null && s.status === "active"
  );
  const hasSession = activeSessions.length > 0;
  const activeSession = activeSessions[0];
  const snapshot = state?.snapshot;
  const debugUrl = activeSession?.debugUrl;

  // Build the DevTools inspector URL for the first page target.
  // This gives us a fully interactive view of the page in a webview.
  const inspectorUrl =
    debugUrl && pageTargets.length > 0
      ? `${debugUrl}/devtools/inspector.html?ws=127.0.0.1:${new URL(debugUrl).port}/devtools/page/${pageTargets[0].id}`
      : null;

  // Direct page URL (what the agent is browsing)
  const pageUrl = pageTargets[0]?.url ?? state?.activePageUrl ?? null;

  // Check if running in Electron (webview available)
  const isElectron = typeof window !== "undefined" && "process" in window;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b-border flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Globe className="text-muted h-3.5 w-3.5" />
          <span className="text-foreground text-xs font-semibold">Browser</span>
          {hasSession && (
            <span className="inline-flex items-center rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Toggle view mode */}
          {hasSession && snapshot?.screenshot && (
            <button
              type="button"
              className={cn(
                "rounded p-0.5 transition-colors",
                viewMode === "screenshot"
                  ? "bg-muted text-foreground"
                  : "text-muted hover:text-foreground"
              )}
              onClick={() => setViewMode((m) => (m === "live" ? "screenshot" : "live"))}
              title={
                viewMode === "live"
                  ? "Switch to screenshot view"
                  : "Switch to live interactive view"
              }
            >
              {viewMode === "live" ? (
                <ImageIcon className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
            </button>
          )}
          <button
            type="button"
            className="text-muted hover:text-foreground rounded p-0.5 transition-colors"
            onClick={() => void refresh()}
            title="Refresh"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {/* No session yet */}
        {!hasSession && (
          <div className="text-muted flex flex-col items-center justify-center gap-3 p-3 py-8 text-center">
            <Monitor className="h-10 w-10 opacity-30" />
            <div className="space-y-1.5">
              <p className="text-foreground text-xs font-medium">Embedded Browser</p>
              <p className="max-w-[220px] text-[10px] leading-relaxed opacity-70">
                The agent will launch a browser when it uses the{" "}
                <code className="bg-muted rounded px-1 py-0.5 text-[9px]">browser</code> tool. A
                live interactive view will appear here.
              </p>
              <p className="max-w-[220px] text-[10px] leading-relaxed opacity-70">
                You can interact with the browser directly — enter credentials, click, scroll —
                while the agent also controls it.
              </p>
            </div>

            <div className="mt-2 w-full max-w-[260px] space-y-2">
              <div className="rounded border border-white/5 p-2.5 text-left">
                <p className="text-[9px] font-semibold uppercase tracking-wider opacity-50">
                  Capabilities
                </p>
                <ul className="mt-1.5 space-y-1 text-[10px] leading-relaxed opacity-70">
                  <li>
                    <strong>Shared session</strong> — you &amp; the agent use the same browser
                  </li>
                  <li>
                    <strong>Enter credentials</strong> — log in, then let the agent work
                  </li>
                  <li>Navigate, click, type, scroll, screenshot</li>
                  <li>Multi-tab support, session isolation</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Live session */}
        {hasSession && (
          <div className="flex h-full flex-col">
            {/* URL bar */}
            <div className="flex items-center gap-1.5 border-b border-white/5 bg-muted/50 px-2.5 py-1.5">
              <Globe className="text-muted h-3 w-3 shrink-0" />
              <span className="flex-1 truncate font-mono text-[10px] text-foreground">
                {pageUrl ?? snapshot?.url ?? "about:blank"}
              </span>
              {debugUrl && (
                <button
                  type="button"
                  className="text-muted hover:text-foreground shrink-0 p-0.5"
                  onClick={() => {
                    if (inspectorUrl) {
                      window.open(inspectorUrl, "_blank");
                    }
                  }}
                  title="Open in external browser"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Interactive webview (live mode) — Electron only */}
            {viewMode === "live" && inspectorUrl && isElectron && (
              <div className="relative flex-1">
                {/*
                 * Electron <webview> embeds the Chrome DevTools inspector,
                 * which shows the actual page with full interactivity.
                 * The user can click, type, scroll — and the agent sees
                 * the same page state via Playwright.
                 */}
                <webview
                  src={inspectorUrl}
                  className="h-full w-full"
                  style={{ display: "flex", flex: 1, minHeight: 0 }}
                  allowpopups
                />
              </div>
            )}

            {/* iframe fallback for non-Electron */}
            {viewMode === "live" && inspectorUrl && !isElectron && (
              <div className="relative flex-1">
                <iframe
                  src={inspectorUrl}
                  className="h-full w-full border-none"
                  title="Browser Inspector"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            )}

            {/* Screenshot fallback (when no debug URL or screenshot mode) */}
            {(viewMode === "screenshot" || !inspectorUrl) && viewMode !== "live" && (
              <>
                {snapshot?.screenshot ? (
                  <div className="relative flex-1 overflow-auto">
                    <img
                      src={`data:image/png;base64,${snapshot.screenshot}`}
                      alt={snapshot.title || "Browser view"}
                      className="w-full"
                      style={{ imageRendering: "auto" }}
                    />
                    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-background/80 px-2 py-1 backdrop-blur-sm">
                      <span className="max-w-[60%] truncate text-[9px] font-medium text-foreground">
                        {snapshot.title}
                      </span>
                      <div className="flex items-center gap-2 text-[9px]">
                        <span className="text-muted">{snapshot.lastAction}</span>
                        <span className="text-muted">{formatRelativeTime(snapshot.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
                    <Play className="h-5 w-5 opacity-30" />
                    <p className="text-[10px]">Session active — waiting for agent to navigate...</p>
                  </div>
                )}
              </>
            )}

            {/* Waiting state — live mode but no inspector URL yet */}
            {viewMode === "live" && !inspectorUrl && (
              <div className="text-muted flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                {snapshot?.screenshot ? (
                  <>
                    <img
                      src={`data:image/png;base64,${snapshot.screenshot}`}
                      alt={snapshot.title || "Browser view"}
                      className="w-full rounded"
                      style={{ imageRendering: "auto" }}
                    />
                    <p className="mt-1 text-[9px] opacity-60">
                      Screenshot view — waiting for CDP connection...
                    </p>
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 opacity-30" />
                    <p className="text-[10px]">Session active — waiting for agent to navigate...</p>
                    {debugUrl && <p className="mt-1 text-[9px] opacity-50">Debug: {debugUrl}</p>}
                  </>
                )}
              </div>
            )}

            {/* Session info strip */}
            <div className="flex flex-wrap gap-3 border-t border-white/5 px-2.5 py-1.5 text-[9px]">
              {activeSessions.map((s) => (
                <div key={s.id} className="text-muted flex items-center gap-2">
                  <span>
                    Tabs: <span className="font-medium text-foreground">{s.pageCount}</span>
                  </span>
                  <span>
                    Mode:{" "}
                    <span className="font-medium text-foreground">
                      {s.headless ? "Headless" : "Interactive"}
                    </span>
                  </span>
                  {s.debugUrl && <span className="font-medium text-emerald-400">CDP</span>}
                  <span>{formatRelativeTime(s.lastActivity)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3600_000)}h ago`;
}
