import * as Blockly from 'blockly/core';
import type { StudioConfig, StudioOptions } from '../../config';
import type { SchemaSnapshot } from '../../core/schema/types';
import type { JsonPath } from '../../core/json';
import { errorMessage, parseJSONC, updateSource } from '../../core/json';
import {
  defineBlocks,
  enhanceContextMenus,
  metadata,
  reindexPaths,
  serializeValue,
  setBlockContext,
  valueToBlock,
} from './blocks';
import { palette } from './palette';
import type { Inspection } from '../../core/schema/inspector';
import { inspectValue } from '../../core/schema/inspector';
import type { ValidationReport } from '../../core/validation';
import { diagnosticPath, diagnosticMessage } from '../../core/validation';
export interface BlockEditor {
  syncSource(text: string): void;
  setReport(report: ValidationReport | null): void;
  flushHistory(redo: boolean): boolean;
  search(query: string): void;
  focus(path: JsonPath): void;
  fit(): void;
  collapse(value: boolean): void;
  dispose(): void;
  workspace: Blockly.WorkspaceSvg;
}
/** Workspace lifecycle owns listeners and delayed edits; callbacks are cancelled on disposal. */
export function createBlockEditor(
  host: HTMLElement,
  source: string,
  snapshot: SchemaSnapshot,
  options: StudioOptions,
  config: StudioConfig,
  baseURL: string,
  onUpdate: (text: string) => void,
  onSelect: (path: JsonPath) => void,
  onStatus: (message: string, error?: boolean) => void,
  onDoc: (info: Inspection, event: { clientX: number; clientY: number }) => void,
): BlockEditor {
  defineBlocks();
  const theme = Blockly.Theme.defineTheme('studio_' + options.theme, {
    name: 'studio_' + options.theme,
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: options.theme === 'light' ? '#f5f7fc' : '#0d1322',
      toolboxBackgroundColour: options.theme === 'light' ? '#ffffff' : '#151e30',
      toolboxForegroundColour: options.theme === 'light' ? '#1c2943' : '#e7eefb',
      flyoutBackgroundColour: options.theme === 'light' ? '#ecf1f9' : '#1e2a40',
      flyoutForegroundColour: options.theme === 'light' ? '#1c2943' : '#e7eefb',
    },
    fontStyle: { family: 'system-ui', size: 12 },
  });
  const workspace = Blockly.inject(host, {
    toolbox: { kind: 'categoryToolbox', contents: [] },
    theme,
    renderer: 'thrasos',
    media: new URL('blockly-media/', baseURL).href,
    sounds: false,
    trashcan: true,
    move: { scrollbars: true, drag: true, wheel: true },
    zoom: { controls: true, wheel: true, startScale: 0.82, minScale: 0.26, maxScale: 1.8 },
    collapse: true,
    comments: true,
  });
  let currentSource = source,
    document = parseJSONC(source),
    root: Blockly.BlockSvg | undefined,
    syncing = false,
    disposed = false,
    stale = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let report: ValidationReport | null = null;
  function showDiagnostics(): void {
    const blocks = workspace.getAllBlocks(false);
    const messages = new Map<Blockly.BlockSvg, { text: string[]; error: boolean }>();
    for (const [diagnostics, error] of [
      [report?.errors ?? [], true],
      [report?.warnings ?? [], false],
    ] as const)
      for (const diagnostic of diagnostics) {
        const path = diagnosticPath(diagnostic.jsonPath ?? '');
        // Missing properties have no block: annotate their closest existing container.
        const block = blocks
          .filter((block) => {
            const candidate = metadata(block).path;
            return (
              candidate.length <= path.length &&
              candidate.every((part, index) => String(part) === String(path[index]))
            );
          })
          .sort((a, b) => metadata(b).path.length - metadata(a).path.length)[0];
        if (!block) continue;
        const entry = messages.get(block) ?? { text: [], error: false };
        entry.text.push(diagnosticMessage(diagnostic));
        entry.error ||= error;
        messages.set(block, entry);
      }
    for (const block of blocks) {
      const entry = messages.get(block);
      block.setWarningText(entry ? entry.text.join('\n\n') : null, 'gcscript');
      block.getSvgRoot()?.classList.toggle('studio-block-error', Boolean(entry?.error));
      block.getSvgRoot()?.classList.toggle('studio-block-warning', Boolean(entry && !entry.error));
    }
  }
  const updateContext = () =>
    setBlockContext(workspace, {
      document,
      catalog: snapshot.catalog,
      bundle: snapshot.authoring,
      config,
      islDisplay: options.islDisplay,
    });
  updateContext();
  workspace.updateToolbox(palette(snapshot.catalog, config));
  function reload(text: string): void {
    const parsed = parseJSONC(text);
    syncing = true;
    Blockly.Events.disable();
    try {
      workspace.clear();
      workspace.clearUndo();
      document = parsed;
      updateContext();
      root = valueToBlock(workspace, parsed);
      root.setDeletable(false);
      root.setMovable(false);
      root.moveBy(40, 45);
      currentSource = text;
      stale = false;
      enhanceContextMenus(workspace, (message) => onStatus(message, true));
      showDiagnostics();
    } finally {
      Blockly.Events.enable();
      syncing = false;
    }
  }
  function commit(): void {
    if (disposed || syncing || !root) return;
    try {
      if (stale) throw Error('Fix invalid source JSONC before editing blocks.');
      const floating = workspace.getTopBlocks(false).filter((block) => block !== root);
      if (floating.length)
        throw Error(
          `${floating.length} disconnected block(s). Reconnect or delete them before saving.`,
        );
      reindexPaths(root);
      const next = serializeValue(root),
        text = updateSource(currentSource, next, () =>
          confirm(
            'Structural Blockly edit must reformat JSONC and may remove source comments. Apply the edit?',
          ),
        );
      if (text !== currentSource) {
        currentSource = text;
        document = next;
        updateContext();
        onUpdate(text);
        onStatus('Blocks saved');
      }
      enhanceContextMenus(workspace, (message) => onStatus(message, true));
    } catch (error) {
      onStatus('Blocks not saved: ' + errorMessage(error), true);
    }
  }
  const listener = (event: Blockly.Events.Abstract): void => {
    if (syncing || disposed) return;
    if (event.type === Blockly.Events.SELECTED) {
      const id = (event as Blockly.Events.Selected).newElementId;
      const block = id ? workspace.getBlockById(id) : null;
      if (block) onSelect(metadata(block).path);
      return;
    }
    if (event.isUiEvent) return;
    clearTimeout(timer);
    timer = setTimeout(commit, config.timing.blocksDebounce);
  };
  workspace.addChangeListener(listener);
  reload(source);
  const observer = new ResizeObserver(() => {
    if (!disposed) Blockly.svgResize(workspace);
  });
  observer.observe(host);
  const showDoc = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-id]') : null,
      id = target?.getAttribute('data-id');
    const block = id
      ? (workspace.getBlockById(id) ?? workspace.getFlyout()?.getWorkspace().getBlockById(id))
      : null;
    if (!block) return;
    const type = String(block.getFieldValue('TYPE') ?? '');
    const meta = metadata(block);
    if (block.isInFlyout) {
      const fn = snapshot.catalog.byName[type];
      if (fn)
        onDoc(
          {
            title: fn.title,
            kind: fn.category === 'extras' ? 'Build-stage directive' : 'GCScript DSL',
            description: fn.description,
            path: [],
            value: undefined,
            valueType: 'object',
            schema: fn.schema,
            returnSchema: fn.returnSchema,
            returnType: '',
            examples: fn.examples,
            functionName: fn.name,
            file: fn.file,
          },
          event,
        );
    } else
      onDoc(
        inspectValue(
          document,
          snapshot.authoring,
          snapshot.catalog,
          meta.path,
          block.type === 'studio_isl_call' ? type : undefined,
        ),
        event,
      );
  };
  host.addEventListener('pointerover', showDoc);
  return {
    workspace,
    setReport(next) {
      report = next;
      showDiagnostics();
    },
    flushHistory(redo) {
      clearTimeout(timer);
      // Invalid text belongs to source history; the last valid block projection must not intercept it.
      if (stale) return true;
      if (
        (redo && workspace.getRedoStack().length > 0) ||
        (!redo && workspace.getTopBlocks(false).some((block) => block !== root))
      ) {
        workspace.undo(redo);
        timer = setTimeout(commit, config.timing.blocksDebounce);
        return false;
      }
      commit();
      return true;
    },
    syncSource(text) {
      if (text === currentSource) return;
      clearTimeout(timer);
      try {
        reload(text);
        onStatus('Blocks synchronized with JSONC');
      } catch (error) {
        stale = true;
        onStatus('Blocks retain last valid JSONC: ' + errorMessage(error), true);
      }
    },
    search(query) {
      workspace.updateToolbox(palette(snapshot.catalog, config, query));
    },
    focus(path) {
      const block = workspace
        .getAllBlocks(false)
        .filter(
          (block) =>
            metadata(block).path.length <= path.length &&
            metadata(block).path.every((part, index) => String(part) === String(path[index])),
        )
        .sort((a, b) => metadata(b).path.length - metadata(a).path.length)[0];
      if (block && Blockly.common.getSelected() !== block) block.select();
    },
    fit() {
      Blockly.svgResize(workspace);
      workspace.zoomToFit();
    },
    collapse(value) {
      workspace
        .getAllBlocks(false)
        .filter((block) => block !== root)
        .forEach((block) => block.setCollapsed(value));
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      host.removeEventListener('pointerover', showDoc);
      workspace.removeChangeListener(listener);
      workspace.dispose();
    },
  };
}
