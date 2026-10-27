import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('rich ISL help, opaque menus, global tooltip preference and editor toolbar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({
      body: readFileSync('tests/fixtures/runtime-schema.json', 'utf8'),
      contentType: 'application/json',
    }),
  );
  await page.goto('./');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  const source = JSON.stringify(
    {
      type: 'script',
      run: {
        build: {
          type: 'buildTx',
          returnURLPattern: "{get('args.return-URL')}",
          tx: {
            outputs: {
              payment: {
                address: "{get('args.address')}",
                assets: [
                  {
                    policyId: 'ada',
                    assetName: 'ada',
                    quantity: "{mulBigNum(get('args.quantity'),get('args.decimals'))}",
                  },
                ],
              },
            },
          },
        },
      },
    },
    null,
    2,
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.getByRole('textbox', { name: 'Editor content' }).press('Control+A');
  await page.keyboard.press('Control+v');
  const call = (name: string) =>
    page
      .locator('.view-line span')
      .filter({ hasText: new RegExp('^' + name + '$') })
      .first();
  await call('get').hover();
  await expect(page.locator('.monaco-hover:visible')).toContainText('arbitrary data');
  await expect(page.locator('.monaco-hover:visible .monaco-tokenized-source')).toContainText(
    /function\s+get\(/,
  );
  await expect(
    page.locator('.monaco-hover:visible').getByRole('heading', { name: 'Arguments', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.monaco-hover:visible')).not.toContainText('**');
  await expect(page.locator('.monaco-hover:visible')).not.toContainText('###');
  await page.keyboard.press('Escape');
  await call('mulBigNum').hover();
  await expect(page.locator('.monaco-hover:visible')).toContainText('Multiplies');
  await expect(page.locator('.monaco-hover:visible')).not.toContainText(
    'Quantity (Positive BigNum)',
  );
  await page.screenshot({ path: '/tmp/studio-followup-hover.png' });
  await page.keyboard.press('Escape');
  await page.locator('.view-line').first().click({ button: 'right' });
  await expect(page.locator('.monaco-menu:visible').first()).toHaveCSS(
    'background-color',
    'rgb(21, 30, 48)',
  );
  await expect(page.locator('.context-view.monaco-menu-container:visible')).toHaveCSS(
    'opacity',
    '1',
  );
  await page.screenshot({ path: '/tmp/studio-followup-menu.png' });
  await page.keyboard.press('Escape');
  await expect(
    page.locator('.top-actions').getByRole('button', { name: 'Undo (Ctrl+Z)' }),
  ).toHaveCount(0);
  await expect(
    page.locator('.editor-view-actions').getByRole('button', { name: 'Undo (Ctrl+Z)' }),
  ).toBeVisible();
  await expect(page.locator('.editor-view-actions [role="separator"]')).toBeVisible();
  await page.getByText('Output', { exact: true }).click();
  expect(await page.locator('.studio-menu[open] button').allTextContents()).toEqual([
    'Wallet URL',
    'QR code',
    'URL parameters',
    'Built strict JSON',
    'IDE file link',
    'IDE project link',
    'html snippet',
    'html-zero snippet',
    'react snippet',
    'button snippet',
    'express snippet',
    'Import wallet result',
  ]);
  await expect(page.locator('.studio-menu[open] hr')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open Studio options' }).click();
  await expect(page.getByLabel('Referral address (optional)')).toHaveValue('');
  for (const label of [
    'Debug syntax timing in console',
    'Enhanced syntax highlighting',
    'Autosave project in this browser',
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await page.getByLabel('Show editor tooltips (Code, Nodes, Blocks)').uncheck();
  await page.getByRole('button', { name: 'Apply & reload schema' }).click();
  await call('mulBigNum').hover();
  await expect(page.locator('.monaco-hover:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  await page.locator('gc-scope-card button.name').first().hover();
  await expect(page.locator('.studio-doc-popover')).toHaveCount(0);
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await page.locator('.blocklyText').first().hover();
  await expect(page.locator('.studio-doc-popover')).toHaveCount(0);
  await expect(page.locator('.blocklyTooltipDiv:visible')).toHaveCount(0);
});

test('nested metadata ISL, Find/Replace toggle and block diagnostics', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({
      body: readFileSync('tests/fixtures/runtime-schema.json', 'utf8'),
      contentType: 'application/json',
    }),
  );
  await page.goto('./');
  const editor = page.getByRole('textbox', { name: 'Editor content' });
  await expect(editor).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  async function paste(value: unknown) {
    await page.evaluate(
      (source) => navigator.clipboard.writeText(source),
      JSON.stringify(value, null, 2),
    );
    await editor.press('Control+A');
    await editor.press('Control+v');
  }
  await paste({
    type: 'script',
    run: {
      build: {
        type: 'buildTx',
        tx: { auxiliaryData: { '674': { msg: "{strToMetadataStr(get('args.message'))}" } } },
      },
    },
  });
  const metadataCall = page.locator('.view-line span').filter({ hasText: /^strToMetadataStr$/ });
  await expect(metadataCall).toBeVisible();
  await expect(metadataCall).toHaveAttribute('class', /gc-token-/);
  await metadataCall.hover();
  await expect(page.locator('.monaco-hover:visible')).toContainText('strToMetadataStr()');
  await page.keyboard.press('Escape');
  const find = page.getByRole('button', {
    name: 'Toggle Find and Replace (Ctrl+F / Ctrl+H)',
    exact: true,
  });
  await find.click();
  await expect(page.locator('.find-widget.visible')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Replace', exact: true })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Find', exact: true });
  await search.fill('message');
  await expect(page.locator('.find-widget .matchesCount')).toContainText('1 of 1');
  await page.getByRole('textbox', { name: 'Replace', exact: true }).fill('note');
  await page.getByRole('button', { name: /^Replace All \(/ }).click();
  await expect(page.locator('.view-lines')).toContainText('args.note');
  await find.click();
  await expect(page.locator('.find-widget.visible')).toHaveCount(0);
  await editor.press('Control+f');
  await expect(page.locator('.find-widget.visible')).toBeVisible();
  await page.keyboard.press('Escape');
  await paste({ type: 'script', run: { address: { type: 'getCurentAddress' } } });
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(page.locator('.blocks-diagnostics')).toContainText('getCurrentAddress');
  await expect(page.locator('.studio-block-error')).not.toHaveCount(0);
  await expect(page.locator('.blocklyWarningIcon')).not.toHaveCount(0);
  await page.locator('.blocks-diagnostics button').first().click();
  await expect(page.locator('.studio-block-error.blocklySelected')).toBeVisible();
  await page.screenshot({ path: '/tmp/studio-block-errors.png' });
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await paste({ type: 'script', run: { address: { type: 'getCurrentAddress' } } });
  await page.getByRole('button', { name: 'Blocks', exact: true }).click();
  await expect(page.locator('.blocks-diagnostics')).toHaveCount(0);
  await expect(page.locator('.studio-block-error')).toHaveCount(0);
});
