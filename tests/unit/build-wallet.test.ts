import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, getConfig, languageColor } from '../../src/config';
import { buildProjectFile, commitBuild } from '../../src/core/project/build';
import { createProject, put } from '../../src/core/project/vfs';
import {
  decodeWalletResult,
  parsePendingRun,
  walletParameters,
  withWalletCallback,
} from '../../src/core/wallet';
import { createStudioStore, initialState } from '../../src/core/state';
describe('build orchestration', () => {
  it('builds the selected source and complete unsaved VFS under its logical identity', async () => {
    const p = put(createProject(DEFAULT_CONFIG, 'p'), 'lib/entry.gcscript', {
      text: '{"type":"script","run":[]}',
      encoding: 'utf8',
    });
    const build = vi.fn(async () => '{}');
    expect(await buildProjectFile({ build }, p, 'lib/entry.gcscript', {}, false)).toBe('{}');
    expect(build).toHaveBeenCalledWith({
      input: p.files['lib/entry.gcscript']?.text,
      fileUri: 'app:///lib/entry.gcscript',
      files: p.files,
      useSchema: {},
      compactOutput: false,
      doValidate: true,
    });
  });
  it('rejects non-executable and binary targets', async () => {
    const p = put(createProject(DEFAULT_CONFIG, 'p'), 'a.gcscript', {
      text: 'AA==',
      encoding: 'base64',
    });
    await expect(buildProjectFile({ build: vi.fn() }, p, 'a.gcscript', {}, false)).rejects.toThrow(
      'text file',
    );
    await expect(buildProjectFile({ build: vi.fn() }, p, 'missing', {}, false)).rejects.toThrow(
      'text file',
    );
  });
  it('refuses stale build writes and source overwrite', () => {
    const p = createProject(DEFAULT_CONFIG, 'p');
    expect(() => commitBuild({ ...p, revision: 1 }, p, p.active, 'out.gcscript', '{}')).toThrow(
      'changed',
    );
    expect(() => commitBuild({ ...p, id: 'other' }, p, p.active, 'out.gcscript', '{}')).toThrow(
      'changed',
    );
    expect(() => commitBuild(p, p, p.active, p.active, '{}')).toThrow('overwrite');
    expect(commitBuild(p, p, p.active, 'out.gcscript', '{}').files['out.gcscript']?.text).toBe(
      '{}',
    );
  });
});
describe('wallet transport', () => {
  it('enforces the selected network by default and omits referral attribution unless configured', () => {
    const params = walletParameters('{}', DEFAULT_CONFIG.defaults, 'https://site.test/studio/');
    expect(params.disableNetworkRouter).toBe(false);
    expect(
      walletParameters(
        '{}',
        { ...DEFAULT_CONFIG.defaults, disableNetworkRouter: true },
        'https://site.test',
      ).disableNetworkRouter,
    ).toBe(true);
    expect(params).not.toHaveProperty('refAddress');
    expect(params.network).toBe('preprod');
    expect(
      walletParameters(
        '{}',
        { ...DEFAULT_CONFIG.defaults, refAddress: ' addr_test1_configured ' },
        'https://site.test',
      ).refAddress,
    ).toBe('addr_test1_configured');
  });
  it('creates a subpath-safe callback with one result query', () => {
    const input = '{"type":"script","run":{}}';
    const code = JSON.parse(withWalletCallback(input, 'https://site.test/studio/', 'run123'));
    expect(code.returnURLPattern).toBe(
      'https://site.test/studio/index.html?result={result}#studioRun=run123',
    );
    expect(input).not.toContain('returnURLPattern');
    expect(() => withWalletCallback('[]', 'https://site.test', 'x')).toThrow('object');
  });
  it('validates pending identity and expiry without treating correlation as authorization', () => {
    const pending = { token: 't', projectId: 'p', resultsPath: 'results/a.json', created: 100 };
    expect(parsePendingRun(pending, 200, 1000)).toEqual(pending);
    expect(() => parsePendingRun(pending, 1101, 1000)).toThrow('expired');
    expect(() => parsePendingRun(pending, 99, 1000)).toThrow();
    expect(() => parsePendingRun({}, 200, 1000)).toThrow();
  });
  it('decodes plain JSON and encoded exports, rejects empty and executable payloads', async () => {
    const decode = vi.fn(async () => ({ exports: 42 }));
    expect(await decodeWalletResult('{"exports":1}', decode)).toEqual({ exports: 1 });
    expect(await decodeWalletResult('[1,2]', decode)).toEqual([1, 2]);
    expect(await decodeWalletResult('encoded', decode)).toEqual({ exports: 42 });
    expect(await decodeWalletResult({ data: true }, decode)).toEqual({ data: true });
    await expect(decodeWalletResult('', decode)).rejects.toThrow('Empty');
    await expect(decodeWalletResult(null, decode)).rejects.toThrow('invalid');
    await expect(decodeWalletResult({ x: () => {} }, decode)).rejects.toThrow('invalid');
  });
});
it('loads isolated serializable config and honors function overrides', async () => {
  const a = await getConfig(),
    b = await getConfig();
  a.defaults.theme = 'light';
  expect(b.defaults.theme).toBe('dark');
  expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  expect(languageColor(b, 'script', 'gcscript')).toBe(languageColor(b, 'importAsData', 'gcscript'));
  expect(languageColor(b, '$importAsScript', 'extras')).toBe(
    languageColor(b, '$importAsData', 'extras'),
  );
  expect(languageColor(b, 'get', 'isl')).toBe(b.colors.categories.isl);
});
it('provides an exportable subscribed state store', () => {
  const initial = initialState(createProject(DEFAULT_CONFIG, 'p'), DEFAULT_CONFIG, true),
    store = createStudioStore(initial),
    listener = vi.fn();
  const stop = store.subscribe(listener);
  store.update((s) => s);
  expect(listener).not.toHaveBeenCalled();
  store.update((s) => ({ ...s, mode: 'blocks' }));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().mode).toBe('blocks');
  expect(store.getSnapshot().layout.explorer).toBe(false);
  stop();
  store.update((s) => ({ ...s, mode: 'code' }));
  expect(listener).toHaveBeenCalledTimes(1);
});
