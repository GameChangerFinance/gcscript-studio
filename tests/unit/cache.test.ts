import { describe, expect, it, vi } from 'vitest';
import { createSchemaCache } from '../../src/core/schema/cache';
const bundle = { 'api.json': { type: 'object' } };
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
const fetchResult = (body: unknown = bundle): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
describe('schema cache', () => {
  it('downloads once, persists exact URL identity, and reads offline on reload', async () => {
    const storage = memory(),
      fetcher = fetchResult(),
      cache = createSchemaCache(storage, 'schema:', fetcher);
    expect(await cache.load('/one')).toEqual(bundle);
    expect(await cache.load('/one')).toEqual(bundle);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const reload = createSchemaCache(
      storage,
      'schema:',
      vi.fn(() => {
        throw Error('offline');
      }),
    );
    expect(await reload.load('/one')).toEqual(bundle);
    expect(storage.data.has('schema:/one')).toBe(true);
  });
  it('coalesces concurrent requests and repairs corrupt cached data', async () => {
    const storage = memory();
    storage.setItem('s:a', '{bad');
    const fetcher = fetchResult(),
      cache = createSchemaCache(storage, 's:', fetcher);
    await Promise.all([cache.load('a'), cache.load('a')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears and refreshes wallet schemas and extras together', async () => {
    const storage = memory(),
      fetcher = fetchResult(),
      cache = createSchemaCache(storage, '', fetcher);
    await cache.load('wallet');
    await cache.load('extras');
    await cache.refresh(['wallet', 'extras']);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('allows retry after HTTP or malformed-schema failures', async () => {
    const storage = memory();
    let failed = true;
    const fetcher: typeof fetch = vi.fn(async () =>
      failed ? new Response('no', { status: 503 }) : new Response(JSON.stringify(bundle)),
    );
    const cache = createSchemaCache(storage, '', fetcher);
    await expect(cache.load('a')).rejects.toThrow('HTTP 503');
    failed = false;
    await expect(cache.load('a')).resolves.toEqual(bundle);
    await expect(createSchemaCache(memory(), '', fetchResult([])).load('b')).rejects.toThrow(
      'Schema',
    );
  });
  it('keeps editing available when browser storage is disabled', async () => {
    const warn = vi.fn(),
      storage = {
        getItem() {
          throw Error('disabled');
        },
        setItem() {
          throw Error('disabled');
        },
        removeItem() {
          throw Error('disabled');
        },
      };
    const cache = createSchemaCache(storage, '', fetchResult(), warn);
    await expect(cache.load('a')).resolves.toEqual(bundle);
    await cache.refresh(['a']);
    expect(warn).toHaveBeenCalled();
  });
  it('prevents stale in-flight requests from overwriting refreshed schemas', async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetcher: typeof fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(
        async () => new Response(JSON.stringify({ 'api.json': { title: 'new' } })),
      );
    const storage = memory(),
      cache = createSchemaCache(storage, '', fetcher);
    const stale = cache.load('x');
    await cache.refresh(['x']);
    finish?.(new Response(JSON.stringify(bundle)));
    await stale;
    expect(JSON.parse(storage.getItem('x') ?? '{}').bundle['api.json'].title).toBe('new');
  });
});

it('expires at exactly the CLI 24-hour boundary and rejects future/legacy timestamps', async () => {
  const storage = memory(),
    fetcher = fetchResult();
  let time = 1000;
  const cache = createSchemaCache(
    storage,
    '',
    fetcher,
    () => {},
    24 * 60 * 60 * 1000,
    () => time,
  );
  await cache.load('x');
  time += 24 * 60 * 60 * 1000 - 1;
  await cache.load('x');
  expect(fetcher).toHaveBeenCalledTimes(1);
  time++;
  await cache.load('x');
  expect(fetcher).toHaveBeenCalledTimes(2);
  storage.setItem('x', JSON.stringify({ savedAt: time + 1, bundle }));
  await cache.load('x');
  storage.setItem('x', JSON.stringify(bundle));
  await cache.load('x');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
