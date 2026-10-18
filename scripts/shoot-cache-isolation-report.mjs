#!/usr/bin/env node
/**
 * Screenshot the Issue #460 verification report.
 *
 *   node scripts/shoot-cache-isolation-report.mjs
 *
 * Renders `.tmp/cache-isolation-report.html` (built by
 * `scripts/build-cache-isolation-report.mjs` from the vitest JSON
 * report) in the installed Playwright Chromium and writes a WebP to
 * `docs/verification/security/cache-isolation-test.webp`.
 *
 * WebP, not PNG: the report is text and compresses ~10x smaller, and
 * the intermediate PNG stays under the gitignored `.tmp/`.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SOURCE = resolve(REPO_ROOT, '.tmp/cache-isolation-report.html');
const PNG = resolve(REPO_ROOT, '.tmp/cache-isolation-report.png');
const WEBP = resolve(REPO_ROOT, 'docs/verification/security/cache-isolation-test.webp');

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	await page.goto(`file://${SOURCE}`, { waitUntil: 'load' });
	await page.screenshot({ path: PNG, fullPage: true });
	mkdirSync(resolve(WEBP, '..'), { recursive: true });
	const bytes = await sharp(PNG)
		.resize({ width: 1280, withoutEnlargement: true })
		.webp({ quality: 82 })
		.toFile(WEBP);
	process.stdout.write(`${WEBP} ${bytes.size} bytes\n`);
} finally {
	await browser.close();
}
