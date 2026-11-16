// Sound effects for moves on the board: a move, a capture, castling, a promotion, check, checkmate, and the end of a
// game without a mate (stalemate, insufficient material). Synthesised with the Web Audio API (no sound files): short
// filtered noise "knocks" of wood on wood for the moves, small bell tones for check and the end of the game.
// `soundFor` (pure) picks the sound for a move; `playSound` plays it (a no-op where there is no Web Audio, e.g. tests).
// The App plays one when the board steps one move forward (a move played or "Next"), a quiet knock one move back,
// and nothing on a jump (start / end / a click in the move list), so scrolling through a game isn't noisy.

import { isCheckmate, tryPosition } from './chess';

export type SoundKind = 'move' | 'capture' | 'castle' | 'promote' | 'check' | 'checkmate' | 'draw' | 'back';

/** The sound for the move `san` that led to `fenAfter`: the end of the game first, then check, then the move itself. */
export function soundFor(san: string, fenAfter: string): SoundKind {
  if (san.includes('#') || isCheckmate(fenAfter)) return 'checkmate';
  const pos = tryPosition(fenAfter);
  if (pos && pos.isEnd()) return 'draw';
  if (san.includes('+')) return 'check';
  if (san.includes('=')) return 'promote';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  return 'move';
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(ac.sampleRate * 0.25);
  noise = ac.createBuffer(1, len, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** A wooden knock at `t`: a burst of band-passed noise plus a short low thump. */
function knock(ac: AudioContext, out: AudioNode, t: number, opts: { freq: number; gain: number; decay: number }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = opts.freq;
  bp.Q.value = 3;
  const g = ac.createGain();
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + opts.decay + 0.02);

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(opts.freq / 4, t);
  osc.frequency.exponentialRampToValueAtTime(opts.freq / 8, t + opts.decay);
  const og = ac.createGain();
  og.gain.setValueAtTime(opts.gain * 0.6, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + opts.decay + 0.02);
}

/** A soft bell tone at `t` (sine with a quieter octave above). */
function bell(ac: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number) {
  for (const [mult, level] of [[1, 1], [2, 0.3]] as const) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

/** Play `kind` now. Silently does nothing without Web Audio (or before the page has had a user gesture). */
export function playSound(kind: SoundKind, volume = 0.6): void {
  const ac = audio();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume().catch(() => undefined);
  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  const t = ac.currentTime + 0.005;
  switch (kind) {
    case 'move':
      knock(ac, out, t, { freq: 1400, gain: 0.9, decay: 0.07 });
      break;
    case 'back':
      knock(ac, out, t, { freq: 1100, gain: 0.45, decay: 0.05 });
      break;
    case 'capture':
      knock(ac, out, t, { freq: 900, gain: 1, decay: 0.09 });
      knock(ac, out, t + 0.045, { freq: 1600, gain: 0.8, decay: 0.08 });
      break;
    case 'castle':
      knock(ac, out, t, { freq: 1400, gain: 0.85, decay: 0.07 });
      knock(ac, out, t + 0.11, { freq: 1250, gain: 0.85, decay: 0.07 });
      break;
    case 'promote':
      knock(ac, out, t, { freq: 1400, gain: 0.85, decay: 0.07 });
      bell(ac, out, t + 0.06, 784, 0.25, 0.25);
      bell(ac, out, t + 0.14, 1047, 0.3, 0.25);
      break;
    case 'check':
      knock(ac, out, t, { freq: 1300, gain: 0.85, decay: 0.07 });
      bell(ac, out, t + 0.03, 880, 0.3, 0.3);
      break;
    case 'checkmate':
      knock(ac, out, t, { freq: 1000, gain: 1, decay: 0.1 });
      bell(ac, out, t + 0.05, 784, 0.35, 0.3);
      bell(ac, out, t + 0.2, 988, 0.35, 0.3);
      bell(ac, out, t + 0.35, 1319, 0.7, 0.32);
      break;
    case 'draw':
      knock(ac, out, t, { freq: 1300, gain: 0.85, decay: 0.07 });
      bell(ac, out, t + 0.05, 659, 0.45, 0.28);
      bell(ac, out, t + 0.25, 523, 0.6, 0.28);
      break;
  }
}
