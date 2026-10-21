#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #425.
 *
 * Renders the Japanese copy review-target collector as a static HTML
 * page at `.tmp/japanese-copy-review-report.html`, and screenshots it
 * with the Playwright chromium already installed for the E2E suite into
 * `docs/verification/copy/japanese-diff-report.webp` — the path Issue
 * #425 requires in the PR body, which this repository commits as WebP
 * (Issue #501 precedent; a PNG of the same page is several times larger
 * for no evidentiary gain).
 *
 * The page carries three parts:
 *
 *   1. the **live** report for the current change set (the pull
 *      request's own diff), including the per-file classification, so a
 *      reader can see which changed files were review targets and why
 *      every other file was out of scope;
 *   2. a **worked example** built from committed fixtures — a before /
 *      after row with number-drift, and a withheld line — because a pull
 *      request that changes only the collector itself has no Japanese
 *      review target of its own; and
 *   3. the **fixture matrix**: every status the collector can print,
 *      asserted by `scripts/collect-japanese-copy-review.test.mjs`.
 *
 * The report is rendered from the working tree only: no browser is
 * needed to produce the HTML (the collector is a text scan over a git
 * diff), no network is used, the Worker is never started, and no secret
 * is read. Only the final screenshot needs chromium
 * (`pnpm run e2e:install`).
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the capture
 * is taken into a Buffer and re-encoded with the existing `sharp`
 * devDependency as `resize({ width: 1600, withoutEnlargement: true })`
 * followed by `webp({ quality: WEBP_QUALITY })`. No intermediate PNG is
 * written to disk (`sharp` only sees the in-memory Buffer), the target
 * extension is asserted to be `.webp` so a PNG can never drift back
 * into `docs/`, and a file over 300 KB is an error rather than a
 * silent commit. `sharp` stays a devDependency and is never imported
 * by the Worker / SSR.
 *
 * The one credential-shaped fixture is generated at run time
 * (`syntheticSecretFixture()`), so this script never writes a token into
 * the HTML, the WebP, the terminal or the repository.
 *
 *   node scripts/make-japanese-copy-review-report.mjs --base=origin/release-0-7-0
 *   pnpm run verify:copy-diff-report-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	gitDiff,
	gitShowFile,
	parseDiff,
	resolveBaseRef,
	resolveDiffBase,
} from './_copy-japanese-diff.mjs';
import {
	FIXTURE_DIR,
	buildReviewTargets,
	loadDeclarations,
	renderHtml,
	syntheticSecretFixture,
} from './collect-japanese-copy-review.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/japanese-copy-review-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/copy/japanese-diff-report.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;
const WEBP_MAX_BYTES = 300 * 1024;

const { declaration, baseSurfaces } = loadDeclarations();

function headSha() {
	return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
		cwd: ROOT,
		encoding: 'utf8',
	}).trim();
}

function baseRefFrom(argv) {
	const explicit = argv.find((arg) => arg.startsWith('--base='));
	return explicit ? explicit.slice('--base='.length) : null;
}

/** Markdown code fences need the whole file, not the changed lines. */
function sourceTextsFor(diffText, diffBase) {
	const sourceTexts = {};
	for (const file of parseDiff(diffText)) {
		if (!/\.mdx?$/i.test(file.path)) continue;
		sourceTexts[file.path] = {
			before: gitShowFile(diffBase.ref, file.path),
			after: gitShowFile('HEAD', file.path),
		};
	}
	return sourceTexts;
}

/**
 * The live change set of the current checkout, or an empty one.
 *
 * The report mirrors the collector: it diffs the merge base of the base
 * ref and HEAD, so a base branch that moved on does not publish its own
 * text into the report.
 */
function liveResult() {
	const base = resolveBaseRef(baseRefFrom(process.argv.slice(2)), process.env, [
		'COPY_REVIEW_BASE',
	]);
	if (!base) {
		return { base: null, result: buildReviewTargets('', declaration, baseSurfaces) };
	}
	const diffBase = resolveDiffBase(base, 'HEAD');
	if (!diffBase) {
		return { base, result: buildReviewTargets('', declaration, baseSurfaces) };
	}
	const diff = gitDiff(diffBase.ref, 'HEAD');
	const sourceTexts = sourceTextsFor(diff, diffBase);
	return {
		base,
		diffBase,
		result: buildReviewTargets(diff, declaration, baseSurfaces, { sourceTexts, diffBase }),
	};
}

function fixturePath(name) {
	return join(ROOT, FIXTURE_DIR, name);
}

/** Every committed fixture, through the same pure collector as the CLI. */
function committedFixtures() {
	return readdirSync(join(ROOT, FIXTURE_DIR))
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name) => {
			const fixture = JSON.parse(readFileSync(fixturePath(name), 'utf8'));
			const result = buildReviewTargets(`${fixture.diff.join('\n')}\n`, declaration, baseSurfaces, {
				sourceTexts: fixture.sourceTexts ?? {},
			});
			if (result.status !== fixture.expect) {
				throw new Error(
					`${name}: collector printed "${result.status}", fixture expects "${fixture.expect}"`,
				);
			}
			return {
				name: fixture.name ?? name.replace(/\.json$/, ''),
				status: result.status,
				note: fixture.note ?? '',
				diff: fixture.diff,
				result,
			};
		});
}

/** The runtime-generated credential fixture, through the same collector. */
function runtimeSecretFixture() {
	const fixture = syntheticSecretFixture();
	const result = buildReviewTargets(`${fixture.diff.join('\n')}\n`, declaration, baseSurfaces, {
		sourceTexts: fixture.sourceTexts ?? {},
	});
	if (result.status !== fixture.status) {
		throw new Error(
			`${fixture.name}: collector printed "${result.status}", fixture expects "${fixture.status}"`,
		);
	}
	return { name: fixture.name, status: result.status, note: fixture.note, result };
}

/**
 * The worked example: one rewording with number-drift and one withheld
 * line, so the page demonstrates both paths even when the live change
 * set has no Japanese target.
 */
function workedExample(committed) {
	const modified = committed.find((fixture) => fixture.name === 'modified-ui');
	const secret = runtimeSecretFixture();
	const diffLines = [...(modified?.diff ?? []), ...syntheticSecretFixture().diff];
	const result = buildReviewTargets(`${diffLines.join('\n')}\n`, declaration, baseSurfaces);
	return {
		name: `${modified ? modified.name : 'modified-ui'} + ${secret.name}`,
		status: result.status,
		targets: result.targets,
		redactions: result.redactions,
	};
}

async function shoot(htmlPath, target) {
	if (!target.endsWith('.webp')) {
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
		return await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
	} finally {
		await browser.close();
	}
}

const committed = committedFixtures();
const secret = runtimeSecretFixture();
const fixtures = [...committed, secret].map(({ name, status, note }) => ({
	name,
	status,
	note,
}));

const live = liveResult();
mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(
	HTML_REPORT,
	renderHtml(live.result, {
		fixtures,
		demo: workedExample(committed),
		sourceSha: headSha(),
	}),
);
process.stdout.write(`wrote ${HTML_REPORT}\n`);
if (live.diffBase) {
	process.stdout.write(
		`live change set: ${live.diffBase.ref}..HEAD (${live.result.targets.length} target(s), ${live.result.redactions.length} withheld)\n`,
	);
} else if (live.base) {
	process.stdout.write(
		`live change set: unknown (no merge base of ${live.base} and HEAD, and HEAD is not a merge commit)\n`,
	);
} else {
	process.stdout.write(
		'live change set: no base ref resolved — pass --base=<ref> to diff the pull request\n',
	);
}
process.stdout.write(
	`fixtures: ${fixtures.map((fixture) => `${fixture.name}=${fixture.status}`).join(', ')}\n`,
);

const info = await shoot(HTML_REPORT, WEBP_TARGET);
const sizeOnDisk = statSync(WEBP_TARGET).size;
if (sizeOnDisk > WEBP_MAX_BYTES) {
	throw new Error(
		`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} KB verification budget; lower WEBP_QUALITY or narrow the report`,
	);
}
process.stdout.write(
	`wrote ${WEBP_TARGET} (${info.width}x${info.height}, ${Math.round(sizeOnDisk / 1024)} KB)\n`,
);
