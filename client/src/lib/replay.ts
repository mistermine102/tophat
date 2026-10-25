// Replay of a move's consequences on the board (prototype B "Show me why" / "Show better move"): the position before
// the move, then the narrated line move by move — each step with an arrow and a ✓ / ✗ marker coloured by its tone for
// the mover and the story's caption for it — then the line's result. Drives session.setPreview; the real position
// comes back when it stops (also when the viewed move changes).
import type { Candidate, MoveAnalysis, StoryPart, Tone } from '@chess-coach/shared';
import { computed, onBeforeUnmount, reactive, watch } from 'vue';
import type { Session } from '../stores/session';
import { moveNumberLabel, playUci } from './chess';
import { lineFact, storyParts } from './tones';

export interface Frame {
  fen: string;
  /** Move leading to this frame (null for the starting position). */
  uci: string | null;
  /** "12. Nc3" style move name (null for the starting position / the result). */
  move: string | null;
  caption: string;
  tone: Tone;
  /** Index of the story part this frame shows (for the timeline), or null. */
  part: number | null;
}

const MAX_FALLBACK_PLIES = 6;

/** Frames for a candidate's (or the played move's) narrated line, from the position before the move. */
export function buildFrames(fenBefore: string, c: Candidate, intro: string): Frame[] {
  const line = lineFact(c.explanation?.short);
  const parts = storyParts(c.explanation?.short);
  const ucis = line?.steps.length ? line.steps.map((s) => s.uci) : c.pvUci.slice(0, MAX_FALLBACK_PLIES);
  const frames: Frame[] = [{ fen: fenBefore, uci: null, move: null, caption: intro, tone: 'neutral', part: null }];
  let fen = fenBefore;
  for (let i = 0; i < ucis.length; i++) {
    const before = fen;
    const m = playUci(fen, ucis[i]!);
    if (!m) break;
    fen = m.fenAfter;
    const pi = parts.findIndex((p) => !!p.plies && p.plies[0] <= i && i <= p.plies[1]);
    const part: StoryPart | undefined = parts[pi];
    frames.push({ fen, uci: m.uci, move: `${moveNumberLabel(before)} ${m.san}`, caption: part?.text ?? m.san, tone: part?.tone ?? 'neutral', part: pi >= 0 ? pi : null });
  }
  const last = parts[parts.length - 1];
  if (last && !last.plies && last.text !== '…' && frames.length > 1) {
    const end = frames[frames.length - 1]!;
    frames.push({ ...end, move: null, caption: last.text, tone: last.tone, part: parts.length - 1 });
  }
  return frames;
}

export type ReplayKind = 'why' | 'better';

export function useReplay(session: Session, opts: { stepMs?: number; holdMs?: number } = {}) {
  const stepMs = opts.stepMs ?? 1800;
  const holdMs = opts.holdMs ?? 3200;
  const st = reactive({ kind: null as ReplayKind | null, frames: [] as Frame[], index: 0, playing: false, label: '' });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  function show() {
    const f = st.frames[st.index];
    if (!f) return;
    const sq = f.uci ? ([f.uci.slice(0, 2), f.uci.slice(2, 4)] as const) : null;
    session.setPreview({
      fen: f.fen,
      uci: f.uci ?? '',
      caption: f.caption,
      arrows: sq ? [{ from: sq[0], to: sq[1], brush: f.tone }] : [],
      ...(sq && f.tone !== 'neutral' ? { marker: { square: sq[1], tone: f.tone } } : {}),
    });
  }

  function schedule() {
    clear();
    if (!st.playing) return;
    const atEnd = st.index >= st.frames.length - 1;
    timer = setTimeout(
      () => {
        if (atEnd) stop();
        else {
          st.index++;
          show();
          schedule();
        }
      },
      atEnd ? holdMs : st.index === 0 ? 1100 : stepMs,
    );
  }

  function start(kind: ReplayKind, a: MoveAnalysis, c: Candidate, label: string) {
    const intro = kind === 'why' ? `Before ${moveNumberLabel(a.fenBefore)} ${a.san}` : `Instead of ${a.san}: ${c.san}`;
    const frames = buildFrames(a.fenBefore, c, intro);
    if (frames.length < 2) return;
    st.kind = kind;
    st.frames = frames;
    st.index = 0;
    st.playing = true;
    st.label = label;
    show();
    schedule();
  }

  function stop() {
    clear();
    const was = st.kind !== null;
    st.kind = null;
    st.frames = [];
    st.playing = false;
    if (was) session.setPreview(null);
  }

  function goTo(i: number) {
    if (!st.kind) return;
    st.index = Math.max(0, Math.min(st.frames.length - 1, i));
    st.playing = false;
    clear();
    show();
  }
  const next = () => goTo(st.index + 1);
  const prev = () => goTo(st.index - 1);
  function toggle() {
    if (!st.kind) return;
    if (st.playing) {
      st.playing = false;
      clear();
      return;
    }
    if (st.index >= st.frames.length - 1) st.index = 0;
    st.playing = true;
    show();
    schedule();
  }

  /** Jump to the first frame showing story part `part`. */
  function goToPart(part: number) {
    const i = st.frames.findIndex((f) => f.part === part);
    if (i >= 0) goTo(i);
  }

  // another move on the board / navigation: the replay is over
  watch(
    () => session.current.value?.id,
    () => stop(),
  );
  onBeforeUnmount(stop);

  const frame = computed(() => (st.kind ? (st.frames[st.index] ?? null) : null));
  return { st, frame, start, stop, next, prev, goTo, goToPart, toggle };
}
