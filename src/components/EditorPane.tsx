import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioController } from '../app/controller';
import type { StudioState } from '../core/state';
import { errorMessage, parseJSONC, updateSource } from '../core/json';
import type { JsonPath } from '../core/json';
import { isGCScript } from '../core/project/vfs';
import type { CodeEditor } from '../adapters/monaco/editor';
import type { BlockEditor } from '../adapters/blockly/editor';
import type { StructureGraph } from '../adapters/graph/editor';
import { reorderValue } from '../core/language/structure';
import type { Inspection } from '../core/schema/inspector';
import { diagnosticMessage, diagnosticPath } from '../core/validation';
export type ShowDocumentation = (
  info: Inspection,
  event: { clientX: number; clientY: number },
) => void;
export function EditorPane({
  controller,
  state,
  showDoc,
  findRequest,
}: {
  controller: StudioController;
  state: StudioState;
  showDoc: ShowDocumentation;
  findRequest: number;
}) {
  const codeHost = useRef<HTMLDivElement>(null),
    blockHost = useRef<HTMLDivElement>(null),
    graphHost = useRef<HTMLDivElement>(null);
  const code = useRef<CodeEditor | null>(null),
    blocks = useRef<BlockEditor | null>(null),
    graph = useRef<StructureGraph | null>(null);
  const [loaded, setLoaded] = useState(false),
    [blockStatus, setBlockStatus] = useState(''),
    [blockError, setBlockError] = useState(false),
    [query, setQuery] = useState('');
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    controller.beforeHistory = (redo) => blocks.current?.flushHistory(redo) ?? true;
    return () => {
      delete controller.beforeHistory;
    };
  }, [controller]);
  const docRef = useRef(showDoc);
  useEffect(() => {
    docRef.current = showDoc;
  }, [showDoc]);
  const file = state.project.files[state.project.active],
    script = isGCScript(state.project.active) && file?.encoding === 'utf8';
  const codeVisible = !script || state.mode === 'code' || state.mode === 'split';
  const nodesVisible =
    script &&
    (state.mode === 'nodes' || (state.mode === 'split' && state.options.splitView === 'nodes'));
  const blocksVisible =
    script &&
    (state.mode === 'blocks' || (state.mode === 'split' && state.options.splitView === 'blocks'));
  const hasSchema = state.schema !== null;
  const select = useCallback(
    (path: JsonPath, origin: StudioState['selectionOrigin']) => {
      controller.store.update((previous) =>
        JSON.stringify(previous.selection) === JSON.stringify(path) &&
        previous.selectionOrigin === origin
          ? previous
          : { ...previous, selection: path, selectionOrigin: origin },
      );
    },
    [controller],
  );
  useEffect(() => {
    if (!hasSchema) return;
    let cancelled = false;
    void import('../adapters/monaco/editor')
      .then(({ createCodeEditor }) => {
        const snapshot = stateRef.current.schema;
        if (cancelled || !codeHost.current || !snapshot) return;
        code.current = createCodeEditor(
          codeHost.current,
          snapshot,
          stateRef.current.options,
          controller.config,
          (text, path) => controller.editFile(text, path, true),
          (path) => select(path, 'code'),
        );
        setLoaded(true);
      })
      .catch((error) => controller.notify('Code editor unavailable: ' + errorMessage(error), true));
    return () => {
      cancelled = true;
      code.current?.dispose();
      code.current = null;
    };
  }, [controller, hasSchema, select]);
  useEffect(() => {
    if (state.schema) code.current?.setSchema(state.schema);
  }, [state.schema, loaded]);
  useEffect(() => {
    code.current?.configure(state.options);
  }, [state.options, loaded]);
  useEffect(() => {
    if (findRequest && loaded) code.current?.toggleFindReplace();
  }, [findRequest, loaded]);
  useEffect(() => {
    code.current?.setFile(state.project.active, file?.text ?? '', file?.encoding === 'base64');
  }, [state.project.active, file, loaded]);
  useEffect(() => {
    code.current?.setReport(state.diagnostics ?? state.report);
  }, [state.diagnostics, state.report, state.project.active, loaded]);
  useEffect(() => {
    if (state.selectionOrigin !== 'code') code.current?.focus(state.selection);
    blocks.current?.focus(state.selection);
    graph.current?.focus(state.selection);
  }, [state.selection, state.selectionOrigin]);
  useEffect(() => {
    if (!blocksVisible || !state.schema) return;
    let cancelled = false;
    void import('../adapters/blockly/editor')
      .then(({ createBlockEditor }) => {
        if (cancelled || !blockHost.current) return;
        const current = stateRef.current,
          snapshot = current.schema,
          key = current.project.active,
          text = current.project.files[key]?.text;
        if (!snapshot || text === undefined) return;
        blocks.current = createBlockEditor(
          blockHost.current,
          text,
          snapshot,
          current.options,
          controller.config,
          controller.baseURL,
          (text) => controller.editFile(text, key),
          (path) => select(path, 'visual'),
          (message, error = false) => {
            setBlockStatus(message);
            setBlockError(error);
          },
          (info, event) => docRef.current(info, event),
        );
        const report = stateRef.current.diagnostics ?? stateRef.current.report;
        blocks.current.setReport(report?.file === key ? report : null);
      })
      .catch((error) => {
        setBlockStatus(errorMessage(error));
        setBlockError(true);
      });
    return () => {
      cancelled = true;
      blocks.current?.dispose();
      blocks.current = null;
    };
  }, [
    controller,
    blocksVisible,
    state.schema,
    state.project.active,
    state.options.theme,
    state.options.islDisplay,
    select,
  ]);
  useEffect(() => {
    if (file) blocks.current?.syncSource(file.text);
  }, [file]);
  const diagnostics = state.diagnostics ?? state.report;
  const activeDiagnostics = diagnostics?.file === state.project.active ? diagnostics : null;
  useEffect(() => {
    blocks.current?.setReport(activeDiagnostics);
  }, [activeDiagnostics]);
  useEffect(() => {
    blocks.current?.search(query);
  }, [query]);
  const source = file?.text,
    snapshot = state.schema,
    activePath = state.project.active,
    nodeChildrenLimit = state.options.nodeChildrenLimit;
  useEffect(() => {
    if (!nodesVisible || !snapshot || source === undefined || !graphHost.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void import('../adapters/graph/editor')
        .then(({ createGraph }) => {
          if (cancelled || !graphHost.current) return;
          const key = activePath;
          graph.current = createGraph(
            graphHost.current,
            parseJSONC(source),
            snapshot,
            {
              ...controller.config,
              defaults: { ...controller.config.defaults, nodeChildrenLimit },
            },
            (path) => select(path, 'visual'),
            (path, delta) => {
              try {
                const current = controller.store.getSnapshot().project.files[key]?.text;
                if (!current) return;
                const next = reorderValue(parseJSONC(current), path, delta);
                controller.editFile(
                  updateSource(current, next, () =>
                    confirm(
                      'Reordering this collection normalizes JSONC and may remove comments. Continue?',
                    ),
                  ),
                  key,
                );
              } catch (error) {
                controller.notify(errorMessage(error), true);
              }
            },
            (info, event) => docRef.current(info, event),
          );
          return graph.current.ready;
        })
        .catch((error) => controller.notify('Graph unavailable: ' + errorMessage(error), true));
    }, controller.config.timing.editorDebounce);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      graph.current?.dispose();
      graph.current = null;
    };
  }, [controller, nodesVisible, snapshot, activePath, source, nodeChildrenLimit, select]);
  return (
    <div className="editorframe">
      <div
        className={'codebox ' + (codeVisible ? '' : 'hidden')}
        style={state.mode === 'split' ? { flex: '0 0 ' + state.layout.code + '%' } : undefined}
      >
        <div className="monaco" ref={codeHost} />
        {!loaded ? (
          <div className="empty">
            {state.status.error ? state.status.message : 'Loading code editor and schema…'}
          </div>
        ) : null}
        {!file ? (
          <div className="empty editor-empty">Create or import a file to begin.</div>
        ) : file.encoding === 'base64' ? (
          <div className="empty editor-empty">
            Binary file · retained in the project archive. Download from the file menu.
          </div>
        ) : null}
      </div>
      <div className={'graphbox ' + (nodesVisible ? '' : 'hidden')}>
        <div className="graphcanvas" ref={graphHost} />
        <div className="graph-overlay">
          <div className="overlay-card small">Structured program · ordered scopes</div>
          <button
            className="btn btn-sm btn-outline-secondary overlay-card"
            onClick={() => graph.current?.fit()}
          >
            Fit graph
          </button>
        </div>
        <div className="graph-navigation">
          Containment · drag to pan · scroll to zoom · ↗ open nested scopes
        </div>
      </div>
      <div className={'blocksbox ' + (blocksVisible ? '' : 'hidden')}>
        <div className="blocks-toolbar">
          <input
            aria-label="Search block library"
            placeholder="Search blocks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            data-tooltip="Fit all blocks in the workspace"
            onClick={() => blocks.current?.fit()}
          >
            Fit
          </button>
          <button
            data-tooltip="Collapse all code blocks"
            onClick={() => blocks.current?.collapse(true)}
          >
            Collapse
          </button>
          <button
            data-tooltip="Expand all code blocks"
            onClick={() => blocks.current?.collapse(false)}
          >
            Expand
          </button>
          <span className="hint">Drag blocks · right-click for actions</span>
        </div>
        {activeDiagnostics &&
        (activeDiagnostics.errors.length || activeDiagnostics.warnings.length) ? (
          <details className="blocks-diagnostics" open>
            <summary>
              {activeDiagnostics.errors.length} errors · {activeDiagnostics.warnings.length}{' '}
              warnings
            </summary>
            <ul>
              {[
                ...activeDiagnostics.errors.map((diagnostic) => ({
                  diagnostic,
                  severity: 'error',
                })),
                ...activeDiagnostics.warnings.map((diagnostic) => ({
                  diagnostic,
                  severity: 'warning',
                })),
              ].map(({ diagnostic, severity }, index) => (
                <li key={index} className={severity}>
                  <button
                    onClick={() => select(diagnosticPath(diagnostic.jsonPath ?? ''), 'visual')}
                    data-tooltip="Select the block containing this diagnostic"
                  >
                    {diagnostic.jsonPath || '/'}: {diagnosticMessage(diagnostic)}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="blocks-host" ref={blockHost} />
        {blockStatus ? (
          <div role="status" className={'blocks-status ' + (blockError ? 'error' : '')}>
            {blockStatus}
          </div>
        ) : null}
      </div>
    </div>
  );
}
