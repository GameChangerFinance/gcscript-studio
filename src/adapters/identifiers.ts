/** Local correlation IDs are not authentication credentials; support HTTP development origins. */
export function createCorrelationId(cryptoSource: Crypto | undefined = globalThis.crypto): string {
  if (cryptoSource?.randomUUID) return cryptoSource.randomUUID();
  if (cryptoSource?.getRandomValues)
    return [...cryptoSource.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}
