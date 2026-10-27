import { gc } from '../gc';
import type { StudioConfig } from '../../config';
import { decodeWalletResult, parsePendingRun } from '../../core/wallet';
import type { PendingRun } from '../../core/wallet';
import type { JsonValue } from '../../core/json';
import { isJsonValue } from '../../core/json';
import { path } from '../../core/project/vfs';
export interface WalletReturn {
  pending: PendingRun;
  result: JsonValue;
}
export const decodeResult = (value: unknown): Promise<JsonValue> =>
  decodeWalletResult(value, async (input) => gc.encodings.msg.decoder(input));

/** Capture and scrub before React starts; storage survives wallets that sever window.opener. */
export async function captureWalletReturn(config: StudioConfig): Promise<boolean> {
  const url = new URL(location.href),
    result = url.searchParams.get('result');
  if (result === null) return false;
  const token = new URLSearchParams(url.hash.slice(1)).get('studioRun');
  url.searchParams.delete('result');
  url.hash = '';
  history.replaceState(history.state, '', url.pathname + url.search);
  if (!token) throw Error('Wallet returned without a Studio run identifier');
  const pending = parsePendingRun(
    JSON.parse(localStorage.getItem(config.storage.run + ':' + token) ?? 'null'),
    Date.now(),
    config.wallet.pendingMaxAge,
  );
  const payload: WalletReturn = { pending, result: await decodeResult(result) };
  if (pending.token !== token) throw Error('Wallet return token does not match its run record');
  path(pending.resultsPath);
  localStorage.setItem(config.storage.result + ':' + token, JSON.stringify(payload));
  window.opener?.postMessage({ type: 'gcstudio-wallet-return' }, location.origin);
  // A redirect return must boot the IDE and consume this saved envelope in the same window.
  if (pending.mode === 'redirect') return false;
  window.close();
  return true;
}
export function registerRun(config: StudioConfig, pending: PendingRun): void {
  localStorage.setItem(config.storage.run + ':' + pending.token, JSON.stringify(pending));
}
export function consumeReturns(
  config: StudioConfig,
  projectId: string,
  accept: (payload: WalletReturn) => void,
  onError: (message: string) => void,
): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(config.storage.result + ':')) continue;
    try {
      const token = key.slice(config.storage.result.length + 1);
      const pending = parsePendingRun(
        JSON.parse(localStorage.getItem(config.storage.run + ':' + token) ?? 'null'),
        Date.now(),
        config.wallet.pendingMaxAge,
      );
      if (pending.token !== token) throw Error('Wallet return token does not match its run record');
      path(pending.resultsPath);
      if (pending.projectId !== projectId) continue;
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (typeof raw !== 'object' || raw === null || !('result' in raw))
        throw Error('Invalid wallet return envelope');
      // Decoding was completed by the callback. Only data-only JSON crosses the bridge.
      const result = raw.result;
      if (!isJsonValue(result) || result === null) throw Error('Invalid wallet return data');
      accept({ pending, result });
      localStorage.removeItem(key);
      localStorage.removeItem(config.storage.run + ':' + token);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
}
