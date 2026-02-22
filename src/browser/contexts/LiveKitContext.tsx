/**
 * LiveKitContext — global LiveKit session state accessible from any page.
 *
 * Lifts useLiveKit out of ChatPane so voice/video persists while navigating
 * between Home, Projects, and Workspaces.
 *
 * Usage:
 *   // In ChatPane (or any page with a workspace):
 *   const { setActiveRoom } = useLiveKitContext();
 *   useEffect(() => { setActiveRoom(workspaceId); }, [workspaceId]);
 *
 *   // In any component that needs LiveKit state:
 *   const { state, isMicOn, ... } = useLiveKitContext();
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLiveKit, type UseLiveKitReturn } from "@/browser/hooks/useLiveKit";
import { useAPI } from "@/browser/contexts/API";

// ── Context shape ──────────────────────────────────────────────────────────

export interface LiveKitContextValue extends UseLiveKitReturn {
  /** Whether LiveKit credentials are configured in Settings */
  isConfigured: boolean;
  /**
   * The room name the next "Start Session" will connect to.
   * ChatPane sets this to its workspaceId on mount so the floating bar
   * always knows which room to join.
   */
  activeRoomName: string | null;
  /** Called by ChatPane (or any page) to register the current room name */
  setActiveRoom: (roomName: string | null) => void;
  /** Connects to activeRoomName as "user". No-op if no activeRoomName. */
  onStart: () => void;
}

const LiveKitContext = createContext<LiveKitContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

export function LiveKitProvider({ children }: { children: ReactNode }) {
  const { api } = useAPI();
  const [isConfigured, setIsConfigured] = useState(false);
  const [activeRoomName, setActiveRoomName] = useState<string | null>(null);

  // Check credentials once on mount (re-checks when api becomes available)
  useEffect(() => {
    if (!api) return;
    void api.livekit.getConfig().then((cfg) => {
      setIsConfigured(Boolean(cfg.apiKeySet && cfg.baseUrl));
    });
  }, [api]);

  const liveKit = useLiveKit({ api });

  const onStart = useCallback(() => {
    if (!activeRoomName) return;
    void liveKit.connect(activeRoomName, "user");
  }, [activeRoomName, liveKit]);

  return (
    <LiveKitContext.Provider
      value={{
        ...liveKit,
        isConfigured,
        activeRoomName,
        setActiveRoom: setActiveRoomName,
        onStart,
      }}
    >
      {children}
    </LiveKitContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useLiveKitContext(): LiveKitContextValue {
  const ctx = useContext(LiveKitContext);
  if (!ctx) {
    throw new Error("useLiveKitContext must be used within <LiveKitProvider>");
  }
  return ctx;
}
