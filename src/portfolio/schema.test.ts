import { describe, expect, it } from 'vitest';
import {
	FacetSchema,
	LinkKindSchema,
	parseFacetArray,
	parseTechnologyArray,
	rowToLink,
	rowToMedia,
	rowToProject,
	SLUG_REGEX,
	SlugSchema,
	StatusSchema,
	VisibilitySchema,
} from './schema';

/**
 * Schema unit tests — pure function coverage for the
 * JSON-encoded column parsers and row → public-shape
 * converters. No D1 / no env — these run on the standard
 * Vitest pool so they stay fast and isolated.
 *
 * The DI-seam-based integration tests for `load.ts` live in
 * `load.test.ts`.
 */

describe('schema — SlugSchema', () => {
	it.each([
		['aulymo', true],
		['multi-slicer', true],
		['tastile', true],
		['a', true],
		['a'.repeat(128), true],
		['a'.repeat(129), false],
		['Aulymo', false], // uppercase rejected
		['-leading-dash', false], // must start with alphanumeric
		['', false],
		['with space', false],
		['with_underscore', false], // grammar: [a-z0-9-] only
	])('SlugSchema.safeParse(%j) → %s', (input, ok) => {
		const result = SlugSchema.safeParse(input);
		expect(result.success).toBe(ok);
	});
});

describe('schema — enums', () => {
	it.each(['develop', 'video', 'design', 'other'])('FacetSchema accepts %s', (v) => {
		expect(FacetSchema.safeParse(v).success).toBe(true);
	});
	it('FacetSchema rejects unknown', () => {
		expect(FacetSchema.safeParse('audio').success).toBe(false);
	});

	it.each(['public', 'unlisted', 'draft'])('VisibilitySchema accepts %s', (v) => {
		expect(VisibilitySchema.safeParse(v).success).toBe(true);
	});

	it.each(['published', 'archived'])('StatusSchema accepts %s', (v) => {
		expect(StatusSchema.safeParse(v).success).toBe(true);
	});

	it.each(['repo', 'demo', 'release', 'article', 'shop', 'video', 'other'])(
		'LinkKindSchema accepts %s',
		(v) => {
			expect(LinkKindSchema.safeParse(v).success).toBe(true);
		},
	);
});

describe('schema — parseFacetArray / parseTechnologyArray', () => {
	it('parses valid facet arrays', () => {
		expect(parseFacetArray('["develop","video"]')).toEqual(['develop', 'video']);
	});
	it('drops invalid facets silently', () => {
		expect(parseFacetArray('["develop","unknown","video"]')).toEqual(['develop', 'video']);
	});
	it('returns [] on malformed JSON', () => {
		expect(parseFacetArray('not-json')).toEqual([]);
	});
	it('returns [] on non-array JSON', () => {
		expect(parseFacetArray('{"facets":1}')).toEqual([]);
	});
	it('returns [] on empty string', () => {
		expect(parseFacetArray('')).toEqual([]);
	});

	it('parses technology array keeping strings only', () => {
		expect(parseTechnologyArray('["TypeScript",1,"Rust",null]')).toEqual(['TypeScript', 'Rust']);
	});
});

describe('schema — row converters', () => {
	it('rowToLink passes through and defaults invalid kind to "other"', () => {
		const valid = rowToLink({
			id: 'l1',
			project_id: 'p1',
			kind: 'repo',
			label: null,
			url: 'https://example.com',
			display_order: 0,
			created_at: 1,
		});
		expect(valid).toEqual({
			id: 'l1',
			kind: 'repo',
			label: null,
			url: 'https://example.com',
			displayOrder: 0,
		});

		const fallback = rowToLink({
			id: 'l2',
			project_id: 'p1',
			kind: 'weblink',
			label: null,
			url: 'https://example.com',
			display_order: 0,
			created_at: 1,
		});
		expect(fallback.kind).toBe('other');
	});

	it('rowToMedia produces a public shape with url=null (composed by loader)', () => {
		const out = rowToMedia({
			id: 'm1',
			project_id: 'p1',
			r2_key: 'portfolio/aulymo/cover.webp',
			content_type: 'image/webp',
			width: 1200,
			height: 800,
			alt: 'Aulymo splash',
			caption: null,
			is_cover: 1,
			display_order: 0,
			created_at: 1,
		});
		expect(out).toMatchObject({
			id: 'm1',
			r2Key: 'portfolio/aulymo/cover.webp',
			isCover: true,
			url: null,
		});
	});

	it('rowToMedia isCover flag maps 0 → false', () => {
		const out = rowToMedia({
			id: 'm2',
			project_id: 'p1',
			r2_key: 'portfolio/aulymo/thumb.webp',
			content_type: 'image/webp',
			width: null,
			height: null,
			alt: 'thumb',
			caption: null,
			is_cover: 0,
			display_order: 1,
			created_at: 1,
		});
		expect(out.isCover).toBe(false);
	});

	it('rowToProject converts all snake_case fields and parses JSON columns', () => {
		const out = rowToProject(
			{
				id: 'p1',
				slug: 'aulymo',
				title: 'Aulymo',
				summary: 'Lyric motion tool',
				role: 'Solo developer',
				period_start: Date.UTC(2022, 0, 1),
				period_end: null,
				period_label: '2022 - present',
				motivation_md: '',
				architecture_md: null,
				constraints_md: null,
				implementation_md: null,
				evidence_md: null,
				retrospective_md: null,
				facets: '["develop","design"]',
				technologies: '["After Effects"]',
				visibility: 'public',
				status: 'published',
				pinned: 1,
				display_order: 0,
				created_at: 1,
				updated_at: 2,
			},
			[],
			[],
		);
		expect(out).toMatchObject({
			id: 'p1',
			slug: 'aulymo',
			periodEnd: null,
			facets: ['develop', 'design'],
			technologies: ['After Effects'],
			visibility: 'public',
			status: 'published',
			pinned: true,
		});
	});

	it('rowToProject falls back to safe defaults on invalid JSON / unknown enums', () => {
		const out = rowToProject(
			{
				id: 'p2',
				slug: 'broken',
				title: 'Broken row',
				summary: '',
				role: '',
				period_start: 0,
				period_end: null,
				period_label: null,
				motivation_md: '',
				architecture_md: null,
				constraints_md: null,
				implementation_md: null,
				evidence_md: null,
				retrospective_md: null,
				facets: 'not-json',
				technologies: '[]',
				visibility: 'invalid',
				status: 'unknown',
				pinned: 0,
				display_order: 0,
				created_at: 0,
				updated_at: 0,
			},
			[],
			[],
		);
		expect(out.facets).toEqual([]);
		expect(out.technologies).toEqual([]);
		expect(out.visibility).toBe('draft');
		expect(out.status).toBe('archived');
		expect(out.pinned).toBe(false);
	});
});

describe('schema — SLUG_REGEX sanity', () => {
	it('matches the documented grammar', () => {
		expect(SLUG_REGEX.test('aulymo')).toBe(true);
		expect(SLUG_REGEX.test('multi-slicer')).toBe(true);
		expect(SLUG_REGEX.test('a')).toBe(true);
		expect(SLUG_REGEX.test('-leading')).toBe(false);
	});
});
