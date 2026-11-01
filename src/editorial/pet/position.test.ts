import { describe, expect, it } from 'vitest';
import {
	PET_POSITION_MARGIN,
	PET_POSITION_STORAGE_KEY,
	type PetPositionStorage,
	browserPetPositionStorage,
	clampPosition,
	parseStoredPosition,
	positionToRatio,
	ratioToPosition,
	readStoredPosition,
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
 */

const VIEWPORT = { width: 1280, height: 800 };
const BOX = { width: 96, height: 104 };

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
	it('keeps the sprite inside the viewport with the resting margin', () => {
		expect(clampPosition({ x: -400, y: -400 }, VIEWPORT, BOX)).toEqual({
			x: PET_POSITION_MARGIN,
			y: PET_POSITION_MARGIN,
		});
		expect(clampPosition({ x: 99999, y: 99999 }, VIEWPORT, BOX)).toEqual({
			x: VIEWPORT.width - BOX.width - PET_POSITION_MARGIN,
			y: VIEWPORT.height - BOX.height - PET_POSITION_MARGIN,
		});
	});

	it('degrades to the margin when the viewport is smaller than the sprite', () => {
		const tiny = { width: 80, height: 90 };
		expect(clampPosition({ x: 10, y: 10 }, tiny, BOX)).toEqual({ x: 0, y: 0 });
	});

	it('round-trips a drag through the stored ratio', () => {
		const dragged = { x: 640, y: 400 };
		const ratio = positionToRatio(dragged, VIEWPORT, BOX);
		// The travel box is the viewport minus the sprite and two margins,
		// so 0.5 is the middle of that box rather than of the screen.
		const travelX = VIEWPORT.width - BOX.width - PET_POSITION_MARGIN * 2;
		const travelY = VIEWPORT.height - BOX.height - PET_POSITION_MARGIN * 2;
		expect(ratio.xRatio).toBeCloseTo((dragged.x - PET_POSITION_MARGIN) / travelX, 10);
		expect(ratio.yRatio).toBeCloseTo((dragged.y - PET_POSITION_MARGIN) / travelY, 10);
		const back = ratioToPosition(ratio, VIEWPORT, BOX);
		expect(back.x).toBeCloseTo(dragged.x, 6);
		expect(back.y).toBeCloseTo(dragged.y, 6);
	});

	it('maps ratio 1,1 to the corner the server renders', () => {
		expect(ratioToPosition({ xRatio: 1, yRatio: 1 }, VIEWPORT, BOX)).toEqual({
			x: VIEWPORT.width - BOX.width - PET_POSITION_MARGIN,
			y: VIEWPORT.height - BOX.height - PET_POSITION_MARGIN,
		});
	});

	it('keeps a stored position in its corner when the window grows', () => {
		const ratio = positionToRatio({ x: 0, y: 0 }, { width: 1280, height: 800 }, BOX);
		const wider = ratioToPosition(ratio, { width: 2560, height: 1600 }, BOX);
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
