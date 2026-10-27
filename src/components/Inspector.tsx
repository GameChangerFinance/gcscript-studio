import type { StudioController } from '../app/controller';
import type { StudioState } from '../core/state';
import { errorMessage, getAt, parseJSONC, patchJSONC } from '../core/json';
import type { JsonPath } from '../core/json';
import { inspectValue } from '../core/schema/inspector';
import { isGCScript } from '../core/project/vfs';
import { Documentation, Markdown } from './Documentation';
export function Inspector({
  controller,
  state,
}: {
  controller: StudioController;
  state: StudioState;
}) {
  const file = state.project.files[state.project.active],
    snapshot = state.schema;
  if (!file || !snapshot) return <div className="panel">Open a file to inspect its contents.</div>;
  if (file.encoding === 'base64')
    return <div className="panel">Binary file. Use the project menu to download it.</div>;
  if (!isGCScript(state.project.active))
    return (
      <div className="panel">
        <h2 className="h6">File information</h2>
        <code>/{state.project.active}</code>
        <p className="field-hint mt-3">
          This file is not GCScript. Edit it in Code; language validation and graphical editors
          apply to GCScript files.
        </p>
      </div>
    );
  if (state.report)
    return (
      <>
        <h2 className="h6">{state.report.isValid ? '✓ Valid GCScript' : 'Validation failed'}</h2>
        {[
          ...state.report.errors.map((error) => ({ ...error, warning: false })),
          ...state.report.warnings.map((error) => ({ ...error, warning: true })),
        ].map((diagnostic, i) => (
          <div className={'problem ' + (diagnostic.warning ? 'warning' : '')} key={i}>
            <b>{diagnostic.jsonPath ?? 'Validation'}</b>
            <p>{diagnostic.message}</p>
            {diagnostic.suggestion ? (
              <Markdown text={diagnostic.suggestion} config={controller.config} />
            ) : null}
            {diagnostic.examples
              ?.slice(0, 3)
              .filter((example) => JSON.stringify(example).length <= 180)
              .map((example, index) => (
                <pre key={index}>
                  <code>{JSON.stringify(example, null, 2)}</code>
                </pre>
              ))}
            {diagnostic.relatedDocs?.slice(0, 2).map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                Language reference ↗
              </a>
            ))}
          </div>
        ))}
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => controller.store.update((previous) => ({ ...previous, report: null }))}
        >
          Return to inspector
        </button>
      </>
    );
  try {
    const document = parseJSONC(file.text),
      info = inspectValue(document, snapshot.authoring, snapshot.catalog, state.selection),
      value = getAt(document, state.selection);
    const select = (path: JsonPath) =>
      controller.store.update((previous) => ({
        ...previous,
        selection: path,
        selectionOrigin: 'inspector',
      }));
    const edit = (path: JsonPath, text: string) => {
      try {
        controller.editFile(patchJSONC(file.text, path, parseJSONC(text)), state.project.active);
      } catch (error) {
        controller.notify(errorMessage(error), true);
      }
    };
    return (
      <>
        <nav aria-label="Selected JSON path" className="studio-breadcrumbs mb-3">
          <button onClick={() => select([])}>root</button>
          {state.selection.map((key, i) => (
            <button key={i} onClick={() => select(state.selection.slice(0, i + 1))}>
              / {key}
            </button>
          ))}
        </nav>
        <Documentation info={info} bundle={snapshot.authoring} config={controller.config} />
        <h3 className="smallcaps mt-4">
          {value && typeof value === 'object' ? 'Properties' : 'Selected value'}
        </h3>
        {value && typeof value === 'object' ? (
          <div className="studio-inspect-props">
            {Object.entries(value).map(([key, child]) => {
              const path = [...state.selection, Array.isArray(value) ? Number(key) : key],
                text = JSON.stringify(child, null, 2);
              return (
                <div key={JSON.stringify(path)}>
                  <button className="prop-open" onClick={() => select(path)}>
                    {key} ↗
                  </button>
                  <textarea
                    key={text}
                    aria-label={'Edit ' + key + ' as JSON'}
                    className="value-input"
                    rows={Math.min(5, Math.max(1, text.split('\n').length))}
                    defaultValue={text}
                    onBlur={(e) => {
                      if (e.target.value !== text) edit(path, e.target.value);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <textarea
            key={JSON.stringify(state.selection) + JSON.stringify(value)}
            className="value-input"
            rows={4}
            aria-label="Edit selected value as JSON"
            defaultValue={JSON.stringify(value, null, 2)}
            onBlur={(e) => edit(state.selection, e.target.value)}
          />
        )}
        {state.selection.length ? (
          <button
            className="btn btn-sm btn-outline-danger mt-3"
            onClick={() => {
              controller.editFile(
                patchJSONC(file.text, state.selection, undefined),
                state.project.active,
              );
              select(state.selection.slice(0, -1));
            }}
          >
            Delete selected value
          </button>
        ) : null}
      </>
    );
  } catch (error) {
    return (
      <div className="problem" role="status">
        {errorMessage(error)}
      </div>
    );
  }
}
