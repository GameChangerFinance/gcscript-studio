import { useState } from 'react';
import type { StudioController } from '../app/controller';
import { errorMessage } from '../core/json';
import { Modal } from './Modal';

export function ImportSources({
  controller,
  kind,
  onClose,
}: {
  controller: StudioController;
  kind: 'url' | 'payload';
  onClose: () => void;
}) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = kind === 'url';
  async function open() {
    if (busy || !source.trim()) return;
    setBusy(true);
    setError('');
    const before = controller.store.getSnapshot().status;
    try {
      await controller.importSource(source);
      const after = controller.store.getSnapshot().status;
      if (after !== before && after.error) throw Error(after.message);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={url ? 'Open from URL' : 'Open from payload'}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="import-source-form"
            className="btn btn-primary"
            disabled={busy || !source.trim()}
          >
            {busy ? 'Opening…' : 'OK'}
          </button>
        </>
      }
    >
      <form
        id="import-source-form"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <label className="form-label" htmlFor="import-source">
          {url ? 'File, project or GC link URL' : 'GC compressed payload or project/script JSON'}
        </label>
        {url ? (
          <input
            id="import-source"
            type="url"
            className="form-control"
            placeholder="https://…/example.gcscript"
            autoFocus
            value={source}
            disabled={busy}
            required
            onChange={(event) => setSource(event.target.value)}
            aria-describedby="import-source-hint"
            aria-invalid={Boolean(error)}
          />
        ) : (
          <textarea
            id="import-source"
            className="form-control font-monospace"
            rows={8}
            placeholder="1-H4sI…"
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={source}
            disabled={busy}
            required
            onChange={(event) => setSource(event.target.value)}
            aria-describedby="import-source-hint"
            aria-invalid={Boolean(error)}
          />
        )}
        <p id="import-source-hint" className="field-hint mt-2">
          {url
            ? 'Open files, ZIP/TAR.GZ projects or GC edit/run links. Direct downloads require CORS access.'
            : 'Paste an encoded GC payload, GCScript JSONC or exported project JSON.'}
        </p>
        {error ? (
          <p role="alert" className="alert alert-danger text-break mb-0">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
