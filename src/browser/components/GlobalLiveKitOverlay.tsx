/**
 * GlobalLiveKitOverlay — draggable video call card.
 *
 * Always visible when a workspace is open (activeRoomName set).
 * Controls are overlaid on the video with a gradient (like modern video calls).
 *
 * States:
 *  disconnected → compact "Start" card
 *  connecting   → card with spinner
 *  connected    → video + overlaid controls (mic, camera, end)
 *  error        → card with retry
 */

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Video,
  VideoOff,
} from "lucide-react";
import { Track } from "livekit-client";
import type { RemoteAudioTrack } from "livekit-client";
import { cn } from "@/common/lib/utils";
import { useLiveKitContext } from "@/browser/contexts/LiveKitContext";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { LiveKitVideoTile } from "./LiveKitVideoTile";
import { AudioWaveVisualizer } from "./AudioWaveVisualizer";

const CARD_W = 256;
// Distance from the right viewport edge (clears the right icon strip ~28px)
const EDGE_RIGHT = 58;
// Distance from the bottom viewport edge.
// Must clear: status-bar ~28px + exec-toolbar ~36px + chat-input ~44px + gap = ~130px
const EDGE_BOTTOM = 280;
// Min card height used when DOM hasn't measured yet
const CARD_H_FALLBACK = 80;
// Approximate header height (titlebar ~36px + tab bar ~36px)
const HEADER_H = 76;

export function GlobalLiveKitOverlay() {
  const lk = useLiveKitContext();
  const { open: openSettings } = useSettings();

  // ── Visibility ────────────────────────────────────────────────────
  const isIdle = lk.state === "disconnected";
  const hasVideo = lk.localVideoTrack !== null || lk.remoteParticipants.length > 0;
  const hasRoom = lk.activeRoomName !== null;

  // Show when: workspace open (has room), OR session active, OR video present
  if (!hasRoom && isIdle && !hasVideo) return null;

  return (
    <DraggableCard>
      {isIdle ? (
        // ── Idle: compact start prompt ──────────────────────────────
        <IdleCard
          isConfigured={lk.isConfigured}
          onStart={lk.onStart}
          onOpenSettings={() => openSettings("providers")}
        />
      ) : lk.state === "connecting" ? (
        // ── Connecting ─────────────────────────────────────────────
        <StatusCard icon={<Loader2 size={13} className="animate-spin text-muted" />} label="Connecting…" />
      ) : lk.state === "error" ? (
        // ── Error ──────────────────────────────────────────────────
        <ErrorCard error={lk.error} onRetry={lk.onStart} />
      ) : (
        // ── Connected: video + overlaid controls ───────────────────
        <ConnectedCard
          lk={lk}
          hasVideo={hasVideo}
        />
      )}
    </DraggableCard>
  );
}

// ── Draggable shell ────────────────────────────────────────────────────────

function DraggableCard({ children }: { children: React.ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  // Initialise to bottom-right, clear of the chat input + status bar
  useEffect(() => {
    if (pos !== null) return;
    // offsetHeight can be 0 before first paint — use a safe minimum
    const h = Math.max(cardRef.current?.offsetHeight ?? 0, CARD_H_FALLBACK);
    setPos({
      x: window.innerWidth - CARD_W - EDGE_RIGHT,
      y: window.innerHeight - h - EDGE_BOTTOM,
    });
  });

  const onGripDown = (e: React.MouseEvent) => {
    if (!pos) return;
    e.preventDefault();
    drag.current = { mx: e.clientX, my: e.clientY, ox: pos.x, oy: pos.y };
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - CARD_W - EDGE_RIGHT, drag.current.ox + e.clientX - drag.current.mx)),
        y: Math.max(HEADER_H, Math.min(window.innerHeight - CARD_H_FALLBACK - EDGE_BOTTOM, drag.current.oy + e.clientY - drag.current.my)),
      });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        "pointer-events-auto fixed z-50 w-[256px] select-none",
        "overflow-visible rounded-2xl",
        "border border-white/[0.08]",
        "bg-[#111]/90 backdrop-blur-xl",
        "shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_0_0.5px_rgba(255,255,255,0.04)]",
      )}
      style={pos ? { left: pos.x, top: pos.y } : { right: EDGE_RIGHT, bottom: EDGE_BOTTOM + CARD_H_FALLBACK }}
    >
      {/* Inner clip — keeps rounded corners on content without clipping tooltips */}
      <div className="overflow-hidden rounded-2xl">
        {/* Drag handle */}
        <div
          onMouseDown={onGripDown}
          className="flex h-6 cursor-grab items-center justify-center bg-white/[0.03] hover:bg-white/[0.06] active:cursor-grabbing transition-colors"
        >
          <GripHorizontal size={12} className="text-white/20" />
        </div>

        {children}
      </div>
    </div>
  );
}

// ── Idle / disconnected ────────────────────────────────────────────────────

function IdleCard({
  isConfigured,
  onStart,
  onOpenSettings,
}: {
  isConfigured: boolean;
  onStart: () => void;
  onOpenSettings: () => void;
}) {
  if (!isConfigured) {
    return (
      <div className="flex items-center gap-2 px-3 py-3">
        <Radio size={12} className="shrink-0 text-white/30" />
        <span className="flex-1 text-[11px] text-white/40">LiveKit not set up</span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="shrink-0 text-[11px] text-blue-400/80 transition-colors hover:text-blue-400"
        >
          Configure
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className="group flex w-full items-center gap-3 px-3 py-3 transition-colors hover:bg-white/[0.04]"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/40 transition-colors group-hover:bg-white/[0.1] group-hover:text-white/70">
        <Radio size={12} />
      </span>
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-[12px] font-medium text-white/60 transition-colors group-hover:text-white/80">
          Start Voice / Video
        </span>
        <span className="text-[10px] text-white/25 transition-colors group-hover:text-white/40">
          Click to begin session
        </span>
      </div>
    </button>
  );
}

// ── Status card (connecting / generic) ────────────────────────────────────

function StatusCard({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-3">
      {icon}
      <span className="text-[11px] text-white/50">{label}</span>
    </div>
  );
}

// ── Error card ────────────────────────────────────────────────────────────

function ErrorCard({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3">
      <span className="min-w-0 flex-1 truncate text-[11px] text-red-400/80">
        {error ?? "Connection failed"}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 text-[11px] text-white/50 transition-colors hover:text-white/80"
      >
        Retry
      </button>
    </div>
  );
}

// ── Connected card ────────────────────────────────────────────────────────

function ConnectedCard({
  lk,
  hasVideo,
}: {
  lk: ReturnType<typeof useLiveKitContext>;
  hasVideo: boolean;
}) {
  // Show/hide the visual panel (video + wave). Starts expanded.
  const [panelOpen, setPanelOpen] = useState(true);
  const totalParticipants = lk.remoteParticipants.length + 1;

  // Pull the agent's remote audio track for the wave visualizer
  const remoteAudioTrack = lk.remoteParticipants
    .flatMap((p) => Array.from(p.audioTrackPublications.values()))
    .find(
      (pub) =>
        pub.isSubscribed &&
        pub.track &&
        pub.source === Track.Source.Microphone
    )
    ?.track as RemoteAudioTrack | undefined ?? null;

  // Heuristic: if remote track exists and PCM amplitude > threshold → speaking
  // (good enough without a full VAD — the wave amplitude does the rest visually)
  const isSpeaking = remoteAudioTrack !== null;

  return (
    <div className="bg-[#0a0a0a]">
      {/* ── Visual panel (collapsible) ──────────────────────────────── */}
      {panelOpen && (
        // Fixed-height container — wave is always background, video sits on top
        <div className="relative h-[144px] w-[256px]">
          {/* Audio wave — always the background layer */}
          <div className="absolute inset-0">
            <AudioWaveVisualizer
              audioTrack={remoteAudioTrack}
              isSpeaking={isSpeaking}
              className="opacity-80"
            />
          </div>

          {/* Video tile — covers the wave once camera/agent tracks arrive */}
          {hasVideo && (
            <div className="absolute inset-0 z-10">
              <LiveKitVideoTile
                localVideoTrack={lk.localVideoTrack}
                isMicOn={lk.isMicOn}
                remoteParticipants={lk.remoteParticipants}
              />
            </div>
          )}

          {/* Gradient + controls overlay */}
          <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-10">
            <ControlsRow
              lk={lk}
              totalParticipants={totalParticipants}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ── Compact controls bar (panel collapsed) ──────────────────── */}
      {!panelOpen && (
        // Wave behind the controls so there's still visual feedback
        <div className="relative h-10 w-[256px]">
          <div className="absolute inset-0 opacity-50">
            <AudioWaveVisualizer
              audioTrack={remoteAudioTrack}
              isSpeaking={isSpeaking}
            />
          </div>
          <div className="absolute inset-0 flex items-center px-2.5">
            <ControlsRow
              lk={lk}
              totalParticipants={totalParticipants}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(true)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline controls row ───────────────────────────────────────────────────

function ControlsRow({
  lk,
  totalParticipants,
  panelOpen,
  onTogglePanel,
}: {
  lk: ReturnType<typeof useLiveKitContext>;
  totalParticipants: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Live badge */}
      <span className="flex items-center gap-1 rounded-full bg-green-500/20 px-1.5 py-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-green-400">
          Live
        </span>
      </span>

      {/* Participant count */}
      <span className="text-[10px] text-white/50">{totalParticipants}p</span>

      <div className="flex-1" />

      {/* Mic */}
      <RoundIconBtn
        active={lk.isMicOn}
        onClick={() => void lk.toggleMic()}
        title={lk.isMicOn ? "Mute" : "Unmute"}
      >
        {lk.isMicOn ? <Mic size={11} /> : <MicOff size={11} />}
      </RoundIconBtn>

      {/* Camera */}
      <RoundIconBtn
        active={lk.isCameraOn}
        onClick={() => void lk.toggleCamera()}
        title={lk.isCameraOn ? "Camera off" : "Camera on"}
      >
        {lk.isCameraOn ? <Video size={11} /> : <VideoOff size={11} />}
      </RoundIconBtn>

      {/* Collapse / expand panel */}
      <RoundIconBtn
        active={false}
        onClick={onTogglePanel}
        title={panelOpen ? "Voice only" : "Show video panel"}
      >
        {panelOpen ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
      </RoundIconBtn>

      {/* End */}
      <button
        type="button"
        onClick={lk.disconnect}
        title="End session"
        className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-500/35"
      >
        <PhoneOff size={10} />
        <span>End</span>
      </button>
    </div>
  );
}

function RoundIconBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors",
        active
          ? "bg-white/15 text-white hover:bg-white/25"
          : "bg-white/[0.07] text-white/40 hover:bg-white/10 hover:text-white/70"
      )}
    >
      {children}
    </button>
  );
}
