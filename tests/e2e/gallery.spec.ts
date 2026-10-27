import { test, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import gc from '@gamechanger-finance/gc/dist/browser.js';

const official = 'https://gamechangerfinance.github.io/gcscript-studio/';
const galleryPath = 'examples/gcscript-studio-three-ides.html';
function galleryFor(base: string): string {
  const source = readFileSync('public/' + galleryPath, 'utf8').replaceAll(official, base);
  const script = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1];
  if (!script) throw Error('Missing gallery bootstrap');
  const hash = createHash('sha256').update(script).digest('base64');
  return source.replace(/sha256-[A-Za-z0-9+/=]+/, 'sha256-' + hash);
}
async function schemas(context: BrowserContext) {
  await context.route('https://wallet.gamechanger.finance/schema/**', (route) =>
    route.fulfill({
      body: readFileSync('tests/fixtures/runtime-schema.json', 'utf8'),
      contentType: 'application/json',
    }),
  );
}

test('hosted gallery restricts framing/content and three iframe IDEs run without a parent wallet host', async ({
  page,
  context,
  baseURL,
}) => {
  const base = baseURL!.replace(/\/?$/, '/');
  await schemas(context);
  const response = await page.request.get(new URL(galleryPath, base).href);
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await page.route('**/' + galleryPath, async (route) =>
    route.fulfill({ response: await route.fetch(), body: galleryFor(base) }),
  );
  await context.route('https://wallet.gamechanger.finance/api/2/run/**', (route) =>
    route.fulfill({ body: '<html><body>Wallet simulator</body></html>', contentType: 'text/html' }),
  );
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto(new URL(galleryPath, base).href);
  await expect(page).toHaveTitle('GCScript Studio for Docs');
  await expect(page.locator('.brand')).toContainText('GCScript Studio for Docs');
  const fullLinks = page.getByRole('link', { name: 'Open full IDE ↗', exact: true });
  await expect(fullLinks).toHaveCount(3);
  for (const [index, view] of ['code', 'node', 'block'].entries()) {
    const fullURL = new URL((await fullLinks.nth(index).getAttribute('href'))!);
    expect(fullURL.searchParams.has('embed')).toBe(false);
    expect(fullURL.searchParams.get('view')).toBe(view);
    const frameURL = new URL((await page.locator('iframe').nth(index).getAttribute('src'))!);
    expect(frameURL.searchParams.get('embed')).toBe('true');
    expect(frameURL.searchParams.get('view')).toBe(view);
  }
  for (const [index, view] of ['Code', 'Nodes', 'Blocks'].entries()) {
    const frame = page.frameLocator('iframe').nth(index);
    await expect(frame.getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(frame.locator('.studio-embedded')).toBeVisible();
  }
  const first = page.frameLocator('iframe').first();
  const pendingPopup = page.waitForEvent('popup');
  await first.getByRole('button', { name: 'Run', exact: true }).click();
  const popup = await pendingPopup;
  await expect(popup.getByText('Wallet simulator')).toBeVisible();
  const decoded = await gc.encodings.msg.decoder(new URL(popup.url()).pathname.split('/').at(-1)!);
  expect(decoded.returnURLPattern).not.toContain('&');
  expect(decoded.returnURLPattern).toContain('#studioRun=embed%3A');
  await popup
    .goto(
      decoded.returnURLPattern.replace(
        '{result}',
        encodeURIComponent('{"exports":{"gallery":42}}'),
      ),
    )
    .catch(() => {});
  await expect(
    first.getByRole('status').filter({ hasText: 'Wallet exports captured' }),
  ).toBeVisible();
  for (let index = 0; index < 3; index++) {
    const frame = page.frameLocator('iframe').nth(index);
    await frame.getByText('Output', { exact: true }).click();
    await frame.getByRole('button', { name: 'IDE project link', exact: true }).click();
    const url = await frame.getByRole('textbox', { name: 'Generated output' }).inputValue();
    const project = await gc.encodings.msg.decoder(new URL(url).pathname.split('/').at(-1)!);
    if (index === 0) expect(project.files['results/result.json'].text).toContain('gallery');
    else expect(project.files['results/result.json']).toBeUndefined();
    await frame.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  await page.screenshot({ path: '/tmp/studio-three-ides.png', fullPage: true });
  const blocked = await page.evaluate(async () => {
    const violation = new Promise<string>((resolve) =>
      document.addEventListener(
        'securitypolicyviolation',
        (event) => {
          if (event.effectiveDirective === 'frame-src') resolve(event.blockedURI);
        },
        { once: true },
      ),
    );
    document.querySelector('iframe')!.src = 'https://unwanted.example/';
    return violation;
  });
  expect(blocked).toContain('https://unwanted.example');
});

test('Pages-style gallery guard refuses nesting before loading any IDE frames', async ({
  page,
  baseURL,
}) => {
  const base = baseURL!.replace(/\/?$/, '/');
  let ideRequests = 0;
  await page.route('**/api/2/edit/**', (route) => {
    ideRequests++;
    return route.abort();
  });
  await page.route('**/' + galleryPath, (route) =>
    route.fulfill({ contentType: 'text/html', body: galleryFor(base) }),
  );
  await page.route('**/nested-gallery-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<iframe src="' + new URL(galleryPath, base).href + '"></iframe>',
    }),
  );
  await page.goto(new URL('nested-gallery-test', base).href);
  await expect(page.frameLocator('iframe').getByRole('alert')).toContainText(
    'Nested galleries are disabled',
  );
  await expect(page.frameLocator('iframe').locator('iframe')).toHaveCount(0);
  expect(ideRequests).toBe(0);
});

test('cross-site gallery returns a wallet popup to its iframe without parent coordination', async ({
  page,
  context,
  baseURL,
}) => {
  const deploymentPath = new URL(baseURL!).pathname.replace(/\/?$/, '/');
  const studio = 'https://studio.test' + deploymentPath;
  await schemas(context);
  await context.route('https://studio.test/**', async (route) => {
    const requested = new URL(route.request().url());
    const relative = requested.pathname.startsWith(deploymentPath)
      ? requested.pathname.slice(deploymentPath.length)
      : requested.pathname.slice(1);
    const destination = new URL(relative + requested.search, baseURL!.replace(/\/?$/, '/'));
    await route.fulfill({ response: await route.fetch({ url: destination.href }) });
  });
  await page.route('https://embedder.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: galleryFor(studio) }),
  );
  await context.route('https://wallet.gamechanger.finance/api/2/run/**', (route) =>
    route.fulfill({ body: '<html><body>Wallet simulator</body></html>', contentType: 'text/html' }),
  );
  await page.goto('https://embedder.test/');
  const first = page.frameLocator('iframe').first();
  await expect(first.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await expect(first.locator('.view-lines')).toContainText('script');
  const pendingPopup = page.waitForEvent('popup');
  await first.getByRole('button', { name: 'Run', exact: true }).click();
  const popup = await pendingPopup;
  await expect(popup.getByText('Wallet simulator')).toBeVisible();
  const decoded = await gc.encodings.msg.decoder(new URL(popup.url()).pathname.split('/').at(-1)!);
  await popup
    .goto(
      decoded.returnURLPattern.replace(
        '{result}',
        encodeURIComponent('{"exports":{"crossSite":42}}'),
      ),
    )
    .catch(() => {});
  await expect(
    first.getByRole('status').filter({ hasText: 'Wallet exports captured' }),
  ).toBeVisible();
});
