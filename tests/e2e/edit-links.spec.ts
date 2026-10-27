import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import gc from '@gamechanger-finance/gc/dist/browser.js';

async function link(baseURL: string, payload: unknown, query = ''): Promise<string> {
  const url = await gc.encode.url({
    input: JSON.stringify(payload),
    apiVersion: '2',
    network: 'preprod',
    encoding: 'gzip',
    disableNetworkRouter: true,
    urlPattern: new URL(
      'api/2/edit/{gcscript}',
      baseURL.endsWith('/') ? baseURL : baseURL + '/',
    ).href.replace('%7Bgcscript%7D', '{gcscript}'),
  });
  return url + query;
}
test.beforeEach(async ({ page }) => {
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({
      body: readFileSync('tests/fixtures/runtime-schema.json', 'utf8'),
      contentType: 'application/json',
    }),
  );
});
async function normalProject(page: import('@playwright/test').Page) {
  await page.goto('./');
  const editor = page.getByRole('textbox', { name: 'Editor content' });
  await expect(editor).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() =>
    navigator.clipboard.writeText('{"type":"script","title":"Keep normal project","run":{}}'),
  );
  await editor.press('Control+A');
  await editor.press('Control+v');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gcscript-studio:project')))
    .toContain('Keep normal project');
  return page.evaluate(() => localStorage.getItem('gcscript-studio:project'));
}
test('embedded source import preserves JSONC and normal storage; generated links preserve source', async ({
  page,
  baseURL,
}) => {
  const normal = await normalProject(page);
  const source =
    '// preserved comment\n{"type":"script","title":"Embedded sample","run":{"address":{"type":"getCurrentAddress"}},}\n';
  await page.goto(
    await link(
      baseURL!,
      {
        format: 'gcscript-studio-file',
        version: 1,
        path: 'src/demo.gcscript',
        file: { text: source, encoding: 'utf8' },
      },
      '?embed=true&view=code',
    ),
  );
  await expect(page.locator('.studio-embedded')).toBeVisible();
  await expect(page.locator('.view-lines')).toContainText('Embedded sample');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.side')).toBeHidden();
  await expect(page.locator('.right')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('gcscript-studio:project'))).toBe(normal);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('embed:gcscript-studio:project')!).project.files[
          'src/demo.gcscript'
        ].text,
    ),
  ).toBe(source);
  await page.getByText('Output', { exact: true }).click();
  await page.getByRole('button', { name: 'IDE file link', exact: true }).click();
  const output = page.getByRole('textbox', { name: 'Generated output' });
  await expect(output).toBeVisible();
  const url = new URL(await output.inputValue());
  expect(await gc.encodings.msg.decoder(url.pathname.split('/').at(-1)!)).toMatchObject({
    file: { text: source },
  });
  await page.getByLabel('Embedded mode (compact editor, separate workspace)').check();
  await expect(output).toHaveValue(/embed=true/);
});

test('normal edit links retain add/replace prompts and cancellation preserves work', async ({
  page,
  baseURL,
}) => {
  await normalProject(page);
  const script = { type: 'script', title: 'Imported through GC codec', run: {} };
  await page.goto(await link(baseURL!, script));
  await expect(page.getByRole('heading', { name: 'Import file', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('Keep normal project');
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gcscript-studio:project')!).project,
  );
  await page.goto(
    await link(baseURL!, {
      ...saved,
      id: 'shared-project',
      files: { 'main.gcscript': { text: JSON.stringify(script), encoding: 'utf8' } },
    }),
  );
  await expect(
    page.getByRole('heading', { name: 'Save current project?', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.view-lines')).toContainText('Keep normal project');
});

test('iframe uses the requested block and node views with compact geometry and full projects', async ({
  page,
  baseURL,
}) => {
  const project = {
    version: '0.1.0',
    id: 'shared',
    revision: 0,
    active: 'main.gcscript',
    dirs: ['empty'],
    files: {
      'main.gcscript': {
        text: '{"type":"script","run":{"name":{"type":"getName"}}}',
        encoding: 'utf8',
      },
      'notes.txt': { text: 'Project companion', encoding: 'utf8' },
    },
  };
  for (const view of ['block', 'node']) {
    const url = await link(baseURL!, project, '?embed=true&view=' + view);
    await page.route('**/iframe-test-host', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body:
          '<!doctype html><html><body style="margin:0"><iframe title="Embedded IDE" style="width:100%;height:500px;border:0" src="' +
          url.replaceAll('&', '&amp;') +
          '"></iframe></body></html>',
      }),
    );
    await page.setViewportSize({ width: 760, height: 540 });
    await page.goto(new URL('iframe-test-host', baseURL).href);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('.studio-embedded')).toBeVisible();
    await expect(
      frame.getByRole('button', { name: view === 'block' ? 'Blocks' : 'Nodes', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      frame
        .locator(
          view === 'block'
            ? '.blocksbox:not(.hidden) .blocklySvg'
            : '.graphbox:not(.hidden) gc-scope-card',
        )
        .first(),
    ).toBeVisible();
    await expect(frame.getByRole('dialog')).toHaveCount(0);
    const geometry = await frame.locator('body').evaluate((body) => ({
      width: body.clientWidth,
      scroll: body.scrollWidth,
      editor: body.querySelector('.editor-container')!.getBoundingClientRect().height,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    expect(geometry.editor).toBeGreaterThan(390);
    await page.screenshot({ path: '/tmp/studio-embed-' + view + '.png' });
    expect(
      await frame
        .locator('body')
        .evaluate(
          () => JSON.parse(localStorage.getItem('embed:gcscript-studio:project')!).project.dirs,
        ),
    ).toContain('empty');
  }
  await page.setViewportSize({ width: 360, height: 540 });
  const mobile = await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate((body) => ({
      width: body.clientWidth,
      scroll: body.scrollWidth,
      editor: body.querySelector('.editor-container')!.getBoundingClientRect().height,
      toolbar: body.querySelector('.topbar')!.getBoundingClientRect().height,
    }));
  expect(mobile.scroll).toBeLessThanOrEqual(mobile.width);
  expect(mobile.toolbar).toBeLessThanOrEqual(50);
  expect(mobile.editor).toBeGreaterThan(390);
  await page.screenshot({ path: '/tmp/studio-embed-mobile.png' });
});
