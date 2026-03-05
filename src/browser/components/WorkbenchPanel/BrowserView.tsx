/**
 * BrowserView — Main interactive browser panel for a minion.
 *
 * Supports two modes:
 * 1. **Live streaming** — WebSocket connection to agent-browser's STREAM_PORT,
 *    rendering JPEG frames on a <canvas> with interactive mouse/keyboard/scroll.
 * 2. **Screenshot fallback** — Static screenshots via API when streaming is unavailable.
 *
 * Also provides:
 * - URL bar for navigation
 * - Toolbar with back/forward/refresh/screenshot/annotated/snapshot/viewport
 * - Accessibility tree view
 * - Viewport presets (Desktop / Tablet / Mobile)
 * - Status bar showing connection state, dimensions, FPS
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronDown,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Tablet,
  Tag,
  TreeDeciduous,
  X,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";
import type { BrowserActionResult, BrowserSessionInfo } from "@/common/types/browser";

type ViewMode = "live" | "screenshot" | "tree";

/** Viewport presets for responsive testing. */
const VIEWPORT_PRESETS = [
  { label: "Desktop", width: 1280, height: 720, icon: Monitor },
  { label: "Tablet", width: 768, height: 1024, icon: Tablet },
  { label: "Mobile", width: 375, height: 812, icon: Smartphone },
] as const;

/** WebSocket frame message from agent-browser stream. */
interface StreamFrame {
  type: "frame";
  data: string; // base64 JPEG
  metadata?: {
    deviceWidth?: number;
    deviceHeight?: number;
    fps?: number;
  };
}

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
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [isLoading, setIsLoading] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showViewportMenu, setShowViewportMenu] = useState(false);
  const [activeViewport, setActiveViewport] = useState<(typeof VIEWPORT_PRESETS)[number]>(VIEWPORT_PRESETS[0]);

  // Streaming state
  const [wsConnected, setWsConnected] = useState(false);
  const [streamFps, setStreamFps] = useState(0);
  const [streamDimensions, setStreamDimensions] = useState<{ w: number; h: number } | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // ── Session polling ────────────────────────────────────────────────────
  const fetchSessionInfo = useCallback(async () => {
    if (!api) return;
    try {
      const info = await api.browser.sessionInfo({ minionId });
      setSessionInfo((prev) => {
        if (
          prev?.url === info?.url &&
          prev?.isActive === info?.isActive &&
          prev?.sessionName === info?.sessionName &&
          prev?.streamPort === info?.streamPort
        ) {
          return prev;
        }
        return info;
      });
      if (info?.url) {
        setUrlInput((prev) => (prev === info.url ? prev : info.url!));
      }
    } catch {
      setSessionInfo((prev) => (prev === null ? prev : null));
    }
  }, [api, minionId]);

  // Poll session info when visible
  useEffect(() => {
    if (!visible || !api) return;
    fetchSessionInfo();
    const interval = setInterval(fetchSessionInfo, 5000);
    return () => clearInterval(interval);
  }, [visible, api, fetchSessionInfo]);

  // ── WebSocket streaming ────────────────────────────────────────────────
  useEffect(() => {
    const streamPort = sessionInfo?.streamPort;
    if (!visible || !streamPort || viewMode !== "live") {
      // Clean up WebSocket if switching away or not visible
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setWsConnected(false);
      }
      return;
    }

    // Create reusable Image element for frame decoding
    if (!imgRef.current) {
      imgRef.current = new Image();
    }

    const wsUrl = `ws://localhost:${streamPort}`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setWsConnected(false);
      return;
    }

    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setError(null);
      frameCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg: StreamFrame = JSON.parse(
          typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)
        );

        if (msg.type === "frame" && msg.data) {
          frameCountRef.current++;

          // Update dimensions from metadata
          if (msg.metadata?.deviceWidth && msg.metadata?.deviceHeight) {
            setStreamDimensions((prev) => {
              if (prev?.w === msg.metadata!.deviceWidth && prev?.h === msg.metadata!.deviceHeight) {
                return prev;
              }
              return { w: msg.metadata!.deviceWidth!, h: msg.metadata!.deviceHeight! };
            });
          }

          // Decode and draw frame on canvas
          const canvas = canvasRef.current;
          if (!canvas) return;

          const img = imgRef.current!;
          img.onload = () => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Resize canvas to match frame dimensions
            if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
            }

            ctx.drawImage(img, 0, 0);
          };
          img.src = `data:image/jpeg;base64,${msg.data}`;
        }
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onerror = () => {
      setWsConnected(false);
    };

    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
    };

    // FPS counter
    fpsIntervalRef.current = setInterval(() => {
      setStreamFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
      setWsConnected(false);
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current);
        fpsIntervalRef.current = null;
      }
    };
  }, [visible, sessionInfo?.streamPort, viewMode]);

  // ── Canvas input handlers — send mouse/keyboard events to WebSocket ────
  const sendWsMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  /** Compute coordinates scaled to the actual page dimensions. */
  const getScaledCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
    },
    []
  );

  /**
   * Mouse events use onMouseDown + onMouseUp only (NOT onClick) to avoid
   * double-firing. CDP requires separate mousePressed → mouseReleased.
   * A mouseMoved is sent before mousePressed so the browser tracks cursor position.
   */
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Focus canvas for keyboard events
      canvasRef.current?.focus();
      const { x, y } = getScaledCoords(e);
      const button = e.button === 2 ? "right" : "left";
      // Move cursor first so hover state updates
      sendWsMessage({
        type: "input_mouse",
        eventType: "mouseMoved",
        x,
        y,
      });
      sendWsMessage({
        type: "input_mouse",
        eventType: "mousePressed",
        x,
        y,
        button,
        clickCount: 1,
      });
    },
    [getScaledCoords, sendWsMessage]
  );

  const handleCanvasMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getScaledCoords(e);
      sendWsMessage({
        type: "input_mouse",
        eventType: "mouseReleased",
        x,
        y,
        button: e.button === 2 ? "right" : "left",
        clickCount: 1,
      });
    },
    [getScaledCoords, sendWsMessage]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getScaledCoords(e);
      sendWsMessage({
        type: "input_mouse",
        eventType: "mouseMoved",
        x,
        y,
      });
    },
    [getScaledCoords, sendWsMessage]
  );

  // No onClick handler — mouseDown + mouseUp is the complete click cycle.
  // Having both would double-fire every click (4 events instead of 2).

  const handleCanvasWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const { x, y } = getScaledCoords(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      sendWsMessage({
        type: "input_mouse",
        eventType: "mouseWheel",
        x,
        y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      });
    },
    [getScaledCoords, sendWsMessage]
  );

  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      sendWsMessage({
        type: "input_keyboard",
        eventType: "keyDown",
        key: e.key,
        code: e.code,
        modifiers:
          (e.altKey ? 1 : 0) |
          (e.ctrlKey ? 2 : 0) |
          (e.metaKey ? 4 : 0) |
          (e.shiftKey ? 8 : 0),
      });
      // Also send char event for printable characters
      if (e.key.length === 1) {
        sendWsMessage({
          type: "input_keyboard",
          eventType: "char",
          key: e.key,
          code: e.code,
          text: e.key,
        });
      }
    },
    [sendWsMessage]
  );

  const handleCanvasKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      sendWsMessage({
        type: "input_keyboard",
        eventType: "keyUp",
        key: e.key,
        code: e.code,
      });
    },
    [sendWsMessage]
  );

  // ── Screenshot (fire-and-forget for background use) ────────────────────
  const takeScreenshot = useCallback(async () => {
    if (!api) return;
    setIsCapturing(true);
    try {
      const result = await api.browser.screenshot({ minionId });
      if (result.success && result.screenshot) {
        setScreenshotBase64(result.screenshot.base64);
      }
    } catch {
      // Silently fail for auto-screenshots
    } finally {
      setIsCapturing(false);
    }
  }, [api, minionId]);

  // ── Navigation ─────────────────────────────────────────────────────────
  const handleNavigate = useCallback(
    async (url?: string) => {
      if (!api) return;
      const targetUrl = url ?? urlInput.trim();
      if (!targetUrl) return;

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
            prev
              ? { ...prev, url: normalizedUrl }
              : { minionId, sessionName: "", url: normalizedUrl, isActive: true, streamPort: null }
          );
          // Refresh session info to get stream port
          fetchSessionInfo();
          // If not in live mode, take a screenshot
          if (viewMode !== "live") {
            takeScreenshot().catch(() => {});
          }
        } else {
          setError(result.error ?? "Navigation failed");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Navigation failed");
      } finally {
        setIsLoading(false);
      }
    },
    [api, minionId, urlInput, takeScreenshot, fetchSessionInfo, viewMode]
  );

  const handleBack = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      await api.browser.back({ minionId });
      await fetchSessionInfo();
      if (viewMode !== "live") takeScreenshot().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Back navigation failed");
    } finally {
      setIsLoading(false);
    }
  }, [api, minionId, fetchSessionInfo, takeScreenshot, viewMode]);

  const handleForward = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      await api.browser.forward({ minionId });
      await fetchSessionInfo();
      if (viewMode !== "live") takeScreenshot().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forward navigation failed");
    } finally {
      setIsLoading(false);
    }
  }, [api, minionId, fetchSessionInfo, takeScreenshot, viewMode]);

  // ── Manual screenshot (user-initiated) ─────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      const result = await api.browser.screenshot({ minionId });
      if (result.success && result.screenshot) {
        setScreenshotBase64(result.screenshot.base64);
        setViewMode("screenshot");
      } else {
        setError("Screenshot failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screenshot failed");
    } finally {
      setIsLoading(false);
    }
  }, [api, minionId]);

  // ── Annotated screenshot ───────────────────────────────────────────────
  const handleAnnotatedScreenshot = useCallback(async () => {
    if (!api) return;
    setIsLoading(true);
    try {
      const result = await api.browser.annotatedScreenshot({ minionId });
      if (result.success && result.annotatedScreenshot) {
        setScreenshotBase64(result.annotatedScreenshot.base64);
        setViewMode("screenshot");
      } else if (result.success && result.screenshot) {
        // Fallback to regular screenshot if annotated not supported
        setScreenshotBase64(result.screenshot.base64);
        setViewMode("screenshot");
      } else {
        setError(result.error ?? "Annotated screenshot failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annotated screenshot failed");
    } finally {
      setIsLoading(false);
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
      setWsConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close browser session");
    }
  }, [api, minionId]);

  // ── Viewport presets ───────────────────────────────────────────────────
  const handleSetViewport = useCallback(
    async (preset: (typeof VIEWPORT_PRESETS)[number]) => {
      if (!api) return;
      setActiveViewport(preset);
      setShowViewportMenu(false);
      try {
        await api.browser.setViewport({
          minionId,
          width: preset.width,
          height: preset.height,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Viewport change failed");
      }
    },
    [api, minionId]
  );

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

  // Close viewport menu on click outside
  useEffect(() => {
    if (!showViewportMenu) return;
    const handler = () => setShowViewportMenu(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [showViewportMenu]);

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
  const ViewportIcon = activeViewport.icon;

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

        {/* View mode buttons */}
        <ToolbarButton
          onClick={() => setViewMode("live")}
          disabled={isLoading}
          active={viewMode === "live"}
          title="Live Stream"
        >
          <Monitor className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleScreenshot}
          disabled={isLoading}
          active={viewMode === "screenshot"}
          title="Screenshot"
        >
          <Camera className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleAnnotatedScreenshot}
          disabled={isLoading}
          title="Annotated Screenshot"
        >
          <Tag className="h-3.5 w-3.5" />
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

        {/* Viewport presets dropdown */}
        <div className="relative">
          <button
            type="button"
            className={cn(
              "flex items-center gap-0.5 rounded p-1 text-xs text-[var(--color-muted)] transition-colors",
              "hover:bg-[var(--color-background)] hover:text-[var(--color-foreground)]"
            )}
            onClick={(e) => {
              e.stopPropagation();
              setShowViewportMenu((v) => !v);
            }}
            title="Viewport presets"
          >
            <ViewportIcon className="h-3.5 w-3.5" />
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
          {showViewportMenu && (
            <div className="absolute left-0 top-full z-20 mt-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
              {VIEWPORT_PRESETS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                      "hover:bg-[var(--color-background)]",
                      activeViewport.label === preset.label && "text-[var(--color-accent)]"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetViewport(preset);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{preset.label}</span>
                    <span className="ml-auto text-[var(--color-muted)]">
                      {preset.width}×{preset.height}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
        {(isLoading || isCapturing) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-background)]/50">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent)]" />
          </div>
        )}

        {/* Live streaming canvas */}
        {viewMode === "live" && (
          <div className="flex h-full flex-col">
            <div className="flex flex-1 items-start justify-center overflow-auto p-2">
              {wsConnected ? (
                <canvas
                  ref={canvasRef}
                  className="max-w-full cursor-pointer rounded border border-[var(--color-border)]"
                  style={{ imageRendering: "auto" }}
                  tabIndex={0}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseMove={handleCanvasMouseMove}
                  onWheel={handleCanvasWheel}
                  onKeyDown={handleCanvasKeyDown}
                  onKeyUp={handleCanvasKeyUp}
                  onContextMenu={(e) => e.preventDefault()}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
                  <Loader2 className="h-6 w-6 animate-spin opacity-50" />
                  <p className="text-xs">Connecting to live stream...</p>
                  <p className="text-xs opacity-50">
                    {sessionInfo?.streamPort
                      ? `Port ${sessionInfo.streamPort}`
                      : "Waiting for stream port allocation"}
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-xs text-[var(--color-accent)] underline hover:no-underline"
                    onClick={handleScreenshot}
                  >
                    Take a screenshot instead
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Static screenshot view */}
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

        {viewMode === "screenshot" && !screenshotBase64 && !isLoading && !isCapturing && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
            <Camera className="h-8 w-8 opacity-30" />
            <p className="text-xs">Click the camera icon to take a screenshot</p>
          </div>
        )}

        {/* Accessibility tree view */}
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

      {/* Status bar */}
      <div className="flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[10px] text-[var(--color-muted)]">
        {/* Connection status */}
        <span className="flex items-center gap-1">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              wsConnected ? "bg-green-500" : sessionInfo?.isActive ? "bg-yellow-500" : "bg-zinc-500"
            )}
          />
          {wsConnected ? "Connected" : sessionInfo?.isActive ? "Session active" : "Disconnected"}
        </span>

        {/* Dimensions */}
        {streamDimensions && (
          <span>
            {streamDimensions.w}×{streamDimensions.h}
          </span>
        )}

        {/* FPS */}
        {wsConnected && <span>{streamFps}fps</span>}

        {/* Stream port */}
        {sessionInfo?.streamPort && (
          <span className="ml-auto">Port {sessionInfo.streamPort}</span>
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
