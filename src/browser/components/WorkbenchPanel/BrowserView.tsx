/**
 * BrowserView — Main browser panel for a minion.
 *
 * Displays the minion's headless browser session with:
 * - URL bar for navigation
 * - Toolbar with back/forward/refresh/screenshot/snapshot actions
 * - Dual view mode: Screenshot (visual) or Accessibility Tree
 * - Empty state when no session is active
 *
 * All API calls go through the oRPC browser routes added in Phase 1.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Globe,
  Loader2,
  RefreshCw,
  TreeDeciduous,
  X,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";
import type { BrowserActionResult, BrowserSessionInfo } from "@/common/types/browser";

type ViewMode = "screenshot" | "tree";

interface BrowserViewProps {
  minionId: string;
  visible: boolean;
}

export const BrowserView: React.FC<BrowserViewProps> = ({ minionId, visible }) => {
  const { api } = useAPI();

  // ── State ──────────────────────────────────────────────────────────────
  const [sessionInfo, setSessionInfo] = useState<BrowserSessionInfo | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [snapshotRaw, setSnapshotRaw] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("screenshot");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Session polling ────────────────────────────────────────────────────
  const fetchSessionInfo = useCallback(async () => {
    if (!api) return;
    try {
      const info = await api.browser.sessionInfo({ minionId });
      setSessionInfo(info);
      if (info?.url) {
        setUrlInput(info.url);
      }
    } catch {
      setSessionInfo(null);
    }
  }, [api, minionId]);

  // Poll session info when visible
  useEffect(() => {
    if (!visible || !api) return;
    fetchSessionInfo();
    const interval = setInterval(fetchSessionInfo, 5000);
    return () => clearInterval(interval);
  }, [visible, api, fetchSessionInfo]);

  // ── Navigation ─────────────────────────────────────────────────────────
  const handleNavigate = useCallback(
    async (url?: string) => {
      if (!api) return;
      const targetUrl = url ?? urlInput.trim();
      if (!targetUrl) return;

      // Auto-prefix with https:// if no protocol
      const normalizedUrl =
        targetUrl.startsWith("http://") || targetUrl.startsWith("https://")
          ? targetUrl
          : `https://${targetUrl}`;

      setIsLoading(true);
      setError(null);
      try {
        const result: BrowserActionResult = await api.browser.navigate({
          minionId,
          url: normalizedUrl,
        });
        if (result.success) {
          setUrlInput(normalizedUrl);
          setSessionInfo((prev) =>
            prev ? { ...prev, url: normalizedUrl } : { minionId, sessionName: "", url: normalizedUrl, isActive: true }
          );
          // Auto-take a screenshot after navigating
          await handleScreenshot();
        } else {
          setError(result.error ?? "Navigation failed");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Navigation failed");
      } finally {
        setIsLoading(false);
      }
    },
    [api, minionId, urlInput]
  );

  const handleBack = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      await api.browser.back({ minionId });
      await fetchSessionInfo();
      await handleScreenshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Back navigation failed");
    } finally {
      setIsLoading(false);
    }
  }, [api, minionId, fetchSessionInfo]);

  const handleForward = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      await api.browser.forward({ minionId });
      await fetchSessionInfo();
      await handleScreenshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forward navigation failed");
    } finally {
      setIsLoading(false);
    }
  }, [api, minionId, fetchSessionInfo]);

  // ── Screenshot ─────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.browser.screenshot({ minionId });
      if (result.success && result.screenshot) {
        setScreenshotBase64(result.screenshot.base64);
        setViewMode("screenshot");
      }
    } catch {
      // Silently fail for auto-screenshots; user can retry manually
    }
  }, [api, minionId]);

  // ── Snapshot ───────────────────────────────────────────────────────────
  const handleSnapshot = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      const result = await api.browser.snapshot({ minionId });
      if (result.success && result.snapshot) {
        setSnapshotRaw(result.snapshot.raw);
        setViewMode("tree");
      } else {
        setError(result.error ?? "Snapshot failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot failed");
    } finally {
      setIsLoading(false);
    }
  }, [api, minionId]);

  // ── Close session ──────────────────────────────────────────────────────
  const handleClose = useCallback(async () => {
    if (!api) return;
    try {
      await api.browser.close({ minionId });
      setSessionInfo(null);
      setScreenshotBase64(null);
      setSnapshotRaw(null);
      setUrlInput("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close browser session");
    }
  }, [api, minionId]);

  // ── Auto-refresh ───────────────────────────────────────────────────────
  useEffect(() => {
    if (autoRefresh && visible && sessionInfo?.isActive) {
      autoRefreshTimerRef.current = setInterval(() => {
        handleScreenshot();
      }, 3000);
    }
    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [autoRefresh, visible, sessionInfo?.isActive, handleScreenshot]);

  // ── URL input key handler ──────────────────────────────────────────────
  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNavigate();
      }
    },
    [handleNavigate]
  );

  // ── Empty state (no active session) ────────────────────────────────────
  if (!sessionInfo?.isActive && !isLoading) {
    return (
      <div className="flex h-full flex-col">
        {/* URL bar even in empty state so user can start a session */}
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
            <input
              ref={urlInputRef}
              type="text"
              className="min-w-0 flex-1 rounded bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              placeholder="Enter URL to start browsing..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleUrlKeyDown}
            />
            <button
              type="button"
              className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]/80 disabled:opacity-50"
              onClick={() => handleNavigate()}
              disabled={!urlInput.trim() || isLoading}
            >
              Go
            </button>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
          <Globe className="h-10 w-10 opacity-30" />
          <p className="text-sm">No active browser session</p>
          <p className="text-xs opacity-70">Enter a URL above or let the agent browse autonomously</p>
        </div>
      </div>
    );
  }

  // ── Active session view ────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* URL bar */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
          <input
            ref={urlInputRef}
            type="text"
            className="min-w-0 flex-1 rounded bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            placeholder="Enter URL..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleUrlKeyDown}
          />
          <button
            type="button"
            className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent)]/80 disabled:opacity-50"
            onClick={() => handleNavigate()}
            disabled={!urlInput.trim() || isLoading}
          >
            Go
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
        <ToolbarButton onClick={handleBack} disabled={isLoading} title="Back">
          <ArrowLeft className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleForward} disabled={isLoading} title="Forward">
          <ArrowRight className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleNavigate(sessionInfo?.url ?? urlInput)}
          disabled={isLoading}
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />

        <ToolbarButton
          onClick={handleScreenshot}
          disabled={isLoading}
          active={viewMode === "screenshot"}
          title="Screenshot"
        >
          <Camera className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleSnapshot}
          disabled={isLoading}
          active={viewMode === "tree"}
          title="Accessibility Tree"
        >
          <TreeDeciduous className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />

        <label className="flex cursor-pointer items-center gap-1 text-xs text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="h-3 w-3"
          />
          Auto
        </label>

        <div className="flex-1" />

        <ToolbarButton onClick={handleClose} title="Close browser session">
          <X className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
          <button
            type="button"
            className="ml-2 underline hover:no-underline"
            onClick={() => setError(null)}
          >
            dismiss
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="relative flex-1 overflow-auto">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-background)]/50">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent)]" />
          </div>
        )}

        {viewMode === "screenshot" && screenshotBase64 && (
          <div className="flex h-full items-start justify-center overflow-auto p-2">
            <img
              src={`data:image/png;base64,${screenshotBase64}`}
              alt="Browser screenshot"
              className="max-w-full rounded border border-[var(--color-border)]"
              style={{ imageRendering: "auto" }}
            />
          </div>
        )}

        {viewMode === "screenshot" && !screenshotBase64 && !isLoading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
            <Camera className="h-8 w-8 opacity-30" />
            <p className="text-xs">Click the camera icon to take a screenshot</p>
          </div>
        )}

        {viewMode === "tree" && snapshotRaw && (
          <pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-[var(--color-foreground)]">
            {snapshotRaw}
          </pre>
        )}

        {viewMode === "tree" && !snapshotRaw && !isLoading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
            <TreeDeciduous className="h-8 w-8 opacity-30" />
            <p className="text-xs">Click the tree icon to take an accessibility snapshot</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Toolbar button helper ────────────────────────────────────────────────

interface ToolbarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({ onClick, disabled, active, title, children }) => (
  <button
    type="button"
    className={cn(
      "rounded p-1 text-[var(--color-muted)] transition-colors",
      "hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)]",
      "disabled:opacity-40 disabled:pointer-events-none",
      active && "bg-[var(--color-background)] text-[var(--color-foreground)]"
    )}
    onClick={onClick}
    disabled={disabled}
    title={title}
  >
    {children}
  </button>
);
