/**
 * Pixel HQ Audio System
 *
 * Optional ambient sounds and SFX for the pixel office visualization.
 * Uses the Web Audio API (AudioContext) following the same patterns
 * as PowerModeEngine's audio system. All sounds are synthesized
 * procedurally — no audio file dependencies.
 *
 * Sounds:
 *   - Typing clicks (when character is in TYPE state)
 *   - Spawn tone (matrix spawn effect)
 *   - Despawn tone (matrix despawn)
 *   - Bubble pop (speech bubble appears)
 *   - Ambient hum (low background drone)
 *   - Celebration jingle (morale: celebrating)
 */

// ─────────────────────────────────────────────────────────────────────────────
// PixelHQAudio
// ─────────────────────────────────────────────────────────────────────────────

export class PixelHQAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private _enabled: boolean = false;
  private _volume: number = 0.3;

  /** Whether audio is enabled */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Master volume (0-1) */
  get volume(): number {
    return this._volume;
  }

  /** Initialize the AudioContext (must be called after user interaction). */
  init(): void {
    if (this.ctx) return;

    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._volume;
      this.masterGain.connect(this.ctx.destination);
      this._enabled = true;
    } catch (e) {
      console.warn("[PixelHQAudio] Failed to create AudioContext:", e);
      this._enabled = false;
    }
  }

  /** Enable/disable audio. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) {
      this.stopAmbient();
    }
  }

  /** Set master volume (0-1). */
  setVolume(vol: number): void {
    this._volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.value = this._volume;
    }
  }

  // ─── Sound Effects ──────────────────────────────────────────────────────

  /** Play a soft typing click sound. */
  playTypingClick(): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    // Short noise burst for key click
    const bufferSize = ctx.sampleRate * 0.02; // 20ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    // High-pass filter for click feel
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2000;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);
    source.start(now);
    source.stop(now + 0.03);
  }

  /** Play a rising tone for matrix spawn effect. */
  playSpawnTone(): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  /** Play a falling tone for despawn effect. */
  playDespawnTone(): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  /** Play a soft pop for speech bubble. */
  playBubblePop(): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** Play a short celebration jingle (3 ascending notes). */
  playCelebration(): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  // ─── Ambient ────────────────────────────────────────────────────────────

  /** Start a low ambient hum (server room / office ambiance). */
  startAmbient(): void {
    if (!this.canPlay() || this.ambientOsc) return;
    const ctx = this.ctx!;

    this.ambientOsc = ctx.createOscillator();
    this.ambientOsc.type = "sine";
    this.ambientOsc.frequency.value = 60; // Low hum

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.03; // Very subtle

    // Add slight detuning for warmth
    const detune = ctx.createOscillator();
    detune.type = "sine";
    detune.frequency.value = 60.5;
    const detuneGain = ctx.createGain();
    detuneGain.gain.value = 0.02;

    this.ambientOsc.connect(this.ambientGain);
    detune.connect(detuneGain);
    this.ambientGain.connect(this.masterGain!);
    detuneGain.connect(this.masterGain!);

    this.ambientOsc.start();
    detune.start();
  }

  /** Stop the ambient hum. */
  stopAmbient(): void {
    if (this.ambientOsc) {
      try {
        this.ambientOsc.stop();
      } catch {
        // Already stopped
      }
      this.ambientOsc.disconnect();
      this.ambientOsc = null;
    }
    if (this.ambientGain) {
      this.ambientGain.disconnect();
      this.ambientGain = null;
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /** Dispose the audio system and release resources. */
  dispose(): void {
    this.stopAmbient();
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this._enabled = false;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private canPlay(): boolean {
    return this._enabled && this.ctx !== null && this.masterGain !== null;
  }
}
