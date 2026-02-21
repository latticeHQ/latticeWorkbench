/**
 * LiveKitBar — compact voice/video control bar for PM Chat.
 *
 * States:
 * - Not configured: shows warning + link to settings
 * - Disconnected:   shows "Start Voice/Video" button
 * - Connecting:     shows spinner
 * - Connected:      shows Mic / Camera toggles + participant count + End button
 * - Error:          shows error message + retry button
 */

import React from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Loader2,
  Radio,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { cn } from "@/common/lib/utils";
import type { LiveKitState } from "@/browser/hooks/useLiveKit";
import type { RemoteParticipant } from "livekit-client";

interface LiveKitBarProps {
  state: LiveKitState;
  error: string | null;
  isMicOn: boolean;
  isCameraOn: boolean;
  remoteParticipants: RemoteParticipant[];
  isConfigured: boolean;
  onStart: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onOpenSettings: () => void;
}

export function LiveKitBar({
  state,
  error,
  isMicOn,
  isCameraOn,
  remoteParticipants,
  isConfigured,
  onStart,
  onEnd,
  onToggleMic,
  onToggleCamera,
  onOpenSettings,
}: LiveKitBarProps) {
  // ── Not configured ────────────────────────────────────────────────
  if (!isConfigured) {
    return (
      <div className="border-border-light flex items-center gap-2 border-t px-3 py-1.5">
        <AlertTriangle size={12} className="text-muted shrink-0" />
        <span className="text-muted text-[11px]">LiveKit not configured.</span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-accent hover:text-accent-hover flex items-center gap-1 text-[11px] transition-colors"
        >
          <Settings size={10} />
          <span>Add credentials</span>
        </button>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <div className="border-border-light flex items-center gap-2 border-t px-3 py-1.5">
        <AlertTriangle size={12} className="shrink-0 text-[var(--color-danger)]" />
        <span className="text-muted min-w-0 flex-1 truncate text-[11px]">
          {error ?? "Connection failed"}
        </span>
        <button
          type="button"
          onClick={onStart}
          className="text-accent hover:text-accent-hover text-[11px] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Connecting ────────────────────────────────────────────────────
  if (state === "connecting") {
    return (
      <div className="border-border-light flex items-center gap-2 border-t px-3 py-1.5">
        <Loader2 size={12} className="text-muted animate-spin shrink-0" />
        <span className="text-muted text-[11px]">Connecting to LiveKit…</span>
      </div>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────
  if (state === "connected") {
    const totalParticipants = remoteParticipants.length + 1; // +1 for local
    return (
      <div className="border-border-light flex items-center gap-1.5 border-t px-3 py-1.5">
        {/* Live indicator */}
        <span className="flex items-center gap-1 pr-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-success)]" />
          <span className="text-[var(--color-success)] text-[10px] font-semibold uppercase tracking-wider">
            Live
          </span>
        </span>

        {/* Participant count */}
        <span className="text-muted pr-1.5 text-[11px]">
          {totalParticipants} participant{totalParticipants !== 1 ? "s" : ""}
        </span>

        <div className="bg-border-light mx-0.5 h-3 w-px" />

        {/* Mic toggle */}
        <ControlButton
          onClick={onToggleMic}
          active={isMicOn}
          title={isMicOn ? "Mute microphone" : "Unmute microphone"}
        >
          {isMicOn ? <Mic size={13} /> : <MicOff size={13} />}
        </ControlButton>

        {/* Camera toggle */}
        <ControlButton
          onClick={onToggleCamera}
          active={isCameraOn}
          title={isCameraOn ? "Turn off camera" : "Turn on camera"}
        >
          {isCameraOn ? <Video size={13} /> : <VideoOff size={13} />}
        </ControlButton>

        <div className="flex-1" />

        {/* End call */}
        <button
          type="button"
          onClick={onEnd}
          title="End session"
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors",
            "bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20"
          )}
        >
          <PhoneOff size={11} />
          <span>End</span>
        </button>
      </div>
    );
  }

  // ── Disconnected ──────────────────────────────────────────────────
  return (
    <div className="border-border-light flex items-center border-t px-3 py-1.5">
      <button
        type="button"
        onClick={onStart}
        className={cn(
          "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
          "text-muted hover:bg-hover hover:text-foreground"
        )}
        title="Start a live voice/video session with your AI agent"
      >
        <Radio size={12} />
        <span>Start Voice/Video Session</span>
      </button>
    </div>
  );
}

// ── Small icon control button ───────────────────────────────────────

function ControlButton({
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
        "flex h-6 w-6 items-center justify-center rounded transition-colors",
        active
          ? "bg-[var(--color-exec-mode)]/10 text-[var(--color-exec-mode)] hover:bg-[var(--color-exec-mode)]/20"
          : "text-muted hover:bg-hover hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
