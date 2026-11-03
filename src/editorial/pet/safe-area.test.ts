import { describe, expect, it } from 'vitest';
import {
	PET_PAGE_PADDING_PX,
	PET_RESERVED_FOOTPRINT_PX,
	PET_SAFE_AREA_INLINE_END,
} from './safe-area';

/**
 * The reserve is written into `petSafeAreaStyle` as literals because
 * Panda's static extractor does not evaluate expressions (Issue #767).
 * These assertions are what keep those literals tied to the sprite
 * geometry instead of becoming three unexplained magic numbers.
 */
describe('pet safe area (Issue #767)', () => {
	it('reserves the resting sprite plus its margin and an 8px clearance', () => {
		// 96 * 0.62 + 24 + 8 = 91.52, rounded up.
		expect(PET_RESERVED_FOOTPRINT_PX).toBe(92);
	});

	it.each([
		['base', 16],
		['md', 24],
		['lg', 32],
	] as const)(
		'subtracts the %s page padding the Container already applies',
		(breakpoint, padding) => {
			expect(PET_PAGE_PADDING_PX[breakpoint]).toBe(padding);
			expect(PET_SAFE_AREA_INLINE_END[breakpoint]).toBe(`${PET_RESERVED_FOOTPRINT_PX - padding}px`);
		},
	);

	it('needs no extra corridor once the centred column clears the box', () => {
		expect(PET_SAFE_AREA_INLINE_END.xl).toBe('0px');
	});
});
