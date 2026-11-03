import { describe, expect, it } from 'vitest';
import {
	CONTENT_SIGNAL_FAMILIES,
	contentSignalFamily,
	contentSignalToken,
	hashContentSeed,
} from './content-signal';

/**
 * The content-signal contract (Issue #764, direction B).
 *
 * The point of this file is determinism. A colour that changes between
 * two renders of the same item is worse than no colour: the reader
 * learns a cue that is not a cue. These tests pin the three properties
 * the rule promises — a stable family list, the shipped category hues,
 * and a seed-to-family mapping that does not move.
 */
describe('content-signal assignment', () => {
	it('keeps the three content categories on their existing hue', () => {
		expect(contentSignalFamily('design')).toBe('rose');
		expect(contentSignalFamily('code')).toBe('cyan');
		expect(contentSignalFamily('writing')).toBe('amber');
	});

	it('gives a Tool no content hue of its own (colour system III)', () => {
		// Issue #812 adopted three content families and made the Tool
		// face ink. `tool` is therefore hashed like any unknown seed: the
		// point is that it is not a CATEGORY with a fixed fourth hue.
		expect(CONTENT_SIGNAL_FAMILIES).toHaveLength(3);
		expect(CONTENT_SIGNAL_FAMILIES).toEqual(['rose', 'cyan', 'amber']);
		expect(contentSignalToken('tool')).toMatch(/^signal\.content\.(rose|cyan|amber)$/);
	});

	it('assigns the same family for the same seed every time', () => {
		for (const seed of ['alpha', 'portfolio/example', '設計', '', 'tool']) {
			const first = contentSignalFamily(seed);
			expect(contentSignalFamily(seed)).toBe(first);
		}
	});

	it('only ever returns a declared family', () => {
		for (let index = 0; index < 200; index += 1) {
			const seed = `seed-${index}`;
			expect(CONTENT_SIGNAL_FAMILIES).toContain(contentSignalFamily(seed));
		}
	});

	it('spreads unknown seeds across more than one family', () => {
		const used = new Set(
			Array.from({ length: 100 }, (_, index) => contentSignalFamily(`project-${index}`)),
		);
		// The hash is not required to be uniform, only not degenerate:
		// a rule that sent every unknown seed to one hue would be the
		// "only one colour is usable" situation direction B forbids.
		expect(used.size).toBeGreaterThan(1);
	});

	it('publishes the token path the semantic layer declares', () => {
		expect(contentSignalToken('design')).toBe('signal.content.rose');
		expect(contentSignalToken('unknown-seed')).toMatch(/^signal\.content\.(rose|cyan|amber)$/);
	});

	it('hashes without depending on the platform', () => {
		// Pinned value: if this changes, every unknown seed is silently
		// re-coloured. Changing it is a visual-language decision, not a
		// refactor.
		expect(hashContentSeed('my-web-2026')).toBe(4151638997);
	});
});
