import type { StudioConfig } from '../../config.js';
import { isRecord } from '../json.js';
export interface VirtualFile {
  text: string;
  encoding: 'utf8' | 'base64';
}
export interface Project {
  version: string;
  id: string;
  revision: number;
  active: string;
  files: Record<string, VirtualFile>;
  dirs: string[];
}
export type ProjectTreeNode =
  | { type: 'directory'; name: string; path: string; children: ProjectTreeNode[] }
  | { type: 'file'; name: string; path: string; file: VirtualFile };

/** Canonical POSIX project paths. The virtual root is never a writable file. */
export function path(input: string, rootOK = false): string {
  const text = input.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!text) {
    if (rootOK) return '';
    throw Error('A file or directory name is required');
  }
  if (
    text.length > 1024 ||
    text
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          [...part].some((character) => character.charCodeAt(0) < 32) ||
          part.length > 255,
      )
  )
    throw Error('Invalid path: ' + input);
  return text;
}
export const parent = (value: string): string =>
  value.slice(0, Math.max(0, value.lastIndexOf('/')));
export const name = (value: string): string => value.slice(value.lastIndexOf('/') + 1);
export const isGCScript = (value: string): boolean => /\.gcscript(?:\.jsonc?)?$/i.test(value);
export const monacoLanguage = (value: string): string =>
  isGCScript(value) || /\.jsonc?$/i.test(value)
    ? 'json'
    : /\.tsx?$/i.test(value)
      ? 'typescript'
      : /\.jsx?$/i.test(value)
        ? 'javascript'
        : /\.css$/i.test(value)
          ? 'css'
          : /\.html?$/i.test(value)
            ? 'html'
            : /\.md$/i.test(value)
              ? 'markdown'
              : /\.ya?ml$/i.test(value)
                ? 'yaml'
                : /\.xml$/i.test(value)
                  ? 'xml'
                  : 'plaintext';
export const has = (project: Project, value: string): boolean =>
  !value ||
  Object.hasOwn(project.files, value) ||
  project.dirs.includes(value) ||
  Object.keys(project.files).some((key) => key.startsWith(value + '/'));
const copy = (project: Project): Project => ({
  ...project,
  revision: project.revision + 1,
  files: { ...project.files },
  dirs: [...project.dirs],
});
export function mkdir(project: Project, value: string): Project {
  const result = copy(project);
  let dir = path(value);
  while (dir) {
    if (Object.hasOwn(result.files, dir)) throw Error('A file blocks the directory: ' + dir);
    if (!result.dirs.includes(dir)) result.dirs.push(dir);
    dir = parent(dir);
  }
  result.dirs.sort();
  return result;
}
export function put(
  project: Project,
  value: string,
  file: VirtualFile,
  overwrite = false,
): Project {
  const key = path(value);
  if (Object.hasOwn(project.files, key) && !overwrite) throw Error('File already exists: ' + key);
  if (!Object.hasOwn(project.files, key) && has(project, key))
    throw Error('Directory already exists: ' + key);
  const result = parent(key) ? mkdir(project, parent(key)) : copy(project);
  Object.defineProperty(result.files, key, {
    value: { ...file },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return result;
}
export function remove(project: Project, value: string): Project {
  const key = path(value);
  if (!has(project, key)) throw Error('Not found: ' + key);
  const result = copy(project);
  for (const file of Object.keys(result.files))
    if (file === key || file.startsWith(key + '/')) delete result.files[file];
  result.dirs = result.dirs.filter((dir) => dir !== key && !dir.startsWith(key + '/'));
  if (result.active === key || result.active.startsWith(key + '/'))
    result.active = Object.keys(result.files).sort()[0] ?? '';
  return result;
}
export function transfer(
  project: Project,
  source: string,
  target: string,
  duplicate = false,
): Project {
  const from = path(source),
    to = path(target);
  if (!has(project, from)) throw Error('Source not found: ' + from);
  if (from === to) {
    if (duplicate) throw Error('Cannot copy onto itself');
    return project;
  }
  if (to.startsWith(from + '/')) throw Error('Cannot place a directory inside itself');
  if (has(project, to)) throw Error('Destination already exists: ' + to);
  const files = Object.entries(project.files).filter(
    ([key]) => key === from || key.startsWith(from + '/'),
  );
  const dirs = project.dirs.filter((key) => key === from || key.startsWith(from + '/'));
  let result = duplicate ? copy(project) : remove(project, from);
  for (const dir of dirs) result = mkdir(result, to + dir.slice(from.length));
  for (const [key, file] of files) result = put(result, to + key.slice(from.length), file);
  if (!duplicate && (project.active === from || project.active.startsWith(from + '/')))
    result.active = to + project.active.slice(from.length);
  return result;
}
export function unique(project: Project, desired: string): string {
  const key = path(desired);
  if (!has(project, key)) return key;
  const dir = parent(key),
    base = name(key),
    dot = base.lastIndexOf('.');
  for (let n = 1; n < 10000; n++) {
    const stem = dot > 0 ? base.slice(0, dot) : base,
      ext = dot > 0 ? base.slice(dot) : '';
    const candidate = (dir ? dir + '/' : '') + stem + ` (copy${n === 1 ? '' : ' ' + n})` + ext;
    if (!has(project, candidate)) return candidate;
  }
  throw Error('Unable to name duplicate');
}
export function moveInto(
  project: Project,
  source: string,
  folder: string,
  duplicate = false,
): Project {
  const dir = path(folder, true);
  if (dir && (!has(project, dir) || Object.hasOwn(project.files, dir)))
    throw Error('Drop onto an existing directory');
  const target = (dir ? dir + '/' : '') + name(source);
  return transfer(project, source, duplicate ? unique(project, target) : target, duplicate);
}
export function tree(project: Project): Extract<ProjectTreeNode, { type: 'directory' }> {
  const top: Extract<ProjectTreeNode, { type: 'directory' }> = {
    type: 'directory',
    name: '',
    path: '',
    children: [],
  };
  const folders = new Map([['', top]]);
  const folder = (key: string): typeof top => {
    const existing = folders.get(key);
    if (existing) return existing;
    const node: typeof top = { type: 'directory', name: name(key), path: key, children: [] };
    folder(parent(key)).children.push(node);
    folders.set(key, node);
    return node;
  };
  for (const dir of project.dirs) folder(dir);
  for (const [key, file] of Object.entries(project.files))
    folder(parent(key)).children.push({ type: 'file', name: name(key), path: key, file });
  const sort = (node: ProjectTreeNode): void => {
    if (node.type === 'directory') {
      node.children.sort(
        (a, b) =>
          Number(b.type === 'directory') - Number(a.type === 'directory') ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      );
      node.children.forEach(sort);
    }
  };
  sort(top);
  return top;
}
export function createProject(config: StudioConfig, id: string): Project {
  return {
    version: config.version,
    id,
    revision: 0,
    active: config.project.initialFile,
    dirs: [],
    files: { [config.project.initialFile]: { text: config.project.source, encoding: 'utf8' } },
  };
}
/** Validate imported/persisted projects before exposing them to editor or filesystem operations. */
export function parseProject(value: unknown, version: string): Project {
  if (!isRecord(value) || value.version !== version)
    throw Error('Saved project version differs. Export a backup, then reset this project.');
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isRecord(value.files) ||
    !Array.isArray(value.dirs) ||
    typeof value.active !== 'string'
  )
    throw Error('Invalid project data');
  let result: Project = {
    version,
    id: value.id,
    revision: Number(value.revision),
    files: {},
    dirs: [],
    active: value.active,
  };
  for (const dir of value.dirs) {
    if (typeof dir !== 'string' || path(dir) !== dir) throw Error('Invalid project directory');
    result = mkdir(result, dir);
  }
  for (const [key, file] of Object.entries(value.files)) {
    if (
      path(key) !== key ||
      !isRecord(file) ||
      typeof file.text !== 'string' ||
      !['utf8', 'base64'].includes(String(file.encoding))
    )
      throw Error('Invalid project file: ' + key);
    result = put(result, key, {
      text: file.text,
      encoding: file.encoding === 'base64' ? 'base64' : 'utf8',
    });
  }
  if (result.active && !Object.hasOwn(result.files, result.active))
    throw Error('Active file is missing');
  result.revision = Number(value.revision);
  return result;
}
