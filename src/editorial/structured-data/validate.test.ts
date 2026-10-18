import { describe, expect, it } from 'vitest';
import { buildCreativeWorkNode, buildPersonNode } from './nodes';
import type { CreativeWorkFacts, PersonFacts } from './types';
import { isSchemaDate, validateStructuredData } from './validate';

/**
 * Validator unit + negative-control tests (Issue #422).
 *
 * Every rule asserted here has a negative control: a payload that
 * MUST be rejected. Without them a validator that returned
 * `{ valid: true }` unconditionally would pass the same suite, and
 * the report screenshot would be evidence of nothing.
 *
 * The fixtures are synthetic on purpose — this file validates the
 * validator. Real repo data is validated in
 * `src/about/structured-data.test.ts`,
 * `src/portfolio/structured-data.test.ts` and
 * `test/integration/structured-data.test.ts` (against real SSR HTML).
 */

const PERSON_FACTS: PersonFacts = {
	name: 'Yusuke Kimura',
	alternateName: ['samuido'],
	description: 'developer / creator',
	url: 'https://rebuildup.dev/about',
	sameAs: ['https://github.com/rebuildup'],
};

const AUTHOR_FACTS: PersonFacts = {
	name: 'Yusuke Kimura',
	url: 'https://rebuildup.dev/about',
	sameAs: ['https://github.com/rebuildup'],
};

const WORK_FACTS: CreativeWorkFacts = {
	name: 'Aulymo — After Effects lyric motion tool',
	description: 'After Effects で lyric motion を作るための tool。',
	url: 'https://rebuildup.dev/portfolio/aulymo',
	dateCreated: '2022',
	dateModified: '2026-01-02T00:00:00.000Z',
};

function personNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...(buildPersonNode(PERSON_FACTS) as object), ...overrides };
}

function codesFor(nodes: readonly unknown[], approvedSameAs?: readonly string[]): string[] {
	return validateStructuredData(nodes, { approvedSameAs }).findings.map((f) => f.code);
}

describe('validateStructuredData — accepts what the contract declares', () => {
	it('accepts a Person node built from approved facts', () => {
		const node = buildPersonNode(PERSON_FACTS);
		expect(node).not.toBeNull();
		const validation = validateStructuredData([node], {
			approvedSameAs: PERSON_FACTS.sameAs,
		});
		expect(validation.findings).toEqual([]);
		expect(validation.valid).toBe(true);
	});

	it('accepts a CreativeWork node with an inline Person author', () => {
		const node = buildCreativeWorkNode(WORK_FACTS, AUTHOR_FACTS);
		expect(validateStructuredData([node as unknown]).findings).toEqual([]);
	});

	it('accepts the BreadcrumbList shape owned by the nav module', () => {
		const breadcrumb = {
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 1,
					name: 'About',
					item: 'https://rebuildup.dev/about',
				},
			],
		};
		expect(validateStructuredData([breadcrumb]).findings).toEqual([]);
	});

	it('reports Rich Results as NOT evaluated — never as a pass', () => {
		// The distinction is the point of the Issue: schema validity
		// and Rich Results support are different systems, and a
		// green validator must never read as "Google will show it".
		const validation = validateStructuredData([buildPersonNode(PERSON_FACTS)]);
		expect(validation.richResults.evaluated).toBe(false);
		expect(validation.richResults.reason).toContain('Rich Results');
		expect(validation.richResults.reference).toMatch(/^https:\/\//);
	});
});

describe('validateStructuredData — negative controls (no silent pass)', () => {
	it('rejects an award / education / credential the repository has no record for', () => {
		for (const property of [
			'award',
			'education',
			'alumniOf',
			'hasCredential',
			'jobTitle',
			'affiliation',
			'knowsAbout',
		]) {
			expect(
				codesFor([personNode({ [property]: 'U-16 プログラミングコンテスト 技術賞' })]),
			).toContain('unapproved-property');
		}
	});

	it('rejects an undeclared @type instead of ignoring it', () => {
		expect(codesFor([personNode({ '@type': 'WebSite' })])).toContain('unknown-type');
	});

	it('rejects a wrong or missing @context', () => {
		expect(codesFor([personNode({ '@context': 'http://schema.org' })])).toContain('context');
		expect(codesFor([personNode({ '@context': undefined })])).toContain('context');
	});

	it('rejects a relative url', () => {
		expect(codesFor([personNode({ url: '/about' })])).toContain('invalid-url');
	});

	it('rejects a url outside the canonical origin', () => {
		expect(codesFor([personNode({ url: 'https://example.com/about' })])).toContain(
			'off-canonical-origin',
		);
	});

	it('rejects an invented sameAs profile', () => {
		const node = personNode({
			sameAs: ['https://github.com/rebuildup', 'https://elsewhere.test/me'],
		});
		expect(codesFor([node], ['https://github.com/rebuildup'])).toContain('unapproved-same-as');
	});

	it('rejects an empty sameAs list — the identity must be verifiable off-site', () => {
		expect(codesFor([personNode({ sameAs: [] })])).toContain('missing-required');
	});

	it('rejects an empty name', () => {
		expect(codesFor([personNode({ name: '   ' })])).toContain('empty-value');
	});

	it('rejects a node that is not an object', () => {
		expect(codesFor(['https://schema.org/Person'])).toContain('node-not-object');
	});

	it('rejects an unknown reserved key', () => {
		expect(codesFor([personNode({ '@graph': [] })])).toContain('reserved-property');
	});

	it('rejects a date that names a day which does not exist', () => {
		// `new Date('2026-02-31')` silently rolls over to 2026-03-03,
		// so a format-only check would accept an impossible date.
		expect(
			codesFor([buildCreativeWorkNode({ ...WORK_FACTS, dateCreated: '2026-02-31' }, AUTHOR_FACTS)]),
		).toContain('invalid-date');
		expect(
			codesFor([buildCreativeWorkNode({ ...WORK_FACTS, dateCreated: '2025-13' }, AUTHOR_FACTS)]),
		).toContain('invalid-date');
	});

	it('rejects a bare @id reference that no node in the document declares', () => {
		const node = buildCreativeWorkNode(WORK_FACTS, AUTHOR_FACTS) as Record<string, unknown>;
		const dangling = {
			...node,
			author: { '@id': 'https://rebuildup.dev/about#person' },
		};
		expect(codesFor([dangling])).toContain('dangling-reference');
	});

	it('rejects a CreativeWork whose url is not a portfolio surface', () => {
		const node = buildCreativeWorkNode(
			{ ...WORK_FACTS, url: 'https://rebuildup.dev/tools/aulymo' },
			AUTHOR_FACTS,
		);
		expect(codesFor([node])).toContain('off-canonical-origin');
	});

	it('rejects a CreativeWork with no author', () => {
		const { author: _omitted, ...withoutAuthor } = buildCreativeWorkNode(
			WORK_FACTS,
			AUTHOR_FACTS,
		) as Record<string, unknown>;
		expect(codesFor([withoutAuthor])).toContain('missing-required');
	});

	it('rejects breadcrumb positions that are not 1-based and sequential', () => {
		const breadcrumb = {
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 0,
					name: 'About',
					item: 'https://rebuildup.dev/about',
				},
			],
		};
		expect(codesFor([breadcrumb])).toContain('invalid-value');
	});
});

describe('isSchemaDate — real calendar dates at declared precision', () => {
	it.each(['2022', '2025-09', '2026-01-02', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00Z'])(
		'accepts %s',
		(value) => {
			expect(isSchemaDate(value)).toBe(true);
		},
	);

	it.each([
		'2026-02-31',
		'2025-13',
		'2025-00',
		'2026-1-2',
		'2026-01-02T00:00:00+09:00',
		'2026-01-02 00:00:00Z',
		'present',
	])('rejects %s', (value) => {
		expect(isSchemaDate(value)).toBe(false);
	});
});
