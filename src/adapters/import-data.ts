import { DEFAULT_CONFIG } from '../config';
import { path } from '../core/project/vfs';

function archivePath(input: string): void {
  // Validate component names using the archive import normalization rules.
  const normalized = path(
    input
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .join('/'),
  );
  if (normalized === '__proto__') throw Error('Unsupported archive entry name: __proto__');
}

/** Consume a bounded byte stream before parsing or exposing imported data to the UI. */
export async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw RangeError('Import exceeds the configured size limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Inflate imported data within the configured byte budget. */
export async function inflateBounded(
  data: Uint8Array,
  format: CompressionFormat,
  limit: number,
): Promise<Uint8Array> {
  const stream = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  return readBounded(stream.pipeThrough(new DecompressionStream(format)), limit);
}

/** Validate archive structure, entry names and resource budgets before import. */
export async function checkArchive(
  data: Uint8Array,
  filename: string,
  limit: number,
  maxEntries = DEFAULT_CONFIG.limits.projectEntries,
): Promise<void> {
  if (/\.(tar\.gz|tgz)$/i.test(filename)) {
    const tar = await inflateBounded(data, 'gzip', limit);
    const decoder = new TextDecoder();
    const field = (start: number, length: number) =>
      decoder.decode(tar.subarray(start, start + length)).split('\0')[0]!;
    let entries = 0;
    for (let offset = 0; offset + 512 <= tar.length;) {
      if (tar.subarray(offset, offset + 512).every((byte) => byte === 0)) break;
      if (++entries > maxEntries)
        throw Error('Archive exceeds the configured file/directory count limit');
      const sizeField = field(offset + 124, 12).trim();
      if (!/^[0-7]*$/.test(sizeField)) throw Error('Invalid TAR size field');
      const size = sizeField ? parseInt(sizeField, 8) : 0;
      const next = offset + 512 + Math.ceil(size / 512) * 512;
      if (!Number.isSafeInteger(size) || next > tar.length)
        throw Error('Truncated or oversized TAR entry');
      archivePath([field(offset + 345, 155), field(offset, 100)].filter(Boolean).join('/'));
      offset = next;
    }
    return;
  }
  if (!/\.zip$/i.test(filename)) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  const earliest = Math.max(0, end - 65535);
  for (; end >= earliest; end--) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === data.length
    )
      break;
  }
  if (end < earliest) throw Error('Invalid ZIP directory');
  const count = view.getUint16(end + 10, true);
  if (count > maxEntries) throw Error('Archive exceeds the configured file/directory count limit');
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count === 65535 ||
    offset === 0xffffffff
  )
    throw Error('Split and ZIP64 archives are not supported');
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw Error('Invalid ZIP entry');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const local = view.getUint32(offset + 42, true);
    const next =
      offset +
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (
      next > end ||
      local + 30 > offset ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(offset + 8, true) & 1
    )
      throw Error('Invalid or encrypted ZIP entry');
    if (view.getUint16(local + 8, true) !== method)
      throw Error('Inconsistent ZIP compression method');
    archivePath(
      new TextDecoder().decode(
        data.subarray(offset + 46, offset + 46 + view.getUint16(offset + 28, true)),
      ),
    );
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > offset || expanded > limit - total)
      throw Error('ZIP entry exceeds the configured size limit');
    if (method === 0) {
      if (compressed !== expanded) throw Error('Invalid stored ZIP entry size');
    } else if (method === 8) {
      const bytes = await inflateBounded(
        data.subarray(start, start + compressed),
        'deflate-raw',
        limit - total,
      );
      if (bytes.length !== expanded) throw Error('Invalid expanded ZIP entry size');
    } else throw Error('Unsupported ZIP compression method: ' + method);
    total += expanded;
    offset = next;
  }
  if (offset !== end) throw Error('Invalid ZIP directory size');
}
