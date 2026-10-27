import type { StudioConfig } from '../../config.js';
import type { EditorMode } from '../state.js';
import type { JsonValue } from '../json.js';
import { isJsonValue, isRecord } from '../json.js';
import type { Project, VirtualFile } from './vfs.js';
import { parseProject, path } from './vfs.js';
import { walletCallbackContext } from '../wallet/index.js';

/** Lossless file transport; plain GCScript JSON and exported Studio projects need no envelope. */
export interface EditFilePayload {
  format: 'gcscript-studio-file';
  version: 1;
  path: string;
  file: VirtualFile;
}
export type EditLinkPayload = JsonValue | Project | EditFilePayload;
export type EditImport =
  { kind: 'file'; path: string; file: VirtualFile } | { kind: 'project'; project: Project };
export type LinkView = 'code' | 'node' | 'block';
export interface StudioLaunch {
  embedded: boolean;
  mode: EditorMode | undefined;
  encoded: string | null;
}

/** Resolve only this deployment's edit route; query flags never authorize execution. */
export function readStudioLaunch(
  href: string,
  baseURL: string,
  config: StudioConfig,
): StudioLaunch {
  const url = new URL(href);
  const route = new URL(config.editLinks.route, baseURL);
  const view = url.searchParams.get('view');
  return {
    embedded:
      (url.searchParams.has('embed') &&
        ['', 'true', '1'].includes(url.searchParams.get('embed') ?? '')) ||
      walletCallbackContext(url).embedded,
    mode:
      view === 'code'
        ? 'code'
        : view === 'node'
          ? 'nodes'
          : view === 'block'
            ? 'blocks'
            : undefined,
    encoded:
      url.origin === route.origin && url.pathname.startsWith(route.pathname)
        ? url.pathname.slice(route.pathname.length)
        : null,
  };
}

/** Validate the entire decoded payload before any project replacement or prompt. */
export function parseEditImport(value: unknown, config: StudioConfig): EditImport {
  if (isRecord(value) && value.format === 'gcscript-studio-file') {
    if (
      value.version !== 1 ||
      typeof value.path !== 'string' ||
      path(value.path) !== value.path ||
      !isRecord(value.file) ||
      typeof value.file.text !== 'string' ||
      !['utf8', 'base64'].includes(String(value.file.encoding))
    )
      throw Error('Invalid IDE file payload');
    return {
      kind: 'file',
      path: value.path,
      file: {
        text: value.file.text,
        encoding: value.file.encoding === 'base64' ? 'base64' : 'utf8',
      },
    };
  }
  if (isRecord(value) && Object.hasOwn(value, 'files') && Object.hasOwn(value, 'version'))
    return { kind: 'project', project: parseProject(value, config.version) };
  if (!isJsonValue(value)) throw Error('IDE link must contain a file, project or JSON value');
  return {
    kind: 'file',
    path: config.project.initialFile,
    file: {
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
      encoding: 'utf8',
    },
  };
}
