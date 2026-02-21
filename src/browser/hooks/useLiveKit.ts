/**
 * useLiveKit — manages a LiveKit room session for real-time voice + video.
 *
 * Handles:
 * - Token acquisition from backend (api.livekit.getToken)
 * - Room connect / disconnect lifecycle
 * - Local mic + camera track toggling
 * - Remote participant + track subscription
 * - LiveKit RPC handler registration (agent → workbench callbacks)
 * - Clean teardown on unmount
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  LocalVideoTrack,
  RemoteParticipant,
  Track,
  RoomConnectOptions,
} from "livekit-client";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

type APIClient = RouterClient<AppRouter>;

export type LiveKitState = "disconnected" | "connecting" | "connected" | "error";

export interface UseLiveKitOptions {
  api: APIClient | null;
  /** Optional: receive a text message from the agent via RPC */
  onAgentMessage?: (text: string) => void;
}

export interface UseLiveKitReturn {
  state: LiveKitState;
  error: string | null;
  isMicOn: boolean;
  isCameraOn: boolean;
  localVideoTrack: LocalVideoTrack | null;
  remoteParticipants: RemoteParticipant[];
  connect: (roomName: string, identity: string) => Promise<void>;
  disconnect: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
}

export function useLiveKit({ api, onAgentMessage }: UseLiveKitOptions): UseLiveKitReturn {
  const [state, setState] = useState<LiveKitState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);

  const roomRef = useRef<Room | null>(null);

  // ── Sync remote participants list ───────────────────────────────────

  const syncParticipants = useCallback((room: Room) => {
    setRemoteParticipants(Array.from(room.remoteParticipants.values()));
  }, []);

  // ── Disconnect (also used for cleanup) ─────────────────────────────

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      void roomRef.current.disconnect();
      roomRef.current = null;
    }
    setState("disconnected");
    setError(null);
    setIsMicOn(false);
    setIsCameraOn(false);
    setLocalVideoTrack(null);
    setRemoteParticipants([]);
  }, []);

  // ── Connect ────────────────────────────────────────────────────────

  const connect = useCallback(
    async (roomName: string, identity: string) => {
      if (!api) {
        setError("API not available");
        setState("error");
        return;
      }
      if (roomRef.current) {
        // Already connected or connecting — disconnect first
        disconnect();
      }

      setState("connecting");
      setError(null);

      try {
        // 1. Get token from backend
        const result = await api.livekit.getToken({ roomName, identity });
        if (!result.success) {
          setError(result.error);
          setState("error");
          return;
        }
        const { token, wsUrl } = result.data;

        // 2. Create room
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        roomRef.current = room;

        // 3. Subscribe to room events
        room
          .on(RoomEvent.Connected, () => {
            setState("connected");
            syncParticipants(room);
          })
          .on(RoomEvent.Disconnected, () => {
            setState("disconnected");
            setIsMicOn(false);
            setIsCameraOn(false);
            setLocalVideoTrack(null);
            setRemoteParticipants([]);
            roomRef.current = null;
          })
          .on(RoomEvent.ParticipantConnected, () => syncParticipants(room))
          .on(RoomEvent.ParticipantDisconnected, () => syncParticipants(room))
          .on(RoomEvent.LocalTrackPublished, (pub) => {
            if (
              pub.track instanceof LocalVideoTrack &&
              pub.track.source === Track.Source.Camera
            ) {
              setLocalVideoTrack(pub.track);
              setIsCameraOn(true);
            }
            if (pub.track?.source === Track.Source.Microphone) {
              setIsMicOn(!pub.isMuted);
            }
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub) => {
            if (pub.track?.source === Track.Source.Camera) {
              setLocalVideoTrack(null);
              setIsCameraOn(false);
            }
            if (pub.track?.source === Track.Source.Microphone) {
              setIsMicOn(false);
            }
          })
          .on(RoomEvent.TrackMuted, (pub, participant) => {
            if (participant === room.localParticipant) {
              if (pub.track?.source === Track.Source.Microphone) setIsMicOn(false);
            }
          })
          .on(RoomEvent.TrackUnmuted, (pub, participant) => {
            if (participant === room.localParticipant) {
              if (pub.track?.source === Track.Source.Microphone) setIsMicOn(true);
            }
          });

        // 4. Register RPC handler for agent → workbench messages
        room.localParticipant.registerRpcMethod(
          "sendMessage",
          async (data: { payload: string }) => {
            try {
              const parsed = JSON.parse(data.payload) as { text?: string };
              if (parsed.text && onAgentMessage) {
                onAgentMessage(parsed.text);
              }
            } catch {
              // ignore parse errors
            }
            return "ok";
          }
        );

        // 5. Connect
        const connectOptions: RoomConnectOptions = {
          autoSubscribe: true,
        };
        await room.connect(wsUrl, token, connectOptions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setState("error");
        roomRef.current = null;
      }
    },
    [api, disconnect, onAgentMessage, syncParticipants]
  );

  // ── Toggle mic ─────────────────────────────────────────────────────

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || state !== "connected") return;
    const enabled = !isMicOn;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    setIsMicOn(enabled);
  }, [isMicOn, state]);

  // ── Toggle camera ──────────────────────────────────────────────────

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || state !== "connected") return;
    const enabled = !isCameraOn;
    await room.localParticipant.setCameraEnabled(enabled);
    // localVideoTrack + isCameraOn updated via LocalTrackPublished/Unpublished events
  }, [isCameraOn, state]);

  // ── Cleanup on unmount ─────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (roomRef.current) {
        void roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, []);

  return {
    state,
    error,
    isMicOn,
    isCameraOn,
    localVideoTrack,
    remoteParticipants,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
  };
}
