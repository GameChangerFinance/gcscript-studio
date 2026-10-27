import { useEffect, useState } from 'react';
import type { StudioController } from '../app/controller';
import { fetchExamples } from '../adapters/examples';
import type { ExampleFile } from '../adapters/examples';
import { errorMessage } from '../core/json';
import { Modal } from './Modal';
export function Examples({
  controller,
  onClose,
}: {
  controller: StudioController;
  onClose(): void;
}) {
  const [examples, setExamples] = useState<ExampleFile[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetchExamples(controller.store.getSnapshot().options, abort.signal)
      .then(setExamples)
      .catch((error) => {
        if (!abort.signal.aborted) setError(errorMessage(error));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [controller]);
  async function open(example: ExampleFile) {
    try {
      const response = await fetch(example.url);
      if (!response.ok) throw Error('Example HTTP ' + response.status);
      const file = new File([await response.blob()], example.name);
      onClose();
      await controller.importFiles([file]);
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  return (
    <Modal title="Official GCScript examples" wide onClose={onClose}>
      <div className="showcase-examples mb-4">
        {controller.config.examples.map((example) => (
          <article className="example-row" key={example.name}>
            <i
              aria-hidden="true"
              className={
                'bi ' +
                (example.name.endsWith('.zip') ? 'bi-file-earmark-zip' : 'bi-file-earmark-code')
              }
            />
            <div className="flex-grow-1">
              <strong>{example.title}</strong>
              <p className="field-hint mb-0">{example.description}</p>
            </div>
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                void open({
                  name: example.name,
                  path: example.name,
                  url: new URL('examples/' + example.name, controller.baseURL).href,
                })
              }
            >
              Open {example.name}
            </button>
          </article>
        ))}
      </div>
      <input
        className="filter mb-3"
        aria-label="Search examples"
        placeholder="Search example names…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? <p>Loading examples…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !examples.length ? (
        <p>No matching GCScript files found in this repository.</p>
      ) : null}
      {examples
        .filter((example) => example.name.toLowerCase().includes(query.toLowerCase()))
        .map((example) => (
          <div className="example-row" key={example.path}>
            <i aria-hidden="true" className="bi bi-file-earmark-code" />
            <span className="flex-grow-1 text-break">{example.name}</span>
            <button className="btn btn-sm btn-primary" onClick={() => void open(example)}>
              Open
            </button>
          </div>
        ))}
    </Modal>
  );
}
