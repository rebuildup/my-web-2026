#!/usr/bin/env node

/**
 * Verification report generator for Issue #422.
 *
 * Runs the structured-data suites with Vitest's JSON reporter, renders
 * the result as a static HTML page (a "CI report" view) at
 * `.tmp/structured-data-report.html`, and screenshots that page with
 * the Playwright chromium already installed for the E2E suite into
 * `docs/verification/seo/structured-data-report.webp` — the path Issue
 * #422 requires in the PR body, with the `.webp` extension substituted
 * for the Issue's literal `.png` (a committed PNG screenshot of this
 * report is larger for no evidentiary gain).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width: 1600, withoutEnlargement:
 * true })` followed by `webp({ quality: 75 })`. No intermediate PNG is
 * written to disk, and the target extension is asserted to be `.webp`
 * so a PNG cannot drift back into `docs/`. `sharp` stays a
 * devDependency and is never imported by the Worker / SSR.
 *
 * The JSON-LD shown in the report is read from
 * `test/integration/fixtures/structured-data-snapshot.json`, which the
 * integration suite compares with `toEqual` against real SSR HTML —
 * so the committed screenshot can never describe a document that CI
 * did not verify.
 *
 * This script is committed so the required screenshot has a
 * reviewable, reproducible source instead of an uncommitted helper.
 * It reads no secret: the suites use the workerd pool's dummy
 * bindings and a local D1 fixture.
 *
 *   node scripts/make-seo-structured-data-report.mjs
 *   pnpm run verify:structured-data-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderReportHtml } from './_seo-structured-data-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const JSON_REPORT = join(TMP, 'structured-data-results.json');
const HTML_REPORT = join(TMP, 'structured-data-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/seo/structured-data-report.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 75;
// 0.9 keeps the dense text of this report legible while holding the
// committed artefact under ~300 KB. WebP on text-heavy pages barely
// benefits from a quality above this, so the scale is spent on
// resolution instead.
const CAPTURE_SCALE = 0.9;

const CONTRACT = join(ROOT, 'src/editorial/structured-data/contract.json');
const SNAPSHOT = join(ROOT, 'test/integration/fixtures/structured-data-snapshot.json');

/** Every suite whose file path contains this filter. */
const SUITE_FILTER = 'structured-data';

const REPRODUCTION = [
	'# 1. the suites themselves (same command CI runs inside validate)',
	'pnpm exec vitest run structured-data',
	'',
	'# 2. the route coverage gate (wired into validate:fast)',
	'node scripts/check-structured-data-coverage.mjs',
	'',
	'# 3. this report + the committed screenshot',
	'pnpm run e2e:install          # once, for the Playwright chromium',
	'pnpm run verify:structured-data-screenshot',
	'',
	'# expected: all suites green, coverage gate exit 0, and',
	'# docs/verification/seo/structured-data-report.webp rewritten.',
	'# /about emits BreadcrumbList + Person; /portfolio/aulymo emits',
	'# BreadcrumbList + CreativeWork; /, /tools*, /design-system emit none.',
].join('\n');

function run() {
	mkdirSync(TMP, { recursive: true });
	execFileSync(
		'npx',
		['vitest', 'run', SUITE_FILTER, '--reporter=json', `--outputFile=${JSON_REPORT}`],
		{
			cwd: ROOT,
			stdio: 'inherit',
		},
	);
	return JSON.parse(readFileSync(JSON_REPORT, 'utf8'));
}

async function shoot(htmlPath, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1400 },
		deviceScaleFactor: CAPTURE_SCALE,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. The PNG bytes stay in memory.
		const capture = await page.screenshot({ fullPage: true });
		const info = await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
		return info;
	} finally {
		await browser.close();
	}
}

const vitestReport = run();
const html = renderReportHtml({
	report: vitestReport,
	registry: JSON.parse(readFileSync(CONTRACT, 'utf8')),
	snapshot: JSON.parse(readFileSync(SNAPSHOT, 'utf8')),
	environment: {
		node: `Node ${process.version}`,
		platform: `${process.platform} ${process.arch}`,
		vitest: vitestReport?.version ?? 'vitest',
	},
	reproduction: REPRODUCTION,
});

writeFileSync(HTML_REPORT, html);
process.stdout.write(`wrote ${HTML_REPORT}\n`);
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
