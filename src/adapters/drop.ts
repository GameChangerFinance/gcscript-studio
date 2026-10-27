/** Read a dropped tree fully before import. Directory readers can return multiple batches. */
export async function droppedFiles(
  transfer: DataTransfer,
  emptyDirectoryMarker?: string,
): Promise<File[]> {
  const files: File[] = [];
  async function walk(entry: FileSystemEntry, parent = ''): Promise<void> {
    const key = parent + entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      Object.defineProperty(file, 'webkitRelativePath', { value: key });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let hasChildren = false;
      for (;;) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        hasChildren = true;
        for (const child of entries) await walk(child, key + '/');
      }
      if (!hasChildren && emptyDirectoryMarker) {
        const file = new File([''], emptyDirectoryMarker);
        Object.defineProperty(file, 'webkitRelativePath', {
          value: key + '/' + emptyDirectoryMarker,
        });
        files.push(file);
      }
    }
  }
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.length) return Array.from(transfer.files);
  for (const entry of entries) await walk(entry);
  return files;
}
