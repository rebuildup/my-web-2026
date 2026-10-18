#!/usr/bin/env node
/**
 * Verification report + screenshot generator for Issue #492.
 *
 * Renders the route × quality-gate coverage matrix as a static HTML
 * page (a "CI report" view — the same page a reviewer would read from a
 * local run or from a CI log) at `.tmp/route-quality-report.html`, and
 * screenshots it with the Playwright chromium already installed for the
 * E2E suite into `docs/verification/quality/route-quality-coverage.webp`
 * — the path Issue #492 requires in the PR body, with the `.webp`
 * extension substituted for the Issue's literal `.png` (a committed PNG
 * of this report is roughly twice the size for no evidentiary gain; the
 * exact byte size is printed per run rather than hard-coded here, so
 * this comment cannot drift on regeneration).
 *
 * The report is rendered from the working tree only: no browser is
 * needed to produce it (the gate is a text scan), no network is used,
 * the Worker is never started, and no secret is read. Only the final
 * screenshot needs chromium (`pnpm run e2e:install`).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the capture
 * is taken into a Buffer and re-encoded with the existing `sharp`
 * devDependency as `resize({ width: 1600, withoutEnlargement: true })`
 * followed by `webp({ quality: WEBP_QUALITY })`. The matrix is a
 * text-dense page, so the quality is 78 rather than 80: the report
 * stays legible and keeps real headroom under the 300 KB verification
 * budget (~278 KB vs ~290 KB at 80). No
 * intermediate PNG is written to disk (`sharp` only sees the in-memory
 * Buffer), the target extension is asserted to be `.webp` so a PNG can
 * never drift back into `docs/`, and a file over 300 KB is an error
 * rather than a silent commit. `sharp` stays a devDependency and is
 * never imported by the Worker / SSR.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper.
 *
 *   node scripts/make-route-quality-report.mjs
 *   pnpm run verify:route-quality-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	checkRouteQualityCoverage,
	deriveRoutesFromFiles,
	renderReport,
} from './check-route-quality-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/route-quality-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/quality/route-quality-coverage.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 78; // see the module docstring: text-dense page, 80 leaves no headroom
const WEBP_MAX_BYTES = 300 * 1024;

function headSha() {
	return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
		cwd: ROOT,
		encoding: 'utf8',
	}).trim();
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
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. The PNG bytes stay in memory only.
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

const result = checkRouteQualityCoverage({ root: ROOT });
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a report for a failing gate: ${result.errors.length} problem(s)\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.exit(1);
}

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(
	HTML_REPORT,
	renderReport({
		manifest: result.manifest,
		routes: deriveRoutesFromFiles({ root: ROOT }),
		result,
		sourceSha: headSha(),
	}),
);
process.stdout.write(`wrote ${HTML_REPORT}\n`);

const info = await shoot(HTML_REPORT, WEBP_TARGET);
const sizeOnDisk = statSync(WEBP_TARGET).size;
if (sizeOnDisk > WEBP_MAX_BYTES) {
	throw new Error(
		`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} KB verification budget; lower WEBP_QUALITY or narrow the report`,
	);
}
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${sizeOnDisk} B, quality ${WEBP_QUALITY})\n`,
);
