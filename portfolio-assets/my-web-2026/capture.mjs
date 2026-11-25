// Reproduction script for Issue #1224 portfolio imagery.
// Captures the public production deployment of my-web-2026
// (https://rebuildup.dev, v0.13.1 @ 5b3c47d8) with Playwright.
// Run from a checkout with `pnpm install` + `playwright install chromium`:
//   node portfolio-assets/my-web-2026/capture.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve `@playwright/test` from the repository checkout that runs this
// script (the script lives outside src/, so bare specifier resolution
// would fail). `@playwright/test` is a direct devDependency.
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');

const outDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'main-home.png', url: 'https://rebuildup.dev/' },
  { name: 'supplement-portfolio.png', url: 'https://rebuildup.dev/portfolio' },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  locale: 'ja-JP',
});

for (const t of targets) {
  const page = await context.newPage();
  await page.goto(t.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, t.name) });
  console.log('captured', t.name);
  await page.close();
}
await browser.close();
