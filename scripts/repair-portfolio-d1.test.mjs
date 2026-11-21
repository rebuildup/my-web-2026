import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildRollbackStatements,
	detectPortfolioViolations,
	renderMarkdownReport,
	snapshotSelectStatement,
	sqlLiteral,
	summariseValue,
	valueDigest,
} from './repair-portfolio-d1.mjs';

/**
 * Fixture coverage for the portfolio D1 repair detector (Issue #1008).
 *
 * What class of defect this catches
 * ---------------------------------
 * A "repair" tool is only safe if it cannot fire on a legal state. The
 * Issue #1008 audit established that empty `role`, empty media and empty
 * links are LEGAL (Issue #813 / ADR-0019) — so the fixtures below pin
 * both directions:
 *
 *   * every repairable violation kind produces exactly the UPDATE the
 *     storage contract implies (and nothing else);
 *   * every legal-empty / already-clean shape produces ZERO repairs —
 *     a false positive here is a production write nobody asked for.
 *
 * No D1, no credentials: the detector is pure over row fixtures.
 */

function project(overrides = {}) {
	return {
		id: 'legacy_demo',
		slug: 'demo',
		title: 'Demo',
		summary: 'A demo project',
		role: '',
		period_start: 1700000000000,
		period_end: null,
		facets: '["develop"]',
		technologies: '[]',
		visibility: 'public',
		status: 'published',
		...overrides,
	};
}

function mediaRow(overrides = {}) {
	return {
		id: 'media_1',
		project_id: 'legacy_demo',
		r2_key: 'portfolio/demo/cover.webp',
		alt: 'cover',
		is_cover: 0,
		display_order: 0,
		...overrides,
	};
}

const EMPTY = { projects: [], links: [], media: [] };

describe('detectPortfolioViolations — facet-derived role', () => {
	it('flags a stored facet-kind label and proposes role = ""', () => {
		const { repairs, manualFindings } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ role: 'Development' })],
		});
		assert.equal(repairs.length, 1);
		assert.equal(repairs[0].kind, 'facet-derived-role');
		assert.equal(repairs[0].table, 'portfolio_project');
		assert.deepEqual(repairs[0].statements, [
			"UPDATE portfolio_project SET role = '' WHERE id = 'legacy_demo'",
		]);
		assert.equal(manualFindings.length, 0);
	});

	it('does NOT flag a recorded role, an empty role, or a non-public row', () => {
		const recorded = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ role: 'Solo developer' })],
		});
		assert.equal(recorded.repairs.length, 0);

		const empty = detectPortfolioViolations({ ...EMPTY, projects: [project({ role: '' })] });
		assert.equal(empty.repairs.length, 0);

		// Issue #813 scope: the facet-role check is the PUBLIC storage
		// contract — a draft row storing the label is not a public
		// violation and this tool must not write to it.
		const draft = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ role: 'Design', visibility: 'draft' })],
		});
		assert.equal(draft.repairs.length, 0);
	});
});

describe('detectPortfolioViolations — facets column', () => {
	it('rewrites invalid JSON to []', () => {
		const { repairs } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ facets: 'not-json' })],
		});
		assert.equal(repairs.length, 1);
		assert.equal(repairs[0].kind, 'facets-not-json');
		assert.deepEqual(repairs[0].statements, [
			"UPDATE portfolio_project SET facets = '[]' WHERE id = 'legacy_demo'",
		]);
	});

	it('rewrites a non-array JSON value to []', () => {
		const { repairs } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ facets: '"develop"' })],
		});
		assert.equal(repairs.length, 1);
		assert.equal(repairs[0].kind, 'facets-not-json');
	});

	it('drops out-of-enum and non-string members, preserves valid order', () => {
		const { repairs } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ facets: '["design","bogus",5,"video"]' })],
		});
		assert.equal(repairs.length, 1);
		assert.equal(repairs[0].kind, 'facets-unknown-values');
		assert.deepEqual(repairs[0].statements, [
			`UPDATE portfolio_project SET facets = '["design","video"]' WHERE id = 'legacy_demo'`,
		]);
	});

	it('leaves clean arrays — including duplicates and drafts — alone', () => {
		for (const facets of ['["develop"]', '[]', '["develop","develop"]']) {
			const { repairs } = detectPortfolioViolations({
				...EMPTY,
				projects: [project({ facets })],
			});
			assert.equal(repairs.length, 0, `facets=${facets} must not repair`);
		}
	});
});

describe('detectPortfolioViolations — duplicate cover media', () => {
	it('demotes every cover but the deterministic keeper', () => {
		const { repairs } = detectPortfolioViolations({
			...EMPTY,
			projects: [project()],
			media: [
				mediaRow({ id: 'm_b', is_cover: 1, display_order: 5 }),
				mediaRow({ id: 'm_a', is_cover: 1, display_order: 1 }),
				mediaRow({ id: 'm_c', is_cover: 0, display_order: 2 }),
			],
		});
		// m_a wins on display_order; m_b is demoted.
		assert.equal(repairs.length, 1);
		assert.equal(repairs[0].kind, 'duplicate-cover-media');
		assert.equal(repairs[0].rowId, 'm_b');
		assert.deepEqual(repairs[0].statements, [
			"UPDATE portfolio_media SET is_cover = 0 WHERE id = 'm_b'",
		]);
	});

	it('breaks display_order ties by lowest id', () => {
		const { repairs } = detectPortfolioViolations({
			...EMPTY,
			projects: [project()],
			media: [
				mediaRow({ id: 'm_z', is_cover: 1, display_order: 0 }),
				mediaRow({ id: 'm_a', is_cover: 1, display_order: 0 }),
			],
		});
		assert.equal(repairs.length, 1);
		assert.equal(repairs[0].rowId, 'm_z');
	});

	it('does nothing for zero or one cover', () => {
		const none = detectPortfolioViolations({
			...EMPTY,
			projects: [project()],
			media: [mediaRow({ is_cover: 0 })],
		});
		assert.equal(none.repairs.length, 0);
		const one = detectPortfolioViolations({
			...EMPTY,
			projects: [project()],
			media: [mediaRow({ is_cover: 1 }), mediaRow({ id: 'm2', is_cover: 0 })],
		});
		assert.equal(one.repairs.length, 0);
	});
});

describe('detectPortfolioViolations — legal-empty states are NOT violations', () => {
	it('empty role / empty media / empty links produce no repairs and no findings', () => {
		const { repairs, manualFindings } = detectPortfolioViolations({
			projects: [project({ role: '' })],
			links: [],
			media: [],
		});
		assert.equal(repairs.length, 0);
		assert.equal(manualFindings.length, 0);
	});
});

describe('detectPortfolioViolations — manual findings (reported, never repaired)', () => {
	it('empty identity fields are manual findings with no statements', () => {
		const { repairs, manualFindings } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ title: '', summary: '', period_start: 0 })],
		});
		assert.equal(repairs.length, 0);
		const kinds = manualFindings.map((f) => f.kind).sort();
		assert.deepEqual(kinds, ['empty-summary', 'empty-title', 'zero-period-start']);
		for (const finding of manualFindings) assert.equal(finding.statements, undefined);
	});

	it('bad link url / kind are manual findings', () => {
		const { repairs, manualFindings } = detectPortfolioViolations({
			...EMPTY,
			projects: [project()],
			links: [
				{ id: 'l1', project_id: 'legacy_demo', kind: 'repo', url: 'not a url' },
				{ id: 'l2', project_id: 'legacy_demo', kind: 'bogus', url: 'https://example.com' },
				{ id: 'l3', project_id: 'legacy_demo', kind: 'demo', url: 'ftp://example.com/x' },
			],
		});
		assert.equal(repairs.length, 0);
		const kinds = manualFindings.map((f) => f.kind).sort();
		assert.deepEqual(kinds, ['non-http-link-url', 'unknown-link-kind', 'unparseable-link-url']);
	});

	it('empty alt / bad r2_key on public media are manual; on draft media ignored', () => {
		const { repairs, manualFindings } = detectPortfolioViolations({
			...EMPTY,
			projects: [project()],
			media: [mediaRow({ id: 'm1', alt: '', r2_key: 'bad key!' })],
		});
		assert.equal(repairs.length, 0);
		assert.deepEqual(manualFindings.map((f) => f.kind).sort(), [
			'empty-media-alt',
			'invalid-media-r2-key',
		]);

		const draft = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ visibility: 'draft' })],
			media: [mediaRow({ id: 'm1', alt: '', r2_key: 'bad key!' })],
		});
		assert.equal(draft.manualFindings.length, 0);
	});

	it('invalid slug and non-deterministic legacy id are manual findings', () => {
		const { manualFindings } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ slug: 'Bad Slug!', id: 'legacy_other' })],
		});
		const kinds = manualFindings.map((f) => f.kind).sort();
		assert.deepEqual(kinds, ['invalid-slug', 'non-deterministic-legacy-id']);
	});
});

describe('sql / snapshot / rollback helpers', () => {
	it('sqlLiteral escapes single quotes and handles NULL', () => {
		assert.equal(sqlLiteral("o'brien"), "'o''brien'");
		assert.equal(sqlLiteral(null), 'NULL');
		assert.equal(sqlLiteral(42), '42');
	});

	it('valueDigest and summariseValue bound report payloads', () => {
		assert.equal(valueDigest('x').length, 12);
		assert.ok(summariseValue('a'.repeat(200)).length <= 82);
		assert.equal(summariseValue('short'), 'short');
	});

	it('snapshotSelectStatement emits one SELECT per touched table', () => {
		const selects = snapshotSelectStatement([
			{
				kind: 'facet-derived-role',
				table: 'portfolio_project',
				rowId: "p'1",
				slug: 'x',
				current: {},
				proposed: {},
				rationale: '',
				statements: [],
			},
			{
				kind: 'duplicate-cover-media',
				table: 'portfolio_media',
				rowId: 'm1',
				slug: 'x',
				current: {},
				proposed: {},
				rationale: '',
				statements: [],
			},
		]);
		assert.equal(selects.length, 2);
		assert.ok(selects.some((s) => s.includes('portfolio_project') && s.includes("'p''1'")));
		assert.ok(selects.some((s) => s.includes('portfolio_media')));
	});

	it('buildRollbackStatements restores every snapshotted column', () => {
		const snapshot = {
			rows: [
				{
					table: 'portfolio_project',
					values: { id: 'p1', slug: 'demo', role: 'Development', facets: '["design"]' },
				},
				{
					table: 'portfolio_media',
					values: { id: 'm1', project_id: 'p1', is_cover: 1 },
				},
			],
		};
		const statements = buildRollbackStatements(snapshot);
		assert.deepEqual(statements, [
			"UPDATE portfolio_project SET slug = 'demo', role = 'Development', facets = '[\"design\"]' WHERE id = 'p1'",
			"UPDATE portfolio_media SET project_id = 'p1', is_cover = 1 WHERE id = 'm1'",
		]);
	});
});

describe('renderMarkdownReport', () => {
	it('lists repairs with their SQL and manual findings in a table', () => {
		const { repairs, manualFindings } = detectPortfolioViolations({
			...EMPTY,
			projects: [project({ role: 'Video production', title: '' })],
		});
		const md = renderMarkdownReport({ target: 'local', repairs, manualFindings });
		assert.ok(md.includes('facet-derived-role'));
		assert.ok(md.includes("UPDATE portfolio_project SET role = ''"));
		assert.ok(md.includes('empty-title'));
		assert.ok(md.includes('target: local'));
	});
});
