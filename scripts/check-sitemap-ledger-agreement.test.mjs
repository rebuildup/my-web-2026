import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	compareSitemapDeclarations,
	isExcludedPath,
	normalizeRoute,
	repositoryDeclarations,
} from './check-sitemap-ledger-agreement.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-sitemap-ledger-agreement.mjs');

// The gate imports the sitemap generator as a TypeScript source
// (`src/http/seo/sitemap.ts`), so the child process needs the type
// stripper even on a Node release where it is on by default.
const NODE_ARGS = ['--experimental-strip-types'];

/**
 * Fixture coverage for the sitemap-membership cross-check (Issue #734).
 *
 * The gate is only worth something if it FAILS on the disagreement it
 * was written for. The two disagreements this Issue closed are the
 * negative controls: `/design-system` was excluded by the ledger while
 * the generator listed it, and `/tools/<slug>` was advertised by the
 * ledger while the generator excluded it. Re-creating either shape
 * here has to produce a violation.
 */

/** Replace one ledger entry, by id. */
function withLedgerEntry(declarations, id, patch) {
	return declarations.map((declaration) =>
		declaration.id === id ? { ...declaration, ...patch } : declaration,
	);
}

test('the repository declarations agree', () => {
	const violations = compareSitemapDeclarations(repositoryDeclarations());
	assert.deepEqual(violations, []);
});

test('the repository gate exits 0', () => {
	const run = spawnSync(process.execPath, [...NODE_ARGS, SCRIPT], { encoding: 'utf8' });
	assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
	assert.match(run.stderr, /agree/);
});

test('the ledger advertising a path the generator omits is a violation', () => {
	// `/design-system` — the shape this Issue closed: the ledger kept it
	// out while the generator listed it.
	const base = repositoryDeclarations();
	const violations = compareSitemapDeclarations({
		...base,
		declarations: withLedgerEntry(base.declarations, '/design-system', { sitemap: false }),
	});
	assert.ok(violations.length > 0);
	assert.ok(
		violations.some((violation) => violation.subject === '/design-system'),
		JSON.stringify(violations),
	);
	assert.ok(
		violations.every((violation) => violation.code === 'ledger-flags-excluded'),
		JSON.stringify(violations),
	);
});

test('the ledger advertising a noindex route family is a violation', () => {
	// `/tools/$slug` — the other shape this Issue closed.
	const base = repositoryDeclarations();
	const violations = compareSitemapDeclarations({
		...base,
		declarations: withLedgerEntry(base.declarations, '/tools/$slug', { sitemap: true }),
	});
	assert.ok(violations.length > 0);
	assert.ok(
		violations.some((violation) => violation.subject === '/tools/$slug'),
		JSON.stringify(violations),
	);
});

test('a declaration that does not say whether it is a sitemap target is a violation', () => {
	// A `sitemap` that is neither true nor false is a claim nobody
	// made: it lands in neither the "advertised" branch nor the "kept
	// out" branch, so a typo in a new declaration used to pass the whole
	// comparison with no violation at all.
	const base = repositoryDeclarations();
	const violations = compareSitemapDeclarations({
		...base,
		declarations: withLedgerEntry(base.declarations, '/about', { sitemap: undefined }),
	});
	assert.ok(violations.length > 0);
	assert.ok(
		violations.some(
			(violation) =>
				violation.code === 'ledger-sitemap-undeclared' && violation.subject === '/about',
		),
		JSON.stringify(violations),
	);
});

test('a route family that does not say whether it is a sitemap target is a violation', () => {
	// The dynamic half has the same hole: a route family whose
	// `sitemap` is missing belongs to neither side of the comparison.
	const base = repositoryDeclarations();
	const violations = compareSitemapDeclarations({
		...base,
		declarations: withLedgerEntry(base.declarations, '/portfolio/$slug', {
			sitemap: undefined,
		}),
	});
	assert.ok(violations.length > 0);
	assert.ok(
		violations.some(
			(violation) =>
				violation.code === 'ledger-sitemap-undeclared' && violation.subject === '/portfolio/$slug',
		),
		JSON.stringify(violations),
	);
});

test('the generator listing a path the ledger omits is a violation', () => {
	const base = repositoryDeclarations();
	const violations = compareSitemapDeclarations({
		...base,
		entries: base.entries.filter((entry) => entry.path !== '/about'),
	});
	assert.ok(violations.length > 0);
	assert.ok(
		violations.some((violation) => violation.subject === '/about'),
		JSON.stringify(violations),
	);
});

test('a path the generator never excluded is a violation', () => {
	// "Kept out of the sitemap" without a recorded reason is how the
	// two declarations drifted apart in the first place.
	const base = repositoryDeclarations();
	const violations = compareSitemapDeclarations({
		...base,
		exclusions: base.exclusions.filter((exclusion) => exclusion.route !== '/keyboard'),
	});
	assert.ok(violations.length > 0);
	assert.ok(
		violations.some((violation) => violation.subject === '/keyboard'),
		JSON.stringify(violations),
	);
});

test('a prefix exclusion covers the routes below it', () => {
	const exclusions = [{ route: '/admin', kind: 'prefix', reason: 'authenticated' }];
	assert.equal(isExcludedPath(exclusions, '/admin'), true);
	assert.equal(isExcludedPath(exclusions, '/admin/login'), true);
	assert.equal(isExcludedPath(exclusions, '/admin/invitations/accept'), true);
	// A sibling that merely starts with the same letters is not covered.
	assert.equal(isExcludedPath(exclusions, '/administer'), false);
	assert.equal(isExcludedPath(exclusions, '/keyboard'), false);
});

test('a route spelling is compared without its trailing slash', () => {
	assert.equal(normalizeRoute('/admin/'), '/admin');
	assert.equal(normalizeRoute('/admin'), '/admin');
	assert.equal(normalizeRoute('/'), '/');
});

test('the gate fails on a ledger that disagrees, at the command line', () => {
	// The runner-level negative control: the gate has to actually RED,
	// not merely compute a violation nobody reads.
	const directory = mkdtempSync(join(tmpdir(), 'sitemap-ledger-'));
	const ledgerPath = join(directory, 'ledger.mjs');
	const ledgerModulePath = join(REPO_ROOT, 'scripts/publication-surface.mjs').replace(/\\/g, '/');
	writeFileSync(
		ledgerPath,
		[
			`import { SURFACE_DECLARATIONS as base } from '${ledgerModulePath}';`,
			'export const SURFACE_DECLARATIONS = base.map((entry) =>',
			"  entry.id === '/design-system' ? { ...entry, sitemap: false } : entry,",
			');',
		].join('\n'),
		'utf8',
	);

	const run = spawnSync(process.execPath, [...NODE_ARGS, SCRIPT, `--ledger=${ledgerPath}`], {
		encoding: 'utf8',
	});
	const output = `${run.stdout}${run.stderr}`;
	assert.equal(run.status, 1, output);
	assert.match(output, /disagree/);
	assert.match(output, /\/design-system/);
});

test('the gate fails on a ledger that does not declare its sitemap membership', () => {
	// The runner-level negative control for the undecided declaration:
	// the gate has to RED, not merely compute a violation nobody reads.
	const directory = mkdtempSync(join(tmpdir(), 'sitemap-ledger-undeclared-'));
	const ledgerPath = join(directory, 'ledger.mjs');
	const ledgerModulePath = join(REPO_ROOT, 'scripts/publication-surface.mjs').replace(/\\/g, '/');
	writeFileSync(
		ledgerPath,
		[
			`import { SURFACE_DECLARATIONS as base } from '${ledgerModulePath}';`,
			'export const SURFACE_DECLARATIONS = base.map((entry) =>',
			"  entry.id === '/about' ? { ...entry, sitemap: undefined } : entry,",
			');',
		].join('\n'),
		'utf8',
	);

	const run = spawnSync(process.execPath, [...NODE_ARGS, SCRIPT, `--ledger=${ledgerPath}`], {
		encoding: 'utf8',
	});
	const output = `${run.stdout}${run.stderr}`;
	assert.equal(run.status, 1, output);
	assert.match(output, /sitemap/);
	assert.match(output, /\/about/);
});

test('the gate refuses an unknown option', () => {
	const run = spawnSync(process.execPath, [...NODE_ARGS, SCRIPT, '--nope'], {
		encoding: 'utf8',
	});
	assert.equal(run.status, 2);
	assert.match(`${run.stdout}${run.stderr}`, /unknown option/);
});
