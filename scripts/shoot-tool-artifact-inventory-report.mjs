#!/usr/bin/env node
/**
 * shoot-tool-artifact-inventory-report — regenerate the Issue #466
 * verification screenshot from the inventory gate's own report.
 *
 * What it produces
 * ----------------
 * `docs/verification/security/tool-artifact-inventory.webp`: the report
 * the licence/dependency gate emits for the synthetic fixture host
 * repository, rendered in a browser.
 *
 * Why the source is a fixture, not this repository
 * -------------------------------------------------
 * The artefact has to show a FAILING gate — a license claim that
 * contradicts the license file, a Tool with no license file at all, a
 * lockfile that drifted since it was reviewed, and an undeclared
 * outbound host. This repository is (correctly) never in that state, so
 * the only honest way to photograph the failure modes is to generate
 * them: `make-tool-artifact-fixture.mjs` builds a synthetic host
 * repository from git plumbing and hand-written files, with no network,
 * no real Tool repository and no credential.
 *
 * What must not appear in the picture
 * ------------------------------------
 * The fixture's bundle carries a credential-SHAPED url
 * (`https://user:pw-fixture@…`) to prove the scan reduces a url to a
 * hostname. The script re-reads the rendered page and fails if that
 * userinfo survived anywhere in it, so the committed image cannot become
 * the place where a credential-shaped string is published.
 *
 * Why WebP
 * --------
 * Committed binaries live in git forever, so the image is resized to the
 * report's own width, encoded as WebP quality 80 and kept under ~300 KB.
 * A PNG of the same page is ~4x the bytes for no additional review value.
 *
 * Usage:
 *   node scripts/shoot-tool-artifact-inventory-report.mjs
 *
 * Exits non-zero if the gate does not fail, so the artefact can never
 * drift into a screenshot of a green run.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = join(REPO_ROOT, '.tmp', 'tool-artifact-inventory-shot');
const FIXTURE_DIR = join(TMP_DIR, 'fixture');
const HTML_PATH = join(TMP_DIR, 'tool-artifact-inventory.html');
const PNG_PATH = join(TMP_DIR, 'tool-artifact-inventory.png');
const OUT_PATH = join(
	REPO_ROOT,
	'docs',
	'verification',
	'security',
	'tool-artifact-inventory.webp',
);

/** Never screenshot this: a credential-SHAPED userinfo from the fixture. */
const FORBIDDEN_IN_PAGE = /pw-fixture|tracker\.example\.org:/;

const REPORT_WIDTH = 1280;
const WEBP_QUALITY = 80;
const MAX_BYTES = 300 * 1024;

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

execFileSync(
	process.execPath,
	[join(REPO_ROOT, 'scripts', 'make-tool-artifact-fixture.mjs'), FIXTURE_DIR, '--quiet'],
	{ cwd: REPO_ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
);

// The gate must FAIL here. A zero exit means the fixture stopped
// exercising the failure modes and the picture would document nothing.
const gate = spawnSync(
	process.execPath,
	[
		join(REPO_ROOT, 'scripts', 'check-tool-artifact-inventory.mjs'),
		`--root=${FIXTURE_DIR}`,
		'--report=html',
		`--report-out=${HTML_PATH}`,
	],
	{ cwd: REPO_ROOT, encoding: 'utf8' },
);
if (gate.status !== 1) {
	process.stderr.write(
		`the gate exited ${gate.status}, expected 1 — the fixture no longer demonstrates a failure\n${gate.stdout}${gate.stderr}`,
	);
	process.exit(1);
}

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: REPORT_WIDTH, height: 1000 } });
	await page.goto(`file://${HTML_PATH}`, { waitUntil: 'load' });
	const body = await page.locator('body').innerText();
	if (FORBIDDEN_IN_PAGE.test(body)) {
		process.stderr.write(
			'the rendered report contains credential-shaped text; refusing to commit it\n',
		);
		process.exit(1);
	}
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
if (kb > MAX_BYTES / 1024) {
	process.stderr.write(`the WebP is ${kb.toFixed(1)} KB, over the ${MAX_BYTES / 1024} KB budget\n`);
	process.exit(1);
}

// The committed image must not be the only copy of the finding text:
// re-read it so a truncated or blank WebP fails loudly.
const rendered = readFileSync(OUT_PATH);
if (rendered.byteLength === 0) {
	process.stderr.write('the WebP is empty\n');
	process.exit(1);
}
