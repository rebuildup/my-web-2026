#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #507.
 *
 * Renders the ASVS coverage ledger as a static HTML page at
 * `.tmp/asvs-coverage-report.html` and screenshots it with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/asvs-coverage-matrix.webp` — the path
 * Issue #507 requires in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png` (Playwright cannot encode
 * WebP, so the capture is re-encoded from memory with the existing
 * `sharp` devDependency and no intermediate PNG is committed).
 *
 * The page carries the same false-green probes the test suite reads:
 * `quality/fixtures/asvs-coverage/pass.json`,
 * `missing-evidence.json`, `missing-follow-up.json` and
 * `unregistered-gate.json`. The image is evidence, not the test;
 * `node --test scripts/check-asvs-coverage.test.mjs` is the authority.
 *
 * The report is rendered from the working tree only: no Worker, no
 * network, no D1/R2, no secret. Only the final screenshot needs
 * chromium (`pnpm run e2e:install`).
 *
 *   node scripts/make-asvs-coverage-report.mjs
 *   pnpm run verify:asvs-coverage-screenshot   # same thing
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
	checkAsvsCoverage,
	evaluateFixture,
	loadFixture,
	renderReport,
} from './check-asvs-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/asvs-coverage-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/asvs-coverage-matrix.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 52; // text-dense page; tuned below the 300 KB evidence budget
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

const result = checkAsvsCoverage({ root: ROOT });
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a report for a failing ledger: ${result.errors.length} problem(s)\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.exit(1);
}

const probes = PROBE_FIXTURES.map((name) => {
	const fixture = loadFixture(ROOT, name);
	return { name, note: fixture.note, result: evaluateFixture(fixture) };
});

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(
	HTML_REPORT,
	renderReport({ manifest: result.manifest, result, probes, sourceSha: headSha() }),
);
process.stdout.write(`wrote ${HTML_REPORT}\n`);

const info = await shoot(HTML_REPORT, WEBP_TARGET);
const sizeOnDisk = statSync(WEBP_TARGET).size;
if (sizeOnDisk > WEBP_MAX_BYTES) {
	throw new Error(
		`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(
			WEBP_MAX_BYTES / 1024,
		)} KB verification budget; lower WEBP_QUALITY or narrow the report`,
	);
}
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${sizeOnDisk} B, quality ${WEBP_QUALITY})\n`,
);
