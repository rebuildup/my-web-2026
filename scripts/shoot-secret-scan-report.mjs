#!/usr/bin/env node
/**
 * shoot-secret-scan-report — regenerate the Issue #475 verification
 * screenshot from the scan report.
 *
 * What it produces
 * ----------------
 * `docs/verification/supply-chain/secret-scan-fail.webp`: the report the
 * gate emits when it finds a credential, rendered from the synthetic
 * dummy fixtures of `scan-secrets.mjs --self-test`.
 *
 * Why the source is a fixture, not a commit
 * ------------------------------------------
 * The artefact has to show a FAILING gate, and the only honest way to
 * produce one without writing a credential-shaped string into the public
 * git history is to generate it. Every value in the report is a repeated
 * dummy character minted in `selfTestFixtures()`; none of it is a real
 * credential, and nothing here reads `.dev.vars`, Infisical, or a Worker.
 *
 * Why WebP
 * --------
 * Committed binaries live in git forever, so the image is resized to the
 * report's own width, encoded as WebP quality 80, and kept under ~300 KB.
 * A PNG of the same page is ~4x the bytes for no additional review value.
 *
 * Usage:
 *   node scripts/shoot-secret-scan-report.mjs
 *
 * Exits non-zero if the report does not fail, so the artefact can never
 * drift into a screenshot of a green run.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = join(REPO_ROOT, '.tmp', 'secret-scan-fail.html');
const PNG_PATH = join(REPO_ROOT, '.tmp', 'secret-scan-fail.png');
const OUT_PATH = join(REPO_ROOT, 'docs', 'verification', 'supply-chain', 'secret-scan-fail.webp');

const REPORT_WIDTH = 1280;
const WEBP_QUALITY = 80;

execFileSync(
	process.execPath,
	[join(REPO_ROOT, 'scripts', 'scan-secrets.mjs'), '--self-test', `--report=${HTML_PATH}`],
	{
		cwd: REPO_ROOT,
		stdio: ['ignore', 'ignore', 'inherit'],
	},
);

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: REPORT_WIDTH, height: 1000 } });
	await page.goto(`file://${HTML_PATH}`, { waitUntil: 'load' });
	await page.screenshot({ path: PNG_PATH, fullPage: true });
} finally {
	await browser.close();
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
await sharp(PNG_PATH)
	.resize({ width: REPORT_WIDTH, withoutEnlargement: true })
	.webp({ quality: WEBP_QUALITY })
	.toFile(OUT_PATH);

const meta = await sharp(OUT_PATH).metadata();
const bytes = statSync(OUT_PATH).size;
const kb = bytes / 1024;
const source = statSync(PNG_PATH).size / 1024;
process.stdout.write(
	`wrote ${OUT_PATH} (${meta.width}x${meta.height}, ${kb.toFixed(1)} KB; PNG source ${source.toFixed(1)} KB)\n`,
);
if (kb > 300) {
	process.stderr.write(
		`secret-scan-fail.webp is ${kb.toFixed(1)} KB — the verification artefact budget is ~300 KB (repo binary bloat)\n`,
	);
	process.exit(1);
}
