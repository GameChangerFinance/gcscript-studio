import type { StudioConfig, StudioOptions } from '../config';
import { createStudioStore, initialState } from '../core/state';
import type { StudioStore } from '../core/state';
import {
  createProject,
  parseProject,
  isGCScript,
  path,
  put,
  name,
  transfer,
  moveInto,
} from '../core/project/vfs';
import type { Project } from '../core/project/vfs';
import { buildProjectFile, commitBuild } from '../core/project/build';
import { buildService, validateBuilt } from '../adapters/build';
import { createSchemaCache } from '../core/schema/cache';
import { extendSchemas } from '../core/schema/extensions';
import { blankFunction, getCatalog } from '../core/schema/catalog';
import { errorMessage, getAt, isObject, isRecord, parseJSONC, patchJSONC } from '../core/json';
import type { JsonValue } from '../core/json';
import { gc } from '../adapters/gc';
import { createValidationScheduler } from '../core/validation';
import {
  archiveFiles,
  dataURIText,
  download,
  downloadURI,
  fileBytes,
  importGCFiles,
  readImports,
} from '../adapters/files';
import { restoreSession, persistSession, sessionConfig } from '../adapters/persistence';
import { decodeEditLink, encodeEditLink } from '../adapters/edit-links';
import { readStudioLaunch } from '../core/project/edit-link';
import type { EditFilePayload, LinkView } from '../core/project/edit-link';
import { consumeReturns, decodeResult, registerRun } from '../adapters/wallet/bridge';
import { createCorrelationId } from '../adapters/identifiers';
import { walletParameters, withWalletCallback, mergeWalletResults } from '../core/wallet';
export interface GeneratedOutput {
  title: string;
  value: string;
  image: boolean;
  editLink?: boolean;
}
export interface StudioController {
  store: StudioStore;
  undo(): void;
  redo(): void;
  beforeHistory?: (redo: boolean) => boolean;
  config: StudioConfig;
  baseURL: string;
  loadSchema(url: string, refresh?: boolean): Promise<void>;
  notify(message: string, error?: boolean, busy?: boolean): void;
  editFile(text: string, key: string, typing?: boolean): void;
  answerPrompt(value: string): void;
  closeProject(): Promise<void>;
  importProjectFile(file: File): Promise<void>;
  importEditLink(href: string): Promise<void>;
  exportFile(): void;
  mutateProject(operation: (project: Project) => Project): boolean;
  moveEntry(
    source: string,
    destination: string,
    options?: { copy?: boolean; intoFolder?: boolean },
  ): boolean;
  applyOptions(options: StudioOptions): Promise<void>;
  build(): Promise<string>;
  validate(): Promise<void>;
  run(): Promise<void>;
  output(kind: string): Promise<GeneratedOutput | null>;
  importFiles(files: FileList | File[], folder?: string): Promise<void>;
  exportProject(format: 'zip' | 'tar.gz' | 'json'): void;
  importResult(text: string): Promise<void>;
  addFunction(name: string): void;
  reset(): void;
  dispose(): void;
}
/** Browser orchestration is centralized here; views do not build, decode or classify programs. */
export function createStudioController(config: StudioConfig): StudioController {
  const baseURL = new URL(import.meta.env.BASE_URL, location.origin).href;
  const launch = readStudioLaunch(location.href, baseURL, config);
  config = sessionConfig(config, launch.embedded);
  const initial = initialState(
    createProject(config, createCorrelationId()),
    config,
    innerWidth <= config.layout.mobileBreakpoint,
  );
  const restored = restoreSession(initial, config, localStorage);
  const store = createStudioStore(
    {
      ...initial,
      ...restored,
      persistenceError: restored.error,
      embedded: launch.embedded,
      mode: launch.mode ?? initial.mode,
      layout: launch.embedded
        ? { ...restored.layout, explorer: false, inspector: false }
        : restored.layout,
    },
    config.history,
  );
  let disposed = false,
    schemaRevision = 0;
  const notify = (message: string, error = false, busy = false): void =>
    store.update((state) => ({
      ...state,
      status: { message, error, busy },
      logs: [message, ...state.logs].slice(0, config.limits.logEntries),
    }));
  const cache = createSchemaCache(
    localStorage,
    config.storage.schemas,
    fetch,
    (message) => notify(message, true),
    config.schemaCacheMaxAge,
  );
  const schemaURL = (url: string) => new URL(url, baseURL).href;
  let persistedProject = restored.project,
    persistedOptions = restored.options,
    persistedLayout = restored.layout;
  const stopPersistence = store.subscribe(() => {
    const state = store.getSnapshot();
    document.documentElement.dataset.bsTheme = state.options.theme;
    try {
      if (
        state.project !== persistedProject ||
        state.options !== persistedOptions ||
        state.layout !== persistedLayout
      ) {
        persistSession(state, config, localStorage);
        persistedProject = state.project;
        persistedOptions = state.options;
        persistedLayout = state.layout;
      }
    } catch {
      store.update((current) =>
        current.persistenceError
          ? current
          : {
              ...current,
              persistenceError:
                'Autosave paused: browser storage is full or unavailable. Export a project backup.',
            },
      );
    }
  });
  function mutateProject(operation: (project: Project) => Project): boolean {
    try {
      store.update((state) => ({
        ...state,
        project: operation(state.project),
        report: null,
        diagnostics: null,
      }));
      return true;
    } catch (error) {
      notify(errorMessage(error), true);
      return false;
    }
  }
  function assertCurrent(snapshot: Project): void {
    const current = store.getSnapshot().project;
    if (disposed || current.id !== snapshot.id || current.revision !== snapshot.revision)
      throw Error('Project changed during operation. Retry with the current files.');
  }
  function schema() {
    const snapshot = store.getSnapshot().schema;
    if (!snapshot) throw Error('Full schema unavailable');
    return snapshot;
  }
  async function buildFile(source: string, save = false): Promise<string> {
    const { project, options } = store.getSnapshot();
    const output = await buildProjectFile(
      buildService,
      project,
      source,
      schema().runtime,
      options.compactOutput,
    );
    assertCurrent(project);
    if (save)
      store.update((state) => ({
        ...state,
        project: commitBuild(state.project, project, source, options.outputPath, output),
      }));
    return output;
  }
  let resolvePrompt: ((choice: string) => void) | undefined;
  let importing = false;
  function choose(
    title: string,
    message: string,
    choices: { value: string; label: string }[],
  ): Promise<string> {
    if (resolvePrompt) throw Error('Another decision is already pending');
    return new Promise((resolve) => {
      resolvePrompt = resolve;
      store.update((state) => ({ ...state, prompt: { title, message, choices } }));
    });
  }
  async function saveBeforeOpening(): Promise<boolean> {
    const choice = await choose(
      'Save current project?',
      'Opening a new project replaces the current workspace. Save a project ZIP backup first?',
      [
        { value: 'save', label: 'Save project ZIP and continue' },
        { value: 'discard', label: 'Continue without saving' },
        { value: 'cancel', label: 'Cancel' },
      ],
    );
    if (choice === 'save') controller.exportProject('zip');
    return choice === 'save' || choice === 'discard';
  }
  function openProject(project: Project, selectEntrypoint = false): void {
    const candidates = Object.keys(project.files)
      .filter(isGCScript)
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const preferred = store.getSnapshot().options.entryFile;
    const entry = candidates.includes(preferred) ? preferred : (candidates[0] ?? project.active);
    project = { ...project, active: selectEntrypoint ? entry : project.active };
    store.update((state) => ({
      ...state,
      project,
      selectedFile: project.active,
      selection: [],
      report: null,
      diagnostics: null,
      options: { ...state.options, entryFile: entry },
    }));
  }
  function resultText(result: JsonValue, destination?: string): string {
    const { project, options } = store.getSnapshot();
    const existing = project.files[path(destination ?? options.resultsPath)];
    // Do not silently overwrite malformed user data when merging was requested.
    const value =
      options.mergeResults && existing
        ? mergeWalletResults(parseJSONC(existing.text), result)
        : result;
    return JSON.stringify(value, null, 2) + '\n';
  }
  const capture = () =>
    consumeReturns(
      config,
      store.getSnapshot().project.id,
      (payload) => {
        store.update((state) => ({
          ...state,
          project: put(
            state.project,
            payload.pending.resultsPath,
            { text: resultText(payload.result, payload.pending.resultsPath), encoding: 'utf8' },
            true,
          ),
        }));
        notify('Wallet exports captured in /' + payload.pending.resultsPath);
      },
      (message) => notify(message, true),
    );
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(config.storage.result + ':')) capture();
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      event.origin === location.origin &&
      isObject(event.data as JsonValue) &&
      (event.data as Record<string, unknown>).type === 'gcstudio-wallet-return'
    )
      capture();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('message', onMessage);
  queueMicrotask(capture);
  let validationRunning = false;
  async function validateActive(background: boolean): Promise<void> {
    if (disposed) return;
    if (validationRunning) {
      if (background) validation.schedule();
      return;
    }
    const { project, options, schema: snapshot } = store.getSnapshot();
    if (
      !snapshot ||
      !isGCScript(project.active) ||
      project.files[project.active]?.encoding !== 'utf8'
    )
      return;
    validationRunning = true;
    if (!background) notify('Validating active file…', false, true);
    try {
      const output = await buildProjectFile(
        buildService,
        project,
        project.active,
        snapshot.runtime,
        options.compactOutput,
        false,
      );
      const report = await validateBuilt(output, snapshot.runtime, 'app:///' + project.active);
      assertCurrent(project);
      if (
        store.getSnapshot().project.active !== project.active ||
        store.getSnapshot().schema !== snapshot
      )
        return;
      store.update((state) => ({
        ...state,
        report: background
          ? state.report
          : { ...report, file: project.active, revision: project.revision },
        diagnostics: { ...report, file: project.active, revision: project.revision },
        layout: background ? state.layout : { ...state.layout, inspector: true },
      }));
      if (!background)
        notify(report.isValid ? 'Validation passed' : 'Validation failed', !report.isValid);
    } catch (error) {
      const current = store.getSnapshot().project;
      if (
        !disposed &&
        current.id === project.id &&
        current.revision === project.revision &&
        current.active === project.active
      ) {
        const report = {
          isValid: false,
          errors: [{ message: errorMessage(error) }],
          warnings: [],
          file: project.active,
          revision: project.revision,
        };
        store.update((state) => ({
          ...state,
          report: background ? state.report : report,
          diagnostics: report,
        }));
        if (!background) notify('Validation: ' + errorMessage(error), true);
      }
    } finally {
      validationRunning = false;
    }
  }
  const validation = createValidationScheduler(
    () => validateActive(true),
    config.timing.validationDebounce,
    config.timing.validationInterval,
  );
  let validationProject = store.getSnapshot().project,
    validationSchema = store.getSnapshot().schema;
  const stopValidation = store.subscribe(() => {
    const state = store.getSnapshot();
    if (state.project !== validationProject || state.schema !== validationSchema) {
      validationProject = state.project;
      validationSchema = state.schema;
      validation.schedule();
    }
  });
  const controller: StudioController = {
    store,
    undo() {
      if (controller.beforeHistory?.(false) !== false) store.undo();
    },
    redo() {
      if (controller.beforeHistory?.(true) !== false) store.redo();
    },
    config,
    baseURL,
    notify,
    mutateProject,
    moveEntry(source, destination, { copy = false, intoFolder = false } = {}) {
      try {
        const from = path(source),
          to = intoFolder
            ? (path(destination, true) ? path(destination) + '/' : '') + name(from)
            : path(destination);
        store.update((state) => {
          const project = intoFolder
            ? moveInto(state.project, from, destination, copy)
            : transfer(state.project, from, to, copy);
          const entry = path(state.options.entryFile);
          const entryFile =
            !copy && (entry === from || entry.startsWith(from + '/'))
              ? to + entry.slice(from.length)
              : entry;
          return {
            ...state,
            project,
            options: { ...state.options, entryFile },
            report: null,
            diagnostics: null,
          };
        });
        return true;
      } catch (error) {
        notify(errorMessage(error), true);
        return false;
      }
    },
    async loadSchema(url, refresh = false) {
      const revision = ++schemaRevision;
      notify(refresh ? 'Refreshing wallet schema and extras…' : 'Loading schema…', false, true);
      const primary = schemaURL(url),
        extrasURL = schemaURL(config.extrasUrl);
      try {
        const runtime = refresh
          ? (await cache.refresh([primary, extrasURL]))[0]
          : await cache.load(primary);
        if (!runtime) throw Error('Wallet schema is empty');
        const extras = await cache.load(extrasURL),
          authoring = extendSchemas(runtime, extras),
          catalog = getCatalog(authoring, new Set(Object.keys(extras)));
        if (disposed || revision !== schemaRevision) return;
        store.update((state) => ({
          ...state,
          schema: { runtime, authoring, catalog, source: primary },
        }));
        notify(
          `Schema ready · ${catalog.functions.length} functions · ${catalog.isl.length} ISL declarations`,
        );
      } catch (error) {
        if (revision === schemaRevision && !disposed) notify(errorMessage(error), true);
        throw error;
      }
    },
    editFile(text, key, typing = false) {
      store.update(
        (state) => {
          const file = state.project.files[key];
          if (!file || file.text === text) return state;
          return {
            ...state,
            project: put(state.project, key, { ...file, text }, true),
            report: null,
            diagnostics: null,
          };
        },
        typing ? 'typing:' + key : undefined,
      );
    },
    async applyOptions(options) {
      options = { ...options, ...config.fixedEditorOptions };
      for (const key of ['entryFile', 'outputPath', 'resultsPath'] as const) path(options[key]);
      if (
        !options.walletUrl.includes('{gcscript}') ||
        !['https:', 'http:'].includes(new URL(options.walletUrl).protocol)
      )
        throw Error('Wallet URL must be HTTP(S) and contain {gcscript}');
      if (
        !Number.isInteger(options.nodeChildrenLimit) ||
        options.nodeChildrenLimit < 1 ||
        options.nodeChildrenLimit > 10000
      )
        throw Error('Node children limit must be between 1 and 10000');
      await controller.loadSchema(options.schemaUrl);
      store.update((state) => ({ ...state, options: { ...options } }));
    },
    async build() {
      notify('Building project entrypoint…', false, true);
      try {
        const { options } = store.getSnapshot();
        const output = await buildFile(options.entryFile, true);
        notify('Built /' + path(options.outputPath));
        return output;
      } catch (error) {
        notify('Build failed: ' + errorMessage(error), true);
        throw error;
      }
    },
    async validate() {
      await validateActive(false);
    },
    async run() {
      const before = store.getSnapshot();
      if (!isGCScript(before.project.active)) return;
      const token = createCorrelationId();
      try {
        notify('Building active file for wallet…', false, true);
        const file = before.project.files[before.project.active];
        if (!file) throw Error('Active file is missing');
        if (!isObject(parseJSONC(file.text))) throw Error('Wallet input must be a GCScript object');
        // The callback is an intentional, undoable source edit, visible in exported files.
        const callback = JSON.parse(withWalletCallback('{}', baseURL, token, launch.embedded)) as {
          returnURLPattern: string;
        };
        controller.editFile(
          patchJSONC(file.text, ['returnURLPattern'], callback.returnURLPattern),
          before.project.active,
        );
        const { project, options } = store.getSnapshot();
        const input = withWalletCallback(
          await buildFile(project.active),
          baseURL,
          token,
          launch.embedded,
        );
        const params = walletParameters(input, options, baseURL);
        const url = await gc.encode.url(params);
        assertCurrent(project);
        if (!['http:', 'https:'].includes(new URL(url).protocol))
          throw Error('GC did not produce a valid wallet URL');
        registerRun(config, {
          token,
          projectId: project.id,
          resultsPath: path(options.resultsPath),
          mode: options.runMode,
          created: Date.now(),
        });
        if (options.runMode === 'qr') {
          const qr = await gc.encode.qr({ ...params, qrResultType: 'png' });
          assertCurrent(project);
          store.update((state) => ({ ...state, launch: { url, qr } }));
          notify('Scan with GameChanger Wallet. Cross-device results must be imported manually.');
        } else if (options.runMode === 'redirect') location.assign(url);
        else {
          const popup = window.open(
            url,
            config.wallet.popupName + '_' + token,
            config.wallet.popupFeatures,
          );
          if (!popup) {
            store.update((state) => ({ ...state, launch: { url } }));
            notify('Popup blocked. Use Open wallet to launch the prepared script.', true);
          } else
            notify(
              'Wallet launched' +
                (options.disableNetworkRouter
                  ? ' using its current network.'
                  : ' on ' + options.network + '.'),
            );
        }
      } catch (error) {
        notify('Run failed: ' + errorMessage(error), true);
      }
    },
    async output(kind) {
      const { project, options } = store.getSnapshot();
      notify('Generating ' + kind + '…', false, true);
      try {
        if (kind === 'editFile' || kind === 'editProject') {
          const key = Object.hasOwn(project.files, store.getSnapshot().selectedFile)
            ? store.getSnapshot().selectedFile
            : project.active;
          const file = project.files[key];
          if (kind === 'editFile' && !file) throw Error('Select a file to share');
          const payload =
            kind === 'editProject'
              ? project
              : ({
                  format: 'gcscript-studio-file',
                  version: 1,
                  path: key,
                  file: file!,
                } satisfies EditFilePayload);
          const mode = store.getSnapshot().mode;
          const view: LinkView = mode === 'nodes' ? 'node' : mode === 'blocks' ? 'block' : 'code';
          const value = await encodeEditLink(payload, baseURL, config, { view });
          assertCurrent(project);
          notify('Open in IDE link generated');
          return {
            title: kind === 'editFile' ? 'Open file in IDE' : 'Open project in IDE',
            value,
            image: false,
            editLink: true,
          };
        }
        const input = await buildFile(project.active),
          params = walletParameters(input, options, baseURL);
        if (kind === 'json') {
          download('output.gcscript', input, 'application/json', config.timing.downloadRevoke);
          notify('Built JSON downloaded');
          return null;
        }
        if (kind === 'url') {
          const value = await gc.encode.url(params);
          assertCurrent(project);
          notify('Wallet URL generated');
          return { title: 'Wallet URL', value, image: false };
        }
        if (kind === 'qr') {
          const value = await gc.encode.qr({ ...params, qrResultType: 'png' });
          assertCurrent(project);
          notify('Wallet QR generated');
          return { title: 'QR code', value, image: true };
        }
        if (kind === 'urlQueryParams') {
          const url = await gc.encode.url(params);
          const value = JSON.stringify(Object.fromEntries(new URL(url).searchParams), null, 2);
          assertCurrent(project);
          notify('URL parameters generated');
          return { title: 'URL parameters', value: String(value), image: false };
        }
        if (!(kind in gc.snippet)) throw Error('Unsupported snippet format: ' + kind);
        const handler = gc.snippet[kind as keyof typeof gc.snippet];
        const output = await handler(params);
        assertCurrent(project);
        const text = output.startsWith('data:') ? dataURIText(output) : output;
        download(
          kind + '-snippet.' + (kind === 'express' ? 'js' : kind === 'react' ? 'html' : 'html'),
          text,
          'text/plain',
          config.timing.downloadRevoke,
        );
        notify('Snippet downloaded');
        return null;
      } catch (error) {
        notify('Generation: ' + errorMessage(error), true);
        throw error;
      }
    },
    answerPrompt(value) {
      const resolve = resolvePrompt;
      resolvePrompt = undefined;
      store.update((state) => ({ ...state, prompt: null }));
      resolve?.(value);
    },
    async closeProject() {
      if (await saveBeforeOpening()) {
        openProject(createProject(config, createCorrelationId()));
        notify('Project closed; new workspace created');
      }
    },
    async importEditLink(href) {
      const encoded = readStudioLaunch(href, baseURL, config).encoded;
      if (encoded === null) return;
      const snapshot = store.getSnapshot().project;
      try {
        if (importing) throw Error('Finish the current import first.');
        const imported = await decodeEditLink(encoded, config);
        assertCurrent(snapshot);
        if (launch.embedded) {
          let project =
            imported.kind === 'project'
              ? imported.project
              : put(
                  {
                    ...createProject(config, createCorrelationId()),
                    files: {},
                    dirs: [],
                    active: imported.path,
                  },
                  imported.path,
                  imported.file,
                );
          project = { ...project, id: createCorrelationId() };
          openProject(project);
          // An explicit embedded link replaces only the isolated embedded workspace, even after a version gate.
          if (store.getSnapshot().persistenceError)
            store.update((state) => ({ ...state, persistenceError: '' }));
          notify('Opened IDE link in embedded workspace');
        } else if (imported.kind === 'project') {
          await controller.importProjectFile(
            new File([JSON.stringify(imported.project)], 'project.json'),
          );
        } else {
          await controller.importFiles([
            new File([Uint8Array.from(fileBytes(imported.file)).buffer], imported.path),
          ]);
        }
      } catch (error) {
        notify('Open in IDE: ' + errorMessage(error), true);
      }
    },
    async importProjectFile(file) {
      if (importing) {
        notify('Finish the current import first.', true);
        return;
      }
      importing = true;
      const snapshot = store.getSnapshot().project;
      try {
        const project = parseProject(JSON.parse(await file.text()), config.version);
        if (!(await saveBeforeOpening())) return;
        assertCurrent(snapshot);
        openProject({ ...project, id: createCorrelationId() });
        notify('Opened saved project');
      } catch (error) {
        notify('Import: ' + errorMessage(error), true);
      } finally {
        importing = false;
      }
    },
    async importFiles(files, folder = '') {
      if (importing) {
        notify('Finish the current import first.', true);
        return;
      }
      const list = Array.from(files);
      if (!list.length) return;
      if (list.length === 1 && /\.json$/i.test(list[0]!.name)) {
        try {
          const value: unknown = JSON.parse(await list[0]!.text());
          if (
            isRecord(value) &&
            typeof value.version === 'string' &&
            typeof value.id === 'string' &&
            typeof value.active === 'string' &&
            typeof value.revision === 'number' &&
            isRecord(value.files) &&
            Array.isArray(value.dirs)
          ) {
            await controller.importProjectFile(list[0]!);
            return;
          }
        } catch {
          /* Ordinary JSON is imported as a file; saved projects validate below. */
        }
      }
      importing = true;
      const snapshot = store.getSnapshot().project;
      try {
        const imported = await readImports(list);
        assertCurrent(snapshot);
        const archive = list.some((file) => /\.(zip|tar\.gz|tgz)$/i.test(file.name));
        const choice =
          archive && !folder
            ? 'new'
            : await choose(
                'Import ' + (list.length === 1 ? 'file' : 'files'),
                'Add to the current project, or open as a new project?',
                [
                  { value: 'current', label: 'Import into current project' },
                  { value: 'new', label: 'Open as new project' },
                  { value: 'cancel', label: 'Cancel' },
                ],
              );
        if (choice === 'cancel') return;
        if (choice === 'new' && !(await saveBeforeOpening())) return;
        assertCurrent(snapshot);
        const conflicts =
          choice === 'current'
            ? Object.keys(imported).filter((key) =>
                Object.hasOwn(snapshot.files, (folder ? folder + '/' : '') + key),
              )
            : [];
        if (
          conflicts.length &&
          (await choose('Replace existing files?', conflicts.join(', '), [
            { value: 'replace', label: 'Replace these files' },
            { value: 'cancel', label: 'Cancel' },
          ])) !== 'replace'
        )
          return;
        assertCurrent(snapshot);
        const empty = {
          ...createProject(config, createCorrelationId()),
          files: {},
          dirs: [],
          active: '',
        };
        let project = importGCFiles(
          choice === 'new' ? empty : snapshot,
          imported,
          choice === 'new' ? '' : folder,
          config,
        );
        const importedKey = Object.keys(imported).find(
          (key) => !key.endsWith(config.project.marker),
        );
        if (importedKey)
          project = {
            ...project,
            active: (choice === 'new' || !folder ? '' : folder + '/') + importedKey,
          };
        if (choice === 'new') openProject(project, true);
        else
          store.update((state) => ({
            ...state,
            project,
            selectedFile: project.active,
            selection: [],
            report: null,
            diagnostics: null,
          }));
        notify('Imported ' + Object.keys(imported).length + ' file(s)');
      } catch (error) {
        notify('Import: ' + errorMessage(error), true);
      } finally {
        importing = false;
      }
    },
    exportFile() {
      const { project, selectedFile } = store.getSnapshot();
      const key = Object.hasOwn(project.files, selectedFile) ? selectedFile : project.active;
      const file = project.files[key];
      if (!file) {
        notify('Select a file to export', true);
        return;
      }
      download(
        name(key),
        fileBytes(file),
        file.encoding === 'utf8' ? 'text/plain' : 'application/octet-stream',
        config.timing.downloadRevoke,
      );
      notify('Exported /' + key);
    },
    exportProject(format) {
      const { project } = store.getSnapshot();
      if (format === 'json') {
        download(
          'gcscript-project.json',
          JSON.stringify(project, null, 2),
          'application/json',
          config.timing.downloadRevoke,
        );
        return;
      }
      const files = archiveFiles(project, config.project.marker);
      downloadURI(
        'gcscript-project.' + format,
        format === 'zip'
          ? gc.utils.virtualFileSystemToZip(files)
          : gc.utils.virtualFileSystemToTarGz(files),
      );
      notify('Project archive downloaded');
    },
    async importResult(text) {
      const project = store.getSnapshot().project;
      const result = await decodeResult(text);
      assertCurrent(project);
      const resultSource = resultText(result);
      mutateProject((current) =>
        put(
          current,
          store.getSnapshot().options.resultsPath,
          { text: resultSource, encoding: 'utf8' },
          true,
        ),
      );
      notify('Wallet result imported');
    },
    addFunction(name) {
      const { project } = store.getSnapshot(),
        fn = schema().catalog.byName[name];
      if (!fn) return;
      const file = project.files[project.active];
      if (!file || !isGCScript(project.active)) {
        notify('Open a GCScript file to add a function', true);
        return;
      }
      try {
        const document = parseJSONC(file.text);
        let selected = store.getSnapshot().selection;
        while (
          selected.length &&
          (!isObject(getAt(document, selected)) ||
            getAt(document, [...selected, 'type']) !== 'script')
        )
          selected = selected.slice(0, -1);
        const owner = getAt(document, selected);
        if (!isObject(owner) || owner.type !== 'script')
          throw Error('Select a script with a run collection');
        const run = owner.run;
        const next = blankFunction(fn, schema().authoring);
        if (Array.isArray(run))
          controller.editFile(
            patchJSONC(file.text, [...selected, 'run', run.length], next),
            project.active,
          );
        else {
          const entries = isObject(run) ? run : {};
          let key = name.replace(/^\$/, ''),
            i = 2;
          while (Object.hasOwn(entries, key)) key = name.replace(/^\$/, '') + i++;
          controller.editFile(
            patchJSONC(file.text, [...selected, 'run', key], next),
            project.active,
          );
        }
        notify('Added ' + name);
      } catch (error) {
        notify(errorMessage(error), true);
      }
    },
    reset() {
      localStorage.removeItem(config.storage.project);
      store.update((state) => ({
        ...initialState(
          createProject(config, createCorrelationId()),
          config,
          innerWidth <= config.layout.mobileBreakpoint,
        ),
        schema: state.schema,
        embedded: launch.embedded,
        mode: launch.mode ?? 'code',
        layout: launch.embedded
          ? { ...initial.layout, explorer: false, inspector: false }
          : initial.layout,
        persistenceError: '',
      }));
      notify('New project created');
    },
    dispose() {
      resolvePrompt?.('cancel');
      resolvePrompt = undefined;
      disposed = true;
      schemaRevision++;
      stopPersistence();
      stopValidation();
      validation.dispose();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
    },
  };
  return controller;
}
