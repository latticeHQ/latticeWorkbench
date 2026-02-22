/**
 * LiveKitBar — floating pill-shaped voice/video control bar.
 *
 * Designed to float globally above all pages as a fixed overlay — see
 * GlobalLiveKitOverlay for positioning. Self-contained with its own
 * background, border, blur, and shadow.
 *
 * States:
 * - Not configured: warning + "Add credentials" link to Settings
 * - Disconnected:   "Start Voice/Video Session" button
 * - Connecting:     connecting spinner
 * - Connected:      ● LIVE | participant count | Mic | Camera | End
 * - Error:          error message + retry
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

// ── Shared pill wrapper ────────────────────────────────────────────────────

function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        "rounded-full border border-white/10 bg-[var(--color-bg-panel)]/90 backdrop-blur-md",
        "shadow-[0_4px_24px_rgba(0,0,0,0.35)] px-3 py-1.5",
        className
      )}
    >
      {children}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────

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
  /**
   * "pill"  — floating pill with backdrop-blur background (default, standalone)
   * "flat"  — no background, transparent row for use inside a card/panel footer
   */
  variant?: "pill" | "flat";
}

// ── Component ──────────────────────────────────────────────────────────────

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
  variant = "pill",
}: LiveKitBarProps) {
  // Flat variant: no pill — just a transparent flex row for card footers
  const Wrap = variant === "flat"
    ? ({ children }: { children: React.ReactNode }) => (
        <div className="flex items-center gap-2 px-3 py-2">{children}</div>
      )
    : Pill;
  // ── Not configured ──────────────────────────────────────────────────
  if (!isConfigured) {
    return (
      <Wrap>
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
      </Wrap>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────
  if (state === "error") {
    return (
      <Wrap>
        <AlertTriangle size={12} className="shrink-0 text-[var(--color-danger)]" />
        <span className="text-muted max-w-[200px] truncate text-[11px]">
          {error ?? "Connection failed"}
        </span>
        <button
          type="button"
          onClick={onStart}
          className="text-accent hover:text-accent-hover text-[11px] transition-colors"
        >
          Retry
        </button>
      </Wrap>
    );
  }

  // ── Connecting ──────────────────────────────────────────────────────
  if (state === "connecting") {
    return (
      <Wrap>
        <Loader2 size={12} className="text-muted animate-spin shrink-0" />
        <span className="text-muted text-[11px]">Connecting…</span>
      </Wrap>
    );
  }

  // ── Connected ───────────────────────────────────────────────────────
  if (state === "connected") {
    const totalParticipants = remoteParticipants.length + 1;
    return (
      <Wrap>
        {/* Live indicator */}
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-success)]" />
          <span className="text-[var(--color-success)] text-[10px] font-semibold uppercase tracking-wider">
            Live
          </span>
        </span>

        {/* Participant count */}
        <span className="text-muted text-[11px] pl-0.5">
          {totalParticipants} participant{totalParticipants !== 1 ? "s" : ""}
        </span>

        <div className="bg-border-light h-3 w-px" />

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

        <div className="bg-border-light h-3 w-px" />

        {/* End call */}
        <button
          type="button"
          onClick={onEnd}
          title="End session"
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            "bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25"
          )}
        >
          <PhoneOff size={11} />
          <span>End</span>
        </button>
      </Wrap>
    );
  }

  // ── Disconnected ────────────────────────────────────────────────────
  return (
    <Wrap>
      <button
        type="button"
        onClick={onStart}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
          "text-muted hover:bg-white/5 hover:text-foreground"
        )}
        title="Start a live voice/video session with your AI agent"
      >
        <Radio size={12} />
        <span>Start Voice/Video Session</span>
      </button>
    </Wrap>
  );
}

// ── Small icon control button ──────────────────────────────────────────────

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
        "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
        active
          ? "bg-[var(--color-exec-mode)]/15 text-[var(--color-exec-mode)] hover:bg-[var(--color-exec-mode)]/25"
          : "text-muted hover:bg-white/5 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
