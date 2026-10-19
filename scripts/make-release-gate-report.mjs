#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #508.
 *
 * Renders the release-gate check ledger as a static HTML page (the
 * "release report" view a reviewer reads from a local run or a CI log)
 * at `.tmp/release-gate-report.html`, and screenshots it with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/release-gate-missing-check.webp` — the
 * path Issue #508 requires in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png` (Playwright cannot encode
 * WebP, so a committed PNG would carry twice the bytes for no
 * evidentiary gain; the exact byte size is printed per run rather than
 * hard-coded here, so this comment cannot drift on regeneration).
 *
 * The report carries the false-green probe the Issue is about: the same
 * pure evaluator runs on the on-disk fixtures
 * `quality/fixtures/release-gate/pass.json` (a complete release) and
 * `missing-required-check.json` (one required inspection removed from
 * the chain), so the page shows the caught FAIL next to today's PASS.
 * The image is evidence, not the test: `node --test
 * scripts/check-release-gate-coverage.test.mjs` is what asserts the
 * verdict, and it reads the same fixtures.
 *
 * Rendered from the working tree only: the gate is a text scan, so no
 * browser is needed to produce the HTML, no network is used, the Worker
 * is never started, and no secret is read. Only the final screenshot
 * needs chromium (`pnpm run e2e:install`).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer (never a file) and re-encoded with the
 * existing `sharp` devDependency as `resize({ width: 1600,
 * withoutEnlargement: true })` followed by `webp({ quality:
 * WEBP_QUALITY })`. No intermediate PNG is written to disk, the target
 * extension is asserted to be `.webp` so a PNG can never drift back
 * into `docs/`, and a file over 300 KB is an error rather than a silent
 * commit. `sharp` stays a devDependency and is never imported by the
 * Worker / SSR.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper.
 *
 *   node scripts/make-release-gate-report.mjs
 *   pnpm run verify:release-gate-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	PROBE_FIXTURES,
	checkReleaseGateCoverage,
	evaluateFixture,
	loadFixture,
	renderReport,
} from './check-release-gate-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/release-gate-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/release-gate-missing-check.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 54; // see the module docstring: the widest page in the security folder
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

const result = checkReleaseGateCoverage({ root: ROOT });
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a report for a failing gate: ${result.errors.length} problem(s)\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.exit(1);
}

const probes = PROBE_FIXTURES.map((name) => {
	const fixture = loadFixture(ROOT, name);
	return { name, note: fixture.note, ...evaluateFixture(fixture) };
});

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(HTML_REPORT, renderReport({ result, probes, sourceSha: headSha() }));
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
