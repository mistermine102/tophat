// Measures engine time for the analysis budget (ARCHITECTURE.md "Analysis budget").
// Usage: npm run bench:engine -w server   (env THREADS, HASH to override; default Threads=10 Hash=512)
import { Engine, type SearchRequest } from '../src/engine/uci';

const FENS: Record<string, string> = {
  'QGD (W, move 9)': 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9',
  'Najdorf Bg5 (W, move 10)': 'r1b1kb1r/1pqn1ppp/p2ppn2/6B1/3NPP2/2N2Q2/PPP3PP/R3KB1R w KQkq - 2 10',
  'Closed Ruy (B, move 9)': 'r1bq1rk1/2p1bppp/p1np1n2/1p2p3/4P3/1BP2N1P/PP1P1PP1/RNBQR1K1 b - - 0 9',
};
const BUDGETS: [string, Omit<SearchRequest, 'fen'>][] = [
  ['deep d18 mpv5', { depth: 18, multipv: 5 }],
  ['shallow d8 mpv5', { depth: 8, multipv: 5 }],
  ['threat d12 mpv1', { depth: 12, multipv: 1 }],
  ['forced d12 mpv2', { depth: 12, multipv: 2 }],
];

const engine = await Engine.start({ threads: Number(process.env.THREADS ?? 10), hashMb: Number(process.env.HASH ?? 512) });
console.log(`${engine.name}, Threads=${engine.threads}, Hash=${engine.hashMb}`);
const rows: string[] = ['| position | search | cold ms | warm ms | nodes (cold) |', '|---|---|---|---|---|'];
for (const [name, fen] of Object.entries(FENS)) {
  for (const [label, b] of BUDGETS) {
    await engine.newGame(); // cold: clear hash
    const cold = await engine.search({ fen, ...b });
    const warm = await engine.search({ fen, ...b }); // hash already holds this position
    rows.push(`| ${name} | ${label} | ${cold.timeMs} | ${warm.timeMs} | ${cold.nodes} |`);
  }
}
console.log(rows.join('\n'));
await engine.quit();
