#!/usr/bin/env node

/**
 * Capture the anomaly-monitor verification artefact (Issue #481).
 *
 * The image is **measured, not drawn**: this script runs the fixture
 * proof (`scripts/request-anomaly-monitor-fixture.mjs`), which replays
 * every recorded fixture through the shipped monitor, renders the matrix
 * it printed as a self-contained HTML report, and screenshots that page
 * with the Playwright Chromium the E2E suite already uses. A reviewer
 * who re-runs the command gets the same table, not a hand-written
 * picture of one.
 *
 * Safety posture: the proof prints status classes, counts and verdicts
 * only. The child's raw output is NOT replayed — a run that failed its
 * own leak guard prints the offending row's NUMBER and nothing else, and
 * forwarding the stream would copy that row into a CI log — so failure
 * is reported by exit code plus the row number the proof itself chose to
 * print. Nothing here reads a secret, a credential, or a deployed
 * environment.
 *
 * The Chromium screenshot is taken as PNG (lossless raster) and then
 * **converted to WebP** before it is committed: the artefact is a flat
 * page of text, which WebP q80 encodes at a fraction of the PNG size
 * with no visible loss, and a committed screenshot must not bloat the
 * repository. The PNG intermediate stays in `.tmp/` (gitignored) and is
 * deleted after the conversion.
 *
 * Output: `docs/verification/security/anomaly-monitor-fixture.webp`
 * Scratch: `.tmp/anomaly-monitor-fixture.html`,
 *         `.tmp/anomaly-monitor-fixture.png`,
 *         `.tmp/anomaly-monitor-fixture.webp` (all gitignored)
 *
 * The encoded WebP is written to the scratch path first and moved into
 * place only after the size ceiling passes, so an over-limit run can
 * never leave an over-budget file in `docs/`.
 *
 * Usage:
 *   pnpm run verify:anomaly-monitor-screenshot
 *
 * Exits non-zero when the proof fails, when the report would leak, or
 * when the encoded artefact exceeds `MAX_ARTEFACT_BYTES`.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROOF = 'scripts/request-anomaly-monitor-fixture.mjs';
export const OUTPUT = 'docs/verification/security/anomaly-monitor-fixture.webp';
const SCRATCH_HTML = '.tmp/anomaly-monitor-fixture.html';
const SCRATCH_PNG = '.tmp/anomaly-monitor-fixture.png';
const SCRATCH_WEBP = '.tmp/anomaly-monitor-fixture.webp';

/**
 * Chromium viewport for the capture. The committed artefact is exactly
 * this wide (the page is rendered at it and `withoutEnlargement` never
 * upscales), so the encode width below is derived from it rather than
 * being an independent constant that could disagree.
 */
export const CAPTURE_VIEWPORT = Object.freeze({ width: 1600, height: 1000 });

/** Encoding contract for the committed artefact (see the header). */
export const ARTEFACT_ENCODE_OPTIONS = Object.freeze({
	width: CAPTURE_VIEWPORT.width,
	quality: 80,
});
/** Hard ceiling so a wider matrix cannot quietly bloat the repository. */
export const MAX_ARTEFACT_BYTES = 300 * 1024;

/**
 * The line printed when the proof exits non-zero.
 *
 * Only the exit code is reported. The proof's own output is withheld
 * because a failing run is precisely the run where a row carried
 * something it should not have, and the refusal it prints names the row
 * rather than the content — replaying the stream would undo that.
 */
export function failureMessage(code) {
	return `[anomaly-monitor] the proof exited with code ${code}; its raw output is withheld (a failing row is the one that carries identifier-shaped material) — re-run \`node ${PROOF}\` to inspect\n`;
}

/** Run the proof, writing the HTML report as a side effect. */
export function runProof() {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, [PROOF, `--html=${SCRATCH_HTML}`], {
			cwd: repoRoot,
			env: process.env,
		});
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
		});
		child.stderr.on('data', (chunk) => {
			output += chunk;
		});
		child.on('error', rejectPromise);
		child.on('close', (code) => resolvePromise({ code, output }));
	});
}

/** The refusal printed when the encode would bloat the repository. */
export function overBudgetMessage(size) {
	return `[anomaly-monitor] ${OUTPUT} would be ${size} bytes (> ${MAX_ARTEFACT_BYTES}); lower ARTEFACT_ENCODE_OPTIONS.quality or narrow the report instead of committing it\n`;
}

async function main() {
	const { code } = await runProof();
	if (code !== 0) {
		process.stderr.write(failureMessage(code));
		return 1;
	}

	const { chromium } = await import('@playwright/test');
	const shot = resolve(repoRoot, SCRATCH_PNG);
	mkdirSync(dirname(shot), { recursive: true });
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT } });
		await page.goto(`file://${resolve(repoRoot, SCRATCH_HTML)}`);
		await page.waitForLoadState('load');
		await page.screenshot({ path: shot, fullPage: true });
	} finally {
		await browser.close();
	}

	// PNG (raster) -> WebP (committed).
	const { default: sharp } = await import('sharp');
	const encoded = resolve(repoRoot, SCRATCH_WEBP);
	const info = await sharp(shot)
		.resize({ width: ARTEFACT_ENCODE_OPTIONS.width, withoutEnlargement: true })
		.webp({ quality: ARTEFACT_ENCODE_OPTIONS.quality })
		.toFile(encoded);
	rmSync(shot, { force: true });

	if (info.size > MAX_ARTEFACT_BYTES) {
		// Fail safe: the over-limit encode stays in `.tmp/` and the
		// previously committed artefact is left untouched.
		rmSync(encoded, { force: true });
		process.stderr.write(overBudgetMessage(info.size));
		return 1;
	}

	// Only an artefact inside the ceiling reaches the committed path.
	const target = resolve(repoRoot, OUTPUT);
	mkdirSync(dirname(target), { recursive: true });
	renameSync(encoded, target);

	process.stdout.write(
		`[anomaly-monitor] wrote ${OUTPUT} (${info.width}x${info.height} webp q${ARTEFACT_ENCODE_OPTIONS.quality}, ${info.size} bytes)\n`,
	);
	return 0;
}

// Only run the capture when executed directly; the operator test imports
// the pure helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
