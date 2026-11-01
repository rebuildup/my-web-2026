import { describe, expect, it } from 'vitest';
import {
	PET_POSITION_MARGIN,
	PET_POSITION_STORAGE_KEY,
	PET_REST_INSET_BLOCK_END,
	type PetPositionStorage,
	type PetTravelInsets,
	browserPetPositionStorage,
	clampPosition,
	parseStoredPosition,
	positionToRatio,
	ratioToPosition,
	readStoredPosition,
	restingBlockEndInset,
	writeStoredPosition,
} from './position';

/**
 * Where the companion was left (Issue #274).
 *
 * The owner asked for the dragged position to be remembered in the same
 * browser AND for the character to render correctly at its initial
 * position when storage is unavailable. Both halves are provable here
 * because the module takes storage as an argument: "storage throws" is
 * a fake, not a browser setting.
 *
 * The bottom edge is a value, not a constant (Issue #783): the
 * analytics-consent surface occupies the bottom of the viewport and the
 * character has to rest above it. `restingBlockEndInset` turns that
 * surface's published height into the inset the rest of this module
 * uses, so every case below states the inset it assumes.
 */

const VIEWPORT = { width: 1280, height: 800 };
const BOX = { width: 96, height: 104 };

/** No consent surface on the page: the ordinary resting corner. */
const BARE: PetTravelInsets = { inline: PET_POSITION_MARGIN, blockEnd: PET_REST_INSET_BLOCK_END };

function fakeStorage(initial: Record<string, string> = {}): PetPositionStorage & {
	readonly values: Map<string, string>;
} {
	const values = new Map(Object.entries(initial));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

describe('pet position (Issue #274)', () => {
	it('keeps the sprite inside the viewport with the resting inset', () => {
		// The top and side edges keep the ordinary margin; only the bottom
		// is lifted, because that is the edge a fixed surface occupies.
		expect(clampPosition({ x: -400, y: -400 }, VIEWPORT, BOX, BARE)).toEqual({
			x: PET_POSITION_MARGIN,
			y: PET_POSITION_MARGIN,
		});
		expect(clampPosition({ x: 99999, y: 99999 }, VIEWPORT, BOX, BARE)).toEqual({
			x: VIEWPORT.width - BOX.width - PET_POSITION_MARGIN,
			y: VIEWPORT.height - BOX.height - PET_REST_INSET_BLOCK_END,
		});
	});

	it('degrades to the margin when the viewport is smaller than the sprite', () => {
		const tiny = { width: 80, height: 90 };
		expect(clampPosition({ x: 10, y: 10 }, tiny, BOX, BARE)).toEqual({ x: 0, y: 0 });
	});

	it('round-trips a drag through the stored ratio', () => {
		const dragged = { x: 640, y: 400 };
		const ratio = positionToRatio(dragged, VIEWPORT, BOX, BARE);
		// The travel box is the viewport minus the sprite and the insets,
		// so 0.5 is the middle of that box rather than of the screen.
		const travelX = VIEWPORT.width - BOX.width - PET_POSITION_MARGIN * 2;
		const travelY = VIEWPORT.height - BOX.height - PET_REST_INSET_BLOCK_END - PET_POSITION_MARGIN;
		expect(ratio.xRatio).toBeCloseTo((dragged.x - PET_POSITION_MARGIN) / travelX, 10);
		expect(ratio.yRatio).toBeCloseTo((dragged.y - PET_POSITION_MARGIN) / travelY, 10);
		const back = ratioToPosition(ratio, VIEWPORT, BOX, BARE);
		expect(back.x).toBeCloseTo(dragged.x, 6);
		expect(back.y).toBeCloseTo(dragged.y, 6);
	});

	it('maps ratio 1,1 to the corner the server renders', () => {
		expect(ratioToPosition({ xRatio: 1, yRatio: 1 }, VIEWPORT, BOX, BARE)).toEqual({
			x: VIEWPORT.width - BOX.width - PET_POSITION_MARGIN,
			y: VIEWPORT.height - BOX.height - PET_REST_INSET_BLOCK_END,
		});
	});

	it('keeps a stored position in its corner when the window grows', () => {
		const ratio = positionToRatio({ x: 0, y: 0 }, { width: 1280, height: 800 }, BOX, BARE);
		const wider = ratioToPosition(ratio, { width: 2560, height: 1600 }, BOX, BARE);
		expect(wider).toEqual({ x: PET_POSITION_MARGIN, y: PET_POSITION_MARGIN });
	});

	it('rejects anything that is not a ratio in [0, 1]', () => {
		expect(parseStoredPosition(null)).toBeNull();
		expect(parseStoredPosition('not json')).toBeNull();
		expect(parseStoredPosition('null')).toBeNull();
		expect(parseStoredPosition('{}')).toBeNull();
		expect(parseStoredPosition('{"xRatio":1}')).toBeNull();
		expect(parseStoredPosition('{"xRatio":"0.5","yRatio":0.5}')).toBeNull();
		expect(parseStoredPosition('{"xRatio":1.5,"yRatio":0.5}')).toBeNull();
		expect(parseStoredPosition('{"xRatio":-0.1,"yRatio":0.5}')).toBeNull();
		expect(parseStoredPosition('{"xRatio":0.5,"yRatio":0.25}')).toEqual({
			xRatio: 0.5,
			yRatio: 0.25,
		});
	});

	it('reads and writes the documented key', () => {
		const storage = fakeStorage();
		writeStoredPosition(storage, { xRatio: 0.25, yRatio: 0.75 });
		expect(storage.values.has('pet-position.v1')).toBe(true);
		expect(PET_POSITION_STORAGE_KEY).toBe('pet-position.v1');
		expect(readStoredPosition(storage)).toEqual({ xRatio: 0.25, yRatio: 0.75 });
	});

	it('does not crash when storage is unavailable', () => {
		const throwing: PetPositionStorage = {
			getItem: () => {
				throw new Error('storage is blocked');
			},
			setItem: () => {
				throw new Error('quota exceeded');
			},
		};
		expect(() => writeStoredPosition(throwing, { xRatio: 0.5, yRatio: 0.5 })).not.toThrow();
		expect(readStoredPosition(throwing)).toBeNull();
		expect(readStoredPosition(null)).toBeNull();
		expect(() => writeStoredPosition(null, { xRatio: 0.5, yRatio: 0.5 })).not.toThrow();
	});

	it('reports unusable browser storage as absent, not as a throw', () => {
		// The workerd pool has no `window`, which is the same outcome as a
		// browser that refuses the `localStorage` getter. The component
		// renders at its initial position in both cases.
		expect(browserPetPositionStorage()).toBeNull();
	});
});

describe('pet position × analytics consent surface (Issue #783)', () => {
	it('falls back to the resting inset when no surface is on the page', () => {
		expect(restingBlockEndInset(0)).toBe(PET_REST_INSET_BLOCK_END);
		// A value that is not a number must not move the character either.
		expect(restingBlockEndInset(Number.NaN)).toBe(PET_REST_INSET_BLOCK_END);
		expect(restingBlockEndInset(-40)).toBe(PET_REST_INSET_BLOCK_END);
	});

	it('stays at the resting inset for the collapsed pill', () => {
		// The pill is 36 px tall, 12 px off the edge, and the surface
		// publishes `height + 12` — 48 px. 48 + 12 = 60 is below 72, so the
		// character returns to exactly the position it had before the
		// consent surface existed.
		expect(restingBlockEndInset(48)).toBe(PET_REST_INSET_BLOCK_END);
	});

	it('clears a full-width band by the published height plus the gap', () => {
		// The shipped band (Issue #783) is 198 px tall at 1440 and 341.2 px
		// at 390, and it is flush with the bottom edge, so the property this
		// function receives is `ceil(height)` — 198 / 342. The sprite adds
		// its own 12 px, leaving 12 px of visible clearance above the band.
		expect(restingBlockEndInset(198)).toBe(210);
		expect(restingBlockEndInset(342)).toBe(354);
	});

	it('never puts the resting position inside the band', () => {
		for (const width of [1440, 390]) {
			const viewport = width === 1440 ? { width: 1440, height: 900 } : { width: 390, height: 844 };
			// The published value is `ceil(height)`: 198 at 1440, 342 at 390.
			const bandHeight = width === 1440 ? 198 : 342;
			const insets: PetTravelInsets = {
				inline: PET_POSITION_MARGIN,
				blockEnd: restingBlockEndInset(bandHeight),
			};
			// The deepest legal position is the bottom of the travel box.
			const deepest = clampPosition({ x: 0, y: 99_999 }, viewport, BOX, insets);
			const spriteBottom = deepest.y + BOX.height;
			const bandTop = viewport.height - bandHeight;
			expect(spriteBottom).toBeLessThanOrEqual(bandTop - 12);
		}
	});

	it('re-maps a stored ratio when the band appears without ending up under it', () => {
		const viewport = { width: 1440, height: 900 };
		const bare: PetTravelInsets = { inline: 24, blockEnd: PET_REST_INSET_BLOCK_END };
		const band: PetTravelInsets = { inline: 24, blockEnd: restingBlockEndInset(198) };

		// The visitor dragged the character to the bottom of the page before
		// any consent surface was shown.
		const ratio = positionToRatio({ x: 900, y: 760 }, viewport, BOX, bare);
		expect(ratio.yRatio).toBeCloseTo(1, 6);

		// The same ratio in the new box still means "the bottom", which now
		// sits above the band instead of under it.
		const restored = ratioToPosition(ratio, viewport, BOX, band);
		expect(restored.y).toBe(viewport.height - BOX.height - band.blockEnd);
		expect(restored.y + BOX.height).toBeLessThanOrEqual(viewport.height - 198 - 12);
	});

	it('keeps a ratio relative when only the bottom edge moves', () => {
		const viewport = { width: 1440, height: 900 };
		const bare: PetTravelInsets = { inline: 24, blockEnd: 72 };
		const band: PetTravelInsets = { inline: 24, blockEnd: 210 };
		const middle = ratioToPosition({ xRatio: 0.5, yRatio: 0.5 }, viewport, BOX, bare);
		const lifted = ratioToPosition({ xRatio: 0.5, yRatio: 0.5 }, viewport, BOX, band);
		expect(lifted.x).toBeCloseTo(middle.x, 6);
		// Half of a shorter travel box is higher up, and stays at half.
		const bareHalf = 24 + (viewport.height - BOX.height - 72 - 24) / 2;
		const bandHalf = 24 + (viewport.height - BOX.height - 210 - 24) / 2;
		expect(middle.y).toBeCloseTo(bareHalf, 6);
		expect(lifted.y).toBeCloseTo(bandHalf, 6);
	});

	it('falls back to the top edge when the viewport cannot hold the inset', () => {
		// A short landscape phone with a tall band: there is nowhere above
		// the surface, so the character must not be pushed off-screen.
		const viewport = { width: 640, height: 400 };
		const insets: PetTravelInsets = { inline: 24, blockEnd: restingBlockEndInset(342) };
		const clamped = clampPosition({ x: 300, y: 380 }, viewport, BOX, insets);
		expect(clamped.y).toBe(0);
		expect(ratioToPosition({ xRatio: 0, yRatio: 1 }, viewport, BOX, insets).y).toBe(0);
	});
});
