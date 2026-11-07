// IndexedDB implementation of the analysis cache (core/src/store.ts `CacheStore`): the browser's replacement for the
// old server's sqlite file. Same tables and keys (analysis key = sha1 of ANALYSIS_VERSION + settings hash + move
// context, so a new version or other settings never read old entries). Values are stored as structured clones.
import type { CacheStore, Table } from '@chess-coach/core/store';

export const DB_NAME = 'chess-coach';
const DB_VERSION = 1;
const TABLES: Table[] = ['analyses', 'searches', 'games', 'settings'];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export class IdbStore implements CacheStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = DB_NAME, factory: IDBFactory = indexedDB): Promise<IdbStore> {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t);
    };
    const db = await req(open);
    // another tab upgrading the schema: let it (this tab keeps working from memory until reloaded)
    db.onversionchange = () => db.close();
    return new IdbStore(db);
  }

  async get<T>(table: Table, key: string): Promise<T | undefined> {
    const v = await req(this.db.transaction(table, 'readonly').objectStore(table).get(key));
    return (v ?? undefined) as T | undefined;
  }

  async put(table: Table, key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(table, 'readwrite');
    tx.objectStore(table).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }

  async count(table: Table): Promise<number> {
    return req(this.db.transaction(table, 'readonly').objectStore(table).count());
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(TABLES, 'readwrite');
    for (const t of TABLES) tx.objectStore(t).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
    });
  }

  close(): void {
    this.db.close();
  }
}
