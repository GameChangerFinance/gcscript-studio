import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config';
import { createStudioStore, initialState } from '../../src/core/state';
import { createProject, put, transfer } from '../../src/core/project/vfs';
import { mergeWalletResults } from '../../src/core/wallet';
import {
  createValidationScheduler,
  diagnosticEdits,
  diagnosticMessage,
  diagnosticPath,
} from '../../src/core/validation';
const makeStore = (limit = 200) =>
  createStudioStore(initialState(createProject(DEFAULT_CONFIG, 'p'), DEFAULT_CONFIG, false), {
    limit,
    typingGroupMs: 500,
  });
afterEach(() => vi.useRealTimers());
describe('shared edit history', () => {
  it('undoes source, inspector, block and tree changes, preserving identity and increasing revisions', () => {
    const store = makeStore();
    const original = store.getSnapshot().project;
    store.update((s) => ({
      ...s,
      project: put(s.project, 'main.gcscript', { text: '{}', encoding: 'utf8' }, true),
    }));
    store.update((s) => ({
      ...s,
      project: put(s.project, 'lib/a.json', { text: '42', encoding: 'utf8' }),
    }));
    store.undo();
    expect(store.getSnapshot().project.files['lib/a.json']).toBeUndefined();
    store.undo();
    expect(store.getSnapshot().project.files).toEqual(original.files);
    expect(store.getSnapshot().project.revision).toBe(4);
    store.redo();
    expect(store.getSnapshot().project.files['main.gcscript']?.text).toBe('{}');
    store.update((s) => ({
      ...s,
      project: put(s.project, 'b.json', { text: '1', encoding: 'utf8' }),
    }));
    expect(store.canRedo()).toBe(false);
  });
  it('coalesces typing but separates commands and ignores selection/notification state', () => {
    vi.useFakeTimers();
    const store = makeStore();
    for (const text of ['a', 'ab', 'abc'])
      store.update(
        (s) => ({
          ...s,
          project: put(s.project, s.project.active, { text, encoding: 'utf8' }, true),
        }),
        'typing',
      );
    store.update((s) => ({ ...s, selection: ['type'], logs: ['status'] }));
    vi.advanceTimersByTime(501);
    store.update(
      (s) => ({
        ...s,
        project: put(s.project, s.project.active, { text: 'abcd', encoding: 'utf8' }, true),
      }),
      'typing',
    );
    store.undo();
    expect(store.getSnapshot().project.files['main.gcscript']?.text).toBe('abc');
    store.undo();
    expect(store.getSnapshot().project.files['main.gcscript']?.text).toContain('getCurrentAddress');
    store.undo();
    expect(store.canUndo()).toBe(false);
  });
  it('restores entrypoint after rename and clears history on a new project', () => {
    const store = makeStore(1);
    store.update((s) => ({
      ...s,
      project: transfer(s.project, 'main.gcscript', 'src/main.gcscript'),
      options: { ...s.options, entryFile: 'src/main.gcscript' },
    }));
    store.undo();
    expect(store.getSnapshot().options.entryFile).toBe('main.gcscript');
    store.redo();
    expect(store.getSnapshot().project.active).toBe('src/main.gcscript');
    store.update((s) => ({ ...s, project: createProject(DEFAULT_CONFIG, 'new') }));
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(store.getSnapshot().project.id).toBe('new');
  });
  it('bounds history retention', () => {
    const store = makeStore(1);
    for (const text of ['a', 'b'])
      store.update((s) => ({
        ...s,
        project: put(s.project, s.project.active, { text, encoding: 'utf8' }, true),
      }));
    store.undo();
    store.undo();
    expect(store.getSnapshot().project.files['main.gcscript']?.text).toBe('a');
  });
});
describe('named wallet results', () => {
  it('merges nested namespaces while replacing arrays/scalars', () => {
    expect(
      mergeWalletResults(
        { old: 1, user: { address: 'a', count: 1 }, list: [1, 2] },
        { user: { count: 2 }, list: [3], next: true },
      ),
    ).toEqual({ old: 1, user: { address: 'a', count: 2 }, list: [3], next: true });
    expect(mergeWalletResults({ data: true }, null)).toBeNull();
  });
  it('never traverses object prototypes', () => {
    const incoming = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
    );
    const value = mergeWalletResults({}, incoming);
    expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
    expect({}).not.toHaveProperty('polluted');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
describe('actionable diagnostics', () => {
  const diagnostic = {
    code: 'code-invalid-const-enum',
    jsonPath: '/run/a/type',
    provided: 'getCurentAddress',
    message: 'Unknown function',
    suggestion: 'Use getCurrentAddress',
    details: { closestValues: ['getCurrentAddress'] },
    examples: [{ type: 'getCurrentAddress' }],
  };
  const source = '{"type":"script", "run":{"a":{"type":"getCurentAddress"}}}';
  it('maps escaped JSON pointers and proposes bounded, exact edits', () => {
    expect(diagnosticPath('/a~1b/~0key/0')).toEqual(['a/b', '~key', '0']);
    expect(diagnosticPath('')).toEqual([]);
    const edits = diagnosticEdits(source, diagnostic);
    expect(edits).toHaveLength(1);
    const edit = edits[0]!;
    expect(source.slice(edit.offset, edit.offset + edit.length)).toBe('"getCurentAddress"');
    expect(edit.text).toBe('"getCurrentAddress"');
    expect(diagnosticMessage(diagnostic)).toContain('Examples: {"type":"getCurrentAddress"}');
  });
  it('does not offer stale, speculative, or malformed edits', () => {
    expect(diagnosticEdits(source.replace('getCurentAddress', 'data'), diagnostic)).toEqual([]);
    expect(diagnosticEdits('invalid', diagnostic)).toEqual([]);
    expect(diagnosticEdits(source, { message: 'other' })).toEqual([]);
    expect(diagnosticEdits(source, { ...diagnostic, details: null })).toEqual([]);
    expect(diagnosticMessage({ message: 'x', examples: ['a'.repeat(200)] })).toBe('x');
  });
});
describe('automatic validation scheduler', () => {
  it('debounces edits, drains sustained edits on interval and avoids overlaps', async () => {
    vi.useFakeTimers();
    let resolve: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const scheduler = createValidationScheduler(run, 900, 15000);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(899);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(900);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(16000);
    expect(run).toHaveBeenCalledTimes(1);
    resolve?.();
    await vi.advanceTimersByTimeAsync(900);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    resolve?.();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(20000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('runs during sustained typing and retries failures only at interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw Error('temporary');
    });
    const scheduler = createValidationScheduler(run, 900, 15000);
    for (let i = 0; i < 30; i++) {
      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
