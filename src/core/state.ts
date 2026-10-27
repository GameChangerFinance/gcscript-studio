import type { StudioConfig, StudioOptions } from '../config.js';
import type { JsonPath } from './json.js';
import type { Project } from './project/vfs.js';
import type { SchemaSnapshot } from './schema/types.js';
import type { ValidationReport } from './validation.js';
export type EditorMode = 'code' | 'nodes' | 'blocks' | 'split';
export interface StudioState {
  embedded: boolean;
  project: Project;
  options: StudioOptions;
  selection: JsonPath;
  selectionOrigin: 'code' | 'visual' | 'inspector';
  mode: EditorMode;
  layout: { left: number; right: number; code: number; explorer: boolean; inspector: boolean };
  status: { message: string; error: boolean; busy: boolean };
  logs: string[];
  schema: SchemaSnapshot | null;
  report: ValidationReport | null;
  diagnostics: ValidationReport | null;
  persistenceError: string;
  selectedFile: string;
  prompt: { title: string; message: string; choices: { value: string; label: string }[] } | null;
  launch: { url: string; qr?: string } | null;
}
export interface StudioStore {
  getSnapshot(): StudioState;
  subscribe(listener: () => void): () => void;
  update(update: (state: StudioState) => StudioState, group?: string): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
/** Framework-neutral, serializable state with one subscription boundary for alternate shells. */
export function createStudioStore(
  initial: StudioState,
  policy = { limit: 200, typingGroupMs: 500 },
): StudioStore {
  let current = initial;
  const listeners = new Set<() => void>();
  type Edit = { project: Project; entryFile: string };
  const past: Edit[] = [],
    future: Edit[] = [];
  let lastGroup: string | undefined,
    lastTime = 0;
  const emit = () => listeners.forEach((listener) => listener());
  function travel(from: Edit[], to: Edit[]): void {
    const edit = from.pop();
    if (!edit) return;
    to.push({ project: current.project, entryFile: current.options.entryFile });
    current = {
      ...current,
      options: { ...current.options, entryFile: edit.entryFile },
      project: { ...edit.project, revision: current.project.revision + 1 },
      selection: [],
      report: null,
      diagnostics: null,
    };
    lastGroup = undefined;
    emit();
  }
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    undo: () => travel(past, future),
    redo: () => travel(future, past),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    update(update, group) {
      const next = update(current);
      if (next === current) return;
      if (next.project.id !== current.project.id) {
        past.length = future.length = 0;
        lastGroup = undefined;
      } else if (
        next.project.files !== current.project.files ||
        next.project.dirs !== current.project.dirs
      ) {
        if (!group || lastGroup !== group || Date.now() - lastTime > policy.typingGroupMs) {
          past.push({ project: current.project, entryFile: current.options.entryFile });
          if (past.length > policy.limit) past.shift();
        }
        future.length = 0;
        lastGroup = group;
        lastTime = Date.now();
      }
      current = next;
      emit();
    },
  };
}
export function initialState(project: Project, config: StudioConfig, mobile: boolean): StudioState {
  return {
    embedded: false,
    project,
    options: { ...config.defaults },
    selection: [],
    selectionOrigin: 'code',
    mode: 'code',
    layout: {
      left: config.layout.left,
      right: config.layout.right,
      code: config.layout.code,
      explorer: !mobile,
      inspector: !mobile,
    },
    status: { message: 'Loading schema…', error: false, busy: true },
    logs: [],
    schema: null,
    report: null,
    diagnostics: null,
    persistenceError: '',
    selectedFile: project.active,
    prompt: null,
    launch: null,
  };
}
