// (UI round) Tone of a fact FOR THE MOVER: does it help ('good'), hurt ('bad') or just describe ('neutral')?
// Pure data mapping, no prose. The server's explain.ts derives `Level.tones` from it (plus a few context rules where a
// sentence says something else than the bare fact, e.g. a hang worded as a sound sacrifice); the client's mock
// fixtures use it directly.
import type { Color, Fact, Tone } from './types';

/**
 * - bad: hangs, allows, allows-mate, misses-mate, misses, a capture that loses material (not a desperado), the
 *   mover's own castling-lost, a positional change against the mover;
 * - good: checkmate, winning capture / recapture, promotion, castling, development, attacks and tactics (fork, pin,
 *   skewer, discovered attack, trap, attack on a pinned piece), threats, defences (defends-threat, defend, escape,
 *   prevents), the opponent's castling-lost, a positional change for the mover, positional-gain;
 * - neutral: check, stalemate, even trades, desperado captures, check evasions, forced replies, deep-payoff,
 *   necessary, nothing-notable; a line fact by its result (see `lineTone`).
 */
export function factTone(f: Fact, mover: Color): Tone {
  switch (f.type) {
    case 'checkmate':
    case 'promotion':
    case 'castle':
    case 'develop':
    case 'attack':
    case 'fork':
    case 'pin':
    case 'skewer':
    case 'discovered-attack':
    case 'trapped':
    case 'attack-pinned':
    case 'threat':
    case 'defends-threat':
    case 'defend':
    case 'escape':
    case 'prevents':
    case 'positional-gain':
      return 'good';
    case 'capture':
      if (f.outcome === 'wins-material' || f.outcome === 'recapture') return 'good';
      if (f.outcome === 'loses-material') return f.desperado ? 'neutral' : 'bad';
      return 'neutral';
    case 'hangs':
    case 'allows':
    case 'allows-mate':
    case 'misses-mate':
    case 'misses':
    case 'loosens':
    case 'chased':
    case 'passer':
    case 'undeveloped':
    case 'trades-down':
      return 'bad';
    case 'castling-lost':
      return f.color === mover ? 'bad' : 'good';
    case 'positional':
      // delta: + = good for the mover (whichever side's pieces changed)
      return f.delta > 0 ? 'good' : f.delta < 0 ? 'bad' : 'neutral';
    case 'line':
      return lineTone(f);
    default:
      return 'neutral';
  }
}

/** A short-term line by its result: mate / material won = good, mated / material lost = bad, else neutral. */
export function lineTone(line: Extract<Fact, { type: 'line' }>): Tone {
  if (line.draw && line.result !== 'mate' && line.result !== 'mated') return 'neutral';
  switch (line.result) {
    case 'mate':
    case 'wins-material':
      return 'good';
    case 'mated':
    case 'loses-material':
      return 'bad';
    default:
      return 'neutral';
  }
}

/** Order for a bad move's sentences: what hurts first, then what just describes the move, then what helps. */
export const BAD_MOVE_TONE_ORDER: Readonly<Record<Tone, number>> = { bad: 0, neutral: 1, good: 2 };
