/**
 * LiveKitVideoTile — unified video panel for the LiveKit overlay card.
 *
 * Layout:
 * - Remote (agent avatar) fills the full panel as the primary view.
 * - Local self-view is a small PiP overlaid in the bottom-left corner.
 * - When no remote video, local self-view fills the panel.
 * - Returns null when no video at all.
 *
 * Positioning is handled by the parent (GlobalLiveKitOverlay), not this component.
 */

import React, { useEffect, useRef } from "react";
import { MicOff } from "lucide-react";
import { cn } from "@/common/lib/utils";
import type { LocalVideoTrack, RemoteParticipant, RemoteTrackPublication } from "livekit-client";
import { Track } from "livekit-client";

interface LiveKitVideoTileProps {
  localVideoTrack: LocalVideoTrack | null;
  isMicOn: boolean;
  remoteParticipants: RemoteParticipant[];
  className?: string;
}

export function LiveKitVideoTile({
  localVideoTrack,
  isMicOn,
  remoteParticipants,
  className,
}: LiveKitVideoTileProps) {
  const remoteVideoPublications = remoteParticipants.flatMap((p) =>
    Array.from(p.videoTrackPublications.values()).filter(
      (pub) => pub.isSubscribed && pub.track && pub.source === Track.Source.Camera
    )
  );

  const hasRemote = remoteVideoPublications.length > 0;
  const hasLocal = localVideoTrack !== null;

  if (!hasRemote && !hasLocal) return null;

  return (
    // Panel wrapper — 16:9 at 256 wide; parent handles rounded corners
    <div className={cn("relative w-[256px] overflow-hidden", className)}>
      {/* ── Primary video ────────────────────────────────────────────
          Remote (agent avatar) takes priority; local fills when alone. */}
      {hasRemote ? (
        <RemoteVideoPanel publication={remoteVideoPublications[0]} />
      ) : (
        <LocalVideoPanel track={localVideoTrack!} />
      )}

      {/* ── PiP self-view ────────────────────────────────────────────
          Shown in bottom-left corner when remote video is the primary. */}
      {hasRemote && hasLocal && (
        <div className="absolute bottom-2 left-2 overflow-hidden rounded-lg shadow-lg ring-1 ring-white/20">
          <LocalVideoPip track={localVideoTrack!} />
          {!isMicOn && (
            <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70">
              <MicOff size={8} className="text-white" />
            </div>
          )}
        </div>
      )}

      {/* ── Mute badge on local-only view ───────────────────────────── */}
      {!hasRemote && !isMicOn && (
        <div className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/70">
          <MicOff size={10} className="text-white" />
        </div>
      )}
    </div>
  );
}

// ── Remote: full-panel video (256 × 144) ──────────────────────────────────

function RemoteVideoPanel({ publication }: { publication: RemoteTrackPublication }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !publication.track) return;
    const videoEl = publication.track.attach(el);
    return () => { if (publication.track) publication.track.detach(videoEl); };
  }, [publication.track]);

  return (
    <video
      ref={videoRef}
      className="h-[144px] w-[256px] object-cover"
      autoPlay
      playsInline
    />
  );
}

// ── Local: full-panel (when no remote) ───────────────────────────────────

function LocalVideoPanel({ track }: { track: LocalVideoTrack }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const videoEl = track.attach(el) as HTMLVideoElement;
    return () => { track.detach(videoEl); };
  }, [track]);

  return (
    <video
      ref={videoRef}
      className="h-[144px] w-[256px] object-cover"
      autoPlay
      muted
      playsInline
    />
  );
}

// ── Local: small PiP overlay (80 × 45) ────────────────────────────────────

function LocalVideoPip({ track }: { track: LocalVideoTrack }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const videoEl = track.attach(el) as HTMLVideoElement;
    return () => { track.detach(videoEl); };
  }, [track]);

  return (
    <video
      ref={videoRef}
      className="h-[45px] w-[80px] object-cover"
      autoPlay
      muted
      playsInline
    />
  );
}
