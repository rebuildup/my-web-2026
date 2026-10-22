#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #437.
 *
 * Renders the stale public copy review-date gate as a static HTML page
 * (the "CI report" view a reviewer reads from a local run or a CI log)
 * at `.tmp/stale-content-review-report.html`, and captures it with the
 * Playwright chromium already installed for the E2E suite into
 * `docs/verification/content/stale-copy-review.webp` — the path Issue
 * #437 requires in the PR body, with the `.webp` extension substituted
 * for the Issue's literal `.png` (a committed PNG of this report is
 * several times larger for no evidentiary gain).
 *
 * The capture takes **two viewports** — desktop 1440 and mobile 390 —
 * and stacks them, so the artefact shows both the wide layout and the
 * narrow one. The image is supporting evidence; the test
 * (`scripts/check-stale-content-review.test.mjs`) is the authority.
 *
 * The report is rendered from the working tree only: no browser is
 * needed to produce it (the gate is a text scan over the tree), no
 * network is used, the Worker is never started, and no secret is read.
 * Only the final screenshot needs chromium (`pnpm run e2e:install`).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width, withoutEnlargement: true })`
 * followed by `webp({ quality: WEBP_QUALITY })`. No intermediate PNG is
 * written to disk (`sharp` only sees the in-memory Buffer), the target
 * extension is asserted to be `.webp` so a PNG can never drift back
 * into `docs/`, and a file over the byte cap is an error rather than a
 * silent commit. `sharp` stays a devDependency and is never imported
 * by the Worker / SSR.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper.
 *
 *   node scripts/make-stale-content-review-report.mjs
 *   pnpm run verify:stale-copy-review-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	REGISTRY_PATH,
	SURFACES_PATH,
	collectSegments,
	evaluateRegistry,
	renderHtml,
} from './check-stale-content-review.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/stale-content-review-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/content/stale-copy-review.webp');
const WEBP_WIDTH = 1440;
const WEBP_QUALITY = 80;
const WEBP_MAX_BYTES = 300 * 1024;
const DESKTOP = { width: 1440, height: 1200 };
const MOBILE = { width: 390, height: 844 };
const GAP = 24;

/** The commit the report was rendered from. */
function headSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8',
		}).trim();
	} catch {
		return null;
	}
}

/** The date the report was rendered for. */
function today() {
	return new Date().toISOString().slice(0, 10);
}

/** Capture one viewport into an in-memory PNG buffer. */
async function shoot(htmlPath, viewport, { fullPage }) {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		const capture = await page.screenshot({ fullPage });
		return capture;
	} finally {
		await browser.close();
	}
}

if (!WEBP_TARGET.endsWith('.webp')) {
	throw new Error(`refusing to write a non-WebP verification artefact: ${WEBP_TARGET}`);
}

const surfaces = JSON.parse(readFileSync(join(ROOT, SURFACES_PATH), 'utf8'));
const registry = JSON.parse(readFileSync(join(ROOT, REGISTRY_PATH), 'utf8'));
const { segments, skipped } = collectSegments(ROOT, surfaces, {
	excludedPaths: registry.excludedPaths ?? [],
	excludedExpressions: registry.excludedExpressions ?? [],
});
const result = evaluateRegistry({ segments, registry, today: today() });

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(HTML_REPORT, renderHtml(result, { sourceSha: headSha(), skipped }));
process.stdout.write(`wrote ${HTML_REPORT}\n`);

const desktop = await shoot(HTML_REPORT, DESKTOP, { fullPage: true });
const mobile = await shoot(HTML_REPORT, MOBILE, { fullPage: false });

const { default: sharp } = await import('sharp');
const desktopImage = sharp(desktop);
const desktopMeta = await desktopImage.metadata();
const mobileImage = sharp(mobile);
const mobileMeta = await mobileImage.metadata();

const canvasWidth = (desktopMeta.width ?? DESKTOP.width) + GAP + (mobileMeta.width ?? MOBILE.width);
const canvasHeight = Math.max(
	desktopMeta.height ?? DESKTOP.height,
	mobileMeta.height ?? MOBILE.height,
);

const composited = await sharp({
	create: {
		width: canvasWidth,
		height: canvasHeight,
		channels: 3,
		background: { r: 246, g: 244, b: 239 },
	},
})
	.composite([
		{ input: desktop, top: 0, left: 0 },
		{ input: mobile, top: 0, left: (desktopMeta.width ?? DESKTOP.width) + GAP },
	])
	.png()
	.toBuffer();

mkdirSync(dirname(WEBP_TARGET), { recursive: true });
const info = await sharp(composited)
	.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
	.webp({ quality: WEBP_QUALITY })
	.toFile(WEBP_TARGET);

const sizeOnDisk = statSync(WEBP_TARGET).size;
if (sizeOnDisk > WEBP_MAX_BYTES) {
	throw new Error(
		`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} KB verification budget; lower WEBP_QUALITY or narrow the report`,
	);
}
process.stdout.write(
	`wrote ${WEBP_TARGET} (${info.width}x${info.height}, ${Math.round(sizeOnDisk / 1024)} KB, viewports ${DESKTOP.width}px + ${MOBILE.width}px)\n`,
);
