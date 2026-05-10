// 8-bit-ish chirps for the mascot. Web Audio API only — no assets, no
// network. One shared AudioContext, lazy-initialised on first user gesture
// (browsers block AudioContext until then). Respects prefers-reduced-motion.

export type ChirpKind = "cheer" | "error" | "level-up" | "click";

let ctx: AudioContext | null = null;
let muted = true; // off by default — user opts in via Settings

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

export function setMuted(value: boolean): void {
  muted = value;
}

export function isMuted(): boolean {
  return muted;
}

function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Note {
  readonly freq: number;
  readonly start: number; // seconds offset from "now"
  readonly dur: number;   // seconds
  readonly type?: OscillatorType;
  readonly vol?: number;
}

function playSequence(notes: ReadonlyArray<Note>, masterGain = 0.07): void {
  if (muted || reducedMotion()) return;
  const audio = getCtx();
  if (!audio) return;
  // Resume in case the context is suspended (browser autoplay policies)
  if (audio.state === "suspended") void audio.resume();

  const now = audio.currentTime;
  for (const n of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = n.type ?? "square";
    osc.frequency.setValueAtTime(n.freq, now + n.start);
    const peak = (n.vol ?? 1) * masterGain;
    // Tiny attack/release to avoid clicks
    gain.gain.setValueAtTime(0, now + n.start);
    gain.gain.linearRampToValueAtTime(peak, now + n.start + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + n.start + n.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + n.start);
    osc.stop(now + n.start + n.dur + 0.02);
  }
}

// ── canonical chirps ──

export function playChirp(kind: ChirpKind): void {
  switch (kind) {
    case "cheer":
      // Rising arpeggio — C5, E5, G5
      playSequence([
        { freq: 523.25, start: 0.00, dur: 0.08 },
        { freq: 659.25, start: 0.08, dur: 0.08 },
        { freq: 783.99, start: 0.16, dur: 0.12 },
      ]);
      break;
    case "error":
      // Descending beep — G4, E4, C4 with sawtooth for grit
      playSequence([
        { freq: 392.00, start: 0.00, dur: 0.09, type: "sawtooth" },
        { freq: 329.63, start: 0.09, dur: 0.09, type: "sawtooth" },
        { freq: 261.63, start: 0.18, dur: 0.16, type: "sawtooth" },
      ], 0.05);
      break;
    case "level-up":
      // Fanfare — C5, E5, G5, C6, then sustained C6
      playSequence([
        { freq: 523.25, start: 0.00, dur: 0.10 },
        { freq: 659.25, start: 0.10, dur: 0.10 },
        { freq: 783.99, start: 0.20, dur: 0.10 },
        { freq: 1046.5, start: 0.30, dur: 0.10 },
        { freq: 1046.5, start: 0.45, dur: 0.30, vol: 0.7, type: "triangle" },
        // Sparkle on top
        { freq: 1568.0, start: 0.50, dur: 0.06, vol: 0.4 },
        { freq: 2093.0, start: 0.58, dur: 0.06, vol: 0.4 },
      ], 0.08);
      break;
    case "click":
      // Tiny tick for hover/click — short triangle
      playSequence([
        { freq: 880, start: 0, dur: 0.03, type: "triangle", vol: 0.5 },
      ], 0.04);
      break;
  }
}
