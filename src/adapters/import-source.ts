import type { StudioConfig } from '../config';
import type { EditImport } from '../core/project/edit-link';
import { parseEditImport } from '../core/project/edit-link';
import { path } from '../core/project/vfs';
import { decodeEditLink } from './edit-links';
import { readBounded } from './import-data';
import { parseJSONC, isRecord } from '../core/json';

/** URLs are fetched as data with no credentials, redirects, HTML rendering or script execution. */
export async function readImportSource(
  source: string,
  config: StudioConfig,
): Promise<EditImport | { kind: 'download'; file: File }> {
  const input = source.trim();
  if (!input) throw Error('Paste a URL, GC payload, GCScript or project JSON');
  if (new TextEncoder().encode(input).byteLength > config.editLinks.maxDecodedBytes)
    throw Error('Import exceeds the configured size limit');
  if (/^[\w-]+$/.test(input)) return decodeEditLink(input, config);
  if (
    input.startsWith('{') ||
    input.startsWith('[') ||
    input.startsWith('//') ||
    input.startsWith('/*')
  ) {
    const value = parseJSONC(input);
    const imported = parseEditImport(value, config);
    if (imported.kind === 'file' && !(isRecord(value) && value.format === 'gcscript-studio-file'))
      imported.file.text = input;
    return imported;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw Error('Use an HTTP(S) URL, GC payload, GCScript or project JSON');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw Error('Import URLs must use HTTP(S) without credentials');
  const encoded = /\/api\/2\/(?:edit|run)\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
  if (encoded) return decodeEditLink(encoded, config);
  const filename = path(decodeURIComponent(url.pathname.split('/').at(-1) || 'main.gcscript'));
  if (filename.includes('/')) throw Error('Invalid import filename');
  const response = await fetch(url.href, {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(config.timing.importTimeout),
  });
  if (!response.ok) throw Error('Import download failed: HTTP ' + response.status);
  if (!response.body) throw Error('Import response has no content');
  const bytes = await readBounded(response.body, config.limits.archiveBytes);
  if (!/\.(zip|tar\.gz|tgz)$/i.test(filename)) {
    const text = new TextDecoder().decode(bytes).trim();
    if (/^(?:1-|0-|XQ|wo)[\w-]+$/.test(text)) return decodeEditLink(text, config);
    if (text.startsWith('{')) {
      try {
        const value = JSON.parse(text) as unknown;
        if (
          isRecord(value) &&
          ((Object.hasOwn(value, 'files') && Object.hasOwn(value, 'version')) ||
            value.format === 'gcscript-studio-file')
        )
          return parseEditImport(value, config);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return { kind: 'download', file: new File([bytes], filename) };
}
