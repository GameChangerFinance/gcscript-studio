import './features';
import * as monaco from 'monaco-editor/editor/editor.api';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register.js';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import type { StudioConfig, StudioOptions } from '../../config';
import type { SchemaSnapshot } from '../../core/schema/types';
import type { JsonPath } from '../../core/json';
import { getAt, parseJSONC, sourcePathAt, sourceRange } from '../../core/json';
import type { ValidationReport } from '../../core/validation';
import { diagnosticPath, diagnosticMessage, diagnosticEdits } from '../../core/validation';
import { isExpression, islSourceTokens } from '../../core/language/isl';
import { highlightSource } from '../../core/language/highlight';
import { inspectValue } from '../../core/schema/inspector';
import { schemaAtPath, supportsISL } from '../../core/schema/context';
import { makeMonacoSchemas } from './schemas';
import { monacoLanguage, isGCScript } from '../../core/project/vfs';
self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};
export interface CodeEditor {
  setFile(path: string, text: string, binary: boolean): void;
  setSchema(snapshot: SchemaSnapshot): void;
  setReport(report: ValidationReport | null): void;
  configure(options: StudioOptions): void;
  toggleFindReplace(): void;
  focus(path: JsonPath): void;
  dispose(): void;
}

/** Published ISL signatures mix emphasis and punctuation; code preserves their readable contract. */
function documentationMarkdown(source: string): string {
  return source.replace(
    /^#{1,6}\s+\*function\*\s+([^\n]+)$/gm,
    (_heading, signature: string) =>
      '```typescript\nfunction ' + signature.replace(/\*|`/g, '') + '\n```',
  );
}

/** Browser adapter owns workers, models and subscriptions; domain helpers stay editor independent. */
export function createCodeEditor(
  host: HTMLElement,
  initial: SchemaSnapshot,
  options: StudioOptions,
  config: StudioConfig,
  onChange: (text: string, path: string) => void,
  onSelect: (path: JsonPath) => void,
): CodeEditor {
  let snapshot = initial,
    currentPath = '',
    settings = options,
    syncing = false;
  let report: ValidationReport | null = null;
  const models = new Map<string, monaco.editor.ITextModel>();
  const overlays = document.createElement('div');
  overlays.className = 'studio-monaco-overlays monaco-component';
  document.body.appendChild(overlays);
  const editor = monaco.editor.create(host, {
    value: '',
    language: 'json',
    automaticLayout: true,
    fixedOverflowWidgets: true,
    overflowWidgetsDomNode: overlays,
    useShadowDOM: false,
    hover: {
      enabled: options.codeTooltips ? 'on' : 'off',
      delay: config.timing.tooltipDelay,
      sticky: true,
    },
    fontSize: 13,
    lineHeight: 22,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    quickSuggestions: { strings: true, other: true, comments: false },
    tabSize: 2,
    formatOnPaste: true,
    padding: { top: 16 },
  });
  const dismissHover = (event: KeyboardEvent) => {
    if (event.key === 'Escape') editor.trigger('studio', 'editor.action.hideHover', null);
  };
  document.addEventListener('keydown', dismissHover, true);
  const decorations = editor.createDecorationsCollection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rules = new Map<string, string>();
  const style = document.createElement('style');
  document.head.appendChild(style);
  function updateSyntax(): void {
    const model = editor.getModel();
    if (!model) return;
    if (!settings.syntaxHighlighting || !isGCScript(currentPath)) {
      decorations.clear();
      return;
    }
    const begun = performance.now();
    const marks = highlightSource(model.getValue(), snapshot.authoring, snapshot.catalog, config);
    const items = marks.map((mark) => {
      const color = /^#[\da-f]{6}$/i.test(mark.color) ? mark.color : '#ffffff';
      const className = 'gc-token-' + color.slice(1);
      rules.set(className, color);
      const start = model.getPositionAt(mark.offset),
        end = model.getPositionAt(mark.offset + mark.length);
      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: { inlineClassName: className, inlineClassNameAffectsLetterSpacing: true },
      };
    });
    style.textContent = [...rules]
      .map(([name, color]) => `.monaco-editor .${name}{color:${color}!important;font-weight:650}`)
      .join('\n');
    decorations.set(items);
    if (settings.debugMode)
      console.info('Syntax pass', { ms: performance.now() - begun, marks: marks.length });
  }
  function configure(next: StudioOptions): void {
    settings = next;
    monaco.editor.defineTheme('gc-studio-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0d1322',
        'editorGutter.background': '#0d1322',
        'menu.background': '#151e30',
        'menu.foreground': '#e7eefb',
        'menu.selectionBackground': '#1e2a40',
        'menu.selectionForeground': '#e7eefb',
        'menu.separatorBackground': '#2a3850',
        'menu.border': '#2a3850',
      },
    });
    monaco.editor.defineTheme('gc-studio-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#f5f7fc',
        'editorGutter.background': '#f5f7fc',
        'menu.background': '#ffffff',
        'menu.foreground': '#1c2943',
        'menu.selectionBackground': '#ecf1f9',
        'menu.selectionForeground': '#1c2943',
        'menu.separatorBackground': '#d9e1ed',
        'menu.border': '#d9e1ed',
      },
    });
    monaco.editor.setTheme('gc-studio-' + next.theme);
    editor.updateOptions({
      hover: {
        enabled: next.codeTooltips ? 'on' : 'off',
        delay: config.timing.tooltipDelay,
        sticky: true,
      },
    });
    updateSyntax();
  }
  function setSchema(next: SchemaSnapshot): void {
    snapshot = next;
    // Schema hover is plain-text escaped by the JSON worker. Our contextual provider owns rich help.
    jsonDefaults.setModeConfiguration({ ...jsonDefaults.modeConfiguration, hovers: false });
    jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
      trailingCommas: 'ignore',
      schemaValidation: 'error',
      enableSchemaRequest: false,
      schemas: makeMonacoSchemas(next.authoring, config.schemaNamespace),
    });
    updateSyntax();
  }
  let pendingChange: { text: string; path: string } | null = null;
  let changeQueued = false,
    disposed = false;
  const change = editor.onDidChangeModelContent(() => {
    if (syncing) return;
    pendingChange = { text: editor.getValue(), path: currentPath };
    if (!changeQueued) {
      changeQueued = true;
      // Publish after Monaco finishes its edit/token transaction; never re-enter it through React.
      queueMicrotask(() => {
        changeQueued = false;
        const value = pendingChange;
        pendingChange = null;
        if (!disposed && value) onChange(value.text, value.path);
      });
    }
    clearTimeout(timer);
    timer = setTimeout(updateSyntax, config.timing.syntaxDebounce);
  });
  const cursor = editor.onDidChangeCursorPosition((e) => {
    const model = editor.getModel();
    if (model && isGCScript(currentPath))
      onSelect(sourcePathAt(model.getValue(), model.getOffsetAt(e.position)));
  });
  const completion = monaco.languages.registerCompletionItemProvider('json', {
    triggerCharacters: ['"', ':', '{', '('],
    provideCompletionItems(model, position) {
      if (!isGCScript(currentPath) || model !== editor.getModel()) return { suggestions: [] };
      const text = model.getValue(),
        offset = model.getOffsetAt(position),
        line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const typePrefix = /"type"\s*:\s*"([^"\n]*)$/.exec(line);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - (typePrefix?.[1]?.length ?? 0),
        endColumn: position.column,
      };
      if (typePrefix)
        return {
          suggestions: snapshot.catalog.functions.map((fn) => ({
            label: fn.name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: fn.name,
            range,
            detail: fn.title,
            documentation: {
              value: documentationMarkdown(fn.description),
              isTrusted: false,
              supportHtml: false,
            },
          })),
        };
      try {
        const doc = parseJSONC(text),
          path = sourcePathAt(text, offset);
        if (
          !supportsISL(snapshot.authoring, schemaAtPath(doc, snapshot.authoring, path)) ||
          !/\{[^}]*$/.test(line)
        )
          return { suggestions: [] };
        return {
          suggestions: snapshot.catalog.isl.map((fn) => ({
            label: fn.name + '()',
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: fn.name + '(${1})',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            detail: 'ISL · ' + fn.group,
            documentation: {
              value: documentationMarkdown(
                fn.schema.markdownDescription ?? fn.schema.description ?? '',
              ),
              isTrusted: false,
              supportHtml: false,
            },
          })),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });
  const hover = monaco.languages.registerHoverProvider('json', {
    provideHover(model, position) {
      if (!settings.codeTooltips || !isGCScript(currentPath) || model !== editor.getModel())
        return null;
      try {
        const text = model.getValue(),
          path = sourcePathAt(text, model.getOffsetAt(position)),
          doc = parseJSONC(text);
        const valueRange = sourceRange(text, path);
        const offset = model.getOffsetAt(position);
        const token =
          valueRange &&
          isExpression(getAt(doc, path)) &&
          supportsISL(snapshot.authoring, schemaAtPath(doc, snapshot.authoring, path))
            ? islSourceTokens(
                text.slice(valueRange.offset, valueRange.offset + valueRange.length),
              ).find(
                (item) =>
                  item.kind === 'call' &&
                  offset >= valueRange.offset + item.offset &&
                  offset < valueRange.offset + item.offset + item.length &&
                  snapshot.catalog.islByName[item.text],
              )
            : undefined;
        const isl = token?.text;
        const owner = path.at(-1) === 'type' ? path.slice(0, -1) : path;
        const info = inspectValue(doc, snapshot.authoring, snapshot.catalog, owner, isl);
        const start =
          token && valueRange ? model.getPositionAt(valueRange.offset + token.offset) : position;
        const end =
          token && valueRange
            ? model.getPositionAt(valueRange.offset + token.offset + token.length)
            : { ...position, column: position.column + 1 };
        return {
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          contents: [
            {
              value: `**${info.title}** · ${info.kind}\n\n${documentationMarkdown(info.description)}\n\nType: \`${info.valueType}\`\n\nReturns: \`${info.returnType}\``,
              isTrusted: false,
              supportHtml: false,
            },
          ],
        };
      } catch {
        return null;
      }
    },
  });
  function setReport(next: ValidationReport | null): void {
    report = next;
    for (const [key, model] of models) {
      const markers: monaco.editor.IMarkerData[] = [];
      if (next?.file === key)
        for (const [items, severity] of [
          [next.errors, monaco.MarkerSeverity.Error],
          [next.warnings, monaco.MarkerSeverity.Warning],
        ] as const) {
          for (const diagnostic of items) {
            const path = diagnosticPath(diagnostic.jsonPath ?? '');
            let range = sourceRange(model.getValue(), path);
            while (!range && path.length) {
              path.pop();
              range = sourceRange(model.getValue(), path);
            }
            const start = model.getPositionAt(range?.offset ?? 0);
            const end = model.getPositionAt((range?.offset ?? 0) + Math.max(1, range?.length ?? 1));
            markers.push({
              ...{
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column,
              },
              message: diagnosticMessage(diagnostic),
              severity,
              source: 'GCScript',
              ...(diagnostic.code
                ? {
                    code: diagnostic.relatedDocs?.[0]
                      ? {
                          value: diagnostic.code,
                          target: monaco.Uri.parse(diagnostic.relatedDocs[0]),
                        }
                      : diagnostic.code,
                  }
                : {}),
            });
          }
        }
      monaco.editor.setModelMarkers(model, 'gcscript', markers);
    }
  }
  const fixes = monaco.languages.registerCodeActionProvider('json', {
    provideCodeActions(model, range) {
      const actions: monaco.languages.CodeAction[] = [];
      if (model === editor.getModel() && report?.file === currentPath) {
        for (const diagnostic of [...report.errors, ...report.warnings]) {
          for (const edit of diagnosticEdits(model.getValue(), diagnostic)) {
            const start = model.getPositionAt(edit.offset),
              end = model.getPositionAt(edit.offset + edit.length);
            const editRange = new monaco.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            );
            if (!monaco.Range.areIntersectingOrTouching(editRange, range)) continue;
            actions.push({
              title: edit.title,
              kind: 'quickfix',
              isPreferred: actions.length === 0,
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: { range: editRange, text: edit.text },
                  },
                ],
              },
            });
          }
        }
      }
      return { actions, dispose() {} };
    },
  });
  configure(options);
  setSchema(initial);
  return {
    configure,
    setSchema,
    setReport,
    setFile(path, text, binary) {
      currentPath = path;
      syncing = true;
      try {
        if (!path) {
          editor.setModel(null);
          return;
        }
        let model = models.get(path);
        let changed = !model || editor.getModel() !== model;
        if (!model) {
          model = monaco.editor.createModel(
            binary ? '' : text,
            monacoLanguage(path),
            monaco.Uri.parse('file:///project/' + path),
          );
          models.set(path, model);
        }
        if (editor.getModel() !== model) editor.setModel(model);
        const value = binary ? '' : text;
        if (model.getValue() !== value) {
          changed = true;
          // Replace only the changed span: preserve cursor/view state and Monaco's edit stack.
          const old = model.getValue();
          let from = 0,
            tail = 0;
          while (from < old.length && from < value.length && old[from] === value[from]) from++;
          while (
            tail < old.length - from &&
            tail < value.length - from &&
            old[old.length - tail - 1] === value[value.length - tail - 1]
          )
            tail++;
          const start = model.getPositionAt(from),
            end = model.getPositionAt(old.length - tail);
          editor.executeEdits('studio', [
            {
              range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
              text: value.slice(from, value.length - tail),
            },
          ]);
        }
        editor.updateOptions({ readOnly: binary });
        if (changed) updateSyntax();
      } finally {
        syncing = false;
      }
    },
    toggleFindReplace() {
      const find = editor.getContribution<
        monaco.editor.IEditorContribution & {
          getState(): { isRevealed: boolean };
          closeFindWidget(): void;
        }
      >('editor.contrib.findController');
      if (find?.getState().isRevealed) find.closeFindWidget();
      else {
        editor.focus();
        void editor.getAction('editor.action.startFindReplaceAction')?.run();
      }
    },
    focus(path) {
      const model = editor.getModel();
      if (!model) return;
      const range = sourceRange(model.getValue(), path);
      if (!range) return;
      const start = model.getPositionAt(range.offset),
        end = model.getPositionAt(range.offset + range.length);
      editor.setSelection(
        new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      );
      editor.revealPositionInCenterIfOutsideViewport(start);
    },
    dispose() {
      disposed = true;
      pendingChange = null;
      clearTimeout(timer);
      change.dispose();
      cursor.dispose();
      completion.dispose();
      hover.dispose();
      fixes.dispose();
      editor.dispose();
      document.removeEventListener('keydown', dismissHover, true);
      overlays.remove();
      models.forEach((model) => model.dispose());
      style.remove();
    },
  };
}
