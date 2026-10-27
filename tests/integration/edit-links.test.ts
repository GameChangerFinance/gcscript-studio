import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config';
import { decodeEditLink, encodeEditLink } from '../../src/adapters/edit-links';
import { readStudioLaunch, parseEditImport } from '../../src/core/project/edit-link';
import { createProject, mkdir, put } from '../../src/core/project/vfs';
import { sessionConfig } from '../../src/adapters/persistence';
import { withWalletCallback, walletCallbackContext } from '../../src/core/wallet';
import { gc } from '../../src/adapters/gc';
import { buildService } from '../../src/adapters/build';
import { runtime } from '../fixtures';
const base = 'https://studio.test/gcscript-studio/';
const config = DEFAULT_CONFIG;
describe('GC edit-link transport', () => {
  it('preserves an ampersand-free embedded callback through repeated real builds and URL encoding', async () => {
    const expected = JSON.parse(withWalletCallback('{}', base, 'roundtrip', true)).returnURLPattern;
    let input = JSON.stringify({
      type: 'script',
      run: { address: { type: 'getCurrentAddress' } },
      returnURLPattern: 'https://old.test/?result={result}&amp;amp;embed=true',
    });
    for (let pass = 0; pass < 3; pass++) {
      input = withWalletCallback(input, base, 'roundtrip', true);
      input = await buildService.build({
        input,
        fileUri: 'app:///main.gcscript',
        files: {},
        useSchema: runtime,
        compactOutput: false,
        doValidate: true,
      });
      const encoded = await gc.encode.url({
        input,
        apiVersion: '2',
        network: 'preprod',
        encoding: 'gzip',
        disableNetworkRouter: true,
        urlPattern: 'https://wallet.test/api/2/run/{gcscript}',
      });
      const decoded = await gc.encodings.msg.decoder(new URL(encoded).pathname.split('/').at(-1)!);
      expect(decoded.returnURLPattern).toBe(expected);
      expect(decoded.returnURLPattern).not.toContain('&');
    }
  });
  it('uses the actual GC gzip codec under a deployment subpath without wallet parameters', async () => {
    const script = { type: 'script', run: { address: { type: 'getCurrentAddress' } } };
    const url = await encodeEditLink(script, base, config, { embed: true, view: 'node' });
    expect(url).toMatch(/^https:\/\/studio.test\/gcscript-studio\/api\/2\/edit\/1-H4s/);
    expect(new URL(url).search).toBe('?embed=true&view=node');
    const launch = readStudioLaunch(url, base, config);
    expect(launch).toMatchObject({ embedded: true, mode: 'nodes' });
    const imported = await decodeEditLink(launch.encoded!, config);
    expect(imported.kind).toBe('file');
    if (imported.kind === 'file') expect(JSON.parse(imported.file.text)).toEqual(script);
  });
  it('preserves exact JSONC source, filenames and binary file representation', async () => {
    for (const file of [
      { text: '// keep\n{"type":"script","run":{},}\n', encoding: 'utf8' as const },
      { text: 'AP8=', encoding: 'base64' as const },
    ]) {
      const url = await encodeEditLink(
        { format: 'gcscript-studio-file', version: 1, path: 'lib/main.gcscript', file },
        base,
        config,
      );
      expect(await decodeEditLink(readStudioLaunch(url, base, config).encoded!, config)).toEqual({
        kind: 'file',
        path: 'lib/main.gcscript',
        file,
      });
    }
  });
  it('round-trips the serializable VFS including empty directories and binary assets', async () => {
    let project = mkdir(createProject(config, 'transport'), 'empty');
    project = put(project, 'asset.bin', { text: 'AP8=', encoding: 'base64' });
    const url = await encodeEditLink(project, base, config);
    expect(await decodeEditLink(readStudioLaunch(url, base, config).encoded!, config)).toEqual({
      kind: 'project',
      project,
    });
  });
  it('rejects corrupt, excessive, version-incompatible and unsafe payloads', async () => {
    for (const payload of [
      '',
      '../oops',
      '1-corrupt',
      'a'.repeat(config.editLinks.maxEncodedCharacters + 1),
    ])
      await expect(decodeEditLink(payload, config)).rejects.toThrow();
    const file = { text: '{}', encoding: 'utf8' };
    expect(() =>
      parseEditImport(
        { format: 'gcscript-studio-file', version: 1, path: '../escape.gcscript', file },
        config,
      ),
    ).toThrow();
    expect(() =>
      parseEditImport({ format: 'gcscript-studio-file', version: 2, path: 'x', file }, config),
    ).toThrow();
    expect(() =>
      parseEditImport({ ...createProject(config, 'old'), version: 'old' }, config),
    ).toThrow('version');
    await expect(
      encodeEditLink('oversized', base, {
        ...config,
        editLinks: { ...config.editLinks, maxDecodedBytes: 1 },
      }),
    ).rejects.toThrow('too large');
    const url = await encodeEditLink({ type: 'script' }, base, config);
    await expect(
      decodeEditLink(readStudioLaunch(url, base, config).encoded!, {
        ...config,
        editLinks: { ...config.editLinks, maxDecodedBytes: 1 },
      }),
    ).rejects.toThrow('too large');
  });
  it('interprets explicit view and embed flags without matching other origins or paths', () => {
    for (const [query, embedded, mode] of [
      ['embed', true, undefined],
      ['embed=1&view=block', true, 'blocks'],
      ['embed=false&view=code', false, 'code'],
      ['embed=0&view=toString', false, undefined],
    ] as const)
      expect(readStudioLaunch(base + '?' + query, base, config)).toMatchObject({
        embedded,
        mode,
        encoded: null,
      });
    expect(readStudioLaunch('https://other.test/api/2/edit/1-x', base, config).encoded).toBeNull();
    expect(readStudioLaunch(base + 'api/2/run/1-x', base, config).encoded).toBeNull();
  });
  it('isolates editable sessions and wallet records while sharing schema downloads', () => {
    const embedded = sessionConfig(config, true);
    for (const key of ['project', 'options', 'run', 'result'] as const) {
      expect(embedded.storage[key]).not.toBe(config.storage[key]);
      expect(embedded.storage[key].startsWith(config.storage[key] + ':')).toBe(false);
    }
    expect(embedded.storage.schemas).toBe(config.storage.schemas);
    expect(sessionConfig(embedded, true)).toEqual(embedded);
    expect(sessionConfig(config, false)).toBe(config);
    const callback = new URL(
      JSON.parse(withWalletCallback('{}', base, 'token', true)).returnURLPattern,
    );
    expect(callback.pathname).toBe('/gcscript-studio/index.html');
    expect(callback.searchParams.has('embed')).toBe(false);
    expect(callback.href).not.toContain('&');
    expect(walletCallbackContext(callback)).toEqual({ token: 'token', embedded: true });
    expect(readStudioLaunch(callback.href, base, config).embedded).toBe(true);
    expect(callback.searchParams.get('result')).toBe('{result}');
  });
});
