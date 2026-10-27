import type { StudioConfig, StudioOptions } from '../config';
import { isRecord } from '../core/json';
import type { StudioState } from '../core/state';
import { parseProject } from '../core/project/vfs';
/** Embedded sessions share schema downloads, but never editable state or wallet result records. */
export function sessionConfig(config: StudioConfig, embedded: boolean): StudioConfig {
  if (!embedded) return config;
  const result = structuredClone(config),
    prefix = config.editLinks.embeddedStoragePrefix;
  for (const key of ['project', 'options', 'run', 'result'] as const)
    if (!result.storage[key].startsWith(prefix)) result.storage[key] = prefix + result.storage[key];
  if (!result.wallet.popupName.startsWith(prefix))
    result.wallet.popupName = prefix + result.wallet.popupName;
  return result;
}
export interface SessionRestore {
  project: StudioState['project'];
  options: StudioOptions;
  layout: StudioState['layout'];
  error: string;
}
/** A single version gate protects all persisted editable state; mismatches pause autosave. */
export function restoreSession(
  initial: StudioState,
  config: StudioConfig,
  storage: Storage,
): SessionRestore {
  try {
    const raw = storage.getItem(config.storage.project);
    const data: unknown = raw
      ? JSON.parse(raw)
      : { version: config.version, project: initial.project };
    if (!isRecord(data) || data.version !== config.version)
      throw Error(
        'Saved Studio state is from a different version. Download a backup, then reset saved state.',
      );
    const preferences = storage.getItem(config.storage.options);
    if (preferences) {
      const saved: unknown = JSON.parse(preferences);
      if (!isRecord(saved) || saved.version !== config.version || !isRecord(saved.options))
        throw Error(
          'Saved Studio options are from a different version. Download a backup, then reset saved state.',
        );
      data.options = saved.options;
    }
    const project = parseProject(data.project, config.version);
    const options = { ...config.defaults };
    if (isRecord(data.options))
      for (const key of Object.keys(options) as (keyof StudioOptions)[]) {
        const value = data.options[key];
        if (typeof value === typeof options[key]) Object.assign(options, { [key]: value });
      }
    Object.assign(options, config.fixedEditorOptions);
    if (
      !['dark', 'light'].includes(options.theme) ||
      !['popup', 'redirect', 'qr'].includes(options.runMode) ||
      !['preprod', 'mainnet'].includes(options.network) ||
      !['blocks', 'nodes'].includes(options.splitView) ||
      !['text', 'blocks'].includes(options.islDisplay)
    )
      throw Error('Invalid saved Studio options');
    const layout = { ...initial.layout };
    if (isRecord(data.layout))
      for (const key of ['left', 'right', 'code'] as const) {
        const value = data.layout[key];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) layout[key] = value;
      }
    return { project, options, layout, error: '' };
  } catch (error) {
    return {
      project: initial.project,
      options: initial.options,
      layout: initial.layout,
      error: error instanceof Error ? error.message : 'Browser storage is unavailable',
    };
  }
}
export function persistSession(state: StudioState, config: StudioConfig, storage: Storage): void {
  if (state.persistenceError) return;
  // Autosave controls project contents. Preferences must still remember that it was disabled.
  const preferences = JSON.stringify({ version: config.version, options: state.options });
  if (storage.getItem(config.storage.options) !== preferences)
    storage.setItem(config.storage.options, preferences);
  if (!state.options.autosave) return;
  storage.setItem(
    config.storage.project,
    JSON.stringify({
      version: config.version,
      project: state.project,
      options: state.options,
      layout: state.layout,
    }),
  );
}
