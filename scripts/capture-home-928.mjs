#!/usr/bin/env node

/**
 * capture-home-928 — final-acceptance captures of the shipped Home (`/`)
 * for Issue #928, written to `docs/verification/home/928-*.webp`.
 *
 * What this captures
 * ------------------
 * The REAL route rendered by the dev server (not a story, not a
 * fixture): full-page captures at
 *
 *   - desktop 1440 × light / dark
 *   - mobile  390  × light / dark
 *   - desktop 1440 × light × prefers-reduced-motion: reduce
 *
 * and, after each capture, reads the rendered document back and records
 * the section order / landmark facts the acceptance review needs:
 *
 *   - every <h2> text in DOM order (the information-priority claim is
 *     about what a visitor meets first, so the order is asserted, not
 *     eyeballed only);
 *   - whether the activity capability links to the live `/activity`
 *     surface;
 *   - whether the advertising unit region is present;
 *   - whether the privacy notice region is present.
 *
 * The script prints a JSON summary on stdout; the verification record
 * (`docs/verification/home/928-final-acceptance.md`) quotes it.
 *
 * Usage:
 *   node scripts/capture-home-928.mjs [base-url] [out-dir]
 *
 * Requires a running dev server (default http://127.0.0.1:3000).
 * Nothing is deployed; no remote binding or secret is touched.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const outDir = resolve(
	REPO_ROOT,
	process.argv[3] ?? 'docs/verification/home',
);

const CONDITIONS = [
	{ name: 'desktop-light', width: 1440, height: 900, colorScheme: 'light' },
	{ name: 'desktop-dark', width: 1440, height: 900, colorScheme: 'dark' },
	{ name: 'mobile-light', width: 390, height: 844, colorScheme: 'light' },
	{ name: 'mobile-dark', width: 390, height: 844, colorScheme: 'dark' },
	{
		name: 'desktop-light-reduced-motion',
		width: 1440,
		height: 900,
		colorScheme: 'light',
		reducedMotion: 'reduce',
	},
];

async function inspect(page) {
	return page.evaluate(() => {
		const headings = [...document.querySelectorAll('h2')].map((h) =>
			h.textContent?.trim().replace(/\s+/g, ' '),
		);
		const links = [...document.querySelectorAll('a[href]')].map((a) =>
			a.getAttribute('href'),
		);
		const text = document.body.innerText;
		return {
			headings,
			activityLink: links.includes('/activity'),
			adRegion: /広告|sponsored|advertisement/i.test(text),
			privacyNotice: /プライバシー|privacy/i.test(text),
			skipLink: !!document.querySelector('a[href="#main"]'),
			mainLandmark: !!document.querySelector('main#main'),
		};
	});
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const summary = {};
try {
	for (const cond of CONDITIONS) {
		const context = await browser.newContext({
			viewport: { width: cond.width, height: cond.height },
			colorScheme: cond.colorScheme,
			...(cond.reducedMotion ? { reducedMotion: cond.reducedMotion } : {}),
			deviceScaleFactor: 2,
		});
		const page = await context.newPage();
		const response = await page.goto(`${base}/`, {
			waitUntil: 'networkidle',
			timeout: 60_000,
		});
		if (!response || response.status() !== 200) {
			throw new Error(`${cond.name}: GET / -> ${response?.status()}`);
		}
		const facts = await inspect(page);
		const png = await page.screenshot({ fullPage: true });
		// WebP caps at 16383px per side; tall mobile pages are split
		// into parts like the 887-current captures (`--part1`, …).
		const meta = await sharp(png).metadata();
		const PART = 12_000;
		const parts = Math.max(1, Math.ceil((meta.height ?? 0) / PART));
		for (let i = 0; i < parts; i += 1) {
			const suffix = parts > 1 ? `--part${i + 1}` : '';
			const out = resolve(outDir, `928-home-${cond.name}${suffix}.webp`);
			let pipe = sharp(png);
			if (parts > 1) {
				pipe = pipe.extract({
					left: 0,
					top: i * PART,
					width: meta.width ?? 1,
					height: Math.min(PART, (meta.height ?? 0) - i * PART),
				});
			}
			await pipe.webp({ quality: 82 }).toFile(out);
		}
		summary[cond.name] = {
			status: response.status(),
			facts,
			parts,
			height: meta.height,
		};
		await context.close();
	}
} finally {
	await browser.close();
}

console.log(JSON.stringify(summary, null, 2));
