import { gc } from './gc';
import type { StudioConfig } from '../config';
import type { EditImport, EditLinkPayload, LinkView } from '../core/project/edit-link';
import { parseEditImport } from '../core/project/edit-link';

/** Use GC's URL/message codec unchanged; this endpoint opens source and never runs it. */
export async function encodeEditLink(
  payload: EditLinkPayload,
  baseURL: string,
  config: StudioConfig,
  options: { embed?: boolean; view?: LinkView } = {},
): Promise<string> {
  const input = JSON.stringify(payload);
  if (new TextEncoder().encode(input).length > config.editLinks.maxDecodedBytes)
    throw Error('IDE link payload is too large. Export a project archive instead.');
  parseEditImport(payload, config);
  const pattern = new URL(config.editLinks.route + '{gcscript}', baseURL).href.replace(
    '%7Bgcscript%7D',
    '{gcscript}',
  );
  const url = new URL(
    await gc.encode.url({
      input,
      apiVersion: '2',
      network: config.defaults.network,
      encoding: 'gzip',
      disableNetworkRouter: true,
      urlPattern: pattern,
    }),
  );
  if (
    url.pathname.slice(new URL(config.editLinks.route, baseURL).pathname.length).length >
    config.editLinks.maxEncodedCharacters
  )
    throw Error('IDE link is too large. Export a project archive instead.');
  if (options.embed) url.searchParams.set('embed', 'true');
  if (options.view) url.searchParams.set('view', options.view);
  return url.href;
}

/** Decode through GC, then validate paths, version and size before exposing editable state. */
export async function decodeEditLink(encoded: string, config: StudioConfig): Promise<EditImport> {
  if (
    !encoded ||
    encoded.length > config.editLinks.maxEncodedCharacters ||
    !/^[\w-]+$/.test(encoded)
  )
    throw Error('Invalid or oversized IDE link payload');
  const decoded: unknown = await gc.encodings.msg.decoder(encoded);
  const text = JSON.stringify(decoded);
  if (
    text === undefined ||
    new TextEncoder().encode(text).length > config.editLinks.maxDecodedBytes
  )
    throw Error('Decoded IDE link payload is invalid or too large');
  return parseEditImport(decoded, config);
}
