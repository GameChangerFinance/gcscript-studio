import { describe, expect, it } from 'vitest';
import { gc } from '../../src/adapters/gc';
import { buildService, validateBuilt } from '../../src/adapters/build';
import {
  archiveFiles,
  dataURIText,
  fileBytes,
  fromBytes,
  importGCFiles,
  toGCFiles,
} from '../../src/adapters/files';
import { DEFAULT_CONFIG } from '../../src/config';
import { createProject, mkdir, put } from '../../src/core/project/vfs';
import { buildProjectFile } from '../../src/core/project/build';
import { walletParameters } from '../../src/core/wallet';
import { runtime, authoring } from '../fixtures';
import type { JsonValue } from '../../src/core/json';
import { isRecord } from '../../src/core/json';
const file = (text: string) => ({ text, encoding: 'utf8' as const });
describe('official GC browser consumer', () => {
  it('builds nested app imports from the complete VFS and validates strict output', async () => {
    let p = createProject(DEFAULT_CONFIG, 'real-gc-build');
    p = put(
      p,
      'scripts/main.gcscript',
      file(
        '{"type":"script","run":{"configuration":{"type":"$importAsData","as":"object","from":{"network":"app:///data/config.json"}},"helpers":{"type":"$importAsScript","args":"{get(\'args\')}","from":{"helper":"app://./helper.gcscript"}}}}',
      ),
    );
    p = put(
      p,
      'scripts/helper.gcscript',
      file('{"type":"script","run":{"value":{"type":"data","value":"hello"}}}'),
    );
    p = put(p, 'data/config.json', file('{"network":"preprod","amount":"9007199254740993"}'));
    const output = await buildProjectFile(buildService, p, 'scripts/main.gcscript', runtime, false);
    const built: JsonValue = JSON.parse(output);
    expect(built).toMatchObject({
      type: 'script',
      run: {
        configuration: { type: 'data', value: { network: { amount: '9007199254740993' } } },
        helpers: { type: 'script', args: "{get('args')}", run: { helper: { type: 'script' } } },
      },
    });
    expect(output).not.toContain('$importAs');
    expect((await validateBuilt(output, runtime, 'app:///output.gcscript')).isValid).toBe(true);
  });
  it('authoring validation accepts build-stage functions but retains required argument errors', async () => {
    const input =
      '{"type":"script","run":{"settings":{"type":"$importAsData","as":"object","from":{"file":"app:///settings.json"}}}}';
    expect((await validateBuilt(input, authoring, 'app:///main.gcscript')).isValid).toBe(true);
    const invalid =
      '{"type":"script","run":{"settings":{"type":"$importAsData","as":"invalid","from":{}}}}';
    expect((await validateBuilt(invalid, authoring, 'app:///main.gcscript')).isValid).toBe(false);
  });
  it('rejects protocol-less and forbidden filesystem imports', async () => {
    const p = createProject(DEFAULT_CONFIG, 'p');
    for (const uri of ['./missing.json', 'file:///tmp/secret', 'app:///../secret']) {
      const input = JSON.stringify({
        type: 'script',
        run: { bad: { type: '$importAsData', from: { item: uri } } },
      });
      await expect(
        buildService.build({
          input,
          files: p.files,
          fileUri: 'app:///main.gcscript',
          useSchema: runtime,
          compactOutput: false,
        }),
      ).rejects.toThrow();
    }
  });
  it('retains binary files and empty directories through ZIP and TAR.GZ', () => {
    let p = put(createProject(DEFAULT_CONFIG, 'archive'), 'assets/data.bin', {
      encoding: 'base64',
      text: 'AP8AgA==',
    });
    p = mkdir(p, 'empty/folder');
    for (const format of ['zip', 'tar.gz']) {
      const data = archiveFiles(p, DEFAULT_CONFIG.project.marker);
      const uri =
        format === 'zip'
          ? gc.utils.virtualFileSystemToZip(data)
          : gc.utils.virtualFileSystemToTarGz(data);
      const decoded =
        format === 'zip'
          ? gc.utils.zipToVirtualFileSystem(uri)
          : gc.utils.tarGzToVirtualFileSystem(uri);
      const imported = importGCFiles({ ...p, files: {}, dirs: [] }, decoded, '', DEFAULT_CONFIG);
      expect(imported.files['assets/data.bin']).toEqual(p.files['assets/data.bin']);
      expect(imported.dirs).toContain('empty/folder');
    }
    expect([...fileBytes(p.files['assets/data.bin'] ?? file(''))]).toEqual([0, 255, 0, 128]);
    expect(fromBytes(new TextEncoder().encode('hello 🌐')).text).toBe('hello 🌐');
    expect(toGCFiles(p.files)['assets/data.bin']?.data).toBeInstanceOf(Uint8Array);
  });
  it('rejects archive path traversal and configured expansion limits before commit', () => {
    const p = createProject(DEFAULT_CONFIG, 'p');
    expect(() =>
      importGCFiles(p, { '../bad': { data: new Uint8Array([1]) } }, '', DEFAULT_CONFIG),
    ).toThrow('path');
    expect(() =>
      importGCFiles(p, { safe: { data: new Uint8Array(2) } }, '', {
        ...DEFAULT_CONFIG,
        limits: { ...DEFAULT_CONFIG.limits, archiveBytes: 1 },
      }),
    ).toThrow('size limit');
  });
  it('encodes a direct network-specific wallet URL and decodes its exact payload', async () => {
    const input = '{"type":"script","run":{"message":{"type":"data","value":"hello"}}}';
    const url = await gc.encode.url(
      walletParameters(input, DEFAULT_CONFIG.defaults, 'https://studio.test/gcscript-studio/'),
    );
    expect(url).toMatch(/^https:\/\/wallet\.gamechanger\.finance\//);
    expect(url).not.toContain('/network/');
    const query = new URL(url);
    expect(query.searchParams.get('networkTag')).toBe('preprod');
    expect(query.searchParams.has('ref')).toBe(false);
    const encoded = decodeURIComponent(query.pathname.split('/').at(-1) ?? '');
    const decoded: unknown = await gc.encodings.msg.decoder(encoded);
    expect(decoded).toBeDefined();
    const message = await gc.encodings.msg.encoder({
      input,
      apiVersion: '2',
      network: 'preprod',
      encoding: 'gzip',
    });
    const data: unknown = await gc.encodings.msg.decoder(String(message));
    expect(isRecord(data)).toBe(true);
  });
  it('generates all supported source snippets without Node runtime imports', async () => {
    const params = walletParameters(
      '{"type":"script","args":{"message":"hello"},"run":{"value":{"type":"macro","run":"{get(\'args.message\')}"}}}',
      DEFAULT_CONFIG.defaults,
      'https://studio.test/',
    );
    for (const kind of ['html', 'html-zero', 'react', 'button', 'express'] as const) {
      const output = await gc.snippet[kind](params);
      expect(output).toMatch(/^data:/);
      expect(dataURIText(output).length).toBeGreaterThan(50);
    }
  });
});

it('accepts array imports and root script directives in the authoring schema', async () => {
  const source = '{"type":"$importAsScript","from":["app:///lib/child.gcscript"]}';
  expect((await validateBuilt(source, authoring, 'app:///root.gcscript')).isValid).toBe(true);
  const p = put(
    createProject(DEFAULT_CONFIG, 'root-import'),
    'lib/child.gcscript',
    file('{"type":"script","run":{"value":{"type":"data","value":"ok"}}}'),
  );
  const result = await buildService.build({
    input: source,
    files: p.files,
    fileUri: 'app:///main.gcscript',
    useSchema: runtime,
    compactOutput: false,
  });
  expect(JSON.parse(result)).toMatchObject({ type: 'script', run: [{ type: 'script' }] });
});
