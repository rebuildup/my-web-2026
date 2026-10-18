import { describe, expect, it } from 'vitest';
import {
	type SlugGrammar,
	assertNoSlugCollisions,
	classifySlugCandidate,
	describeSlugGrammar,
	describeSlugRejection,
	findSlugCollisions,
	formatSlugCollisions,
} from './slug-identity';

/**
 * URL slug identity policy (Issue #433).
 *
 * The grammar below is a local stand-in with the same shape as the two
 * owner-owned grammars. The real ones are exercised through the shared
 * decision table in `./fixtures.test.ts`; this file tests the
 * classification order and the collision audit itself.
 */
const EMOJI_LIKE: SlugGrammar = {
	name: 'emoji-like-slug',
	pattern: /^[a-z][a-z0-9_]*$/,
	maxLength: 16,
};

describe('classifySlugCandidate — acceptance', () => {
	it('accepts an ASCII slug that fits the grammar and returns it unchanged', () => {
		const verdict = classifySlugCandidate('thumbs_up', EMOJI_LIKE);
		expect(verdict).toEqual({ ok: true, slug: 'thumbs_up' });
	});

	it('accepts the single shortest possible slug', () => {
		expect(classifySlugCandidate('a', EMOJI_LIKE)).toEqual({ ok: true, slug: 'a' });
	});

	it('accepts a slug of exactly the maximum length', () => {
		const slug = `a${'b'.repeat(EMOJI_LIKE.maxLength - 1)}`;
		expect(classifySlugCandidate(slug, EMOJI_LIKE).ok).toBe(true);
	});
});

describe('classifySlugCandidate — refusals carry a reason', () => {
	it('refuses a non-string', () => {
		for (const value of [undefined, null, 0, {}, ['a']]) {
			expect(classifySlugCandidate(value, EMOJI_LIKE)).toEqual({
				ok: false,
				reason: 'not-a-string',
				offenders: [],
			});
		}
	});

	it('refuses an empty candidate', () => {
		expect(classifySlugCandidate('', EMOJI_LIKE)).toEqual({
			ok: false,
			reason: 'empty',
			offenders: [],
		});
	});

	it('refuses a precomposed accent as non-ASCII and names the code point', () => {
		const verdict = classifySlugCandidate('caf\u00e9', EMOJI_LIKE);
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.reason).toBe('non-ascii');
		expect(verdict.offenders.map((fact) => fact.hex)).toEqual(['U+00E9']);
	});

	it('refuses the decomposed spelling for the same reason', () => {
		const verdict = classifySlugCandidate('cafe\u0301', EMOJI_LIKE);
		if (verdict.ok) throw new Error('expected a refusal');
		expect(verdict.reason).toBe('non-ascii');
		expect(verdict.offenders.map((fact) => fact.hex)).toEqual(['U+0301']);
	});

	it('refuses a non-ASCII candidate even when it would also fail the grammar', () => {
		// The reason has to be the policy, not the grammar: otherwise a
		// reader cannot tell "this is not a URL" from "this is not a
		// valid emoji slug".
		const verdict = classifySlugCandidate('Caf\u00e9', EMOJI_LIKE);
		if (verdict.ok) throw new Error('expected a refusal');
		expect(verdict.reason).toBe('non-ascii');
	});

	it('refuses an over-long candidate', () => {
		const verdict = classifySlugCandidate('a'.repeat(EMOJI_LIKE.maxLength + 1), EMOJI_LIKE);
		expect(verdict).toEqual({ ok: false, reason: 'too-long', offenders: [] });
	});

	it('refuses ASCII that does not fit the grammar', () => {
		for (const value of ['Thumbs_Up', '1leading', 'with-dash', 'with space']) {
			const verdict = classifySlugCandidate(value, EMOJI_LIKE);
			if (verdict.ok) throw new Error(`expected ${value} to be refused`);
			expect(verdict.reason).toBe('grammar-mismatch');
		}
	});

	it('never mints a slug out of a confusable word', () => {
		// The whole point: NFKC would have produced "finance" here.
		const verdict = classifySlugCandidate('\ufb01nance', EMOJI_LIKE);
		if (verdict.ok) throw new Error('a confusable must never become a URL');
		expect('slug' in verdict).toBe(false);
	});
});

describe('describeSlugRejection', () => {
	const reject = (value: unknown): string => {
		const verdict = classifySlugCandidate(value, EMOJI_LIKE);
		if (verdict.ok) throw new Error(`expected ${String(value)} to be refused`);
		return describeSlugRejection(verdict, EMOJI_LIKE);
	};

	it('keeps the length wording the slug owners already use', () => {
		expect(reject('')).toBe('must be 1..16 chars');
		expect(reject('a'.repeat(17))).toBe('must be 1..16 chars');
	});

	it('states the grammar for an ASCII mismatch', () => {
		expect(reject('Thumbs_Up')).toBe('must match ^[a-z][a-z0-9_]*$');
	});

	it('names the offending code point and the refusal for non-ASCII', () => {
		expect(reject('caf\u00e9')).toContain('U+00E9 LATIN SMALL LETTER E WITH ACUTE');
		expect(reject('caf\u00e9')).toContain('transliteration and diacritic stripping are refused');
	});

	it('describes a grammar so a relaxation has to argue with it', () => {
		expect(describeSlugGrammar(EMOJI_LIKE)).toBe(
			'emoji-like-slug: /^[a-z][a-z0-9_]*$/ , 1..16 chars, ASCII only',
		);
	});
});

describe('findSlugCollisions', () => {
	it('reports nothing for a clean catalog', () => {
		expect(
			findSlugCollisions([
				{ id: 'a', slug: 'aulymo', displayText: 'Aulymo' },
				{ id: 'b', slug: 'multi-slicer', displayText: 'Multi slicer' },
			]),
		).toEqual([]);
	});

	it('reports two entries claiming one URL', () => {
		const collisions = findSlugCollisions([
			{ id: 'a', slug: 'thumbs_up', displayText: 'Thumbs up' },
			{ id: 'b', slug: 'thumbs_up', displayText: 'Thumbs up!' },
		]);
		expect(collisions).toHaveLength(1);
		expect(collisions[0].kind).toBe('duplicate-url');
		expect(collisions[0].key).toBe('thumbs_up');
		expect(collisions[0].ids).toEqual(['a', 'b']);
	});

	it('reports one word filed under two URLs because of its normalization form', () => {
		const collisions = findSlugCollisions([
			{ id: 'nfc', slug: 'caf-a', displayText: 'Caf\u00e9' },
			{ id: 'nfd', slug: 'caf-b', displayText: 'Cafe\u0301' },
		]);
		expect(collisions).toHaveLength(1);
		expect(collisions[0].kind).toBe('normalization-alias');
		expect(collisions[0].slugs).toEqual(['caf-a', 'caf-b']);
		expect(collisions[0].detail).toContain('NFC/NFD spellings');
	});

	it('reports one identical title filed under two URLs', () => {
		const collisions = findSlugCollisions([
			{ id: 'a', slug: 'area-10', displayText: '10 ㎡' },
			{ id: 'b', slug: 'area-ten', displayText: '10 ㎡' },
		]);
		expect(collisions).toHaveLength(1);
		expect(collisions[0].kind).toBe('normalization-alias');
		expect(collisions[0].detail).toContain('one title is filed under 2 URLs');
	});

	it('does not report two genuinely different titles as aliases', () => {
		expect(
			findSlugCollisions([
				{ id: 'a', slug: 'caf-a', displayText: 'Caf\u00e9' },
				{ id: 'b', slug: 'cafe', displayText: 'Cafe' },
			]),
		).toEqual([]);
	});

	it('ignores entries without display text (slug-only callers)', () => {
		expect(
			findSlugCollisions([
				{ id: 'a', slug: 'thumbs_up' },
				{ id: 'b', slug: 'tada' },
			]),
		).toEqual([]);
	});

	it('sorts duplicate URLs before aliases so a report reads deterministically', () => {
		const collisions = findSlugCollisions([
			{ id: 'nfc', slug: 'caf-b', displayText: 'Cafe\u0301' },
			{ id: 'dup1', slug: 'thumbs_up', displayText: 'A' },
			{ id: 'dup2', slug: 'thumbs_up', displayText: 'B' },
			{ id: 'nfd', slug: 'caf-a', displayText: 'Caf\u00e9' },
		]);
		expect(collisions.map((collision) => collision.kind)).toEqual([
			'duplicate-url',
			'normalization-alias',
		]);
	});
});

describe('assertNoSlugCollisions', () => {
	it('passes a clean catalog', () => {
		expect(() =>
			assertNoSlugCollisions([{ id: 'a', slug: 'thumbs_up', displayText: 'Thumbs up' }]),
		).not.toThrow();
	});

	it('throws with the Issue reference and both findings', () => {
		expect(() =>
			assertNoSlugCollisions([
				{ id: 'a', slug: 'x', displayText: 'S\u00e4me' },
				{ id: 'b', slug: 'x', displayText: 'Other' },
				{ id: 'c', slug: 'y', displayText: 'Sa\u0308me' },
			]),
		).toThrow(/Issue #433/);
	});

	it('formats an empty finding list as an empty string', () => {
		expect(formatSlugCollisions([])).toBe('');
	});
});
