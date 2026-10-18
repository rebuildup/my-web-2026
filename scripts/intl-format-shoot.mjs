#!/usr/bin/env node
/**
 * intl-format-shoot — screenshot of the Intl locale comparison report
 * (Issue #430).
 *
 * Usage:
 *   node scripts/intl-format-shoot.mjs [reportHtml] [outWebp]
 *
 * Defaults: reportHtml `.tmp/intl-date-number.html`,
 *           outWebp `docs/verification/i18n/intl-date-number.webp`
 *
 * What it does
 * ------------
 * Renders the static report produced by `scripts/intl-format-report.mjs`
 * in headless Chromium, captures the full page, and writes a
 * compressed WebP into the repository.
 *
 * The committed artefact is WebP, not PNG: the Issue names a `.png`
 * path, but a PNG of this page is several times larger for no gain at
 * documentation scale, and the repository keeps binary artefacts
 * small. The intermediate PNG stays in `.tmp/` and is never
 * committed.
 *
 * The output is capped: the script fails when the WebP is larger than
 * 300 KB, so the artefact cannot silently bloat the repository.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REPORT = resolve(REPO_ROOT, process.argv[2] ?? '.tmp/intl-date-number.html');
const OUT = resolve(REPO_ROOT, process.argv[3] ?? 'docs/verification/i18n/intl-date-number.webp');
const PNG = resolve(REPO_ROOT, '.tmp/intl-date-number.png');
const MAX_BYTES = 300 * 1024;

await mkdir(dirname(PNG), { recursive: true });
await mkdir(dirname(OUT), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 1600, height: 1000 },
	deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(REPORT).href, { waitUntil: 'load' });
await page.waitForSelector('table', { timeout: 30_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(200);
// Trim the trailing viewport padding: the capture is the document,
// not the empty space below it.
const contentHeight = await page.evaluate(() =>
	Math.ceil(document.body.getBoundingClientRect().bottom),
);
await page.setViewportSize({ width: 1600, height: Math.min(Math.max(contentHeight, 200), 4000) });
await page.waitForTimeout(100);
await page.screenshot({ path: PNG, fullPage: true });
await browser.close();

const info = await sharp(PNG)
	.resize({ width: 1600, withoutEnlargement: true })
	.webp({ quality: 80 })
	.toFile(OUT);

if (info.size > MAX_BYTES) {
	console.error(
		`intl-format-shoot: ${OUT} is ${info.size} bytes, over the ${MAX_BYTES} byte cap — reduce the viewport width or the quality setting.`,
	);
	process.exitCode = 1;
} else {
	console.log(`intl-format-shoot: wrote ${OUT} (${info.width}x${info.height}, ${info.size} bytes)`);
}
