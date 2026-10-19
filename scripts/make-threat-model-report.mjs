#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #479.
 *
 * Renders the per-capability threat model ledger as a static HTML review
 * page at `.tmp/threat-model-report.html` — the trust boundary diagram
 * for one feature unit, the ledger of every modelled capability with its
 * review questions, and the false-green probe — and screenshots it with
 * the Playwright chromium already installed for the E2E suite into
 * `docs/verification/security/threat-model-diagram.webp`.
 *
 * The Issue asks for `docs/verification/security/threat-model-diagram.png`.
 * The committed artefact is WebP for the same reason as every other file
 * in that directory: Playwright cannot encode WebP, so the capture is
 * taken into a Buffer and re-encoded with the repository's existing
 * `sharp` devDependency, and no intermediate PNG is ever written to disk.
 * The renderer also refuses any target that is not `.webp`, and fails
 * rather than committing an artefact over the 300 KB verification budget.
 *
 * Rendered from the working tree only: the gate is a text scan, so the
 * HTML needs no browser, the Worker is never started, no binding is read
 * and no secret is touched. The fixtures the page probes are the same
 * ones `scripts/check-threat-model.test.mjs` asserts on, so the picture
 * cannot disagree with the suite.
 *
 *   node scripts/make-threat-model-report.mjs
 *   pnpm run verify:threat-model-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkThreatModel, collectProbes, renderReport } from './check-threat-model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/threat-model-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/threat-model-diagram.webp');
const VIEWPORT_WIDTH = 1440;
// The SVG is 1360 px wide, so a 1440 px viewport renders it without the
// upscale a narrower page would force, and the artefact is then written at
// its native width instead of being stretched.
const WEBP_WIDTH = VIEWPORT_WIDTH;
const QUALITY_LADDER = [64, 56, 48, 40, 34, 28];
const WEBP_MAX_BYTES = 300 * 1024;

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

async function shoot(htmlPath, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: VIEWPORT_WIDTH, height: 1400 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Nothing leaves the machine: the page is a local file, and the only
		// asset it can reach is the stylesheet inlined above it.
		await page.evaluate((limit) => {
			const overflow = document.documentElement.scrollWidth;
			if (overflow > limit) {
				throw new Error(
					`rendered page overflows horizontally (${overflow}px) — a clipped column would make the image misleading`,
				);
			}
		}, VIEWPORT_WIDTH);
		// Playwright cannot emit WebP, so capture into a Buffer (never a
		// file) and re-encode with sharp. The PNG bytes stay in memory only.
		const capture = await page.screenshot({ fullPage: true });
		// Quality ladder: the highest setting that fits the verification
		// budget wins, so the artefact is not committed worse than it has
		// to be and the budget is never met by deleting evidence.
		for (const quality of QUALITY_LADDER) {
			const info = await sharp(capture)
				.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
				.webp({ quality })
				.toFile(target);
			if (statSync(target).size <= WEBP_MAX_BYTES) return { ...info, quality };
		}
		throw new Error('no quality on the ladder fits the verification budget');
	} finally {
		await browser.close();
	}
}

const result = checkThreatModel({ root: ROOT });
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a report for a failing ledger: ${result.errors.length} problem(s)\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.exit(1);
}

const probes = collectProbes(ROOT);
const html = renderReport({ manifest: result.manifest, result, probes, sourceSha: headSha() });

// The page is a review artefact, so it must not be the place a value is
// published: re-read the markup and refuse to write it if the fixture
// credential leaked into the rendered page.
const probeLiteral = '1:Rml4dHVyZUxpdGVyYWxWYWx1ZUZpeHR1cmVWYWx1ZUZpeHR1cmU';
if (html.includes(probeLiteral)) {
	throw new Error('refusing to render: the probe credential reached the report markup');
}

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(HTML_REPORT, html);
process.stdout.write(`wrote ${HTML_REPORT}\n`);

const info = await shoot(HTML_REPORT, WEBP_TARGET);
const sizeOnDisk = statSync(WEBP_TARGET).size;
if (sizeOnDisk > WEBP_MAX_BYTES) {
	throw new Error(
		`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} KB verification budget; lower WEBP_QUALITY or narrow the report`,
	);
}
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${sizeOnDisk} B, quality ${info.quality})\n`,
);
