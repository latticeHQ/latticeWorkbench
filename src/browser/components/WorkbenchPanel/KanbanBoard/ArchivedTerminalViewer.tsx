import { useRef, useEffect, useState } from "react";
import { init, Terminal, FitAddon } from "ghostty-web";
import { useAPI } from "@/browser/contexts/API";
import { readPersistedState } from "@/browser/hooks/usePersistedState";
import {
  DEFAULT_TERMINAL_FONT_CONFIG,
  TERMINAL_FONT_CONFIG_KEY,
  type TerminalFontConfig,
} from "@/common/constants/storage";
import { ArrowLeft, Lock } from "lucide-react";

interface ArchivedTerminalViewerProps {
  minionId: string;
  sessionId: string;
  profileName: string;
  onBack: () => void;
}

/**
 * Inline read-only terminal pane for viewing archived kanban sessions.
 *
 * Replaces the kanban columns when the user clicks "View" on an archived card.
 * Uses FitAddon to fill the Board tab panel — no dialog sizing issues.
 */
export function ArchivedTerminalViewer(props: ArchivedTerminalViewerProps) {
  const { api } = useAPI();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create terminal and write screen buffer
  useEffect(() => {
    if (!api) return;

    let cancelled = false;

    async function setup() {
      try {
        const result = await api!.kanban.getArchivedBuffer({
          minionId: props.minionId,
          sessionId: props.sessionId,
        });

        if (cancelled) return;

        const buffer = result.screenBuffer;
        if (!buffer) {
          setError("No screen buffer available for this session");
          setLoading(false);
          return;
        }

        await init();
        if (cancelled) return;

        const containerEl = containerRef.current;
        if (!containerEl) return;

        const styles = getComputedStyle(document.documentElement);
        const terminalBg = styles.getPropertyValue("--color-terminal-bg").trim() || "#0D0D0D";
        const terminalFg = styles.getPropertyValue("--color-terminal-fg").trim() || "#d4d4d4";

        const fontConfig = readPersistedState<TerminalFontConfig>(
          TERMINAL_FONT_CONFIG_KEY,
          DEFAULT_TERMINAL_FONT_CONFIG,
        );

        const terminal = new Terminal({
          fontSize: fontConfig.fontSize,
          fontFamily: fontConfig.fontFamily,
          cursorBlink: false,
          disableStdin: true,
          theme: {
            background: terminalBg,
            foreground: terminalFg,
          },
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(containerEl);
        fitAddon.fit();

        // Write the archived screen buffer
        terminal.write(buffer);

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("ArchivedTerminalViewer: failed to load buffer:", err);
          setError("Failed to load archived session");
          setLoading(false);
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
      setLoading(true);
      setError(null);
    };
  }, [api, props.minionId, props.sessionId]);

  // Re-fit on container resize
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header bar with back button and session info */}
      <div className="border-border flex items-center gap-2 border-b px-2 py-1.5">
        <button
          onClick={props.onBack}
          className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Board
        </button>
        <span className="text-muted text-xs">|</span>
        <span className="text-foreground truncate text-xs font-medium">
          {props.profileName}
        </span>
        <span className="text-muted inline-flex items-center gap-0.5 text-xs">
          <Lock className="h-2.5 w-2.5" />
          Read-only
        </span>
      </div>

      {/* Terminal fills remaining space */}
      <div className="relative flex-1 overflow-hidden">
        {loading && !error && (
          <div className="text-muted absolute inset-0 flex items-center justify-center text-xs">
            Loading archived session...
          </div>
        )}
        {error && (
          <div className="text-danger absolute inset-0 flex items-center justify-center text-xs">
            {error}
          </div>
        )}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ visibility: loading || error ? "hidden" : "visible" }}
        />
      </div>
    </div>
  );
}
