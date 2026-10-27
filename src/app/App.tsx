import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StudioController, GeneratedOutput } from './controller';
import type { Inspection } from '../core/schema/inspector';
import { signature } from '../core/schema/catalog';
import { isGCScript } from '../core/project/vfs';
import { errorMessage } from '../core/json';
import { languageColor } from '../config';
import { Explorer } from '../components/Explorer';
import { EditorPane } from '../components/EditorPane';
import { Inspector } from '../components/Inspector';
import { Options } from '../components/Options';
import { Examples } from '../components/Examples';
import { Documentation } from '../components/Documentation';
import { ButtonTooltips } from '../components/ButtonTooltips';
import { Modal } from '../components/Modal';
import { downloadURI, download } from '../adapters/files';
export function App({ controller }: { controller: StudioController }) {
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  const [dialog, setDialog] = useState<'options' | 'examples' | 'result' | null>(null),
    [sidebarTab, setSidebarTab] = useState<'files' | 'functions'>('files'),
    [search, setSearch] = useState(''),
    [findRequest, setFindRequest] = useState(0);
  const [output, setOutput] = useState<GeneratedOutput | null>(null),
    [resultDraft, setResultDraft] = useState(''),
    [resultError, setResultError] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ info: Inspection; x: number; y: number } | null>(null);
  const filesInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null);
  const script =
    isGCScript(state.project.active) &&
    state.project.files[state.project.active]?.encoding === 'utf8';
  const setLayout = (next: Partial<typeof state.layout>) =>
    controller.store.update((previous) => ({
      ...previous,
      layout: { ...previous.layout, ...next },
    }));
  const showDoc = useCallback(
    (info: Inspection, event: { clientX: number; clientY: number }) =>
      controller.store.getSnapshot().options.codeTooltips
        ? setDoc((previous) =>
            previous?.info.title === info.title &&
            JSON.stringify(previous.info.path) === JSON.stringify(info.path)
              ? previous
              : {
                  info,
                  x: Math.max(12, Math.min(event.clientX + 18, innerWidth - 440)),
                  y: Math.max(12, Math.min(event.clientY + 12, innerHeight - 530)),
                },
          )
        : setDoc(null),
    [controller],
  );
  useEffect(() => {
    if (!state.options.codeTooltips) setDoc(null);
  }, [state.options.codeTooltips]);
  function resize(which: 'left' | 'right' | 'code', event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget,
      origin = event.clientX,
      initial = state.layout[which];
    const move = (next: PointerEvent) => {
      const delta = next.clientX - origin;
      setLayout({
        [which]:
          which === 'code'
            ? Math.max(
                20,
                Math.min(
                  80,
                  initial +
                    (delta /
                      Math.max(300, document.querySelector('.editorframe')?.clientWidth ?? 900)) *
                      100,
                ),
              )
            : Math.max(
                185,
                Math.min(innerWidth * 0.5, initial + delta * (which === 'right' ? -1 : 1)),
              ),
      });
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end, { once: true });
    element.addEventListener('pointercancel', end, { once: true });
  }
  async function generate(kind: string) {
    try {
      setOutput(await controller.output(kind));
    } catch {
      /* Controller displays the diagnostic. */
    }
  }
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.studio-menu'))
        setMenu(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setDoc(null);
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('dialog') ||
        target?.closest('input:not(.monaco-editor input), textarea:not(.monaco-editor textarea)')
      )
        return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key.toLowerCase() === 'y' || event.shiftKey) controller.redo();
        else controller.undo();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', keyboard, true);
    };
  }, [controller]);
  return (
    <div className={'studio' + (state.embedded ? ' studio-embedded' : '')}>
      <ButtonTooltips
        delay={controller.config.timing.tooltipDelay}
        enabled={state.options.codeTooltips}
      />
      {state.prompt ? (
        <Modal
          title={state.prompt.title}
          onClose={() => controller.answerPrompt('cancel')}
          footer={state.prompt.choices.map((choice) => (
            <button
              key={choice.value}
              className={
                'btn ' + (choice.value === 'cancel' ? 'btn-outline-secondary' : 'btn-primary')
              }
              onClick={() => controller.answerPrompt(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        >
          <p className="text-break">{state.prompt.message}</p>
        </Modal>
      ) : null}
      {state.launch ? (
        <Modal
          title={state.launch.qr ? 'Wallet QR code' : 'Open wallet'}
          onClose={() => controller.store.update((current) => ({ ...current, launch: null }))}
        >
          {state.launch.qr ? (
            <img alt="GameChanger Wallet QR code" className="output-qr" src={state.launch.qr} />
          ) : null}
          <a className="btn btn-primary" href={state.launch.url} target="_blank" rel="opener">
            Open wallet
          </a>
        </Modal>
      ) : null}
      <header className="topbar">
        <button
          className="icon-btn"
          aria-label="Toggle project explorer"
          onClick={() => setLayout({ explorer: !state.layout.explorer })}
        >
          <i aria-hidden="true" className="bi bi-layout-sidebar-inset fs-5" />
        </button>
        <div className="brand">
          <img
            className="brand-logo"
            src={`${import.meta.env.BASE_URL}branding/logo.svg`}
            alt=""
            width={32}
            height={32}
          />
          <div>
            GCScript <span style={{ color: 'var(--accent)' }}>Studio</span>
            <div className="subbrand">CODE + VISUAL EDITOR</div>
          </div>
        </div>
        <nav className="top-actions" aria-label="Project actions">
          <button
            className="btn btn-sm btn-outline-secondary embed-secondary"
            onClick={() => setDialog('examples')}
          >
            <i aria-hidden="true" className="bi bi-collection me-1" />
            Examples
          </button>
          <details
            className="studio-menu embed-secondary"
            open={menu === 'import'}
            onClick={(e) => {
              if ((e.target as Element).closest('button')) setMenu(null);
            }}
          >
            <summary
              aria-expanded={menu === 'import'}
              onClick={(e) => {
                e.preventDefault();
                setMenu(menu === 'import' ? null : 'import');
              }}
              className="btn btn-sm btn-outline-secondary"
            >
              <i aria-hidden="true" className="bi bi-upload me-1" />
              Import
            </summary>
            <div>
              <button onClick={() => filesInput.current?.click()}>Files / ZIP / TAR.GZ</button>
              <button onClick={() => folderInput.current?.click()}>Folder</button>
              <button onClick={() => projectInput.current?.click()}>Saved project JSON</button>
            </div>
          </details>
          <details
            className="studio-menu embed-secondary"
            open={menu === 'export'}
            onClick={(e) => {
              if ((e.target as Element).closest('button')) setMenu(null);
            }}
          >
            <summary
              aria-expanded={menu === 'export'}
              onClick={(e) => {
                e.preventDefault();
                setMenu(menu === 'export' ? null : 'export');
              }}
              className="btn btn-sm btn-outline-secondary"
            >
              <i aria-hidden="true" className="bi bi-download me-1" />
              Export
            </summary>
            <div>
              <button onClick={() => controller.exportFile()}>Selected file</button>
              {(['zip', 'tar.gz', 'json'] as const).map((format) => (
                <button key={format} onClick={() => controller.exportProject(format)}>
                  Project {format.toUpperCase()}
                </button>
              ))}
            </div>
          </details>
          <button
            className="btn btn-sm btn-outline-secondary"
            disabled={!state.schema || state.status.busy}
            onClick={() => {
              void controller.build().catch(() => {});
            }}
          >
            <i aria-hidden="true" className="bi bi-box-seam me-1" />
            Build
          </button>
          <button
            className="btn btn-sm btn-outline-secondary"
            disabled={!script || !state.schema || state.status.busy}
            onClick={() => void controller.validate()}
          >
            <i aria-hidden="true" className="bi bi-check2-circle me-1" />
            Validate
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={!script || !state.schema || state.status.busy}
            onClick={() => void controller.run()}
          >
            <i aria-hidden="true" className="bi bi-play-fill me-1" />
            Run
          </button>
          <details
            className="studio-menu"
            open={menu === 'output'}
            onClick={(e) => {
              if ((e.target as Element).closest('button')) setMenu(null);
            }}
          >
            <summary
              aria-expanded={menu === 'output'}
              onClick={(e) => {
                e.preventDefault();
                setMenu(menu === 'output' ? null : 'output');
              }}
              className="btn btn-sm btn-outline-secondary"
            >
              Output
            </summary>
            <div>
              {controller.config.snippets
                .filter((kind) => ['url', 'qr', 'urlQueryParams'].includes(kind))
                .map((kind) => (
                  <button
                    key={kind}
                    disabled={!script || !state.schema}
                    onClick={() => void generate(kind)}
                  >
                    {kind === 'url' ? 'Wallet URL' : kind === 'qr' ? 'QR code' : 'URL parameters'}
                  </button>
                ))}
              <button disabled={!script || !state.schema} onClick={() => void generate('json')}>
                Built strict JSON
              </button>
              <button disabled={!state.project.active} onClick={() => void generate('editFile')}>
                IDE file link
              </button>
              <button onClick={() => void generate('editProject')}>IDE project link</button>
              <hr />
              {controller.config.snippets
                .filter((kind) => !['url', 'qr', 'urlQueryParams'].includes(kind))
                .map((kind) => (
                  <button
                    key={kind}
                    disabled={!script || !state.schema}
                    onClick={() => void generate(kind)}
                  >
                    {kind} snippet
                  </button>
                ))}
              <hr />
              <button onClick={() => setDialog('result')}>Import wallet result</button>
            </div>
          </details>
          <button
            className="btn btn-sm btn-outline-secondary"
            aria-label="Open Studio options"
            onClick={() => setDialog('options')}
          >
            <i aria-hidden="true" className="bi bi-sliders" />
          </button>
          <button
            className="icon-btn"
            aria-label="Toggle inspector"
            onClick={() => setLayout({ inspector: !state.layout.inspector })}
          >
            <i aria-hidden="true" className="bi bi-layout-sidebar-reverse fs-5" />
          </button>
        </nav>
        <input
          type="file"
          ref={filesInput}
          className="hidden"
          multiple
          aria-label="Import project files"
          onChange={(e) => {
            if (e.target.files) void controller.importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          type="file"
          ref={folderInput}
          className="hidden"
          multiple
          {...{ webkitdirectory: '' }}
          aria-label="Import project folder"
          onChange={(e) => {
            if (e.target.files) void controller.importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          type="file"
          ref={projectInput}
          className="hidden"
          accept=".json"
          aria-label="Import saved project JSON"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void controller.importProjectFile(file);
            e.target.value = '';
          }}
        />
      </header>
      {state.persistenceError ? (
        <div className="persistence-banner" role="alert">
          <span>{state.persistenceError}</span>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() =>
              download(
                'studio-storage-backup.json',
                localStorage.getItem(controller.config.storage.project) ?? '{}',
                'application/json',
              )
            }
          >
            Download saved backup
          </button>
          <button
            className="btn btn-sm btn-outline-danger"
            onClick={() => {
              if (confirm('Replace saved state with a new project? Download a backup first.'))
                controller.reset();
            }}
          >
            Reset saved state
          </button>
        </div>
      ) : null}
      <main className="main">
        <aside
          className={'side ' + (state.layout.explorer ? '' : 'off')}
          style={{ width: state.layout.left, flexBasis: state.layout.left }}
          aria-label="Project explorer and schema library"
        >
          <div className="side-head">
            <div className="action-segment">
              <button
                className={sidebarTab === 'files' ? 'active' : ''}
                onClick={() => setSidebarTab('files')}
              >
                Project
              </button>
              <button
                className={sidebarTab === 'functions' ? 'active' : ''}
                onClick={() => setSidebarTab('functions')}
              >
                Functions
              </button>
            </div>
            <small className="badge-soft">{state.options.network}</small>
          </div>
          <div className="sidebar-scroll">
            {sidebarTab === 'files' ? (
              <Explorer controller={controller} state={state} />
            ) : (
              <>
                <input
                  aria-label="Search schema functions"
                  className="filter"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search functions, arguments…"
                />
                {(['gcscript', 'extras'] as const).map((category) => {
                  const matches =
                    state.schema?.catalog.functions.filter(
                      (fn) =>
                        fn.category === category &&
                        (fn.name + fn.description + Object.keys(fn.props))
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    ) ?? [];
                  return (
                    <section key={category}>
                      <h2 className="group-title">
                        {category === 'extras' ? 'Extras · Build stage' : 'GCScript DSL'} ·{' '}
                        {matches.length}
                      </h2>
                      {matches.map((fn) => {
                        const info: Inspection = {
                          title: fn.title,
                          kind: fn.category === 'extras' ? 'Build-stage directive' : 'GCScript DSL',
                          description: fn.description,
                          path: [],
                          value: undefined,
                          valueType: 'object',
                          schema: fn.schema,
                          returnSchema: fn.returnSchema,
                          returnType: signature(state.schema?.authoring ?? {}, fn.returnSchema),
                          examples: fn.examples,
                          functionName: fn.name,
                          file: fn.file,
                        };
                        return (
                          <div className="item" key={fn.name}>
                            <button
                              className="catalog-name"
                              style={{
                                color: languageColor(controller.config, fn.name, fn.category),
                              }}
                              onClick={(e) => showDoc(info, e)}
                              onFocus={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                showDoc(info, { clientX: rect.right, clientY: rect.top });
                              }}
                            >
                              <i aria-hidden="true" className="bi bi-box me-2" />
                              {fn.name}
                            </button>
                            <button
                              className="icon-btn"
                              aria-label={'Add ' + fn.name + ' to current script'}
                              onClick={() => controller.addFunction(fn.name)}
                            >
                              <i aria-hidden="true" className="bi bi-plus-circle" />
                            </button>
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
              </>
            )}
          </div>
        </aside>
        {state.layout.explorer ? (
          <div
            className="resize-handle"
            role="separator"
            aria-label="Resize explorer"
            onPointerDown={(event) => resize('left', event)}
          />
        ) : null}
        <section className="project-pane" aria-label="Editor">
          <div className="tabbar">
            <span className="path">/{state.project.active || 'No file selected'}</span>
            <div className="editor-view-actions">
              <button
                className="icon-btn"
                aria-label="Undo (Ctrl+Z)"
                disabled={!controller.store.canUndo()}
                onClick={() => controller.undo()}
              >
                <i aria-hidden="true" className="bi bi-arrow-counterclockwise" />
              </button>
              <button
                className="icon-btn"
                aria-label="Redo (Ctrl+Y)"
                disabled={!controller.store.canRedo()}
                onClick={() => controller.redo()}
              >
                <i aria-hidden="true" className="bi bi-arrow-clockwise" />
              </button>
              <button
                className="icon-btn"
                aria-label="Toggle Find and Replace (Ctrl+F / Ctrl+H)"
                disabled={
                  !state.project.active ||
                  state.project.files[state.project.active]?.encoding !== 'utf8'
                }
                onClick={() => {
                  if (state.mode !== 'code' && state.mode !== 'split')
                    controller.store.update((previous) => ({ ...previous, mode: 'code' }));
                  setFindRequest((request) => request + 1);
                }}
              >
                <i aria-hidden="true" className="bi bi-search" />
              </button>
              <button
                className="icon-btn"
                aria-label="Toggle tooltips"
                data-tooltip={
                  state.options.codeTooltips
                    ? 'Hide tooltips in all editor views'
                    : 'Show tooltips in all editor views'
                }
                aria-pressed={state.options.codeTooltips}
                onClick={() =>
                  controller.store.update((previous) => ({
                    ...previous,
                    options: { ...previous.options, codeTooltips: !previous.options.codeTooltips },
                  }))
                }
              >
                <i
                  aria-hidden="true"
                  className={
                    state.options.codeTooltips ? 'bi bi-chat-square-text' : 'bi bi-chat-square'
                  }
                />
              </button>
              <span
                className="view-action-separator"
                role="separator"
                aria-orientation="vertical"
              />
              <nav className="action-segment" aria-label="Editor views">
                {(['code', 'nodes', 'blocks', 'split'] as const).map((mode) => (
                  <button
                    key={mode}
                    disabled={mode !== 'code' && !script}
                    aria-pressed={state.mode === mode}
                    className={state.mode === mode ? 'active' : ''}
                    onClick={() => controller.store.update((previous) => ({ ...previous, mode }))}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </nav>
            </div>
          </div>
          <div className="editor-container">
            <EditorPane
              controller={controller}
              state={state}
              showDoc={showDoc}
              findRequest={findRequest}
            />
            {state.mode === 'split' ? (
              <div
                className="split-resizer"
                style={{ left: state.layout.code + '%' }}
                role="separator"
                aria-label="Resize split editor"
                onPointerDown={(event) => resize('code', event)}
              />
            ) : null}
          </div>
        </section>
        {state.layout.inspector ? (
          <div
            className="resize-handle"
            role="separator"
            aria-label="Resize inspector"
            onPointerDown={(event) => resize('right', event)}
          />
        ) : null}
        <aside
          className={'right ' + (state.layout.inspector ? '' : 'off')}
          style={{ width: state.layout.right, flexBasis: state.layout.right }}
          aria-label="Node inspector"
        >
          <div className="side-head">
            <h2 className="smallcaps m-0">Node inspector</h2>
            <button
              className="icon-btn"
              aria-label="Close inspector"
              onClick={() => setLayout({ inspector: false })}
            >
              <i aria-hidden="true" className="bi bi-x-lg" />
            </button>
          </div>
          <div className="right-inner">
            <Inspector controller={controller} state={state} />
          </div>
        </aside>
      </main>
      <footer className="statusbar">
        {state.diagnostics ? (
          <button
            className="icon-btn"
            aria-label="Show validation diagnostics"
            onClick={() =>
              controller.store.update((current) => ({
                ...current,
                report: current.diagnostics,
                layout: { ...current.layout, inspector: true },
              }))
            }
          >
            {state.diagnostics.errors.length} errors · {state.diagnostics.warnings.length} warnings
          </button>
        ) : null}
        <span role="status" style={{ color: state.status.error ? 'var(--error)' : undefined }}>
          <i
            aria-hidden="true"
            className={
              'bi me-2 ' +
              (state.status.busy
                ? 'bi-hourglass-split'
                : state.status.error
                  ? 'bi-exclamation-circle'
                  : 'bi-check-circle')
            }
          />
          {state.status.message}
        </span>
        <span className="status-end">
          {Object.keys(state.project.files).length} files ·{' '}
          {state.schema?.catalog.functions.length ?? 0} functions · JSONC · Rete · Blockly
        </span>
      </footer>
      {dialog === 'options' ? (
        <Options controller={controller} initial={state.options} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'examples' ? (
        <Examples controller={controller} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'result' ? (
        <Modal
          title="Import wallet result"
          onClose={() => setDialog(null)}
          footer={
            <button
              className="btn btn-primary"
              disabled={!resultDraft.trim()}
              onClick={() => {
                void controller
                  .importResult(resultDraft)
                  .then(() => {
                    setResultDraft('');
                    setDialog(null);
                  })
                  .catch((error) => setResultError(errorMessage(error)));
              }}
            >
              Import result into project
            </button>
          }
        >
          <label htmlFor="wallet-result" className="form-label">
            Paste encoded wallet exports or JSON
          </label>
          <textarea
            id="wallet-result"
            rows={8}
            className="form-control"
            value={resultDraft}
            onChange={(e) => setResultDraft(e.target.value)}
          />
          <p className="field-hint mt-2">
            Saved to /{state.options.resultsPath}. Cross-device QR runs require manual result
            import.
          </p>
          {resultError ? <p role="alert">{resultError}</p> : null}
        </Modal>
      ) : null}
      {output ? (
        <Modal
          title={output.title}
          onClose={() => setOutput(null)}
          footer={
            <button
              className="btn btn-primary"
              onClick={() => {
                if (output.image) downloadURI('gcscript-qr.png', output.value);
                else
                  void navigator.clipboard
                    .writeText(output.value)
                    .then(() => controller.notify('Copied output'))
                    .catch((error) => controller.notify(errorMessage(error), true));
              }}
            >
              {output.image ? 'Download PNG' : 'Copy output'}
            </button>
          }
        >
          {output.editLink ? (
            <label className="form-check mb-3">
              <input
                className="form-check-input"
                type="checkbox"
                checked={new URL(output.value).searchParams.get('embed') === 'true'}
                onChange={(event) => {
                  const url = new URL(output.value);
                  if (event.target.checked) url.searchParams.set('embed', 'true');
                  else url.searchParams.delete('embed');
                  setOutput({ ...output, value: url.href });
                }}
              />
              <span className="form-check-label">
                Embedded mode (compact editor, separate workspace)
              </span>
            </label>
          ) : null}
          {output.image ? (
            <img className="output-qr" src={output.value} alt="GCScript wallet QR" />
          ) : (
            <textarea
              className="form-control"
              aria-label="Generated output"
              readOnly
              rows={6}
              value={output.value}
            />
          )}
        </Modal>
      ) : null}
      {doc && state.schema ? (
        <aside
          className="studio-doc-popover"
          role="dialog"
          aria-label="Schema documentation"
          style={{ left: doc.x, top: doc.y, width: 'min(420px, calc(100vw - 24px))' }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDoc(null);
          }}
        >
          <button
            className="studio-doc-close"
            aria-label="Close documentation"
            onClick={() => setDoc(null)}
          >
            ×
          </button>
          <Documentation
            info={doc.info}
            bundle={state.schema.authoring}
            config={controller.config}
          />
        </aside>
      ) : null}
    </div>
  );
}
