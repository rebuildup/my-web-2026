#!/usr/bin/env node

/**
 * capture-design-matrix — the rendered-screen half of the UI visual
 * review (Issue #1110, ADR-0022 §5.2, docs/runbook/ui-visual-review.md).
 *
 * What this captures
 * ------------------
 * Every declared route at the review matrix:
 *
 *   viewport   desktop 1440×900 / mobile 390×844
 *   appearance light / dark   (`colorScheme` emulation — Panda's `dark`
 *              condition reads `prefers-color-scheme`)
 *   motion     `reducedMotion: 'reduce'` (matches the a11y capture
 *              convention; the page must be judged without animation)
 *
 * Output is FULL-PAGE PNG under `.tmp/design-matrix/` (gitignored):
 * PNG, not WebP, because `measure-chromatic-share.mjs` decodes the
 * same bytes the review looks at — a lossy intermediate would make the
 * chromatic-share observation a measurement of the encoder, not of
 * the page. Pages taller than 16 000 px are split into `--partN`
 * tiles like the `887-current` captures.
 *
 * Usage:
 *   node scripts/capture-design-matrix.mjs [base-url] [--routes=/,/about,…] [--out=dir]
 *
 * Requires a running server (default http://127.0.0.1:3000 — `pnpm run dev`).
 * Read-only against the origin: GET requests only, no mutation, no
 * secret, no binding value is touched or printed.
 *
 * Exit: 0 every capture succeeded / 1 at least one route failed /
 * 2 usage error.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The review matrix's route set — the runbook's "対象 route" list. */
export const DEFAULT_ROUTES = [
	'/',
	'/about',
	'/portfolio',
	'/tools',
	'/stack',
	'/activity',
	'/contact',
	'/now',
];

export const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'mobile', width: 390, height: 844 },
];

export const SCHEMES = ['light', 'dark'];

/** PNG part height — same 16 000 px tile the 887 captures used. */
const PART_HEIGHT = 16_000;

function parseArgs(argv) {
	const positional = [];
	const options = { routes: null, out: null };
	for (const arg of argv) {
		if (arg.startsWith('--routes=')) options.routes = arg.slice('--routes='.length);
		else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
		else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
		else positional.push(arg);
	}
	return { base: positional[0] ?? 'http://127.0.0.1:3000', ...options };
}

/** `/` → `index`, `/portfolio/$slug`-style segments stay readable. */
export function slugForRoute(route) {
	const trimmed = route.replace(/^\/+|\/+$/g, '');
	if (trimmed === '') return 'index';
	return trimmed.replaceAll('/', '-').replaceAll('$', 'dollar-');
}

async function captureCondition(browser, base, route, viewport, scheme, outDir) {
	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height },
		colorScheme: scheme,
		reducedMotion: 'reduce',
		deviceScaleFactor: 2,
	});
	const page = await context.newPage();
	try {
		const url = `${base}${route === '/' ? '/' : route}`;
		const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
		const status = response?.status() ?? 0;
		if (status !== 200) {
			return { route, viewport: viewport.name, scheme, status, error: `GET ${route} -> ${status}` };
		}
		const png = await page.screenshot({ fullPage: true });
		const meta = await sharp(png).metadata();
		const height = meta.height ?? 0;
		const width = meta.width ?? 1;
		const parts = Math.max(1, Math.ceil(height / PART_HEIGHT));
		const stem = `${slugForRoute(route)}--${viewport.name}-${scheme}`;
		for (let i = 0; i < parts; i += 1) {
			const suffix = parts > 1 ? `--part${i + 1}` : '';
			const out = resolve(outDir, `${stem}${suffix}.png`);
			let pipe = sharp(png);
			if (parts > 1) {
				pipe = pipe.extract({
					left: 0,
					top: i * PART_HEIGHT,
					width,
					height: Math.min(PART_HEIGHT, height - i * PART_HEIGHT),
				});
			}
			await pipe.png().toFile(out);
		}
		return { route, viewport: viewport.name, scheme, status, parts, height, width };
	} finally {
		await context.close();
	}
}

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`[capture-design-matrix] ${error.message}\n`);
		return 2;
	}
	const routes = args.routes
		? args.routes.split(',').map((r) => (r.startsWith('/') ? r : `/${r}`))
		: DEFAULT_ROUTES;
	const outDir = resolve(REPO_ROOT, args.out ?? '.tmp/design-matrix');
	mkdirSync(outDir, { recursive: true });

	const browser = await chromium.launch();
	const results = [];
	try {
		for (const route of routes) {
			for (const viewport of VIEWPORTS) {
				for (const scheme of SCHEMES) {
					const result = await captureCondition(browser, args.base, route, viewport, scheme, outDir);
					results.push(result);
					const label = `${route} ${viewport.name} ${scheme}`;
					if (result.error) {
						process.stderr.write(`[capture-design-matrix] FAIL ${label}: ${result.error}\n`);
					} else {
						process.stdout.write(
							`[capture-design-matrix] ${label}: ${result.status}, ${result.parts} part(s), ${result.height}px\n`,
						);
					}
				}
			}
		}
	} finally {
		await browser.close();
	}

	const failures = results.filter((r) => r.error);
	process.stdout.write(
		`[capture-design-matrix] ${results.length - failures.length}/${results.length} captures ok -> ${outDir}\n`,
	);
	return failures.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(await main());
}
