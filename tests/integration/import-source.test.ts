import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DEFAULT_CONFIG } from '../../src/config';
import { readImportSource } from '../../src/adapters/import-source';
import { decodeEditLink, encodeEditLink } from '../../src/adapters/edit-links';
import { readImports, archiveFiles } from '../../src/adapters/files';
import { createProject, put } from '../../src/core/project/vfs';
import { gc } from '../../src/adapters/gc';

afterEach(() => vi.unstubAllGlobals());
const config = DEFAULT_CONFIG;
describe('untrusted import sources', () => {
  it('enforces archive entry size and name constraints', async () => {
    const uri = gc.utils.virtualFileSystemToTarGz({
      'safe-name': { data: new TextEncoder().encode('{}') },
    });
    const tar = gunzipSync(Uint8Array.from(gc.utils.dataURIToBuffer(uri)));
    const negative = Buffer.from(tar);
    negative.fill(0, 124, 136);
    negative.write('-1000', 124);
    await expect(
      readImports([new File([Uint8Array.from(gzipSync(negative))], 'project.tar.gz')]),
    ).rejects.toThrow('TAR size');
    const reserved = Buffer.from(tar);
    reserved.fill(0, 0, 100);
    reserved.write('__proto__');
    await expect(
      readImports([new File([Uint8Array.from(gzipSync(reserved))], 'project.tar.gz')]),
    ).rejects.toThrow('__proto__');
  });
  it('accepts pasted GC payloads and edit/wallet links as data without fetching or executing them', async () => {
    const input = { type: 'script', title: '<img src=x onerror=alert(1)>', run: {} };
    const url = await encodeEditLink(input, 'https://studio.test/', config);
    const payload = new URL(url).pathname.split('/').at(-1)!;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const source of [url, payload, 'https://wallet.test/api/2/run/' + payload]) {
      const imported = await readImportSource(source, config);
      expect(imported.kind).toBe('file');
      if (imported.kind === 'file') expect(JSON.parse(imported.file.text)).toEqual(input);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves JSONC comments in pasted source and reads exported projects', async () => {
    const source = '{\n// Keep this\n"type":"script", "run":{},\n}';
    const file = await readImportSource(source, config);
    expect(file).toMatchObject({ kind: 'file', file: { text: source } });
    const project = createProject(config, 'imported');
    await expect(
      readImportSource(JSON.stringify(project), {
        ...config,
        limits: { ...config.limits, projectEntries: 0 },
      }),
    ).rejects.toThrow('count limit');
    expect(await readImportSource(JSON.stringify(project), config)).toEqual({
      kind: 'project',
      project,
    });
  });
  it('recognizes hosted project JSON and GC payload bodies even without filename extensions', async () => {
    const project = createProject(config, 'hosted');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(project))),
    );
    expect(await readImportSource('https://docs.test/project', config)).toEqual({
      kind: 'project',
      project,
    });
    const url = await encodeEditLink(project, 'https://studio.test/', config);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new URL(url).pathname.split('/').at(-1)!)),
    );
    expect(await readImportSource('https://docs.test/payload', config)).toEqual({
      kind: 'project',
      project,
    });
  });
  it('rejects executable URLs, credentials, relative URLs and executable HTML before any request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const source of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'https://user:pass@evil.test/a',
      '/relative.gcscript',
      '<svg onload=alert(1)>',
    ])
      await expect(readImportSource(source, config)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fetches raw files with bounded content, no credentials, redirects or referrer', async () => {
    const fetcher = vi.fn(async () => new Response('{"type":"script"}'));
    vi.stubGlobal('fetch', fetcher);
    const result = await readImportSource('https://docs.test/example.gcscript', config);
    expect(result.kind).toBe('download');
    if (result.kind === 'download') {
      expect(result.file.name).toBe('example.gcscript');
      expect(await result.file.text()).toBe('{"type":"script"}');
    }
    expect(fetcher).toHaveBeenCalledWith(
      'https://docs.test/example.gcscript',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oversized')),
    );
    await expect(
      readImportSource('https://docs.test/file', {
        ...config,
        limits: { ...config.limits, archiveBytes: 2 },
      }),
    ).rejects.toThrow('size limit');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    await expect(readImportSource('https://docs.test/file', config)).rejects.toThrow('HTTP 403');
  });
  it('enforces the decoded-byte budget for compressed payloads', async () => {
    const url = await encodeEditLink(
      { type: 'script', title: 'x'.repeat(5000), run: {} },
      'https://studio.test/',
      config,
    );
    await expect(
      decodeEditLink(new URL(url).pathname.split('/').at(-1)!, {
        ...config,
        editLinks: { ...config.editLinks, maxDecodedBytes: 100 },
      }),
    ).rejects.toThrow('too large');
  });
  it('preflights real ZIP/TAR.GZ archives and rejects expansion limits and traversal', async () => {
    const project = put(createProject(config, 'archive'), 'long.txt', {
      encoding: 'utf8',
      text: 'x'.repeat(10000),
    });
    for (const format of ['zip', 'tar.gz']) {
      const files = archiveFiles(project, config.project.marker);
      const uri =
        format === 'zip'
          ? gc.utils.virtualFileSystemToZip(files)
          : gc.utils.virtualFileSystemToTarGz(files);
      const bytes = Uint8Array.from(gc.utils.dataURIToBuffer(uri));
      const file = new File([bytes], 'project.' + format);
      expect(Object.keys(await readImports([file]))).toContain('long.txt');
      await expect(readImports([file], config.limits.archiveBytes, 1)).rejects.toThrow(
        'count limit',
      );
      await expect(readImports([file], 1000)).rejects.toThrow('size limit');
    }
    const uri = gc.utils.virtualFileSystemToZip({
      'aa/escape.gcscript': { data: new TextEncoder().encode('{}') },
    });
    const unsafe = Uint8Array.from(gc.utils.dataURIToBuffer(uri));
    for (let index = 0; index < unsafe.length - 2; index++)
      if (unsafe[index] === 97 && unsafe[index + 1] === 97 && unsafe[index + 2] === 47) {
        unsafe[index] = 46;
        unsafe[index + 1] = 46;
      }
    await expect(readImports([new File([unsafe], 'project.zip')])).rejects.toThrow(/path/i);
    await expect(readImports([new File(['invalid'], 'project.zip')])).rejects.toThrow('ZIP');
  });
});
