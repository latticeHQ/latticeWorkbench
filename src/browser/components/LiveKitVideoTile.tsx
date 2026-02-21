/**
 * LiveKitVideoTile — floating self-video tile shown when camera is active.
 *
 * Renders a small 160×90 video element in the bottom-right corner of its
 * positioning parent. Attaches the local LiveKit video track directly to the
 * <video> element using the LiveKit SDK's track.attach() API.
 *
 * Also renders remote participant video tiles above the self-view when remote
 * participants have published video (e.g. an avatar agent).
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
  /** Extra className for the outer wrapper */
  className?: string;
}

export function LiveKitVideoTile({
  localVideoTrack,
  isMicOn,
  remoteParticipants,
  className,
}: LiveKitVideoTileProps) {
  // Collect remote video tracks (e.g., avatar agent publishing video)
  const remoteVideoPublications = remoteParticipants.flatMap((p) =>
    Array.from(p.videoTrackPublications.values()).filter(
      (pub) =>
        pub.isSubscribed && pub.track && pub.source === Track.Source.Camera
    )
  );

  const hasAnyVideo = localVideoTrack || remoteVideoPublications.length > 0;
  if (!hasAnyVideo) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-16 right-3 z-20 flex flex-col items-end gap-1.5",
        className
      )}
    >
      {/* Remote participant video tiles (e.g., avatar) */}
      {remoteVideoPublications.map((pub) => (
        <RemoteVideoTile key={pub.trackSid} trackSid={pub.trackSid} publication={pub} />
      ))}

      {/* Self-view (local camera) */}
      {localVideoTrack && (
        <div className="pointer-events-auto relative overflow-hidden rounded-lg shadow-lg">
          <LocalVideoElement track={localVideoTrack} />
          {!isMicOn && (
            <div className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60">
              <MicOff size={10} className="text-white" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Self-view video element ──────────────────────────────────────────────────

function LocalVideoElement({ track }: { track: LocalVideoTrack }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const videoEl = track.attach(el) as HTMLVideoElement;

    return () => {
      track.detach(videoEl);
    };
  }, [track]);

  return (
    <video
      ref={videoRef}
      className="h-[90px] w-[160px] rounded-lg object-cover"
      autoPlay
      muted
      playsInline
    />
  );
}

// ── Remote video tile ────────────────────────────────────────────────────────

function RemoteVideoTile({
  trackSid,
  publication,
}: {
  trackSid: string;
  publication: RemoteTrackPublication;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !publication.track) return;

    const videoEl = publication.track.attach(el);

    return () => {
      if (publication.track) {
        publication.track.detach(videoEl);
      }
    };
  }, [publication.track, trackSid]);

  return (
    <div className="pointer-events-auto overflow-hidden rounded-lg shadow-lg">
      <video
        ref={videoRef}
        className="h-[90px] w-[160px] rounded-lg object-cover"
        autoPlay
        playsInline
      />
    </div>
  );
}
