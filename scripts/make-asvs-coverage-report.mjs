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
 * The page is captured in two elements rather than as one full-page
 * screenshot: the coverage matrix (summary, the unverified list, the
 * not-applicable list, and the 45 selected rows) is the artefact the
 * Issue names, and the false-green probes below it are a second image
 * (`asvs-coverage-probes.webp`). One full-page capture of both does not
 * fit the 300 KB evidence budget as legible WebP at any quality, and a
 * reviewer who cannot read the rows cannot use the image.
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
const TARGETS = [
	{
		selector: '#asvs-coverage',
		target: join(ROOT, 'docs/verification/security/asvs-coverage-matrix.webp'),
	},
	{
		selector: '#asvs-probes',
		target: join(ROOT, 'docs/verification/security/asvs-coverage-probes.webp'),
	},
];
const WEBP_WIDTH = 1600;
/**
 * The page is text-dense, so it is encoded near-lossless: lossy WebP keeps
 * the byte count down only by smearing the text, which would make the rows
 * unreadable. The ladder starts at the sharpest step that fits the budget
 * and steps down; the grayscale entries are the last resort, not the plan.
 */
const WEBP_QUALITY_LADDER = [
	{ quality: 80, nearLossless: true, grayscale: false },
	{ quality: 70, nearLossless: true, grayscale: false },
	{ quality: 60, nearLossless: true, grayscale: false },
	{ quality: 50, nearLossless: true, grayscale: false },
	{ quality: 40, nearLossless: true, grayscale: false },
	{ quality: 30, nearLossless: true, grayscale: false },
	{ quality: 48, nearLossless: false, grayscale: true },
	{ quality: 40, nearLossless: false, grayscale: true },
	{ quality: 32, nearLossless: false, grayscale: true },
];
const WEBP_MAX_BYTES = 300 * 1024;

function headSha() {
	return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
		cwd: ROOT,
		encoding: 'utf8',
	}).trim();
}

async function shoot(page, { selector, target }) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const capture = await page.locator(selector).screenshot();

	// Playwright cannot encode WebP, so the PNG bytes stay in memory and
	// are re-encoded with sharp; nothing but the final WebP is written.
	for (const step of WEBP_QUALITY_LADDER) {
		let pipeline = sharp(capture).resize({ width: WEBP_WIDTH, withoutEnlargement: true });
		if (step.grayscale) pipeline = pipeline.grayscale();
		const buffer = await pipeline
			.webp({ quality: step.quality, nearLossless: step.nearLossless, effort: 6 })
			.toBuffer();
		if (buffer.length <= WEBP_MAX_BYTES) {
			const info = await sharp(buffer).metadata();
			writeFileSync(target, buffer);
			return {
				target,
				width: info.width,
				height: info.height,
				bytes: buffer.length,
				quality: step.quality,
				nearLossless: step.nearLossless,
				grayscale: step.grayscale,
			};
		}
	}
	throw new Error(
		`${target} does not fit in ${Math.round(WEBP_MAX_BYTES / 1024)} KB of WebP at width ${WEBP_WIDTH} even at ${JSON.stringify(
			WEBP_QUALITY_LADDER.at(-1),
		)} — narrow the report instead of committing a heavier image`,
	);
}

async function captureAll(htmlPath) {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1280, height: 1400 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		const shots = [];
		for (const entry of TARGETS) shots.push(await shoot(page, entry));
		return shots;
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

for (const shot of await captureAll(HTML_REPORT)) {
	process.stdout.write(
		`wrote ${shot.target.replace(`${ROOT}/`, '')} (webp ${shot.width}x${shot.height}, ${
			statSync(shot.target).size
		} B, quality ${shot.quality}${
			shot.nearLossless ? ' nearLossless' : ' lossy'
		}${shot.grayscale ? ' grayscale' : ''})\n`,
	);
}
