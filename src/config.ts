/** Serializable application policy. Consumers await getConfig() at their composition root. */
export interface StudioOptions {
  schemaUrl: string;
  walletUrl: string;
  refAddress: string;
  examplesRepo: string;
  examplesBranch: string;
  examplesPath: string;
  network: 'preprod' | 'mainnet';
  runMode: 'popup' | 'redirect' | 'qr';
  disableNetworkRouter: boolean;
  codeTooltips: boolean;
  mergeResults: boolean;
  theme: 'dark' | 'light';
  splitView: 'blocks' | 'nodes';
  islDisplay: 'text' | 'blocks';
  nodeChildrenLimit: number;
  syntaxHighlighting: boolean;
  debugMode: boolean;
  compactOutput: boolean;
  autosave: boolean;
  entryFile: string;
  outputPath: string;
  resultsPath: string;
}
export type LanguageCategory = 'gcscript' | 'extras' | 'isl' | 'json' | 'user-defined';
export interface StudioConfig {
  version: string;
  defaults: StudioOptions;
  fixedEditorOptions: Pick<StudioOptions, 'autosave' | 'syntaxHighlighting' | 'debugMode'>;
  extrasUrl: string;
  schemaCacheMaxAge: number;
  history: { limit: number; typingGroupMs: number };
  examples: { name: string; title: string; description: string }[];
  schemaNamespace: string;
  storage: { project: string; options: string; schemas: string; run: string; result: string };
  editLinks: {
    route: string;
    embeddedStoragePrefix: string;
    maxEncodedCharacters: number;
    maxDecodedBytes: number;
  };
  colors: {
    functions: Record<string, string>;
    categories: Record<LanguageCategory, string>;
    key: string;
    symbol: string;
  };
  limits: {
    syntaxCharacters: number;
    syntaxNodes: number;
    decorations: number;
    docDepth: number;
    docNodes: number;
    docCharacters: number;
    archiveBytes: number;
    logEntries: number;
  };
  timing: {
    editorDebounce: number;
    blocksDebounce: number;
    syntaxDebounce: number;
    downloadRevoke: number;
    tooltipDelay: number;
    validationDebounce: number;
    validationInterval: number;
  };
  layout: { left: number; right: number; code: number; mobileBreakpoint: number };
  wallet: { popupFeatures: string; popupName: string; pendingMaxAge: number };
  project: { marker: string; initialFile: string; source: string };
  snippets: string[];
  docsUrl: string;
}

const FIXED_EDITOR_OPTIONS = { autosave: true, syntaxHighlighting: true, debugMode: false };

/** Defaults are cloned on load: editor changes never mutate shared configuration. */
export const DEFAULT_CONFIG: StudioConfig = {
  version: '0.1.0',
  fixedEditorOptions: FIXED_EDITOR_OPTIONS,
  defaults: {
    ...FIXED_EDITOR_OPTIONS,
    schemaUrl: 'https://wallet.gamechanger.finance/schema/api/v2/index.json.full',
    walletUrl: 'https://wallet.gamechanger.finance/api/2/run/{gcscript}',
    refAddress: '',
    examplesRepo: 'GameChangerFinance/gamechanger.wallet',
    examplesBranch: 'main',
    examplesPath: 'examples',
    network: 'preprod',
    runMode: 'popup',
    disableNetworkRouter: false,
    codeTooltips: true,
    mergeResults: true,
    theme: 'dark',
    splitView: 'blocks',
    islDisplay: 'text',
    nodeChildrenLimit: 100,
    compactOutput: false,
    entryFile: 'main.gcscript',
    outputPath: 'build/output.gcscript',
    resultsPath: 'results/result.json',
  },
  extrasUrl: 'extras.json.full',
  // GC CLI 1.2.4 config.GCScriptSchemaCacheTTLHours = 24.
  schemaCacheMaxAge: 24 * 60 * 60 * 1000,
  history: { limit: 200, typingGroupMs: 500 },
  examples: [
    {
      name: 'project.zip',
      title: 'Multi-file project',
      description: 'Build a project with reusable GCScript and data imports.',
    },
    {
      name: 'example.gcscript',
      title: 'Single GCScript',
      description: 'Read your current address and return named exports.',
    },
  ],
  schemaNamespace: 'https://gcscript-studio.invalid/schemas/',
  storage: {
    project: 'gcscript-studio:project',
    options: 'gcscript-studio:options',
    schemas: 'gcscript-studio:schema:',
    run: 'gcscript-studio:run',
    result: 'gcscript-studio:result',
  },
  editLinks: {
    route: 'api/2/edit/',
    embeddedStoragePrefix: 'embed:',
    maxEncodedCharacters: 2 * 1024 * 1024,
    maxDecodedBytes: 8 * 1024 * 1024,
  },
  colors: {
    functions: {
      script: '#74e4d0',
      importAsScript: '#74e4d0',
      importAsData: '#74e4d0',
      $importAsScript: '#bb9aff',
      $importAsData: '#bb9aff',
    },
    categories: {
      gcscript: '#74e4d0',
      extras: '#bb9aff',
      isl: '#fc88c2',
      json: '#9bdfa1',
      'user-defined': '#e59a6c',
    },
    key: '#8ab9ff',
    symbol: '#ffb765',
  },
  limits: {
    syntaxCharacters: 140000,
    syntaxNodes: 4500,
    decorations: 1600,
    docDepth: 8,
    docNodes: 100,
    docCharacters: 28000,
    archiveBytes: 64 * 1024 * 1024,
    logEntries: 70,
  },
  timing: {
    editorDebounce: 150,
    blocksDebounce: 300,
    syntaxDebounce: 420,
    downloadRevoke: 1500,
    tooltipDelay: 350,
    validationDebounce: 900,
    validationInterval: 15000,
  },
  layout: { left: 266, right: 310, code: 50, mobileBreakpoint: 850 },
  wallet: {
    popupName: 'gcscript_studio_wallet',
    popupFeatures: 'popup=yes,width=550,height=780',
    pendingMaxAge: 60 * 60 * 1000,
  },
  project: {
    marker: '.gcstudio-empty-directory',
    initialFile: 'main.gcscript',
    source:
      '{\n  "type": "script",\n  "title": "My GCScript project",\n  "exportAs": "myExports",\n  "run": {\n    // Named steps execute in source order.\n    "myAddress": { "type": "getCurrentAddress" }\n  }\n}\n',
  },
  snippets: ['url', 'qr', 'urlQueryParams', 'html', 'html-zero', 'react', 'button', 'express'],
  docsUrl: 'https://wallet.gamechanger.finance/doc/api/v2/',
};

/** Async boundary permits a future remote configuration provider without changing callers. */
export async function getConfig(): Promise<StudioConfig> {
  return structuredClone(DEFAULT_CONFIG);
}

/** One policy shared by Blockly, Monaco, catalog badges and graph cards. */
export function languageColor(
  config: StudioConfig,
  name: string,
  category: LanguageCategory,
): string {
  return config.colors.functions[name] ?? config.colors.categories[category];
}
