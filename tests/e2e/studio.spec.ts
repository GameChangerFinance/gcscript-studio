import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const schema = readFileSync(
  new URL('../../tests/fixtures/runtime-schema.json', import.meta.url),
  'utf8',
);
async function boot(page: Page) {
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({ body: schema, contentType: 'application/json' }),
  );
  await page.goto('./');
  await expect(page.getByRole('status').filter({ hasText: 'Schema ready' })).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
}
test('code, build, validation, output and binary import work with local bundles', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await page.getByRole('textbox', { name: 'Editor content' }).press('Control+End');
  await page.keyboard.insertText('\n// Editor typing is retained');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText(
    'Editor typing is retained',
  );
  await page.screenshot({ path: 'test-results/studio-desktop-code.png' });
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Built /build/output.gcscript' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'output.gcscript', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByRole('heading', { name: '✓ Valid GCScript' })).toBeVisible();
  await page.getByText('Output', { exact: true }).click();
  await page.getByRole('button', { name: 'Wallet URL', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet URL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Generated output' })).toHaveValue(
    /^https:\/\/wallet\.gamechanger\.finance\/api\/2\/run\//,
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('input[aria-label="Import project files"]').setInputFiles({
    name: 'binary.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 255, 128]),
  });
  await page.getByRole('button', { name: 'Import into current project', exact: true }).click();
  await page.getByRole('button', { name: 'binary.bin' }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
test('schema extensions populate Blocks, syntax decorations and inspector without losing source', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await page.getByRole('button', { name: 'Functions', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add $importAsData to current script', exact: true })
    .click();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('$importAsData');
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await expect(page.locator('.blocklyToolbox')).toContainText('GCScript DSL');
  await expect(page.locator('.blocklyToolbox')).toContainText('Extras · Build stage');
  await expect(page.locator('.blocklyToolbox')).toContainText('ISL');
  await page.screenshot({ path: 'test-results/studio-blocks.png' });
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('$importAsData');
  expect(errors).toEqual([]);
});
test('Rete scopes open and dispose cleanly across view switches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  await expect(page.locator('gc-scope-card')).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-nodes.png' });
  await expect(
    page.locator('gc-scope-card').getByText('getCurrentAddress', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  await expect(page.locator('gc-scope-card')).toBeVisible();
  expect(errors).toEqual([]);
});
test('cache is reused on reload and refresh decoration reloads schema and extras', async ({
  page,
}) => {
  let requests = 0,
    extrasRequests = 0;
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) => {
    requests++;
    return route.fulfill({ body: schema, contentType: 'application/json' });
  });
  page.on('request', (request) => {
    if (request.url().endsWith('extras.json.full')) extrasRequests++;
  });
  await page.goto('./');
  await expect(page.getByRole('status').filter({ hasText: 'Schema ready' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Schema ready' })).toBeVisible();
  expect(requests).toBe(1);
  expect(extrasRequests).toBe(1);
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await page.getByRole('button', { name: 'Clear and refresh schema and extras cache' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'cache cleared and refreshed' }),
  ).toBeVisible();
  expect(requests).toBe(2);
  expect(extrasRequests).toBe(2);
});
test('wallet launches directly in a popup and callbacks preserve the project', async ({
  page,
  context,
}) => {
  await boot(page);
  let walletURL = '';
  await context.route('https://wallet.gamechanger.finance/api/2/run/**', (route) => {
    walletURL = route.request().url();
    return route.fulfill({
      body: '<html><body>Wallet test endpoint</body></html>',
      contentType: 'text/html',
    });
  });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByText('Wallet test endpoint')).toBeVisible();
  expect(new URL(walletURL).searchParams.get('networkTag')).toBe('preprod');
  const resultURL = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('gcscript-studio:run:'));
    if (!key) throw Error('Missing run');
    const pending = JSON.parse(localStorage.getItem(key) ?? '{}');
    const callback = new URL('index.html', location.href);
    callback.search = '?result=' + encodeURIComponent(JSON.stringify({ exports: { answer: 42 } }));
    callback.hash = 'studioRun=' + pending.token;
    return callback.href;
  });
  await popup.goto(resultURL).catch(() => {});
  await expect(
    page.getByRole('status').filter({ hasText: 'Wallet exports captured' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'result.json' })).toBeVisible();
});
test('responsive layout and light modal stay in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  const dimensions = await page.evaluate(() => {
    const dialog = document.querySelector('dialog')?.getBoundingClientRect();
    return {
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
      top: dialog?.top ?? -1,
      bottom: dialog?.bottom ?? -1,
      height: innerHeight,
    };
  });
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
  await page.screenshot({ path: 'test-results/mobile-light-options.png' });
});

test('Blockly adapter round-trips full values and protects source edits', async ({ page }) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'Test-only harness is served by the development server',
  );
  await page.goto('/tests/e2e/block-harness.html');
  await expect(page.locator('#report')).not.toHaveText('Running…');
  const results = JSON.parse(await page.locator('#report').innerText());
  expect(results).toEqual({
    lossless: true,
    literalNotExecutable: true,
    colors: true,
    islContract: true,
    connectedArgumentProtected: true,
    commentPreserved: true,
    invalidSourceProtected: true,
    floatingUndo: true,
    floatingRedo: true,
    invalidSourceUsesSharedHistory: true,
  });
});

test('deep links preserve the deployment base and query when loading local assets', async ({
  page,
  baseURL,
}) => {
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({ body: schema, contentType: 'application/json' }),
  );
  await page.goto(
    new URL(
      'nested/editor?source=deep',
      (baseURL ?? 'http://127.0.0.1:5173') + ((baseURL ?? '').endsWith('/') ? '' : '/'),
    ).href,
  );
  await expect(page.getByRole('status').filter({ hasText: 'Schema ready' })).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('source')).toBe('deep');
});

test('QR output produces a rendered PNG from the built source', async ({ page }) => {
  await boot(page);
  await page.getByText('Output', { exact: true }).click();
  await page.getByRole('button', { name: 'QR code', exact: true }).click();
  const image = page.getByRole('img', { name: 'GCScript wallet QR' });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^data:image\/png/);
  expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(
    100,
  );
});

async function replaceSource(page: Page, source: string) {
  // Paste preformatted fixtures so a delayed format-on-paste does not race later import decisions.
  if (source) source = JSON.stringify(JSON.parse(source), null, 2);
  const editor = page.getByRole('textbox', { name: 'Editor content' });
  await editor.press('Control+A');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  if (source) await page.keyboard.press('Control+v');
  else await editor.press('Backspace');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('gcscript-studio:project') ?? '{}').project?.files[
            JSON.parse(localStorage.getItem('gcscript-studio:project') ?? '{}').project?.active
          ]?.text,
      ),
    )
    .toBe(source);
}
test('project menus are exclusive, import opens a picker, and selected file export preserves bytes', async ({
  page,
}) => {
  await boot(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.getByText('Import', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Files / ZIP / TAR.GZ', exact: true }),
  ).toBeVisible();
  await page.getByText('Export', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Files / ZIP / TAR.GZ', exact: true }),
  ).toBeHidden();
  await expect(page.locator('.studio-menu[open]')).toHaveCount(1);
  await page.getByText('Import', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Selected file', exact: true })).toBeHidden();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Files / ZIP / TAR.GZ', exact: true }).click();
  await (
    await picker
  ).setFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('exact content\n') });
  await page.getByRole('button', { name: 'Import into current project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'note.txt', exact: true })).toBeVisible();
  expect(downloads).toEqual([]);
  await page.getByText('Export', { exact: true }).click();
  const exporting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Selected file', exact: true }).click();
  const downloaded = await exporting;
  expect(downloaded.suggestedFilename()).toBe('note.txt');
  const stream = await downloaded.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe('exact content\n');
});
test('single-file and saved-project opening require a save decision and cancellation retains work', async ({
  page,
}) => {
  await boot(page);
  await replaceSource(page, '{"type":"script","title":"Unsaved work","run":{}}');
  const input = page.locator('input[aria-label="Import project files"]');
  await input.setInputFiles({
    name: 'other.gcscript',
    mimeType: 'application/json',
    buffer: Buffer.from('{"type":"script","run":{}}'),
  });
  await page.getByRole('button', { name: 'Open as new project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save current project?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('Unsaved work');
  await expect(page.getByRole('button', { name: 'other.gcscript', exact: true })).toHaveCount(0);
  await input.setInputFiles({
    name: 'other.gcscript',
    mimeType: 'application/json',
    buffer: Buffer.from('{"type":"script","run":{}}'),
  });
  await page.getByRole('button', { name: 'Open as new project', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project ZIP and continue', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('gcscript-project.zip');
  await expect(page.getByRole('button', { name: 'other.gcscript', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'main.gcscript', exact: true })).toHaveCount(0);
});
test('Examples showcases dynamically fetched project ZIP and single script through safe opening', async ({
  page,
}) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: { tree: [] } }));
  await boot(page);
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project.zip', exact: true })).toBeVisible();
  const request = page.waitForRequest('**/examples/example.gcscript');
  await page.getByRole('button', { name: 'Open example.gcscript', exact: true }).click();
  await request;
  await page.getByRole('button', { name: 'Import into current project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'example.gcscript', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  const zip = page.waitForRequest('**/examples/project.zip');
  await page.getByRole('button', { name: 'Open project.zip', exact: true }).click();
  await zip;
  await page.getByRole('button', { name: 'Continue without saving', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'main.gcscript.jsonc', exact: true }),
  ).toBeVisible();
});
test('undo and redo work across Monaco, function additions and inspector deletion', async ({
  page,
}) => {
  await boot(page);
  await replaceSource(page, '{"type":"script","run":{}}');
  await page.waitForTimeout(550);
  await page.getByRole('textbox', { name: 'Editor content' }).press('Control+End');
  await page.keyboard.insertText('\n// an undoable edit');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.view-lines')).not.toContainText('an undoable edit');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.view-lines')).toContainText('an undoable edit');
  await page.getByRole('button', { name: 'Functions', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add getCurrentAddress to current script', exact: true })
    .click();
  await expect(page.locator('.view-lines')).toContainText('getCurrentAddress');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.view-lines')).not.toContainText('getCurrentAddress');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.view-lines')).toContainText('getCurrentAddress');
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('.view-lines')).not.toContainText('getCurrentAddress');
});
test('Monaco hover is visible by default and Options can hide it; buttons have help', async ({
  page,
}) => {
  await boot(page);
  await replaceSource(page, '{\n  "type": "script",\n  "run": {}\n}');
  const type = page
    .locator('.view-line span')
    .filter({ hasText: /^"?script"?$/ })
    .last();
  await type.hover();
  await expect(page.locator('.monaco-hover').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-code-tooltip.png' });
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await expect(page.getByLabel('Show editor tooltips (Code, Nodes, Blocks)')).toBeChecked();
  await expect(
    page.getByLabel('Disable network router (use wallet current network)'),
  ).not.toBeChecked();
  await expect(page.getByLabel('Merge wallet results with existing objects')).toBeChecked();
  await page.getByLabel('Show editor tooltips (Code, Nodes, Blocks)').uncheck();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  await type.hover();
  await page.waitForTimeout(650);
  await expect(page.locator('.monaco-hover:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close project', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});
test('automatic validation highlights a typo and offers an exact Monaco quick fix', async ({
  page,
}) => {
  await boot(page);
  await replaceSource(
    page,
    '{\n "type":"script",\n "run":{"address":{"type":"getCurentAddress"}}\n}',
  );
  await expect(page.getByRole('button', { name: 'Show validation diagnostics' })).toContainText(
    '1 errors',
  );
  await page.getByRole('button', { name: 'Show validation diagnostics' }).click();
  await expect(page.locator('.problem')).toContainText('Did you mean "getCurrentAddress"');
  const typo = page
    .locator('.view-line span')
    .filter({ hasText: /^"?getCurentAddress"?$/ })
    .last();
  await typo.click();
  await page.keyboard.press('Control+.');
  await expect(page.getByText('Use "getCurrentAddress"', { exact: true })).toBeVisible();
  await page.getByText('Use "getCurrentAddress"', { exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('getCurrentAddress');
  await expect(page.getByRole('button', { name: 'Show validation diagnostics' })).toContainText(
    '0 errors',
  );
  await page.screenshot({ path: 'test-results/studio-diagnostics.png' });
});
test('native explorer drop imports data files without triggering downloads', async ({ page }) => {
  await boot(page);
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(['drop content'], 'dropped.txt', { type: 'text/plain' }));
    return value;
  });
  await page.locator('.explorer').dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByRole('button', { name: 'Import into current project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'dropped.txt', exact: true })).toBeVisible();
  expect(downloads).toEqual([]);
});

test('normal keyboard typing and clipboard paste preserve valid JSONC source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await replaceSource(page, '');
  await page
    .getByRole('textbox', { name: 'Editor content' })
    .pressSequentially('{"type":"script","run":{"address":{"type":"getCurrentAddress"}}}');
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByRole('heading', { name: '✓ Valid GCScript' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('Options retain all original preferences and Run honors the router opt-out', async ({
  page,
  context,
}) => {
  await boot(page);
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await page.getByLabel('Network', { exact: true }).selectOption('mainnet');
  await page
    .getByLabel('Referral address (optional)', { exact: true })
    .fill('addr_test1_configured');
  await page.getByLabel('Run mode', { exact: true }).selectOption('popup');
  await page.getByLabel('Disable network router (use wallet current network)').check();
  await page.getByLabel('ISL display in Blocks').selectOption('blocks');
  await page.getByLabel('Split view', { exact: true }).selectOption('nodes');
  await page.getByLabel('Maximum children per node scope').fill('37');
  await page.getByLabel('Built output path').fill('generated/output.gcscript');
  await page.getByLabel('Wallet result path').fill('responses/all.json');
  await page.getByLabel('GitHub examples repository').fill('GameChangerFinance/gamechanger.wallet');
  await page.getByLabel('GitHub branch').fill('main');
  await page.getByLabel('Examples directory').fill('examples');
  await page.getByLabel('Compact build output').check();
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  await page.reload();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  const options = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gcscript-studio:project')!).options,
  );
  expect(options).toMatchObject({
    network: 'mainnet',
    runMode: 'popup',
    disableNetworkRouter: true,
    refAddress: 'addr_test1_configured',
    islDisplay: 'blocks',
    splitView: 'nodes',
    nodeChildrenLimit: 37,
    outputPath: 'generated/output.gcscript',
    resultsPath: 'responses/all.json',
    compactOutput: true,
  });
  let wallet = '';
  await context.route('https://wallet.gamechanger.finance/api/2/run/**', (route) => {
    wallet = route.request().url();
    return route.fulfill({ body: 'Wallet opt-out endpoint' });
  });
  const launch = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const popup = await launch;
  await expect(popup.getByText('Wallet opt-out endpoint')).toBeVisible();
  expect(new URL(wallet).searchParams.has('networkTag')).toBe(false);
  expect(new URL(wallet).searchParams.get('ref')).toBe('addr_test1_configured');
});
test('redirect run returns to the IDE and captures results into the existing project', async ({
  page,
  context,
}) => {
  await boot(page);
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await page.getByLabel('Run mode', { exact: true }).selectOption('redirect');
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  const callback = await page.evaluate(() => new URL('index.html', location.href).href);
  await context.route('https://wallet.gamechanger.finance/api/2/run/**', (route) =>
    route.fulfill({ body: 'Redirect wallet endpoint' }),
  );
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('Redirect wallet endpoint')).toBeVisible();
  await page.goto(callback);
  const token = await page.evaluate(() =>
    Object.keys(localStorage)
      .find((key) => key.startsWith('gcscript-studio:run:'))
      ?.split(':')
      .at(-1),
  );
  await page.goto(
    callback +
      '?result=' +
      encodeURIComponent(JSON.stringify({ redirectExport: { answer: 42 } })) +
      '#studioRun=' +
      token,
  );
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'result.json', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('gcscript-studio:project') ?? '{}').project?.files[
            'results/result.json'
          ].text,
      ),
    )
    .toContain('redirectExport');
});
test('Blockly field edits and inspector deletion participate in shared undo and redo', async ({
  page,
}) => {
  await boot(page);
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await page
    .locator('.blocklyText')
    .filter({ hasText: /^My\sGCScript\sproject$/ })
    .dblclick();
  const field = page.locator('.blocklyHtmlInput');
  await field.fill('Edited in Blocks');
  await field.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('gcscript-studio:project') ?? '{}').project?.files[
            'main.gcscript'
          ]?.text,
      ),
    )
    .toContain('Edited in Blocks');
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('My GCScript project');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.view-lines')).toContainText('Edited in Blocks');
  await page.getByRole('button', { name: 'root', exact: true }).click();
  await page.getByRole('button', { name: 'title ↗', exact: true }).click();
  await page.getByRole('button', { name: 'Delete selected value', exact: true }).click();
  await expect(page.locator('.view-lines')).not.toContainText('Edited in Blocks');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.view-lines')).toContainText('Edited in Blocks');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.view-lines')).not.toContainText('Edited in Blocks');
});

test('Split view can undo and redo invalid source while Blocks retains its last valid projection', async ({
  page,
}) => {
  await boot(page);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.blocklySvg').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Editor content' }).press('Control+End');
  await page.keyboard.insertText('invalid');
  await expect(page.locator('.blocks-status')).toContainText('retain last valid JSONC');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.view-lines')).not.toContainText('invalid');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.view-lines')).toContainText('invalid');
});

test('removed editor preferences stay enabled when loading older saved settings', async ({
  page,
}) => {
  await boot(page);
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await expect(page.getByLabel('Enhanced syntax highlighting', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Debug syntax timing in console')).toHaveCount(0);
  await expect(page.getByLabel('Autosave project in this browser')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  await page.evaluate(() => {
    const key = 'gcscript-studio:options';
    const saved = JSON.parse(localStorage.getItem(key)!);
    Object.assign(saved.options, { autosave: false, syntaxHighlighting: false, debugMode: true });
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('gcscript-studio:options')!).options),
  ).toMatchObject({ autosave: true, syntaxHighlighting: true, debugMode: false });
});
