import { gc } from './gc';
import type { VirtualFile, Project } from '../core/project/vfs';
import { mkdir, path, put } from '../core/project/vfs';
import type { StudioConfig } from '../config';
interface ByteBuffer extends Uint8Array {
  toString(encoding?: string): string;
}
interface BufferFactory {
  from(value: string | Uint8Array, encoding?: string): ByteBuffer;
}
const buffer: BufferFactory = gc.utils.Buffer;
export interface GCFile {
  data: Uint8Array;
  mimeType?: string;
}
export const fileBytes = (file: VirtualFile): ByteBuffer => buffer.from(file.text, file.encoding);
/** GC's VFS is a path-to-{data,mimeType} map; preserve binary bytes without decoding loss. */
export function toGCFiles(files: Record<string, VirtualFile>): Record<string, GCFile> {
  return Object.fromEntries(
    Object.entries(files).map(([key, file]) => [
      key,
      {
        data: fileBytes(file),
        mimeType: file.encoding === 'base64' ? 'application/octet-stream' : 'text/plain',
      },
    ]),
  );
}
export function fromBytes(data: Uint8Array): VirtualFile {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (text.includes('\0')) throw Error('Binary NUL');
    return { text, encoding: 'utf8' };
  } catch {
    return { text: buffer.from(data).toString('base64'), encoding: 'base64' };
  }
}
export const dataURIText = (uri: string): string =>
  new TextDecoder().decode(gc.utils.dataURIToBuffer(uri));
export function archiveFiles(project: Project, marker: string): Record<string, GCFile> {
  const files = toGCFiles(project.files);
  for (const dir of project.dirs)
    if (!Object.keys(files).some((key) => key.startsWith(dir + '/')))
      files[dir + '/' + marker] = { data: buffer.from('') };
  return files;
}
/** Construct an entire import before committing; no partially imported trees on invalid paths. */
export function importGCFiles(
  project: Project,
  files: Record<string, GCFile>,
  folder: string,
  config: StudioConfig,
): Project {
  let next = project,
    total = 0;
  for (const [key, file] of Object.entries(files)) {
    total += file.data.byteLength;
    if (total > config.limits.archiveBytes)
      throw Error('Import exceeds the configured uncompressed size limit');
    const target = path((folder ? path(folder) + '/' : '') + key);
    if (target.endsWith('/' + config.project.marker) && file.data.byteLength === 0)
      next = mkdir(next, target.slice(0, -config.project.marker.length - 1));
    else {
      next = put(next, target, fromBytes(file.data), true);
      if (!next.active) next = { ...next, active: target };
    }
  }
  return next;
}
export async function readImports(files: FileList | File[]): Promise<Record<string, GCFile>> {
  const entries: Record<string, GCFile> = {};
  for (const file of Array.from(files)) {
    const data = new Uint8Array(await file.arrayBuffer());
    const uri = gc.utils.bufferToDataURI(data);
    const unpacked = /\.zip$/i.test(file.name)
      ? gc.utils.zipToVirtualFileSystem(uri)
      : /\.(tar\.gz|tgz)$/i.test(file.name)
        ? gc.utils.tarGzToVirtualFileSystem(uri)
        : { [file.webkitRelativePath || file.name]: { data } };
    for (const [key, value] of Object.entries(unpacked)) {
      const normalized = path(key);
      if (Object.hasOwn(entries, normalized)) throw Error('Duplicate imported path: ' + normalized);
      Object.defineProperty(entries, normalized, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return entries;
}
export function download(
  name: string,
  data: string | Uint8Array,
  type = 'text/plain',
  delay = 1500,
): void {
  const bytes = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  downloadURI(name, url);
  setTimeout(() => URL.revokeObjectURL(url), delay);
}
export function downloadURI(name: string, uri: string): void {
  const anchor = document.createElement('a');
  anchor.href = uri;
  anchor.download = name;
  anchor.click();
}
