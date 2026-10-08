#!/usr/bin/env node
/**
 * layout-audit-shoot — full-page screenshots of every public page at
 * the two audit viewports (Issue #300).
 *
 * The layout audit (Issue #300) compares before/after states of all
 * public pages. Screenshots are verification artefacts: they go to an
 * output directory outside the repository (never committed as
 * binaries — AGENTS.md §9 / review contract) and this script is the
 * durable reproduction procedure recorded in the PR.
 *
 * Usage:
 *   node scripts/layout-audit-shoot.mjs [baseUrl] [outDir]
 *
 * Defaults: baseUrl http://localhost:15907, outDir /tmp/audit300/after
 *
 * Emits one full-page PNG per page per viewport and a JSON line per
 * capture including a horizontal-overflow flag (scrollWidth vs
 * clientWidth) — overflow must be 0 for every capture.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:15907';
const out = process.argv[3] || '/tmp/audit300/after';

const PUBLIC_PAGES = [
	['home', '/'],
	['about', '/about'],
	['contact', '/contact'],
	['portfolio', '/portfolio'],
	['tools', '/tools'],
	['tools-prototype', '/tools/prototype'],
	['tools-readmark', '/tools/readmark'],
	['design-system', '/design-system'],
];

const VIEWPORTS = [
	['1280', { width: 1280, height: 800 }],
	['375', { width: 375, height: 812 }],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
for (const [vpName, viewport] of VIEWPORTS) {
	const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
	const page = await ctx.newPage();
	for (const [name, path] of PUBLIC_PAGES) {
		const url = base + path;
		// `page.goto` resolves even for 404/500 responses — a missing
		// page must never be counted as a successful capture.
		const response = await page.goto(url, { waitUntil: 'networkidle' });
		if (!response || !response.ok()) {
			const status = response ? response.status() : 'no response';
			throw new Error(
				`layout-audit-shoot: GET ${url} returned status ${status} (expected 200) — refusing to capture a non-OK page`,
			);
		}
		await page.evaluate(() => document.fonts.ready);
		await page.waitForTimeout(300);
		const file = `${out}/${name}-${vpName}.png`;
		await page.screenshot({ path: file, fullPage: true });
		const overflow = await page.evaluate(
			// clientWidth (not innerWidth) excludes the vertical
			// scrollbar, so a normal full-page scroll never reports
			// a false overflow.
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
		);
		results.push({ name, path, vp: vpName, overflow });
		console.log(`shot ${file} overflowX=${overflow}`);
	}
	await ctx.close();
}
await browser.close();
const bad = results.filter((r) => r.overflow);
if (bad.length > 0) {
	console.error('horizontal overflow detected:', JSON.stringify(bad, null, 2));
	process.exitCode = 1;
}
