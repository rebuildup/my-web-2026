#!/usr/bin/env node
/**
 * `perf-large-list.mjs` contract tests (Issue #490).
 *
 * The measurement itself needs a browser, a built Worker and a local
 * D1, none of which belong in `pnpm test`. What CAN be asserted here
 * — and what would otherwise only be discovered when a measurement
 * run silently produced a meaningless number — is the pure logic:
 *
 *   1. the fixture generator is deterministic, synthetic and scoped
 *      (ids carry the `fx-` prefix cleanup keys on),
 *   2. the generated SQL cannot invent a facet, a visibility or a
 *      status outside the closed enums the migration CHECKs enforce,
 *   3. the accessibility invariant reports a bare `<div aria-label>`
 *      and ignores a `<div role="group" aria-label>`,
 *   4. `evaluateThresholds` fails a regressed card shape and passes a
 *      healthy one — i.e. the ceiling in the report is real, not
 *      decoration,
 *   5. the CLI refuses a catalogue smaller than the 100+ boundary the
 *      Issue measures, and refuses unknown options.
 *
 * These run as part of `pnpm test` (node --test, see
 * `package.json#scripts.test`).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CLEANUP_SQL,
	FIXTURE_ID_PREFIX,
	NAMING_ROLES,
	PER_CARD_NODE_CEILING,
	buildFixtureRows,
	collectNamingViolations,
	evaluateThresholds,
	fixtureBatchStatements,
	fixtureProjectStatement,
	parseArgs,
	resolveRole,
} from './perf-large-list.mjs';

const healthyReport = () => ({
	expectedTotal: 120,
	pageSize: 100,
	cards: { list: 100, afterLoadMore: 120 },
	domNodes: { list: 1900, perCard: 19, perCardCeiling: PER_CARD_NODE_CEILING },
	a11y: { namingViolations: 0, imagesWithoutAlt: 0 },
	consoleErrors: [],
});

describe('perf-large-list — fixture generator', () => {
	it('is deterministic', () => {
		assert.deepEqual(buildFixtureRows(5), buildFixtureRows(5));
	});

	it('produces synthetic, prefix-scoped, slug-safe rows', () => {
		const rows = buildFixtureRows(120);
		assert.equal(rows.length, 120);
		for (const row of rows) {
			assert.ok(row.id.startsWith(FIXTURE_ID_PREFIX), `id not scoped: ${row.id}`);
			assert.match(row.slug, /^[a-z0-9][a-z0-9-]{0,127}$/);
			assert.match(row.title, /^Fixture project \d{3}$/);
		}
		// Unique ids and slugs: the loader paginates on `id` as the
		// final tiebreaker, so duplicates would break the cursor.
		assert.equal(new Set(rows.map((r) => r.id)).size, 120);
		assert.equal(new Set(rows.map((r) => r.slug)).size, 120);
	});

	it('cycles the closed facet enum and pins every tenth row', () => {
		const rows = buildFixtureRows(4);
		assert.deepEqual(
			rows.map((r) => r.facet),
			['develop', 'design', 'video', 'other'],
		);
		assert.equal(rows[0].pinned, 1);
		assert.equal(rows[1].pinned, 0);
	});

	it('orders rows in the canonical sort order the cursor loader uses', () => {
		const rows = buildFixtureRows(10);
		const orders = rows.map((r) => r.displayOrder);
		assert.deepEqual(
			orders,
			[...orders].sort((a, b) => a - b),
		);
		const updated = rows.map((r) => r.updatedAt);
		assert.deepEqual(
			updated,
			[...updated].sort((a, b) => b - a),
		);
	});
});

describe('perf-large-list — generated SQL', () => {
	it('stays inside the migration CHECK constraints', () => {
		const sql = fixtureProjectStatement(buildFixtureRows(1)[0]);
		assert.match(sql, /'public'/);
		assert.match(sql, /'published'/);
		assert.ok(sql.includes('\'["develop"]\''), `facets not encoded as JSON text: ${sql}`);
		// No quoting hazard: every interpolated literal is generated
		// from a fixed template, never from operator input.
		assert.equal(sql.match(/'/g).length % 2, 0);
	});

	it('emits projects before media rows and omits media by default', () => {
		const rows = buildFixtureRows(2);
		const withoutMedia = fixtureBatchStatements(rows);
		assert.equal(withoutMedia.length, 2);
		const withMedia = fixtureBatchStatements(rows, { withMedia: true });
		assert.equal(withMedia.length, 4);
		assert.ok(withMedia[2].sql.startsWith('INSERT OR REPLACE INTO portfolio_media'));
		assert.ok(withMedia[2].sql.includes(withMedia[0].sql.match(/VALUES \('([^']+)'/)[1]));
	});

	it('scopes cleanup to the fixture id prefix only', () => {
		for (const sql of CLEANUP_SQL) {
			assert.match(sql, /DELETE FROM portfolio_(media|link|project)/);
			assert.match(sql, new RegExp(`LIKE '${FIXTURE_ID_PREFIX}%'`));
		}
	});
});

describe('perf-large-list — accessibility invariant', () => {
	it('flags aria-label on an element whose role is generic', () => {
		const violations = collectNamingViolations([
			{ tag: 'div', role: null, ariaLabel: 'facets' },
			{ tag: 'figure', role: 'img', ariaLabel: 'cover' },
		]);
		assert.deepEqual(violations, ['div[aria-label="facets"]']);
	});

	it('accepts the fixed shape: an explicit naming role', () => {
		const violations = collectNamingViolations([
			{ tag: 'div', role: 'group', ariaLabel: 'facets' },
		]);
		assert.deepEqual(violations, []);
	});

	it('accepts implicit roles — <nav aria-label> is conformant', () => {
		const violations = collectNamingViolations([
			{ tag: 'nav', role: null, ariaLabel: 'Public' },
			{ tag: 'a', role: null, ariaLabel: 'ホーム / Home' },
			{ tag: 'main', role: null, ariaLabel: '本文' },
			{ tag: 'section', role: null, ariaLabel: 'projects' },
		]);
		assert.deepEqual(violations, []);
	});

	it('ignores elements without a label and roles that do not name', () => {
		const violations = collectNamingViolations([
			{ tag: 'div', role: null, ariaLabel: null },
			{ tag: 'div', role: null, ariaLabel: '' },
			{ tag: 'div', role: 'presentation', ariaLabel: 'facets' },
			{ tag: 'span', role: null, ariaLabel: 'facets' },
		]);
		assert.deepEqual(violations, ['div[aria-label="facets"]', 'span[aria-label="facets"]']);
	});

	it('keeps generic roles out of the naming allowlist', () => {
		for (const role of ['generic', 'presentation', 'none']) {
			assert.equal(NAMING_ROLES.has(role), false);
		}
	});

	it('resolves the effective role, explicit attribute winning', () => {
		assert.equal(resolveRole('div', 'group'), 'group');
		assert.equal(resolveRole('div', 'group listitem'), 'group');
		assert.equal(resolveRole('nav', null), 'navigation');
		assert.equal(resolveRole('div', null), 'generic');
	});
});

describe('perf-large-list — thresholds', () => {
	it('passes a healthy boundary measurement', () => {
		const report = healthyReport();
		const verdict = evaluateThresholds(report);
		assert.equal(verdict.pass, true, verdict.failures.join('; '));
	});

	it('fails when one card stops being one card', () => {
		const report = healthyReport();
		// 100 cards at 21 nodes each — one node over the ceiling.
		report.domNodes.list = 2100;
		const verdict = evaluateThresholds(report);
		assert.equal(verdict.pass, false);
		assert.ok(verdict.failures.some((f) => f.includes('DOM nodes per card')));
	});

	it('fails a short first page and a lost append', () => {
		const short = healthyReport();
		short.cards.list = 40;
		assert.ok(
			evaluateThresholds(short).failures.some((f) => f.includes('expected the full page size')),
		);

		const lost = healthyReport();
		lost.cards.afterLoadMore = 100;
		assert.ok(
			evaluateThresholds(lost).failures.some((f) => f.includes('expected the full catalogue')),
		);
	});

	it('fails on aria violations, missing alt and page errors', () => {
		const report = healthyReport();
		report.a11y.namingViolations = 120;
		report.a11y.imagesWithoutAlt = 1;
		report.consoleErrors = ['boom'];
		const failures = evaluateThresholds(report).failures;
		assert.equal(failures.length, 3);
	});

	it('treats a zero-card render as a failure, not as a pass', () => {
		const report = healthyReport();
		report.cards = { list: 0, afterLoadMore: 0 };
		const verdict = evaluateThresholds(report);
		assert.equal(verdict.pass, false);
	});
});

describe('perf-large-list — CLI contract', () => {
	it('defaults to the 120-row / 100-page boundary', () => {
		const options = parseArgs([]);
		assert.equal(options.count, 120);
		assert.equal(options.pageSize, 100);
		assert.equal(options.cpuThrottle, 4);
		assert.equal(options.screenshot, 'docs/verification/perf/large-list-pagination.png');
	});

	it('refuses a catalogue below the 100+ boundary', () => {
		assert.throws(() => parseArgs(['--count=40']), /100\+/);
	});

	it('refuses a catalogue that cannot produce a second page', () => {
		assert.throws(() => parseArgs(['--count=100', '--page-size=100']), /boundary exists/);
	});

	it('refuses unknown options', () => {
		assert.throws(() => parseArgs(['--nope=1']), /unknown option/);
	});
});
