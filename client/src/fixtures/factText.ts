// Fixture-only text templates for Facts. The real prose comes from the server's explain.ts; the UI only ever
// renders Level.text. This exists so the hand-written fixture facts carry realistic text strings.
import type { Color, Fact, PieceRef, PieceRole, PositionalFeature } from '@chess-coach/shared';

const ROLE: Record<PieceRole, string> = {
  pawn: 'pawn', knight: 'knight', bishop: 'bishop', rook: 'rook', queen: 'queen', king: 'king',
};
const VALUE: Record<PieceRole, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const side = (c: Color) => (c === 'white' ? 'White' : 'Black');
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const piece = (p: PieceRef) => `the ${ROLE[p.role]} on ${p.square}`;
const pieceShort = (p: PieceRef) => `${ROLE[p.role]} on ${p.square}`;
const pawns = (n: number) => {
  const a = Math.abs(n);
  return `${a} ${a === 1 ? 'pawn' : 'pawns'}`;
};
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

const FEATURE: Record<PositionalFeature, [better: string, worse: string]> = {
  'king-safety': ['the king is safer', 'the king becomes more exposed'],
  'passed-pawn': ['creates a passed pawn', 'gives the opponent a passed pawn'],
  'isolated-pawn': ['fixes an isolated pawn', 'leaves an isolated pawn'],
  'doubled-pawn': ['undoubles the pawns', 'leaves doubled pawns'],
  mobility: ['the pieces get more active', 'the pieces become passive'],
  'centre-control': ['more control of the centre', 'gives up control of the centre'],
  development: ['better development', 'falls behind in development'],
  'open-file-rook': ['a rook takes an open file', 'gives the opponent an open file'],
  'bishop-pair': ['keeps the bishop pair', 'gives up the bishop pair'],
  space: ['gains space', 'gives up space'],
};

/** Render one fact. `mover` = the side that made the move the fact belongs to. */
export function factText(f: Fact, mover: Color): string {
  switch (f.type) {
    case 'check':
      return f.double ? 'Double check!' : f.discovered ? 'Discovered check.' : 'Gives check.';
    case 'checkmate':
      return 'Checkmate.';
    case 'capture':
      switch (f.outcome) {
        case 'wins-material':
          return `Takes ${piece(f.captured)} and wins material (${signed(f.net)}).`;
        case 'even-trade':
          return `Takes ${piece(f.captured)} — an even trade.`;
        case 'recapture':
          return `Recaptures ${piece(f.captured)}, restoring the material balance.`;
        case 'loses-material':
          return `Takes ${piece(f.captured)}, but loses material in the exchange (${signed(f.net)}).`;
      }
      break;
    case 'promotion':
      return `Promotes to a ${ROLE[f.to]}.`;
    case 'castle':
      return f.side === 'king' ? 'Castles kingside: the king is safe and the rook joins the game.' : 'Castles queenside.';
    case 'develop':
      return `Develops the ${ROLE[f.piece.role]} to ${f.piece.square}.`;
    case 'attack':
      return f.reason === 'undefended'
        ? `Attacks ${piece(f.target)}, which is undefended.`
        : f.reason === 'king'
          ? `The ${pieceShort(f.attacker)} eyes the enemy king.`
          : `Attacks ${piece(f.target)} with the ${ROLE[f.attacker.role]} — a higher-value target.`;
    case 'fork':
      return `Fork: the ${pieceShort(f.attacker)} attacks ${f.targets.map((t) => piece(t)).join(' and ')} at once.`;
    case 'pin':
      return `Pins ${piece(f.pinned)} to ${piece(f.behind)}${f.absolute ? ' — it cannot move at all' : ''}.`;
    case 'skewer':
      return `Skewer: ${piece(f.front)} must move and ${piece(f.behind)} behind it falls.`;
    case 'discovered-attack':
      return `Moving the ${ROLE[f.moved.role]} uncovers an attack by the ${pieceShort(f.attacker)} on ${piece(f.target)}.`;
    case 'escape':
      return `Saves the ${ROLE[f.piece.role]}: it was attacked on ${f.from} and is safe on ${f.piece.square}.`;
    case 'defend':
      return `Defends ${piece(f.piece)}, which was under attack.`;
    case 'block-check':
      return 'Blocks the check.';
    case 'escape-check':
      return 'Steps out of check.';
    case 'hangs':
      return `Leaves ${piece(f.piece)} hanging — it can be taken for free (${signed(-f.loss)}).`;
    case 'allows-mate':
      return `Allows a forced mate in ${f.inMoves}.`;
    case 'threat': {
      const what = f.mateIn
        ? `mate in ${f.mateIn}`
        : f.facts[0]
          ? factText(f.facts[0], mover).replace(/\.$/, '').toLowerCase()
          : `winning ${pawns(f.gain)}`;
      return `Threatens ${f.san} next — ${what}${f.gain > 0 && !f.mateIn ? ` (${signed(f.gain)})` : ''}.`;
    }
    case 'line': {
      const steps = f.steps.map((s) => {
        const key = s.facts[0] ? ` (${stepFactShort(s.facts[0])})` : '';
        return `${s.san}${key}${s.forced ? ' — forced' : ''}`;
      });
      const result =
        f.result === 'mate'
          ? `${side(mover)} mates${f.mateIn ? ` in ${f.mateIn}` : ''}`
          : f.result === 'mated'
            ? `${side(other(mover))} mates`
            : f.result === 'wins-material'
              ? `${side(mover)} wins ${pawns(f.materialDelta)} of material (${signed(f.materialDelta)})`
              : f.result === 'loses-material'
                ? `${side(mover)} loses ${pawns(f.materialDelta)} of material (${signed(f.materialDelta)})`
                : f.result === 'trade'
                  ? 'pieces are traded evenly'
                  : 'a quiet position';
      return `${steps.join(' → ')} → ${result}.`;
    }
    case 'forced-reply':
      return `${f.san} was practically forced: the other ${f.alternatives === 1 ? 'reply loses' : `${f.alternatives} replies lose`} much more.`;
    case 'positional': {
      const [better, worse] = FEATURE[f.feature];
      const text = f.delta >= 0 ? better : worse;
      return `${cap(text)}${f.detail ? ` (${f.detail})` : ''}.`;
    }
    case 'positional-gain':
      return `A positional gain worth about ${(f.cp / 100).toFixed(1)} pawns that isn’t about material.`;
    case 'deep-payoff':
      return 'The payoff is far away — only a deep search sees it.';
    case 'necessary':
      return 'You just had to play it: every alternative was much worse.';
    case 'nothing-notable':
      return 'Nothing notable.';
  }
  return '';
}

function stepFactShort(f: Fact): string {
  switch (f.type) {
    case 'check':
      return 'check';
    case 'checkmate':
      return 'mate';
    case 'capture':
      return `takes ${ROLE[f.captured.role]}`;
    case 'fork':
      return `forks ${f.targets.map((t) => ROLE[t.role]).join(' and ')}`;
    case 'pin':
      return `pins the ${ROLE[f.pinned.role]}`;
    case 'attack':
      return `attacks the ${ROLE[f.target.role]}`;
    case 'escape':
      return `the ${ROLE[f.piece.role]} escapes`;
    case 'promotion':
      return `promotes to ${ROLE[f.to]}`;
    case 'hangs':
      return `hangs the ${ROLE[f.piece.role]}`;
    default:
      return f.type.replace(/-/g, ' ');
  }
}

export function pieceValue(role: PieceRole): number {
  return VALUE[role];
}
