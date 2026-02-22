/**
 * AudioWaveVisualizer — canvas-based agent audio wave.
 *
 * When a remote audio track is connected, reads real-time PCM data via
 * Web Audio AnalyserNode and draws a smooth sine-wave.
 * Falls back to a gentle animated idle wave when no track is present.
 */

import { useEffect, useRef } from "react";
import type { RemoteAudioTrack } from "livekit-client";
import { cn } from "@/common/lib/utils";

interface AudioWaveVisualizerProps {
  /** Agent's remote audio track — from remoteParticipants audio publications */
  audioTrack: RemoteAudioTrack | null;
  /** True while the agent is actively speaking (boosts amplitude) */
  isSpeaking?: boolean;
  className?: string;
}

export function AudioWaveVisualizer({
  audioTrack,
  isSpeaking = false,
  className,
}: AudioWaveVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>();

  // ── Connect remote audio track → AnalyserNode ──────────────────────
  useEffect(() => {
    if (!audioTrack?.mediaStreamTrack) {
      analyserRef.current = null;
      return;
    }

    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const stream = new MediaStream([audioTrack.mediaStreamTrack]);
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      analyserRef.current = analyser;
    } catch {
      analyserRef.current = null;
    }

    return () => {
      analyserRef.current = null;
      void ctx?.close();
    };
  }, [audioTrack]);

  // ── Render loop ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    let phase = 0;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      ctx2d.clearRect(0, 0, W, H);

      // ── Collect wave points ─────────────────────────────────────────
      let pts: number[];
      const analyser = analyserRef.current;

      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(buf);
        pts = Array.from(buf, (v) => (v - 128) / 128); // –1 … +1
      } else {
        // Idle sine — slow gentle oscillation
        phase += 0.018;
        pts = Array.from({ length: 128 }, (_, i) =>
          Math.sin((i / 127) * Math.PI * 3.5 + phase) * 0.12 +
          Math.sin((i / 127) * Math.PI * 1.2 + phase * 0.6) * 0.05
        );
      }

      // ── Draw ────────────────────────────────────────────────────────
      // Amplitude: louder while speaking
      const amp = isSpeaking ? 1.0 : 0.45;

      // Horizontal fade gradient (invisible at edges)
      const grad = ctx2d.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(74, 222, 128, 0)");
      grad.addColorStop(0.12, "rgba(74, 222, 128, 0.65)");
      grad.addColorStop(0.5, "rgba(134, 239, 172, 0.85)");
      grad.addColorStop(0.88, "rgba(74, 222, 128, 0.65)");
      grad.addColorStop(1, "rgba(74, 222, 128, 0)");

      ctx2d.save();
      ctx2d.strokeStyle = grad;
      ctx2d.lineWidth = 1.5;
      ctx2d.shadowColor = "rgba(74, 222, 128, 0.35)";
      ctx2d.shadowBlur = 8;
      ctx2d.beginPath();

      for (let i = 0; i < pts.length; i++) {
        const x = (i / (pts.length - 1)) * W;
        const y = H / 2 + pts[i] * amp * (H / 2 - 10);
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();
      ctx2d.restore();
    };

    draw();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isSpeaking]);

  // Keep canvas drawing-buffer in sync with its CSS display size.
  // Without this the canvas intrinsic height (144) overrides h-full in compact mode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn("w-full h-full", className)}
      // No width/height attrs — let CSS + ResizeObserver control the buffer size
    />
  );
}
