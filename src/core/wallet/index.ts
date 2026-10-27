import { isObject, isJsonValue, isRecord } from '../json.js';
import type { JsonValue } from '../json.js';
import type { StudioOptions } from '../../config.js';
export interface WalletParameters {
  input: string;
  apiVersion: '2';
  network: 'preprod' | 'mainnet';
  encoding: 'gzip';
  urlPattern: string;
  refAddress?: string;
  disableNetworkRouter: boolean;
}
/** Enforce the selected network through GC routing unless explicitly disabled in Options. */
export function walletParameters(
  input: string,
  options: StudioOptions,
  _baseURL: string,
): WalletParameters {
  // Preserve the existing call signature; Studio URLs are never referral attribution.
  void _baseURL;
  return {
    input,
    apiVersion: '2',
    network: options.network,
    encoding: 'gzip',
    urlPattern: options.walletUrl,
    ...(options.refAddress.trim() ? { refAddress: options.refAddress.trim() } : {}),
    disableNetworkRouter: options.disableNetworkRouter,
  };
}
/** A fragment carries callback correlation without a second query field. The caller persists it. */
export function withWalletCallback(
  input: string,
  baseURL: string,
  token: string,
  embedded = false,
): string {
  const code: unknown = JSON.parse(input);
  if (!isJsonValue(code) || !isObject(code))
    throw Error('Wallet input must be a built GCScript object');
  const callback = new URL('index.html', baseURL);
  callback.search = '?result={result}';
  if (embedded) callback.searchParams.set('embed', 'true');
  callback.hash = 'studioRun=' + encodeURIComponent(token);
  return JSON.stringify({
    ...code,
    returnURLPattern: callback.href.replace(/%7Bresult%7D/gi, '{result}'),
  });
}
export interface PendingRun {
  token: string;
  projectId: string;
  resultsPath: string;
  created: number;
  mode?: StudioOptions['runMode'];
}
export function parsePendingRun(value: unknown, now: number, maxAge: number): PendingRun {
  if (
    !isRecord(value) ||
    typeof value.token !== 'string' ||
    typeof value.projectId !== 'string' ||
    typeof value.resultsPath !== 'string' ||
    typeof value.created !== 'number' ||
    value.created > now ||
    now - value.created > maxAge
  )
    throw Error('Unrecognized or expired wallet run');
  return {
    token: value.token,
    projectId: value.projectId,
    resultsPath: value.resultsPath,
    created: value.created,
    ...(['popup', 'redirect', 'qr'].includes(String(value.mode))
      ? { mode: value.mode as StudioOptions['runMode'] }
      : {}),
  };
}
export async function decodeWalletResult(
  value: unknown,
  decode: (input: string) => Promise<unknown>,
): Promise<JsonValue> {
  let result: unknown = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) throw Error('Empty wallet result');
    result = /^[{[]/.test(text) ? JSON.parse(text) : await decode(text);
  }
  if (!isJsonValue(result) || result === null)
    throw Error('Empty or invalid decoded wallet result');
  return result;
}

/** Merge named exports recursively; arrays/scalars replace. Own keys prevent prototype traversal. */
export function mergeWalletResults(previous: JsonValue, incoming: JsonValue): JsonValue {
  if (!isObject(previous) || !isObject(incoming)) return incoming;
  return Object.fromEntries([
    ...Object.entries(previous).filter(([key]) => !Object.hasOwn(incoming, key)),
    ...Object.entries(incoming).map(([key, value]) => [
      key,
      Object.hasOwn(previous, key) ? mergeWalletResults(previous[key]!, value) : value,
    ]),
  ]);
}
