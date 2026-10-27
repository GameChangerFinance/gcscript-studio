import { useState } from 'react';
import type { StudioOptions } from '../config';
import type { StudioController } from '../app/controller';
import { errorMessage } from '../core/json';
import { Modal } from './Modal';
export function Options({
  controller,
  initial,
  onClose,
}: {
  controller: StudioController;
  initial: StudioOptions;
  onClose(): void;
}) {
  const [draft, setDraft] = useState({ ...initial }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const set = <K extends keyof StudioOptions>(key: K, value: StudioOptions[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  async function apply() {
    setBusy(true);
    setError('');
    try {
      await controller.applyOptions(draft);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      await controller.loadSchema(draft.schemaUrl, true);
      setNotice('Wallet schema and extras cache cleared and refreshed.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const textFields: [
    keyof Pick<
      StudioOptions,
      | 'schemaUrl'
      | 'walletUrl'
      | 'refAddress'
      | 'examplesRepo'
      | 'examplesBranch'
      | 'examplesPath'
      | 'entryFile'
      | 'outputPath'
      | 'resultsPath'
    >,
    string,
  ][] = [
    ['schemaUrl', 'Full JSON Schema bundle URL'],
    ['walletUrl', 'Wallet URL pattern'],
    ['refAddress', 'Referral address (optional)'],
    ['entryFile', 'Project entrypoint'],
    ['outputPath', 'Built output path'],
    ['resultsPath', 'Wallet result path'],
    ['examplesRepo', 'GitHub examples repository'],
    ['examplesBranch', 'GitHub branch'],
    ['examplesPath', 'Examples directory'],
  ];
  return (
    <Modal
      title="Studio options"
      wide
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-outline-secondary"
            disabled={busy}
            onClick={() => setDraft({ ...controller.config.defaults })}
          >
            Reset defaults
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Loading…' : 'Apply & reload schema'}
          </button>
        </>
      }
    >
      <p className="field-hint">
        Schemas and extras are cached locally for 24 hours, matching GC CLI. Refresh downloads both
        again and updates validation, documentation, completion and visual palettes.
      </p>
      {error ? (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {textFields.map(([key, label]) => (
        <div className="mb-3" key={key}>
          <label className="form-label" htmlFor={'option-' + key}>
            {label}
          </label>
          <div className="input-group">
            <input
              id={'option-' + key}
              className="form-control"
              value={draft[key]}
              onChange={(e) => set(key, e.target.value)}
            />
            {key === 'schemaUrl' ? (
              <button
                className="btn btn-outline-secondary"
                aria-label="Clear and refresh schema and extras cache"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <i aria-hidden="true" className="bi bi-arrow-clockwise" />
              </button>
            ) : null}
          </div>
          {key === 'refAddress' ? (
            <small>
              Optional Cardano address for GC referral programs, on the selected network. Empty adds
              no ref parameter.
            </small>
          ) : null}
        </div>
      ))}
      <div className="mb-3">
        <label htmlFor="option-runMode" className="form-label">
          Run mode
        </label>
        <select
          id="option-runMode"
          className="form-select"
          value={draft.runMode}
          onChange={(e) =>
            set(
              'runMode',
              e.target.value === 'qr' ? 'qr' : e.target.value === 'redirect' ? 'redirect' : 'popup',
            )
          }
        >
          <option value="popup">Popup (default)</option>
          <option value="redirect">Redirect this window</option>
          <option value="qr">QR code · scan on another device</option>
        </select>
        <small>QR mode requires manual import of cross-device results.</small>
      </div>
      <div className="row g-3">
        <div className="col-sm-6">
          <label htmlFor="option-theme" className="form-label">
            Theme
          </label>
          <select
            id="option-theme"
            className="form-select"
            value={draft.theme}
            onChange={(e) => set('theme', e.target.value === 'light' ? 'light' : 'dark')}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="col-sm-6">
          <label htmlFor="option-network" className="form-label">
            Network
          </label>
          <select
            id="option-network"
            className="form-select"
            value={draft.network}
            onChange={(e) => set('network', e.target.value === 'mainnet' ? 'mainnet' : 'preprod')}
          >
            <option value="preprod">Preprod</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </div>
        <div className="col-sm-6">
          <label htmlFor="option-split" className="form-label">
            Split view
          </label>
          <select
            id="option-split"
            className="form-select"
            value={draft.splitView}
            onChange={(e) => set('splitView', e.target.value === 'nodes' ? 'nodes' : 'blocks')}
          >
            <option value="blocks">Code + Blocks</option>
            <option value="nodes">Code + Nodes</option>
          </select>
        </div>
        <div className="col-sm-6">
          <label htmlFor="option-isl" className="form-label">
            ISL display in Blocks
          </label>
          <select
            id="option-isl"
            className="form-select"
            value={draft.islDisplay}
            onChange={(e) => set('islDisplay', e.target.value === 'blocks' ? 'blocks' : 'text')}
          >
            <option value="text">ISL as text</option>
            <option value="blocks">ISL function blocks (safe subset)</option>
          </select>
          <small>Unsupported expressions remain exact source text.</small>
        </div>
        <div className="col-sm-6">
          <label htmlFor="option-limit" className="form-label">
            Maximum children per node scope
          </label>
          <input
            id="option-limit"
            className="form-control"
            type="number"
            min="1"
            max="10000"
            value={draft.nodeChildrenLimit}
            onChange={(e) => set('nodeChildrenLimit', Number(e.target.value))}
          />
        </div>
      </div>
      {(
        [
          ['codeTooltips', 'Show editor tooltips (Code, Nodes, Blocks)'],
          ['disableNetworkRouter', 'Disable network router (use wallet current network)'],
          ['mergeResults', 'Merge wallet results with existing objects'],
          ['compactOutput', 'Compact build output'],
        ] as const
      ).map(([key, label]) => (
        <div className="form-check mt-3" key={key}>
          <input
            className="form-check-input"
            type="checkbox"
            id={'option-' + key}
            checked={draft[key]}
            onChange={(e) => set(key, e.target.checked)}
          />
          <label className="form-check-label" htmlFor={'option-' + key}>
            {label}
          </label>
        </div>
      ))}
      <p className="run-tip mt-3">
        Build uses the entrypoint. Validate and Run use the active GCScript file. Run uses the
        selected run mode and target network. Disabling the network router uses the wallet’s current
        network. Run saves its return callback into the active script.{' '}
        <code>app:///lib/helper.gcscript</code> imports from the project root;{' '}
        <code>app://./helper.gcscript</code> imports beside the source file.
      </p>
    </Modal>
  );
}
