#!/usr/bin/env node

/**
 * Verification report + screenshot generator (Issue #478).
 *
 * Renders the disclosure flow ledger as a static HTML page at
 * `.tmp/security-disclosure-report.html` and screenshots the
 * `#disclosure-runbook` element with the Playwright chromium already
 * installed for the E2E suite into
 * `docs/verification/security/disclosure-runbook.webp` — the path Issue
 * #478 requires in the PR body, with the `.webp` extension substituted
 * for the Issue's literal `.png` (Playwright cannot encode WebP, so the
 * capture is re-encoded from memory with the existing `sharp`
 * devDependency and no intermediate PNG is committed).
 *
 * The page is refused for a failing ledger: a screenshot of a FAIL state
 * would be a screenshot of drift, and a reviewer cannot tell which one
 * they are looking at. The verdict, the exit code and
 * `node --test scripts/check-security-disclosure.test.mjs` are the
 * authority; the image is evidence of the run.
 *
 * Every row on the page comes from committed fixtures in
 * `quality/fixtures/security-disclosure/` and from
 * `quality/security-disclosure.json`. No Worker, no network, no D1/R2, no
 * secret: the report is rendered from the working tree. The credential
 * probe is materialised in memory by the evaluator and only its reason
 * code reaches this page.
 *
 *   node scripts/make-security-disclosure-report.mjs
 *   pnpm run verify:security-disclosure-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkDisclosureFlow, renderReport } from './check-security-disclosure.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/security-disclosure-report.html');
const TARGET = join(ROOT, 'docs/verification/security/disclosure-runbook.webp');
const WEBP_WIDTH = 1600;
/**
 * The page is text-dense, so it is encoded near-lossless first: lossy WebP
 * keeps the byte count down only by smearing the text, which would make
 * the rows unreadable. The ladder starts at the sharpest step that fits
 * the budget; grayscale is the last resort, not the plan.
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

async function shoot(page) {
	if (extname(TARGET) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${TARGET}`);
	}
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(TARGET), { recursive: true });
	const capture = await page.locator('#disclosure-runbook').screenshot();

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
			writeFileSync(TARGET, buffer);
			return {
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
		`${TARGET} does not fit in ${Math.round(WEBP_MAX_BYTES / 1024)} KB of WebP at width ${WEBP_WIDTH} even at ${JSON.stringify(
			WEBP_QUALITY_LADDER.at(-1),
		)} — narrow the report instead of committing a heavier image`,
	);
}

const result = checkDisclosureFlow({ root: ROOT });
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a report for a failing ledger: ${result.errors.length} problem(s)\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.exit(1);
}

function headSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8',
		}).trim();
	} catch {
		return 'unknown';
	}
}

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(
	HTML_REPORT,
	renderReport({
		manifest: result.manifest,
		result,
		probes: result.probes,
		sourceSha: headSha(),
	}),
);
process.stdout.write(`[disclosure] wrote ${HTML_REPORT.replace(`${ROOT}/`, '')}\n`);

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 1280, height: 1400 },
	deviceScaleFactor: 1,
});
let shot = null;
try {
	await page.goto(pathToFileURL(HTML_REPORT).href, { waitUntil: 'load' });
	shot = await shoot(page);
} finally {
	await browser.close();
}

process.stdout.write(
	`[disclosure] wrote ${TARGET.replace(`${ROOT}/`, '')} (webp ${shot.width}x${shot.height}, ${
		statSync(TARGET).size
	} B, quality ${shot.quality}${shot.nearLossless ? ' nearLossless' : ' lossy'}${
		shot.grayscale ? ' grayscale' : ''
	})\n`,
);
