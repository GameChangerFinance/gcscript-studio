import type { SchemaBundle } from './types.js';
import { parseBundle } from './extensions.js';
export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface SchemaCache {
  load(url: string): Promise<SchemaBundle>;
  refresh(urls: string[]): Promise<SchemaBundle[]>;
}

/** URL-keyed local cache. Invalid entries repair themselves; failed refreshes remain retryable. */
export function createSchemaCache(
  storage: CacheStorage,
  prefix: string,
  fetcher: typeof fetch = fetch,
  onWarning: (message: string) => void = () => {},
  maxAge = 24 * 60 * 60 * 1000,
  now: () => number = Date.now,
): SchemaCache {
  const pending = new Map<string, Promise<SchemaBundle>>();
  const versions = new Map<string, number>();
  async function download(url: string, generation: number): Promise<SchemaBundle> {
    const response = await fetcher(url, { cache: 'no-store' });
    if (!response.ok) throw Error(`Schema HTTP ${response.status} · ${url}`);
    const bundle = parseBundle(await response.json());
    if ((versions.get(url) ?? 0) === generation) {
      try {
        storage.setItem(prefix + url, JSON.stringify({ savedAt: now(), bundle }));
      } catch {
        onWarning('Schema cache could not be stored: browser storage is full or unavailable.');
      }
    }
    return bundle;
  }
  function load(url: string): Promise<SchemaBundle> {
    try {
      const cached = storage.getItem(prefix + url);
      if (cached) {
        const entry: unknown = JSON.parse(cached);
        if (
          entry &&
          typeof entry === 'object' &&
          'savedAt' in entry &&
          'bundle' in entry &&
          typeof entry.savedAt === 'number' &&
          entry.savedAt <= now() &&
          now() - entry.savedAt < maxAge
        )
          return Promise.resolve(parseBundle(entry.bundle));
        storage.removeItem(prefix + url);
      }
    } catch {
      try {
        storage.removeItem(prefix + url);
      } catch {
        /* Storage may be disabled. */
      }
    }
    const existing = pending.get(url);
    if (existing) return existing;
    const request = download(url, versions.get(url) ?? 0).finally(() => {
      if (pending.get(url) === request) pending.delete(url);
    });
    pending.set(url, request);
    return request;
  }
  return {
    load,
    async refresh(urls) {
      for (const url of urls) {
        versions.set(url, (versions.get(url) ?? 0) + 1);
        pending.delete(url);
        try {
          storage.removeItem(prefix + url);
        } catch {
          onWarning('Browser storage is unavailable.');
        }
      }
      return Promise.all(urls.map(load));
    },
  };
}
