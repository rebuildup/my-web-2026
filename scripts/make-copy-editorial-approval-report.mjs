#!/usr/bin/env node

/**
 * Verification report + screenshot generator for Issue #506.
 *
 * Renders the editorial approval gate as a static HTML page (the
 * "CI report" view a reviewer reads from a local run or a CI log) at
 * `.tmp/copy-editorial-approval-report.html`, and screenshots it with
 * the Playwright chromium already installed for the E2E suite into
 * `docs/verification/copy/editorial-approval-gate.webp` — the path
 * Issue #506 requires in the PR body, with the `.webp` extension
 * substituted for the Issue's literal `.png` (a committed PNG of this
 * report is several times larger for no evidentiary gain; the exact
 * byte size is printed per run rather than hard-coded here, so this
 * comment cannot drift on regeneration).
 *
 * The page carries two parts:
 *
 *   1. the **live** verdict for the current change set (the pull
 *      request's own diff), including the per-file classification, so
 *      a reader can see which changed files were treated as public copy
 *      and why every other file was out of scope; and
 *   2. the **fixture matrix**: the four verdicts the gate can print,
 *      each one produced by a committed fixture under
 *      `test/fixtures/copy/editorial-approval/`.
 *
 * The report is rendered from the working tree only: no browser is
 * needed to produce it (the gate is a text scan over a git diff), no
 * network is used, the Worker is never started, and no secret is read.
 * Only the final screenshot needs chromium (`pnpm run e2e:install`).
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
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper.
 *
 *   node scripts/make-copy-editorial-approval-report.mjs --base=origin/release-0-7-0
 *   pnpm run verify:copy-editorial-approval-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	LEDGER_PATH,
	SURFACES_PATH,
	buildChangeSet,
	evaluateApproval,
	gitDiff,
	renderHtml,
	resolveBaseRef,
	resolveDiffBase,
} from './check-copy-editorial-approval.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML_REPORT = join(ROOT, '.tmp/copy-editorial-approval-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/copy/editorial-approval-gate.webp');
const FIXTURE_DIR = join(ROOT, 'test/fixtures/copy/editorial-approval');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;
const WEBP_MAX_BYTES = 300 * 1024;

/** What each committed fixture proves, in report order. */
const FIXTURE_NOTES = {
	approved:
		'a complete owner approval record covers the changed text — all three review dimensions pass.',
	'needs-review':
		'the same change with no approval record — the verdict is NEEDS REVIEW, never a pass.',
	rejected:
		'the owner rejected the change — the verdict is a fail, a different sentence from “not reviewed”.',
	'stale-approval':
		'an approval for other text does not cover this change set — the verdict is a fail.',
	'agent-recorded':
		'a record an automated side wrote, with no owner confirmation — the verdict is NEEDS REVIEW, never a pass.',
	pending:
		'a record whose owner decision is still pending (Issue #754) — the absence of a decision is reported as NEEDS REVIEW, never as approval.',
	'not-applicable':
		'a change that touches no public Japanese copy owes no review — the verdict is not applicable.',
};

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

/**
 * The live change set of the current checkout, or an empty one.
 *
 * The report mirrors the gate: it diffs the merge base of the base ref
 * and HEAD, so a base branch that moved on does not publish its own
 * text into the report (Issue #506).
 */
function liveChangeSet(surfaces) {
	const empty = { units: [], publicFiles: [], otherFiles: [] };
	const base = resolveBaseRef(baseRefFrom(process.argv.slice(2)));
	if (!base) {
		return { base: null, diffBase: null, changeSet: empty };
	}
	const diffBase = resolveDiffBase(base, 'HEAD');
	if (!diffBase) {
		return { base, diffBase: null, changeSet: empty };
	}
	const diff = gitDiff(diffBase.ref, 'HEAD');
	return { base, diffBase, changeSet: buildChangeSet(diff, surfaces) };
}

/** Every committed fixture, evaluated through the same pure evaluator. */
function fixtureRows(surfaces) {
	return readdirSync(FIXTURE_DIR)
		.filter((name) => name.endsWith('.json'))
		.map((name) => name.replace(/\.json$/, ''))
		.sort()
		.map((name) => {
			const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
			const changeSet = buildChangeSet(`${fixture.diff.join('\n')}\n`, surfaces);
			const result = evaluateApproval({
				units: changeSet.units,
				ledger: fixture.ledger,
				pr: fixture.pr ?? null,
			});
			return {
				name,
				verdict: result.verdict,
				note: FIXTURE_NOTES[name] ?? '',
			};
		});
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

const surfaces = JSON.parse(readFileSync(join(ROOT, SURFACES_PATH), 'utf8'));
const ledger = JSON.parse(readFileSync(join(ROOT, LEDGER_PATH), 'utf8'));

const { base, diffBase, changeSet } = liveChangeSet(surfaces);
const result = evaluateApproval({
	units: changeSet.units,
	ledger,
	pr: process.env.COPY_APPROVAL_PR ? Number(process.env.COPY_APPROVAL_PR) : null,
	diffBase,
});

mkdirSync(dirname(HTML_REPORT), { recursive: true });
writeFileSync(
	HTML_REPORT,
	renderHtml(result, {
		fixtures: fixtureRows(surfaces),
		sourceSha: headSha(),
		changeSet,
	}),
);
process.stdout.write(`wrote ${HTML_REPORT}\n`);
if (base && diffBase) {
	process.stdout.write(
		`live change set: ${diffBase.ref}..HEAD (${changeSet.units.length} public segment(s))\n`,
	);
} else if (base) {
	process.stdout.write(
		`live change set: unknown (no merge base of ${base} and HEAD, and HEAD is not a merge commit)\n`,
	);
} else {
	process.stdout.write(
		'live change set: no base ref resolved — pass --base=<ref> to diff the pull request\n',
	);
}

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
