// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gc } from '../../src/adapters/gc';
import { DEFAULT_CONFIG } from '../../src/config';
import { createStudioController } from '../../src/app/controller';
import type { StudioController } from '../../src/app/controller';
import { buildService } from '../../src/adapters/build';
import { runtime, extras } from '../fixtures';
import { put } from '../../src/core/project/vfs';
import { captureWalletReturn, consumeReturns, registerRun } from '../../src/adapters/wallet/bridge';
import { restoreSession, persistSession, sessionConfig } from '../../src/adapters/persistence';
import { initialState } from '../../src/core/state';
import { createProject } from '../../src/core/project/vfs';
import { renderMarkdown } from '../../src/components/Documentation';
import { encodeEditLink } from '../../src/adapters/edit-links';
import { walletCallbackContext, withWalletCallback } from '../../src/core/wallet';
let controller: StudioController | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.endsWith('extras.json.full') ? extras : runtime)),
    ),
  );
});
afterEach(() => {
  controller?.dispose();
  controller = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
async function ready() {
  controller = createStudioController(structuredClone(DEFAULT_CONFIG));
  await controller.loadSchema(DEFAULT_CONFIG.defaults.schemaUrl);
  return controller;
}
const deferred = <T>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
};
describe('controller safety and persistence', () => {
  it('auto-opens embedded links in isolated storage and returns wallets to that session', async () => {
    const normal = initialState(
      createProject(DEFAULT_CONFIG, 'normal-work'),
      DEFAULT_CONFIG,
      false,
    );
    persistSession(normal, DEFAULT_CONFIG, localStorage);
    const saved = localStorage.getItem(DEFAULT_CONFIG.storage.project);
    window.history.replaceState(null, '', '/?embed=true&view=block');
    const app = await ready();
    expect(app.store.getSnapshot()).toMatchObject({
      embedded: true,
      mode: 'blocks',
      layout: { explorer: false, inspector: false },
    });
    const url = await encodeEditLink(
      { type: 'script', title: 'Embedded', run: {} },
      app.baseURL,
      DEFAULT_CONFIG,
    );
    await app.importEditLink(url);
    expect(app.store.getSnapshot().prompt).toBeNull();
    expect(app.store.getSnapshot().project.id).not.toBe('normal-work');
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.project)).toBe(saved);
    expect(localStorage.getItem(app.config.storage.project)).toContain('Embedded');
    const before = app.store.getSnapshot().project;
    await app.importEditLink(app.baseURL + 'api/2/edit/1-invalid');
    expect(app.store.getSnapshot().project).toBe(before);
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await app.run();
    const source = JSON.parse(app.store.getSnapshot().project.files['main.gcscript']!.text);
    expect(walletCallbackContext(new URL(source.returnURLPattern)).embedded).toBe(true);
    expect(source.returnURLPattern).not.toContain('&');
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.project)).toBe(saved);
  });
  it('does not write the whole project for cursor/notification changes', async () => {
    const app = await ready();
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    app.notify('a');
    app.store.update((state) => ({ ...state, selection: ['run'] }));
    expect(spy).not.toHaveBeenCalled();
    app.editFile('{"type":"script","run":{}}', 'main.gcscript');
    expect(spy).toHaveBeenCalledWith(DEFAULT_CONFIG.storage.project, expect.any(String));
  });
  it('rejects a stale async build without replacing new source', async () => {
    const app = await ready(),
      build = deferred<string>();
    vi.spyOn(buildService, 'build').mockReturnValueOnce(build.promise);
    const task = app.build();
    app.editFile('{"type":"script","title":"new","run":{}}', 'main.gcscript');
    build.resolve('{}');
    await expect(task).rejects.toThrow('changed');
    expect(app.store.getSnapshot().project.files['build/output.gcscript']).toBeUndefined();
  });
  it('binds a completed build to its original project identity', async () => {
    const app = await ready(),
      build = deferred<string>();
    vi.spyOn(buildService, 'build').mockReturnValueOnce(build.promise);
    const task = app.build();
    app.reset();
    build.resolve('{}');
    await expect(task).rejects.toThrow('changed');
  });
  it('preserves invalid saved state until the user explicitly resets it', () => {
    localStorage.setItem(
      DEFAULT_CONFIG.storage.project,
      JSON.stringify({ version: 'older', personal: 'keep' }),
    );
    controller = createStudioController(DEFAULT_CONFIG);
    expect(controller.store.getSnapshot().persistenceError).toContain('different version');
    controller.notify('status update');
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.project)).toContain('keep');
    controller.reset();
    expect(controller.store.getSnapshot().persistenceError).toBe('');
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.project)).not.toContain('keep');
  });
  it('restores serializable project state and stops subsequent writes when autosave is off', () => {
    const initial = initialState(createProject(DEFAULT_CONFIG, 'p'), DEFAULT_CONFIG, false);
    const state = { ...initial, options: { ...initial.options, theme: 'light' as const } };
    persistSession(state, DEFAULT_CONFIG, localStorage);
    expect(restoreSession(initial, DEFAULT_CONFIG, localStorage).options.theme).toBe('light');
    const before = localStorage.getItem(DEFAULT_CONFIG.storage.project);
    persistSession(
      { ...state, options: { ...state.options, autosave: false } },
      DEFAULT_CONFIG,
      localStorage,
    );
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.project)).toBe(before);
  });
  it('persists schema refreshes separately and recovers from failed loads', async () => {
    const app = await ready();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('offline', { status: 503 })),
    ); // Existing adapter captures its fetcher; a new instance exercises startup retry.
    app.dispose();
    controller = createStudioController(DEFAULT_CONFIG);
    await expect(controller.loadSchema('/unavailable', true)).rejects.toThrow('503');
    expect(controller.store.getSnapshot().status.error).toBe(true);
  });
  it('does not overwrite source through a misconfigured build output path', async () => {
    const app = await ready();
    app.store.update((state) => ({
      ...state,
      options: { ...state.options, outputPath: 'main.gcscript' },
    }));
    vi.spyOn(buildService, 'build').mockResolvedValue('{}');
    await expect(app.build()).rejects.toThrow('overwrite');
    expect(app.store.getSnapshot().project.files['main.gcscript']?.text).toContain(
      'getCurrentAddress',
    );
  });
  it('rejects invalid option paths and wallet patterns', async () => {
    const app = await ready();
    await expect(
      app.applyOptions({ ...DEFAULT_CONFIG.defaults, outputPath: '../escape' }),
    ).rejects.toThrow('path');
    await expect(
      app.applyOptions({ ...DEFAULT_CONFIG.defaults, walletUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow('Wallet URL');
  });
  it('uses schema-derived defaults when adding directives to source', async () => {
    const app = await ready();
    app.addFunction('$importAsData');
    expect(app.store.getSnapshot().project.files['main.gcscript']?.text).toContain('$importAsData');
    expect(app.store.getSnapshot().project.files['main.gcscript']?.text).toContain(
      '// Named steps',
    );
    app.mutateProject((project) => ({
      ...put(project, 'notes.txt', { text: 'literal', encoding: 'utf8' }),
      active: 'notes.txt',
    }));
    app.addFunction('script');
    expect(app.store.getSnapshot().status.message).toContain('Open a GCScript');
  });
});
describe('wallet callback adapter', () => {
  it('restores embedded redirect results from the fragment marker without a parent host', async () => {
    const config = sessionConfig(DEFAULT_CONFIG, true);
    const initial = initialState(createProject(config, 'embedded-return'), config, false);
    persistSession(initial, config, localStorage);
    registerRun(config, {
      token: 'embedded-token',
      projectId: initial.project.id,
      resultsPath: 'results/result.json',
      created: Date.now(),
      mode: 'redirect',
    });
    const callback = JSON.parse(
      withWalletCallback('{}', location.origin + '/', 'embedded-token', true),
    ).returnURLPattern;
    window.history.replaceState(
      null,
      '',
      callback.replace('{result}', encodeURIComponent('{"exports":{"answer":42}}')),
    );
    expect(await captureWalletReturn(config)).toBe(false);
    expect(location.search).toBe('?embed=true');
    expect(location.hash).toBe('');
    const app = await ready();
    expect(app.store.getSnapshot().embedded).toBe(true);
    expect(app.store.getSnapshot().project.id).toBe(initial.project.id);
    expect(app.store.getSnapshot().project.files['results/result.json']?.text).toContain('answer');
  });
  it('rejects unknown and expired callbacks after scrubbing the URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/index.html?result=%7B%22data%22%3A1%7D#studioRun=unknown',
    );
    await expect(captureWalletReturn(DEFAULT_CONFIG)).rejects.toThrow('expired');
    expect(location.search).toBe('');
    expect(location.hash).toBe('');
  });
  it('captures recognized JSON, notifies, and consumes only into the matching project', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const pending = {
      token: 't',
      projectId: 'p',
      resultsPath: 'results/result.json',
      created: Date.now(),
    };
    registerRun(DEFAULT_CONFIG, pending);
    window.history.replaceState(
      null,
      '',
      '/index.html?result=%7B%22exports%22%3A42%7D#studioRun=t',
    );
    expect(await captureWalletReturn(DEFAULT_CONFIG)).toBe(true);
    expect(close).toHaveBeenCalled();
    const accept = vi.fn(),
      failure = vi.fn();
    consumeReturns(DEFAULT_CONFIG, 'other', accept, failure);
    expect(accept).not.toHaveBeenCalled();
    consumeReturns(DEFAULT_CONFIG, 'p', accept, failure);
    expect(accept).toHaveBeenCalledWith({ pending, result: { exports: 42 } });
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.run + ':t')).toBeNull();
    expect(failure).not.toHaveBeenCalled();
  });
  it('retains failed writes for inspection and retry', () => {
    const pending = {
      token: 't',
      projectId: 'p',
      resultsPath: 'results/result.json',
      created: Date.now(),
    };
    registerRun(DEFAULT_CONFIG, pending);
    localStorage.setItem(
      DEFAULT_CONFIG.storage.result + ':t',
      JSON.stringify({ result: { exports: true } }),
    );
    const failure = vi.fn();
    consumeReturns(
      DEFAULT_CONFIG,
      'p',
      () => {
        throw Error('write failed');
      },
      failure,
    );
    expect(failure).toHaveBeenCalledWith('write failed');
    expect(localStorage.getItem(DEFAULT_CONFIG.storage.result + ':t')).not.toBeNull();
  });
});
it('sanitizes schema HTML, event attributes and hostile links in all documentation views', () => {
  const output = renderMarkdown(
    '<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">bad</a><a href="script.html">docs</a>',
    DEFAULT_CONFIG.docsUrl,
  );
  expect(output).not.toContain('<script');
  expect(output).not.toContain('onerror');
  expect(output).not.toContain('javascript:');
  expect(output).toContain(DEFAULT_CONFIG.docsUrl + 'script.html');
  expect(output).toContain('noopener noreferrer');
});

it('updates the configured entrypoint atomically when moving or renaming it', async () => {
  const app = await ready();
  expect(app.moveEntry('main.gcscript', 'src/main.gcscript')).toBe(true);
  expect(app.store.getSnapshot().options.entryFile).toBe('src/main.gcscript');
  expect(app.store.getSnapshot().project.active).toBe('src/main.gcscript');
  expect(app.moveEntry('src', 'sources')).toBe(true);
  expect(app.store.getSnapshot().options.entryFile).toBe('sources/main.gcscript');
  expect(app.moveEntry('sources/main.gcscript', '', { intoFolder: true, copy: true })).toBe(true);
  expect(app.store.getSnapshot().options.entryFile).toBe('sources/main.gcscript');
  expect(app.moveEntry('missing', 'nowhere')).toBe(false);
});

it('generates URL query metadata using the official encoder transport', async () => {
  const app = await ready();
  const output = await app.output('urlQueryParams');
  expect(JSON.parse(output?.value ?? '{}')).toEqual({ networkTag: 'preprod' });
});

const upload = (name: string, text: string): File =>
  ({
    name,
    webkitRelativePath: '',
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  }) as File;
async function answer(app: StudioController, value: string): Promise<void> {
  await vi.waitFor(() => expect(app.store.getSnapshot().prompt).not.toBeNull());
  app.answerPrompt(value);
}
describe('safe imports and exports', () => {
  it('adds a single file only after choosing current project and never downloads on import', async () => {
    const app = await ready();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const id = app.store.getSnapshot().project.id;
    const task = app.importFiles([upload('new.gcscript', '{"type":"script","run":{}}')]);
    await answer(app, 'current');
    await task;
    expect(app.store.getSnapshot().project.id).toBe(id);
    expect(app.store.getSnapshot().project.files['main.gcscript']).toBeDefined();
    expect(app.store.getSnapshot().project.files['new.gcscript']).toBeDefined();
    expect(click).not.toHaveBeenCalled();
  });
  it('cancel preserves the entire project, including single-file conflict cancellation', async () => {
    const app = await ready();
    const before = app.store.getSnapshot().project;
    let task = app.importFiles([upload('new.txt', 'new')]);
    await answer(app, 'new');
    await answer(app, 'cancel');
    await task;
    expect(app.store.getSnapshot().project).toBe(before);
    task = app.importFiles([upload('main.gcscript', 'overwritten')]);
    await answer(app, 'current');
    await answer(app, 'cancel');
    await task;
    expect(app.store.getSnapshot().project).toBe(before);
  });
  it('opens new files after the save decision and rejects source changes during the dialog', async () => {
    const app = await ready();
    let task = app.importFiles([upload('new.gcscript', '{"type":"script","run":{}}')]);
    await answer(app, 'new');
    await answer(app, 'discard');
    await task;
    expect(Object.keys(app.store.getSnapshot().project.files)).toEqual(['new.gcscript']);
    expect(app.store.getSnapshot().options.entryFile).toBe('new.gcscript');
    task = app.importFiles([upload('stale.txt', 'stale')]);
    await answer(app, 'new');
    app.editFile('changed', 'new.gcscript');
    await answer(app, 'discard');
    await task;
    expect(app.store.getSnapshot().project.files['stale.txt']).toBeUndefined();
    expect(app.store.getSnapshot().status.message).toContain('changed');
  });
  it('requires save choice for saved projects and safely rejects malformed project JSON', async () => {
    const app = await ready();
    const saved = { ...createProject(DEFAULT_CONFIG, 'imported') };
    let task = app.importProjectFile(upload('project.json', JSON.stringify(saved)));
    await answer(app, 'cancel');
    await task;
    expect(app.store.getSnapshot().project.id).not.toBe('imported');
    task = app.importProjectFile(upload('project.json', JSON.stringify(saved)));
    await answer(app, 'discard');
    await task;
    expect(app.store.getSnapshot().project.id).not.toBe('imported');
    expect(app.store.getSnapshot().project.files).toEqual(saved.files);
    await app.importProjectFile(upload('bad.json', '{}'));
    expect(app.store.getSnapshot().status.error).toBe(true);
  });
  it('exports the selected file with its own filename and exact bytes', async () => {
    const app = await ready();
    app.mutateProject((project) =>
      put(project, 'lib/note.txt', { text: 'keep these bytes', encoding: 'utf8' }),
    );
    app.store.update((s) => ({ ...s, selectedFile: 'lib/note.txt' }));
    const objectURL = vi.fn(() => 'blob:test');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = objectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('note.txt');
    });
    app.exportFile();
    expect(click).toHaveBeenCalledTimes(1);
    expect(objectURL.mock.calls[0]?.length).toBe(1);
  });
});
describe('wallet launch and result behavior', () => {
  it('opens only the final URL, enforces mainnet and persists an undoable source callback', async () => {
    const app = await ready();
    app.store.update((state) => ({ ...state, options: { ...state.options, network: 'mainnet' } }));
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await app.run();
    expect(open).toHaveBeenCalledTimes(1);
    const target = new URL(String(open.mock.calls[0]?.[0]));
    expect(target.protocol).toBe('https:');
    expect(target.searchParams.get('networkTag')).toBe('mainnet');
    expect(app.store.getSnapshot().project.files['main.gcscript']?.text).toContain(
      'returnURLPattern',
    );
    app.undo();
    expect(app.store.getSnapshot().project.files['main.gcscript']?.text).not.toContain(
      'returnURLPattern',
    );
    app.store.update((state) => ({
      ...state,
      options: { ...state.options, disableNetworkRouter: true },
    }));
    await app.run();
    expect(new URL(String(open.mock.calls[1]?.[0])).searchParams.has('networkTag')).toBe(false);
  });
  it('offers a prepared wallet link if blocked and renders QR from the same routed parameters', async () => {
    const app = await ready();
    vi.spyOn(window, 'open').mockReturnValue(null);
    await app.run();
    expect(app.store.getSnapshot().launch?.url).toContain('networkTag=preprod');
    app.store.update((s) => ({ ...s, options: { ...s.options, runMode: 'qr' } }));
    vi.spyOn(gc.encode, 'qr').mockResolvedValue('data:image/png;base64,test');
    await app.run();
    expect(gc.encode.qr).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'preprod', disableNetworkRouter: false }),
    );
    expect(app.store.getSnapshot().launch?.qr).toMatch(/^data:image\/png/);
  });
  it('merges multiple decoded results, supports replacement, and preserves malformed merge targets', async () => {
    const app = await ready();
    await app.importResult('{"one":{"address":"a","count":1}}');
    await app.importResult('{"one":{"count":2},"two":true}');
    expect(JSON.parse(app.store.getSnapshot().project.files['results/result.json']!.text)).toEqual({
      one: { address: 'a', count: 2 },
      two: true,
    });
    app.store.update((s) => ({ ...s, options: { ...s.options, mergeResults: false } }));
    await app.importResult('{"replace":1}');
    expect(JSON.parse(app.store.getSnapshot().project.files['results/result.json']!.text)).toEqual({
      replace: 1,
    });
    app.store.update((s) => ({ ...s, options: { ...s.options, mergeResults: true } }));
    app.editFile('invalid', 'results/result.json');
    await expect(app.importResult('{"keep":true}')).rejects.toThrow('JSONC');
    expect(app.store.getSnapshot().project.files['results/result.json']?.text).toBe('invalid');
  });
});

it('keeps redirect callbacks in the same window so the IDE can consume their returns', async () => {
  const app = await ready();
  const pending = {
    token: 'redirect',
    projectId: app.store.getSnapshot().project.id,
    resultsPath: 'responses/redirect.json',
    created: Date.now(),
    mode: 'redirect' as const,
  };
  registerRun(DEFAULT_CONFIG, pending);
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});
  window.history.replaceState(
    null,
    '',
    '/index.html?result=' + encodeURIComponent('{"first":{"answer":42}}') + '#studioRun=redirect',
  );
  expect(await captureWalletReturn(DEFAULT_CONFIG)).toBe(false);
  expect(close).not.toHaveBeenCalled();
  expect(location.search).toBe('');
  window.dispatchEvent(
    new StorageEvent('storage', { key: DEFAULT_CONFIG.storage.result + ':redirect' }),
  );
  expect(app.store.getSnapshot().project.files['responses/redirect.json']?.text).toContain(
    'answer',
  );
});

it('persists Options independently when project autosave is disabled', () => {
  const initial = initialState(createProject(DEFAULT_CONFIG, 'p'), DEFAULT_CONFIG, false);
  const state = {
    ...initial,
    options: {
      ...initial.options,
      autosave: false,
      theme: 'light' as const,
      network: 'mainnet' as const,
    },
  };
  persistSession(state, DEFAULT_CONFIG, localStorage);
  expect(localStorage.getItem(DEFAULT_CONFIG.storage.project)).toBeNull();
  expect(restoreSession(initial, DEFAULT_CONFIG, localStorage).options).toMatchObject({
    autosave: true,
    theme: 'light',
    network: 'mainnet',
  });
  localStorage.setItem(
    DEFAULT_CONFIG.storage.options,
    JSON.stringify({ version: 'older', options: {} }),
  );
  expect(restoreSession(initial, DEFAULT_CONFIG, localStorage).error).toContain(
    'different version',
  );
});
