import type { StudioOptions } from '../config';
import { isRecord } from '../core/json';
export interface ExampleFile {
  name: string;
  path: string;
  url: string;
}
/** Normalize the GitHub tree response before views consume it. */
export async function fetchExamples(
  options: StudioOptions,
  signal?: AbortSignal,
): Promise<ExampleFile[]> {
  const response = await fetch(
    `https://api.github.com/repos/${options.examplesRepo}/git/trees/${encodeURIComponent(options.examplesBranch)}?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' }, ...(signal ? { signal } : {}) },
  );
  if (!response.ok) throw Error('GitHub API HTTP ' + response.status);
  const data: unknown = await response.json();
  if (!isRecord(data) || !Array.isArray(data.tree)) throw Error('Invalid GitHub tree response');
  const prefix = options.examplesPath.replace(/^\/+|\/+$/g, '') + '/';
  return data.tree.flatMap((entry: unknown) =>
    isRecord(entry) &&
    entry.type === 'blob' &&
    typeof entry.path === 'string' &&
    entry.path.startsWith(prefix) &&
    /\.(gcscript|gcscript\.jsonc?|jsonc)$/i.test(entry.path)
      ? [
          {
            name: entry.path.slice(prefix.length),
            path: entry.path,
            url: `https://raw.githubusercontent.com/${options.examplesRepo}/${options.examplesBranch}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
          },
        ]
      : [],
  );
}
