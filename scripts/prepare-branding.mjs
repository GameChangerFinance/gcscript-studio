import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'public/branding');

/** Render checked-in branding assets explicitly; never runs during builds or tests. */
export async function main() {
  const screenshot = await readFile(resolve(root, 'assets/branding/editor-screenshot.png'));
  const logo = await readFile(resolve(output, 'logo.svg'));
  const image = `data:image/png;base64,${screenshot.toString('base64')}`;
  const icon = `data:image/svg+xml;base64,${logo.toString('base64')}`;
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  try {
    {
      const width = 1600;
      const height = 840;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
        <style>
          *{box-sizing:border-box}body{margin:0;background:#0d1321;color:#edf3ff;font-family:Arial,sans-serif}
          main{padding:32px 64px}
          header{display:flex;align-items:center;gap:18px}
          .logo{width:64px;height:64px}
          h1{font-size:48px;letter-spacing:-1.4px;margin:0;font-weight:750}
          h1 span{color:#8ab5ff}.eyebrow{margin:7px 0 0;color:#a5b5d0;font-size:16px;letter-spacing:2px}
          .modes{margin-left:auto;color:#78e2d3;font-size:21px;font-weight:600}
          .intro{font-size:24px;line-height:1.5;color:#ccd7eb;margin:16px 0 0}
          .intro strong{color:#fff}.screen{display:block;width:1160px;height:auto;margin:20px auto 0;border:1px solid #34435d;border-radius:10px}
          footer{display:flex;justify-content:space-between;margin-top:18px;font-size:17px;color:#a5b5d0}
        </style></head><body><main>
          <header><img class="logo" src="${icon}" alt=""><div><h1>GCScript <span>Studio</span></h1>
          <p class="eyebrow">BROWSER IDE FOR GCSCRIPT DSL + ISL</p></div><div class="modes">Code. Nodes. Blocks.</div></header>
          <p class="intro"><strong>Start with 100+ examples.</strong> Build multi-file projects. Run in your wallet of choice.</p>
          <img class="screen" src="${image}" alt="GCScript Studio code editor, visual blocks and schema inspector">
          <footer><span>Monaco · Rete · Blockly · Schema-driven tools</span><span>Edit and build locally in your browser.</span></footer>
        </main></body></html>`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, (image) => image.decode()));
      });
      await page.screenshot({ path: resolve(output, 'readme-hero.png') });
      await page.close();
    }
    for (const [name, size] of [
      ['favicon-32.png', 32],
      ['apple-touch-icon.png', 180],
      ['icon-512.png', 512],
    ]) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}img{display:block;width:100%;height:100%}</style><img src="${icon}" alt="">`,
      );
      await page.locator('img').evaluate((image) => image.decode());
      await page.screenshot({ path: resolve(output, name), omitBackground: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
