// Sound effects for moves on the board: a move, a capture, castling, a promotion, check, checkmate, and the end of a
// game without a mate (stalemate, insufficient material).
//
// Recorded samples (public/sounds, listed in sounds.json; from PyChess, GPL-3.0-or-later, see CREDITS.md there) are
// the sounds: 'place' (a piece set down) and 'take' (a capture: several takes of the same two knocks, one picked at
// random). Everything else is built from those two, with no tones (`playSamples`): castling is king then rook, check
// a firmer placement and a light tap, checkmate a heavy landing and the king tipped over, a draw a second piece
// quietly laid down, a promotion the new piece placed after the pawn, one move back a quiet placement. Each play
// varies pitch and level a touch, so stepping through a game doesn't sound like a loop. The samples are decoded at
// start-up (`preloadSounds`, on an OfflineAudioContext: no audio starts before a user gesture); a sound asked for
// while they are still loading waits for them briefly. Only when they can't be loaded is the synthesised fallback
// used (`piece`: modal wooden knocks, the same shapes).
//
// `soundFor` (pure) picks the sound for a move; `playSound` plays it (a no-op where there is no Web Audio, e.g. tests).
// The App plays one when the board steps one move forward (a move played or "Next"), a quiet knock one move back,
// and nothing on a jump (start / end / a click in the move list), so scrolling through a game isn't noisy.

import { isCheckmate, tryPosition } from './chess';

export type SoundKind = 'move' | 'capture' | 'castle' | 'promote' | 'check' | 'checkmate' | 'draw' | 'back';

export const SOUND_KINDS: readonly SoundKind[] = ['move', 'capture', 'castle', 'promote', 'check', 'checkmate', 'draw', 'back'];

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

// ---------------------------------------------------------------------------------------------------------------
// The audio graph: voices -> bus -> (dry + room) -> compressor -> master -> speakers

interface Engine {
  ac: AudioContext;
  bus: GainNode;
  master: GainNode;
  noise: AudioBuffer;
}

let engine: Engine | null = null;
let unavailable = false;

/** Mono white noise, `seconds` long. */
function whiteNoise(ac: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** A small, warm room: stereo noise decaying exponentially, darker as it decays (a one-pole low-pass that closes). */
function roomImpulse(ac: BaseAudioContext, seconds = 0.45): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const coef = 0.55 - 0.45 * x; // brighter early reflections, duller tail
      lp += coef * (Math.random() * 2 - 1 - lp);
      // a short pre-delay, then an exponential tail
      d[i] = i < ac.sampleRate * 0.008 ? 0 : lp * Math.pow(1 - x, 3.2);
    }
  }
  return buf;
}

function getEngine(): Engine | null {
  if (engine || unavailable) return engine;
  const w = typeof window !== 'undefined' ? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }) : undefined;
  const Ctor = w?.AudioContext ?? w?.webkitAudioContext;
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    const ac = new Ctor({ latencyHint: 'interactive' });
    const master = ac.createGain();
    master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    const bus = ac.createGain();
    const room = ac.createConvolver();
    room.buffer = roomImpulse(ac);
    const wet = ac.createGain();
    wet.gain.value = 0.16;
    bus.connect(comp);
    bus.connect(room).connect(wet).connect(comp);
    comp.connect(master).connect(ac.destination);
    engine = { ac, bus, master, noise: whiteNoise(ac, 0.5) };
  } catch {
    unavailable = true;
  }
  return engine;
}

const jitter = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;

/** An exponential decay from `peak` at `t` (after a short linear attack), time constant `tau`; returns the end time. */
function envelope(param: AudioParam, t: number, peak: number, tau: number, attack = 0.0015): number {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tau);
  return t + attack + tau * 7;
}

/** A burst of filtered noise. */
function noiseBurst(e: Engine, out: AudioNode, t: number, o: { type: BiquadFilterType; freq: number; q?: number; peak: number; tau: number }) {
  const src = e.ac.createBufferSource();
  src.buffer = e.noise;
  const f = e.ac.createBiquadFilter();
  f.type = o.type;
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 0.7;
  const g = e.ac.createGain();
  const end = envelope(g.gain, t, o.peak, o.tau, 0.0005);
  src.connect(f).connect(g).connect(out);
  // start at a random point in the noise, so no two ticks are the same
  src.start(t, Math.random() * 0.4);
  src.stop(end);
}

/** A damped sine mode (optionally with a pitch drop from `freq * drop` to `freq` in `dropTime`). */
function mode(e: Engine, out: AudioNode, t: number, freq: number, peak: number, tau: number, drop = 1, dropTime = 0.012) {
  const osc = e.ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * drop, t);
  if (drop !== 1) osc.frequency.exponentialRampToValueAtTime(freq, t + dropTime);
  const g = e.ac.createGain();
  const end = envelope(g.gain, t, peak, tau);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(end);
}

/** Wooden block mode ratios and how fast each dies relative to the first. */
const WOOD_MODES: readonly { ratio: number; amp: number; tau: number }[] = [
  { ratio: 1, amp: 1, tau: 1 },
  { ratio: 2.58, amp: 0.55, tau: 0.62 },
  { ratio: 4.11, amp: 0.3, tau: 0.42 },
  { ratio: 6.33, amp: 0.16, tau: 0.28 },
];

/**
 * A piece set down on the board. `pitch`: the body's lowest mode (Hz; lighter pieces higher), `vel`: 0 … 1 how hard,
 * `weight`: 0 … 1 how much board thump.
 */
function piece(e: Engine, t: number, o: { pitch: number; vel: number; weight?: number; ring?: number }) {
  const out = e.ac.createGain();
  // the stereo position wanders a touch, like pieces on different squares
  const pan = e.ac.createStereoPanner();
  pan.pan.value = (Math.random() * 2 - 1) * 0.18;
  out.connect(pan).connect(e.bus);
  const vel = o.vel * jitter(0.1);
  const f0 = o.pitch * jitter(0.04);
  const ring = (o.ring ?? 1) * jitter(0.08);
  const weight = o.weight ?? 0.6;
  // contact tick
  noiseBurst(e, out, t, { type: 'highpass', freq: 2600, peak: 0.55 * vel, tau: 0.0035 });
  noiseBurst(e, out, t, { type: 'bandpass', freq: f0 * 2.2, q: 1.4, peak: 0.35 * vel, tau: 0.008 });
  // the piece's body
  for (const m of WOOD_MODES) mode(e, out, t, f0 * m.ratio * jitter(0.01), 0.42 * vel * m.amp, 0.032 * ring * m.tau, 1.015);
  // the board
  mode(e, out, t, 150 * jitter(0.05), 0.5 * vel * weight, 0.03, 1.5, 0.018);
  noiseBurst(e, out, t, { type: 'lowpass', freq: 520, peak: 0.45 * vel * weight, tau: 0.014 });
}

// ---------------------------------------------------------------------------------------------------------------
// Recorded samples: `public/sounds/sounds.json` maps each sample key to one or more files in public/sounds (several =
// one picked at random per play).

type SampleKey = 'place' | 'take';
const samples = new Map<SampleKey, AudioBuffer[]>();
let samplesLoading: Promise<void> | null = null;
/** True once loading has finished (with or without samples). */
let samplesSettled = false;

/** How long a sound asked for while the samples are loading waits for them (the first move after the page opened). */
const LOAD_WAIT_MS = 1500;

/**
 * Load and decode the samples listed in public/sounds/sounds.json (once). Decoded on an OfflineAudioContext, so it can
 * run at start-up, before any user gesture, without starting audio (an AudioBuffer plays on any context).
 */
export function preloadSounds(): Promise<void> {
  if (samplesLoading) return samplesLoading;
  const w = typeof window !== 'undefined' ? (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }) : undefined;
  const Offline = w?.OfflineAudioContext ?? w?.webkitOfflineAudioContext;
  if (!Offline || typeof fetch === 'undefined') {
    samplesSettled = true;
    return (samplesLoading = Promise.resolve());
  }
  const base = `${import.meta.env.BASE_URL ?? '/'}sounds/`;
  samplesLoading = (async () => {
    try {
      const decoder = new Offline(1, 1, 44100);
      const r = await fetch(`${base}sounds.json`);
      if (!r.ok) return;
      const manifest = (await r.json()) as Partial<Record<SampleKey, string[]>>;
      await Promise.all(
        Object.entries(manifest).map(async ([key, files]) => {
          const bufs: AudioBuffer[] = [];
          for (const f of files ?? []) {
            try {
              const fr = await fetch(base + f);
              if (fr.ok) bufs.push(await decoder.decodeAudioData(await fr.arrayBuffer()));
            } catch {
              // a missing or undecodable file: skipped
            }
          }
          if (bufs.length) samples.set(key as SampleKey, bufs);
        }),
      );
    } catch {
      // no manifest: the synthesised fallback
    } finally {
      samplesSettled = true;
    }
  })();
  return samplesLoading;
}

/** The sample keys that loaded (after `preloadSounds`): empty = the synthesised fallback. */
export function loadedSamples(): string[] {
  return [...samples.keys()];
}

/** Play one of `key`'s samples at `t`, `gain` and `rate` varied a touch; false when there is none. */
function sample(e: Engine, key: SampleKey, t: number, gain = 1, rate = 1): boolean {
  const bufs = samples.get(key);
  if (!bufs?.length) return false;
  const src = e.ac.createBufferSource();
  src.buffer = bufs[Math.floor(Math.random() * bufs.length)]!;
  src.playbackRate.value = rate * jitter(0.02);
  const g = e.ac.createGain();
  g.gain.value = gain * jitter(0.06);
  // straight to the output: the recordings carry their own room and need no compressor
  src.connect(g).connect(e.master);
  src.start(t);
  return true;
}

/** Sample levels (one move back is a quiet placement). */
const LEVEL = { place: 0.85, take: 0.95, back: 0.4 } as const;

/**
 * The samples' version of `kind`. Everything is built from the two piece recordings — no tones:
 *  - capture: a heavy landing, then the taken piece knocked over: a low knock and two fading rocks;
 *  - check: the piece set down a touch firmer and lower, then a light tap (a finger on the piece);
 *  - checkmate: the two-knock 'take' recording, then the king toppling and bouncing to rest (lower knocks, each
 *    quieter and sooner than the one before);
 *  - draw: the piece set down, then a second piece quietly laid on the board;
 *  - promotion: the pawn set down, then the new piece placed, lighter and higher.
 * Castling is king then rook, one move back a quiet placement.
 */
function playSamples(e: Engine, kind: SoundKind, t: number, capture: boolean) {
  const tap = (at: number, gain: number, rate: number) => sample(e, 'place', at, LEVEL.place * gain, rate);
  const take = (at: number, gain = 1) => {
    const j = jitter(0.1);
    tap(at, 1.15 * gain, 0.92);
    tap(at + 0.17 * j, 0.55 * gain, 0.84); // the taken piece knocked over
    tap(at + 0.25 * j, 0.2 * gain, 0.88); // and rocking
    tap(at + 0.3 * j, 0.08 * gain, 0.92);
  };
  const piece = (at: number, gain = 1, rate = 1) => (capture ? take(at, gain) : tap(at, gain, rate));
  switch (kind) {
    case 'move':
      piece(t);
      break;
    case 'capture':
      take(t);
      break;
    case 'back':
      sample(e, 'place', t, LEVEL.back, 1.04);
      break;
    case 'castle':
      sample(e, 'place', t, LEVEL.place, 0.96); // king
      sample(e, 'place', t + 0.12, LEVEL.place * 0.9, 1.05); // rook
      break;
    case 'promote':
      piece(t);
      tap(t + 0.09, 0.5, 1.15);
      break;
    case 'check':
      piece(t, 1.12, 0.95);
      tap(t + 0.075, 0.3, 1.12);
      break;
    case 'checkmate': {
      if (!sample(e, 'take', t, LEVEL.take * 1.05, 0.94)) take(t);
      // the king topples and bounces to rest
      const start = t + 0.3 * jitter(0.05);
      const bounces: readonly [number, number][] = [[0, 0.6], [0.09, 0.36], [0.155, 0.21], [0.203, 0.12], [0.239, 0.06]];
      for (const [dt, g] of bounces) tap(start + dt, g, 0.8);
      break;
    }
    case 'draw':
      piece(t);
      tap(t + (capture ? 0.4 : 0.2), 0.32, 0.93);
      break;
  }
}

export interface PlayOptions {
  /** 0 … 1 (default 0.8). */
  volume?: number;
  /** The move was also a capture (check / draw: built on the capture sound instead of a plain placement). */
  capture?: boolean;
}

/** Play `kind` now. Silently does nothing without Web Audio. */
export function playSound(kind: SoundKind, opts: PlayOptions = {}): void {
  const e = getEngine();
  if (!e) return;
  if (e.ac.state === 'suspended') void e.ac.resume().catch(() => undefined);
  const volume = opts.volume ?? 0.8;
  const capture = !!opts.capture;
  const go = () => {
    e.master.gain.value = 0.9 * volume;
    const t = e.ac.currentTime + 0.005;
    if (samples.has('place')) playSamples(e, kind, t, capture);
    else synthesise(e, kind, t, capture);
  };
  if (samplesSettled) {
    go();
    return;
  }
  // still loading: wait for the samples, a little
  const asked = Date.now();
  void preloadSounds().then(() => {
    if (Date.now() - asked < LOAD_WAIT_MS) go();
  });
}

/** The synthesised fallback, when the samples can't be loaded. */
function synthesise(e: Engine, kind: SoundKind, t: number, capture: boolean) {
  const knock = (at: number) => {
    if (!capture) return piece(e, at, { pitch: 700, vel: 0.8 });
    piece(e, at, { pitch: 1050, vel: 0.42, weight: 0.15, ring: 0.6 });
    piece(e, at + 0.038, { pitch: 610, vel: 1, weight: 1, ring: 1.15 });
  };
  switch (kind) {
    case 'move':
      knock(t);
      break;
    case 'promote':
      knock(t);
      piece(e, t + 0.09, { pitch: 820, vel: 0.4, weight: 0.3 });
      break;
    case 'capture':
      capture = true;
      knock(t);
      break;
    case 'back':
      piece(e, t, { pitch: 760, vel: 0.38, weight: 0.25, ring: 0.7 });
      break;
    case 'castle':
      piece(e, t, { pitch: 640, vel: 0.8, weight: 0.7 });
      piece(e, t + 0.14, { pitch: 740, vel: 0.72, weight: 0.6 });
      break;
    case 'check':
      knock(t);
      piece(e, t + 0.075, { pitch: 900, vel: 0.25, weight: 0, ring: 0.6 });
      break;
    case 'checkmate':
      knock(t);
      for (const [dt, v] of [[0.3, 0.5], [0.39, 0.3], [0.455, 0.18], [0.503, 0.1]] as const) piece(e, t + dt, { pitch: 540, vel: v, weight: 0.6 });
      break;
    case 'draw':
      knock(t);
      piece(e, t + 0.2, { pitch: 650, vel: 0.28, weight: 0.4 });
      break;
  }
}
