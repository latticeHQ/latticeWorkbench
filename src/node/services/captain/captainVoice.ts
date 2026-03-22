/**
 * Captain Voice Integration
 *
 * Bridges the Captain's cognitive loop with LiveKit for real-time
 * voice conversations. The Captain can both respond to voice input
 * and proactively initiate voice conversations.
 *
 * Voice transcripts feed into the cognitive loop as perception events.
 * Captain messages can be spoken aloud via LiveKit TTS.
 */

import { log } from "@/node/services/log";
import type { CaptainIdentity } from "./types";

export interface VoiceSessionConfig {
  /** LiveKit server URL. */
  serverUrl: string;
  /** Room name for the captain's voice session. */
  roomName: string;
  /** Participant token for auth. */
  participantToken: string;
  /** Captain identity for voice/personality config. */
  identity: CaptainIdentity;
}

export interface CaptainVoiceConfig {
  /** Voice provider: "elevenlabs", "cartesia", "deepgram" */
  voiceProvider: string;
  /** Voice ID for TTS. */
  voiceId: string;
  /** Speech rate multiplier. */
  speechRate: number;
  /** STT provider: "deepgram", "assemblyai", "openai" */
  sttProvider: string;
  /** Avatar provider (optional): "tavus", "keyframe", "beyond-presence" */
  avatarProvider?: string;
  /** Avatar ID (optional). */
  avatarId?: string;
}

export const DEFAULT_VOICE_CONFIG: CaptainVoiceConfig = {
  voiceProvider: "elevenlabs",
  voiceId: "21m00Tcm4TlvDq8ikWAM", // Default ElevenLabs voice
  speechRate: 1.0,
  sttProvider: "deepgram",
};

/**
 * Captain Voice Service
 *
 * Manages the Captain's voice presence via LiveKit.
 * Connects to latticeRuntime's /api/v2/connection-details with captainMode=true.
 */
export class CaptainVoice {
  private active: boolean = false;
  private voiceConfig: CaptainVoiceConfig;
  private roomName: string | null = null;

  /** Callback to feed transcripts into the cognitive loop. */
  private onTranscript: ((text: string) => void) | null = null;

  constructor(config?: Partial<CaptainVoiceConfig>) {
    this.voiceConfig = { ...DEFAULT_VOICE_CONFIG, ...config };
  }

  /** Set the transcript callback (wired to perception.enqueueVoiceTranscript). */
  setTranscriptCallback(fn: (text: string) => void): void {
    this.onTranscript = fn;
  }

  /**
   * Build the connection details request for latticeRuntime.
   * This is sent to POST /api/v2/connection-details with captainMode=true.
   */
  buildConnectionRequest(
    captainId: string,
    identity: CaptainIdentity,
  ): Record<string, unknown> {
    return {
      roomName: `captain-${captainId}`,
      participantName: identity.name,
      agentName: "captain-voice",
      captainMode: true,
      captainId,
      enableTranscriber: true,
      sessionConfig: {
        voiceProvider: this.voiceConfig.voiceProvider,
        voiceId: this.voiceConfig.voiceId,
        speechRate: this.voiceConfig.speechRate,
        model: identity.preferences.default_model,
        modelProvider: "anthropic",
        temperature: 0.7,
        maxTokens: 4096,
        instructions: [
          `You are ${identity.name}, an autonomous AI captain.`,
          `Personality: ${identity.personality.traits.join(", ")}`,
          `Communication style: ${identity.personality.communication_style}`,
          `Values: ${identity.personality.values.join(", ")}`,
        ].join("\n"),
        sttProvider: this.voiceConfig.sttProvider,
        avatarEnabled: !!this.voiceConfig.avatarProvider,
        avatarProvider: this.voiceConfig.avatarProvider ?? "",
        avatarId: this.voiceConfig.avatarId ?? "",
      },
    };
  }

  /** Start a voice session. */
  async start(captainId: string, _identity: CaptainIdentity): Promise<void> {
    if (this.active) {
      log.warn("[Captain Voice] Session already active");
      return;
    }

    this.roomName = `captain-${captainId}`;
    this.active = true;
    log.info(`[Captain Voice] Started voice session in room ${this.roomName}`);
  }

  /** Stop the voice session. */
  async stop(): Promise<void> {
    if (!this.active) return;

    this.active = false;
    this.roomName = null;
    log.info("[Captain Voice] Stopped voice session");
  }

  /** Check if voice is active. */
  isActive(): boolean {
    return this.active;
  }

  /** Get the current room name. */
  getRoomName(): string | null {
    return this.roomName;
  }

  /**
   * Handle an incoming voice transcript.
   * Called by the LiveKit transcriber integration.
   */
  handleTranscript(text: string): void {
    if (!this.active) return;
    if (!text.trim()) return;

    log.debug(`[Captain Voice] Transcript: ${text.slice(0, 80)}...`);
    this.onTranscript?.(text);
  }
}
