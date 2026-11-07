// SQLite cache (node:sqlite DatabaseSync) for Node scripts and benchmarks: move analyses, engine searches, imported
// games. Node-only — the app itself uses IndexedDB (client/src/worker/idbStore.ts); both implement store.ts
// `CacheStore`.
//
// File: `data/cache.sqlite` at the repo root (gitignored); override with env `CHESS_COACH_DB` or the constructor
// argument (`':memory:'` for tests). Tables are simple key -> JSON stores:
//   analyses(key, json)   key = analysisKey(...) (ARCHITECTURE.md "Cache")
//   searches(key, json)   key = SearchCache.key(fen, params) (analysis/searchCache.ts)
//   games(id, json)       GameRecord (games.ts)
//   settings(name, json)  user settings (`Settings`)

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { CacheStore, Table } from './store';

export { sha1 } from './hash';

export const DEFAULT_DB_PATH = fileURLToPath(new URL('../../data/cache.sqlite', import.meta.url));

export function defaultDbPath(): string {
  return process.env.CHESS_COACH_DB || DEFAULT_DB_PATH;
}

const KEY_COLUMN: Record<Table, string> = { analyses: 'key', searches: 'key', games: 'id', settings: 'name' };

export class CacheDb implements CacheStore {
  readonly path: string;
  private db: DatabaseSync;
  private getStmt = new Map<Table, StatementSync>();
  private putStmt = new Map<Table, StatementSync>();

  constructor(path: string = defaultDbPath()) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    for (const t of Object.keys(KEY_COLUMN) as Table[]) {
      const k = KEY_COLUMN[t];
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${t} (${k} TEXT PRIMARY KEY, json TEXT NOT NULL, updated INTEGER NOT NULL)`);
      this.getStmt.set(t, this.db.prepare(`SELECT json FROM ${t} WHERE ${k} = ?`));
      this.putStmt.set(t, this.db.prepare(`INSERT OR REPLACE INTO ${t} (${k}, json, updated) VALUES (?, ?, ?)`));
    }
  }

  get<T>(table: Table, key: string): T | undefined {
    const row = this.getStmt.get(table)!.get(key) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  put(table: Table, key: string, value: unknown): void {
    this.putStmt.get(table)!.run(key, JSON.stringify(value), Date.now());
  }

  count(table: Table): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}
