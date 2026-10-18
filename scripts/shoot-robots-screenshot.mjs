#!/usr/bin/env node
/**
 * shoot-robots-screenshot — browser capture of the served robots.txt
 * (Issue #423).
 *
 * Verification artefact generator, sibling of
 * `scripts/make-d1-verification-report.mjs` (#452): the PR image is a
 * capture of a LIVE response, not a rendering of the file on disk, so
 * the bytes in the screenshot are provably the bytes the server sends.
 *
 * It does not start a server — start one first, because "served over
 * HTTP by the same pipeline that ships" is the point:
 *
 *   pnpm exec vite dev --port 15923 --strictPort
 *   pnpm run capture:robots            # same as the `node …` line below
 *   node scripts/shoot-robots-screenshot.mjs \
 *     http://localhost:15923/robots.txt docs/verification/web/robots-txt-browser.webp
 *
 * Writes WebP directly (the repository stores verification captures as
 * compressed WebP; the intermediate PNG stays out of git). Pass `.png`
 * as the output suffix to get a PNG instead.
 *
 * Exits non-zero when the capture would be worthless: a non-200
 * response, or a body that is not the committed robots.txt.
 */

import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const url = process.argv[2] ?? 'http://localhost:15923/robots.txt';
const out = process.argv[3] ?? 'docs/verification/web/robots-txt-browser.webp';

const expected = readFileSync(resolve(REPO_ROOT, 'public/robots.txt'), 'utf8');

const browser = await chromium.launch();
try {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 900 },
		deviceScaleFactor: 2,
	});
	const response = await page.goto(url, { waitUntil: 'load' });
	if (!response || !response.ok()) {
		throw new Error(`GET ${url} -> ${response ? response.status() : 'no response'}`);
	}
	const served = await page.evaluate(() => document.body.innerText);
	console.log(`GET ${url} -> ${response.status()} ${response.headers()['content-type']}`);
	if (served.replace(/\r\n/g, '\n').trim() !== expected.trim()) {
		throw new Error(
			`the served robots.txt does not match public/robots.txt (${served.length} vs ${expected.length} chars) — regenerate public/robots.txt before capturing`,
		);
	}

	const png = await page.screenshot({ type: 'png', fullPage: true });
	if (extname(out) === '.png') {
		await sharp(png).toFile(out);
	} else {
		await sharp(png)
			.resize({ width: 1600, withoutEnlargement: true })
			.webp({ quality: 80 })
			.toFile(out);
	}
	console.log(`captured ${out} (${served.length} chars verified against public/robots.txt)`);
} finally {
	await browser.close();
}
