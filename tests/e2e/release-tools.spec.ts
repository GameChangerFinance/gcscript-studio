import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import gc from '@gamechanger-finance/gc/dist/browser.js';

test.beforeEach(async ({ page }) => {
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({
      body: readFileSync('tests/fixtures/runtime-schema.json', 'utf8'),
      contentType: 'application/json',
    }),
  );
});
async function projectLink(base: string, project: unknown) {
  return gc.encode.url({
    input: JSON.stringify(project),
    apiVersion: '2',
    network: 'preprod',
    encoding: 'gzip',
    disableNetworkRouter: true,
    urlPattern: new URL('api/2/edit/{gcscript}', base.replace(/\/?$/, '/')).href.replace(
      '%7Bgcscript%7D',
      '{gcscript}',
    ),
  });
}

test('embedded fullscreen toggles and new-tab link preserves the entire current project', async ({
  page,
  context,
  baseURL,
}) => {
  const project = {
    version: '0.1.0',
    id: 'docs',
    revision: 0,
    active: 'main.gcscript',
    dirs: ['empty'],
    files: {
      'main.gcscript': {
        encoding: 'utf8',
        text: '{"type":"script","title":"Docs project","run":{}}',
      },
      'data.txt': { encoding: 'utf8', text: 'Keep my extra file' },
    },
  };
  const url = await projectLink(baseURL!, project);
  await page.route('**/fullscreen-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe title="Studio" allow="fullscreen" allowfullscreen src="${url}?embed=true&view=block" style="width:100%;height:650px;border:0"></iframe>`,
    }),
  );
  await page.goto(new URL('fullscreen-host', baseURL!.replace(/\/?$/, '/')).href);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('.blocklySvg')).toBeVisible();
  const blockBounds = () =>
    frame.locator('.blocks-host').evaluate((host) => {
      const root = host.querySelector('.blocklyBlockCanvas > g[data-id]')!.getBoundingClientRect();
      const viewport = host.getBoundingClientRect();
      return Math.min(
        root.left - viewport.left,
        viewport.right - root.right,
        root.top - viewport.top,
        viewport.bottom - root.bottom,
      );
    });
  await expect.poll(blockBounds).toBeGreaterThanOrEqual(-2);
  const enter = frame.getByRole('button', { name: 'Enter fullscreen', exact: true });
  await enter.click();
  await expect(frame.getByRole('button', { name: 'Exit fullscreen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await frame.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(enter).toHaveAttribute('aria-pressed', 'false');
  const link = frame.getByRole('link', { name: 'Open current project in a new tab' });
  await expect(link).toHaveAttribute('href', /api\/2\/edit\//);
  const href = new URL((await link.getAttribute('href'))!);
  expect(href.searchParams.has('embed')).toBe(false);
  expect(href.searchParams.get('view')).toBe('block');
  const decoded = await gc.encodings.msg.decoder(href.pathname.split('/').at(-1)!);
  expect(decoded.files['data.txt'].text).toBe('Keep my extra file');
  expect(decoded.dirs).toContain('empty');
  await context.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({
      body: readFileSync('tests/fixtures/runtime-schema.json', 'utf8'),
      contentType: 'application/json',
    }),
  );
  const pending = context.waitForEvent('page');
  await link.click();
  const full = await pending;
  await expect(full.locator('.studio')).toBeVisible();
  await expect(full.locator('.studio-embedded')).toHaveCount(0);
  await expect(full.getByRole('heading', { name: 'Save current project?' })).toBeVisible();
  await full.getByRole('button', { name: 'Continue without saving' }).click();
  await expect(full.getByRole('button', { name: 'Blocks', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await full.close();
  await frame.getByRole('button', { name: 'Fit blocks', exact: true }).click();
  const geometry = await frame.locator('.blocks-host').evaluate((host) => {
    const block = host.querySelector('.blocklyBlockCanvas > g[data-id]')!.getBoundingClientRect();
    const viewport = host.getBoundingClientRect();
    return {
      left: block.left - viewport.left,
      right: viewport.right - block.right,
      top: block.top - viewport.top,
      bottom: viewport.bottom - block.bottom,
    };
  });
  expect(Math.min(...Object.values(geometry))).toBeGreaterThanOrEqual(-2);
  await page.screenshot({ path: '/tmp/studio-release-embedded.png' });
});

test('network dropup shares Options state and outputs advertise complete dapp generation', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change network' })).toBeVisible();
  await page.getByText('Output', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '1-click dapp code generation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'React dapp', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change network' }).click();
  await expect(page.getByRole('heading', { name: '1-click dapp code generation' })).toBeHidden();
  await page.getByRole('button', { name: 'Cardano Mainnet', exact: true }).click();
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await expect(page.getByLabel('Network', { exact: true })).toHaveValue('mainnet');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByText('Output', { exact: true }).click();
  await page.getByRole('button', { name: 'Wallet URL', exact: true }).click();
  const output = await page.getByRole('textbox', { name: 'Generated output' }).inputValue();
  expect(new URL(output).searchParams.get('networkTag')).toBe('mainnet');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByText('Output', { exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'HTML + JavaScript dapp', exact: true }).click();
  expect((await pending).suggestedFilename()).toBe('html-dapp.html');
  await page.reload();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change network' })).toContainText(
    'Cardano Mainnet',
  );
  await page.screenshot({ path: '/tmp/studio-release-desktop.png' });
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.locator('.network-toggle .network-dlt')).toBeHidden();
  expect(await page.locator('.network-toggle').innerText()).not.toContain('Cardano');
  await page.getByRole('button', { name: 'Change network' }).click();
  await expect(
    page.getByRole('button', { name: 'Pre-Production Testnet', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '/tmp/studio-release-network-mobile.png' });
});

test('URL and pasted payload imports retain save choices and never render imported HTML', async ({
  page,
  baseURL,
}) => {
  await page.goto('./');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByText('Import', { exact: true }).click();
  await expect(page.locator('.studio-menu[open] input, .studio-menu[open] textarea')).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Open from payload…', exact: true }).click();
  const sourceDialog = page.getByRole('dialog', { name: 'Open from payload', exact: true });
  const payloadInput = sourceDialog.getByLabel('GC compressed payload or project/script JSON');
  await payloadInput.fill('invalid-payload');
  await sourceDialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(sourceDialog.getByRole('alert')).toBeVisible();
  await expect(payloadInput).toHaveValue('invalid-payload');
  await expect(payloadInput).toHaveAttribute('spellcheck', 'false');
  await page.setViewportSize({ width: 390, height: 740 });
  const bounds = await sourceDialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  await page.screenshot({ path: '/tmp/studio-import-payload-modal.png' });
  await sourceDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sourceDialog).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('https://docs.test/external.gcscript', (route) =>
    route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      body: '{"type":"script","title":"<img src=x onerror=window.xss=1>","run":{}}',
    }),
  );
  await page.getByText('Import', { exact: true }).click();
  await page.getByRole('button', { name: 'Open from URL…', exact: true }).click();
  await page
    .getByLabel('File, project or GC link URL', { exact: true })
    .fill('https://docs.test/external.gcscript');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Import into current project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 1 file' })).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, 'xss'))).toBe(false);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByText('Import', { exact: true }).click();
  const url = await projectLink(baseURL!, { type: 'script', title: 'Payload import', run: {} });
  await page.getByRole('button', { name: 'Open from payload…', exact: true }).click();
  await page
    .getByLabel('GC compressed payload or project/script JSON')
    .fill(new URL(url).pathname.split('/').at(-1)!);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Open as new project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save current project?' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Save current project?', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => Object.hasOwn(window, 'xss'))).toBe(false);
});
