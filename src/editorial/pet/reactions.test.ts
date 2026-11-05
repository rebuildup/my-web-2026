import { describe, expect, it } from 'vitest';
import {
	PET_DRAG_THRESHOLD_PX,
	PET_POINTER_DEAD_ZONE_PX,
	PET_POINTER_NEAR_PX,
	PET_SCROLL_REACTION_PX,
	dragPose,
	isAnimatedPose,
	lookPose,
	scrollPose,
} from './reactions';

/**
 * The companion's reactions are decisions (Issue #274).
 *
 * These are the half of "反応" that a static-markup test cannot reach:
 * the component owns listeners and timers, but every pose it can take
 * comes out of one of the three functions below. Pinning them pins the
 * behaviour the owner asked for — drag switches the look, scroll and
 * pointer produce a gaze, and `prefers-reduced-motion: reduce` silences
 * all of it while leaving the drag itself intact.
 */

const BOX = { left: 100, top: 100, width: 96, height: 104 };

describe('drag pose (Issue #274)', () => {
	it('switches to the travel strip at the reference threshold', () => {
		// The desktop Codex pet flips `running-right` / `running-left` at
		// the same 4 px. Below it, nothing moves and nothing plays.
		expect(PET_DRAG_THRESHOLD_PX).toBe(4);
		expect(dragPose(false, 4, null)).toBe('run-right');
		expect(dragPose(false, -4, null)).toBe('run-left');
		expect(dragPose(false, 3, null)).toBeNull();
		expect(dragPose(false, -3, null)).toBeNull();
	});

	it('keeps the last direction when the drag turns vertical', () => {
		expect(dragPose(false, 0, 'run-left')).toBe('run-left');
		expect(dragPose(false, 1, 'run-right')).toBe('run-right');
	});

	it('plays nothing under reduced motion, while the drag itself still works', () => {
		expect(dragPose(true, 40, null)).toBeNull();
		expect(dragPose(true, -40, 'run-right')).toBeNull();
	});
});

describe('scroll gaze (Issue #274)', () => {
	it('looks the way the reader is heading', () => {
		expect(PET_SCROLL_REACTION_PX).toBe(24);
		expect(scrollPose(false, 24)).toBe('look-down');
		expect(scrollPose(false, -24)).toBe('look-up');
	});

	it('ignores small scrolls so the gaze does not stutter', () => {
		expect(scrollPose(false, 23)).toBeNull();
		expect(scrollPose(false, -23)).toBeNull();
		expect(scrollPose(false, 0)).toBeNull();
	});

	it('never claims travel: the reaction is a gaze, not the running strip', () => {
		expect(scrollPose(false, 500)).toBe('look-down');
		expect(scrollPose(false, -500)).toBe('look-up');
	});

	it('is silent under reduced motion', () => {
		expect(scrollPose(true, 500)).toBeNull();
		expect(scrollPose(true, -500)).toBeNull();
	});
});

describe('pointer gaze (Issue #274)', () => {
	const centre = { x: BOX.left + BOX.width / 2, y: BOX.top + BOX.height / 2 };

	it('looks toward a nearby pointer', () => {
		expect(lookPose(false, { x: centre.x + 40, y: centre.y }, BOX)).toBe('look-right');
		expect(lookPose(false, { x: centre.x - 40, y: centre.y }, BOX)).toBe('look-left');
		expect(lookPose(false, { x: centre.x, y: centre.y + 40 }, BOX)).toBe('look-down');
		expect(lookPose(false, { x: centre.x, y: centre.y - 40 }, BOX)).toBe('look-up');
	});

	it('ignores a pointer that is far away', () => {
		const outside = centre.x + PET_POINTER_NEAR_PX + 1;
		expect(lookPose(false, { x: outside, y: centre.y }, BOX)).toBeNull();
	});

	it('has no direction for a pointer sitting on the sprite', () => {
		const inside = PET_POINTER_DEAD_ZONE_PX - 1;
		expect(lookPose(false, { x: centre.x + inside, y: centre.y }, BOX)).toBeNull();
		expect(lookPose(false, centre, BOX)).toBeNull();
	});

	it('is silent under reduced motion', () => {
		expect(lookPose(true, { x: centre.x + 40, y: centre.y }, BOX)).toBeNull();
	});
});

describe('animated poses (Issue #274)', () => {
	it('are exactly the multi-frame strips', () => {
		expect(isAnimatedPose('wave')).toBe(true);
		expect(isAnimatedPose('run-right')).toBe(true);
		expect(isAnimatedPose('run-left')).toBe(true);
		// The look cells are single frames: a static pose swap, so no
		// animation exists to opt out of.
		for (const pose of ['idle', 'look-up', 'look-right', 'look-down', 'look-left'] as const) {
			expect(isAnimatedPose(pose)).toBe(false);
		}
	});
});
