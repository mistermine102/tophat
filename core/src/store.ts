// Key -> JSON cache used by the analysis pipeline (ARCHITECTURE.md "Cache"). Environment-neutral interface with
// three implementations:
//   - MemoryStore (here): tests, throw-away runs;
//   - IdbStore (client/src/worker/idbStore.ts): IndexedDB in the browser (the app);
//   - CacheDb (cache.ts, node:sqlite): Node scripts and benchmarks.
// `get` / `put` may be sync or async; callers always `await` them.
//
// Tables:
//   analyses   key = analysisKey(...) (games.ts)      -> MoveAnalysis
//   searches   key = SearchCache.key(fen, params)      -> SearchResult
//   games      id = sha1(start FEN + UCI moves)         -> ParsedGame
//   settings   name                                     -> any (not used by the pipeline)

export type Table = 'analyses' | 'searches' | 'games' | 'settings';

export interface CacheStore {
  get<T>(table: Table, key: string): Promise<T | undefined> | T | undefined;
  put(table: Table, key: string, value: unknown): Promise<void> | void;
}

export class MemoryStore implements CacheStore {
  private tables = new Map<Table, Map<string, string>>();

  get<T>(table: Table, key: string): T | undefined {
    const v = this.tables.get(table)?.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }

  put(table: Table, key: string, value: unknown): void {
    let t = this.tables.get(table);
    if (!t) this.tables.set(table, (t = new Map()));
    t.set(key, JSON.stringify(value));
  }

  count(table: Table): number {
    return this.tables.get(table)?.size ?? 0;
  }
}
