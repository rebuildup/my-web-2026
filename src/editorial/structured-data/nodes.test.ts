import { describe, expect, it } from 'vitest';
import { buildCreativeWorkNode, buildPersonNode, buildPersonReference } from './nodes';
import type { CreativeWorkFacts, PersonFacts } from './types';

/**
 * Builder tests (Issue #422).
 *
 * The builders are fail-closed projections: they copy what they are
 * given, drop what is absent, and return `null` when a node would be
 * meaningless. They never invent a placeholder, because a placeholder
 * in structured data is a fabricated fact with a machine-readable
 * shape around it.
 */

const PERSON: PersonFacts = {
	name: '木村友亮 / Yusuke Kimura',
	alternateName: ['samuido'],
	description: 'developer / creator',
	url: 'https://rebuildup.dev/about',
	sameAs: ['https://github.com/rebuildup', 'https://x.com/samuido'],
};

const AUTHOR: PersonFacts = {
	name: 'Yusuke Kimura',
	url: 'https://rebuildup.dev/about',
	sameAs: [],
};

const WORK: CreativeWorkFacts = {
	name: 'Aulymo',
	description: 'After Effects で lyric motion を作るための tool。',
	url: 'https://rebuildup.dev/portfolio/aulymo',
	dateCreated: '2022',
	dateModified: '2026-01-02T00:00:00.000Z',
};

describe('buildPersonNode', () => {
	it('projects only the supplied facts under a derived @id', () => {
		expect(buildPersonNode(PERSON)).toEqual({
			'@context': 'https://schema.org',
			'@type': 'Person',
			'@id': 'https://rebuildup.dev/about#person',
			name: '木村友亮 / Yusuke Kimura',
			url: 'https://rebuildup.dev/about',
			sameAs: ['https://github.com/rebuildup', 'https://x.com/samuido'],
			alternateName: ['samuido'],
			description: 'developer / creator',
		});
	});

	it('omits optional keys rather than emitting empty strings', () => {
		const node = buildPersonNode({
			name: 'Yusuke Kimura',
			url: PERSON.url,
			sameAs: [PERSON.sameAs[0] as string],
		});
		expect(node).not.toHaveProperty('description');
		expect(node).not.toHaveProperty('alternateName');
	});

	it('de-duplicates sameAs entries', () => {
		const node = buildPersonNode({
			...PERSON,
			sameAs: ['https://x.com/samuido', 'https://x.com/samuido'],
		});
		expect(node?.sameAs).toEqual(['https://x.com/samuido']);
	});

	it('returns null when the identity is unusable', () => {
		expect(buildPersonNode({ ...PERSON, name: '  ' })).toBeNull();
		expect(buildPersonNode({ ...PERSON, url: '' })).toBeNull();
	});
});

describe('buildCreativeWorkNode', () => {
	it('embeds the author inline so every @id resolves in-document', () => {
		const node = buildCreativeWorkNode(WORK, AUTHOR);
		expect(node).toEqual({
			'@context': 'https://schema.org',
			'@type': 'CreativeWork',
			'@id': 'https://rebuildup.dev/portfolio/aulymo#creativework',
			name: 'Aulymo',
			description: WORK.description,
			url: 'https://rebuildup.dev/portfolio/aulymo',
			author: {
				'@type': 'Person',
				'@id': 'https://rebuildup.dev/about#person',
				name: 'Yusuke Kimura',
				url: 'https://rebuildup.dev/about',
			},
			dateCreated: '2022',
			dateModified: '2026-01-02T00:00:00.000Z',
		});
	});

	it('omits image when the row has no usable cover URL', () => {
		const node = buildCreativeWorkNode({ ...WORK, imageUrl: null }, AUTHOR);
		expect(node).not.toHaveProperty('image');
	});

	it('keeps image when the cover URL is present', () => {
		const node = buildCreativeWorkNode(
			{ ...WORK, imageUrl: 'https://media.rebuildup.dev/a.webp' },
			AUTHOR,
		);
		expect(node?.image).toBe('https://media.rebuildup.dev/a.webp');
	});

	it('omits dates the source does not record', () => {
		const node = buildCreativeWorkNode(
			{ name: WORK.name, description: WORK.description, url: WORK.url },
			AUTHOR,
		);
		expect(node).not.toHaveProperty('dateCreated');
		expect(node).not.toHaveProperty('dateModified');
	});

	it('returns null when the work or the author is unusable', () => {
		expect(buildCreativeWorkNode({ ...WORK, name: '' }, AUTHOR)).toBeNull();
		expect(buildCreativeWorkNode({ ...WORK, description: '' }, AUTHOR)).toBeNull();
		expect(buildCreativeWorkNode(WORK, { ...AUTHOR, name: '' })).toBeNull();
	});
});

describe('buildPersonReference', () => {
	it('returns the minimal inline author node', () => {
		expect(buildPersonReference(AUTHOR)).toEqual({
			'@type': 'Person',
			'@id': 'https://rebuildup.dev/about#person',
			name: 'Yusuke Kimura',
			url: 'https://rebuildup.dev/about',
		});
	});
});
