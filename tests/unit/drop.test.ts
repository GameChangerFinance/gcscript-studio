import { describe, expect, it } from 'vitest';
import { droppedFiles } from '../../src/adapters/drop';
const fileEntry = (name: string, text: string): FileSystemEntry =>
  ({
    isFile: true,
    isDirectory: false,
    name,
    file: (accept: (file: File) => void) => accept(new File([text], name)),
  }) as unknown as FileSystemFileEntry;
const directory = (name: string, batches: FileSystemEntry[][]): FileSystemEntry =>
  ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (accept: (entries: FileSystemEntry[]) => void) => accept(batches.shift() ?? []),
    }),
  }) as unknown as FileSystemDirectoryEntry;
const transfer = (entries: FileSystemEntry[]): DataTransfer =>
  ({
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files: [],
  }) as unknown as DataTransfer;
describe('explorer native drops', () => {
  it('drains all directory batches and preserves nested paths/empty directories', async () => {
    const data = transfer([
      directory('project', [
        [fileEntry('main.gcscript', '{}')],
        [directory('lib', [[fileEntry('data.json', '42')]]), directory('empty', [])],
        [],
      ]),
    ]);
    const files = await droppedFiles(data, '.empty-marker');
    expect(files.map((file) => file.webkitRelativePath)).toEqual([
      'project/main.gcscript',
      'project/lib/data.json',
      'project/empty/.empty-marker',
    ]);
    expect(await files[1]!.text()).toBe('42');
  });
  it('supports ordinary FileList drops when entry APIs are unavailable', async () => {
    const file = new File(['hello'], 'note.txt');
    expect(await droppedFiles({ files: [file] } as unknown as DataTransfer)).toEqual([file]);
  });
  it('rejects reader failures before any importer receives partial data', async () => {
    const entry = {
      isFile: false,
      isDirectory: true,
      name: 'bad',
      createReader: () => ({
        readEntries: (_accept: unknown, reject: (error: Error) => void) =>
          reject(Error('Read failed')),
      }),
    } as unknown as FileSystemEntry;
    await expect(droppedFiles(transfer([entry]))).rejects.toThrow('Read failed');
  });
});
