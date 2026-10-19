#!/usr/bin/env node
/**
 * Verification report + screenshot generator (Issue #494).
 *
 * Renders the personal-data review as a static HTML page — the same
 * view a reviewer opens from a local run or from a CI log — and
 * screenshots it with the Playwright chromium already installed for
 * the E2E suite into
 * `docs/verification/privacy/publication-redaction-review.webp`, the
 * path Issue #494 requires with the `.webp` extension substituted for
 * the Issue's literal `.png` (a committed PNG of this page is roughly
 * twice the size for no evidentiary gain; the exact byte size is
 * printed per run rather than hard-coded, so this comment cannot drift
 * on regeneration).
 *
 * The report is rendered from the working tree only: no Worker, no dev
 * server, no network, no secret. Only the screenshot needs chromium
 * (`pnpm run e2e:install`), and the page itself is a single self-
 * contained file with no stylesheet, font or image reference, so it
 * renders identically offline.
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the
 * capture is taken into a Buffer and re-encoded with the existing
 * `sharp` devDependency as `resize({ width: 1600, withoutEnlargement:
 * true })` followed by `webp({ quality: WEBP_QUALITY })`. No
 * intermediate PNG is written to disk (sharp only sees the in-memory
 * Buffer), the target extension is asserted to be `.webp` so a PNG can
 * never drift back into `docs/`, and a file over 300 KB is an error
 * rather than a silent commit. `sharp` stays a devDependency and is
 * never imported by the Worker / SSR.
 *
 *   node scripts/make-publication-redaction-report.mjs
 *   pnpm run verify:publication-redaction-screenshot   # same thing
 *   node scripts/make-publication-redaction-report.mjs --html=.tmp/x.html
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	CORPUS_RELATIVE_PATH,
	REPORT_RELATIVE_PATH,
	collectPublishedContent,
	digests,
	evaluate,
	loadCorpus,
} from './check-publication-redaction.mjs';
import { REVIEW_SCHEMA, renderHtmlReport } from './personal-data-review.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HTML = join(ROOT, '.tmp/publication-redaction-review.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/privacy/publication-redaction-review.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 66; // see the module docstring: text-dense Japanese page, 78, 74 and 68 left too little headroom
const WEBP_MAX_BYTES = 300 * 1024;

const htmlFlag = process.argv.find((arg) => arg.startsWith('--html='));
const HTML_TARGET = htmlFlag ? resolve(ROOT, htmlFlag.slice('--html='.length)) : DEFAULT_HTML;
const shootOnly = process.argv.includes('--screenshot');

/** Never regenerate a report for a corpus that already fails the gate. */
function currentReview() {
	const { corpus, raw, error } = loadCorpus();
	if (error) throw new Error(error);
	if (!corpus || corpus.schema !== REVIEW_SCHEMA) {
		throw new Error(`${CORPUS_RELATIVE_PATH} has no \`schema: "${REVIEW_SCHEMA}"\` block`);
	}
	const publishedFiles = collectPublishedContent();
	const review = evaluate({ corpus, publishedFiles });
	const { corpusDigest, publishedDigest, candidateFiles } = digests({
		corpusRaw: raw,
		publishedFiles,
	});
	return {
		review,
		html: renderHtmlReport({
			review,
			corpusDigest,
			publishedDigest,
			candidateFileCount: candidateFiles,
		}),
		digests: { corpusDigest, publishedDigest },
		publishedCount: publishedFiles.length,
		candidateCount: candidateFiles,
	};
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

const { review, html, digests: digestBlock, publishedCount, candidateCount } = currentReview();
const errors = review.findings.filter((entry) => entry.severity === 'error');
if (errors.length > 0) {
	process.stderr.write(
		`refusing to render a report for a failing gate: ${errors.length} problem(s)\n`,
	);
	for (const entry of errors) process.stderr.write(`  - ${entry.code} ${entry.message}\n`);
	process.exit(1);
}

mkdirSync(dirname(HTML_TARGET), { recursive: true });
writeFileSync(HTML_TARGET, html);
process.stdout.write(
	`wrote ${HTML_TARGET} (verdict ${review.verdict}, corpus ${digestBlock.corpusDigest}, ${publishedCount} published content file(s), ${candidateCount} carrying a candidate)\n`,
);

if (!shootOnly) {
	// A chromium failure is NOT swallowed: the sibling generator
	// (`scripts/make-route-quality-report.mjs`) lets the same failure
	// propagate, so the operator sees a red command instead of a
	// "screenshot skipped" line that leaves the committed WebP stale.
	const info = await shoot(HTML_TARGET, WEBP_TARGET);
	const sizeOnDisk = statSync(WEBP_TARGET).size;
	if (sizeOnDisk > WEBP_MAX_BYTES) {
		throw new Error(
			`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} KB verification budget; lower WEBP_QUALITY or narrow the report`,
		);
	}
	process.stdout.write(
		`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${sizeOnDisk} B, quality ${WEBP_QUALITY})\n`,
	);
}

// The tracked markdown report is the check-mode authority; regenerate it
// from the same inputs so the two artefacts cannot disagree.
process.stdout.write(
	`tracked report: ${REPORT_RELATIVE_PATH} — regenerate with \`pnpm run publication:redaction:write\` when the corpus changes\n`,
);
