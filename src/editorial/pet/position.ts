/**
 * Where the companion character was left (Issue #274).
 *
 * The overlay can be dragged, and the owner asked for that position to
 * survive a reload in the same browser. What is stored is a RATIO of
 * the travel box, not a pixel coordinate: a pixel saved on a 2560 px
 * display would put the character off-screen on a 1280 px one, and a
 * ratio still lands in the same corner. `yRatio` = 1 is the bottom of
 * the travel box, `xRatio` = 1 the right-hand end.
 *
 * Everything here is a pure function of its arguments — the storage
 * object is passed in rather than reached for globally — so the
 * "storage is unavailable / holds junk" cases are provable without a
 * jsdom. `PetSprite` owns the browser wiring and the `try/catch`.
 *
 * The travel box is the viewport minus the sprite minus a margin on
 * each edge, so ratio 1,1 is the resting corner the component draws
 * before any drag (`inset-block-end` / `inset-inline-end` = the same
 * margin).
 */

export const PET_POSITION_STORAGE_KEY = 'pet-position.v1';

/** Space kept between the sprite and the viewport edge, in CSS px. */
export const PET_POSITION_MARGIN = 24;

export interface PetPositionRatio {
	readonly xRatio: number;
	readonly yRatio: number;
}

export interface PetPositionPixels {
	readonly x: number;
	readonly y: number;
}

export interface PetViewportSize {
	readonly width: number;
	readonly height: number;
}

export interface PetBoxSize {
	readonly width: number;
	readonly height: number;
}

/** The storage surface this module needs — a subset of `Storage`. */
export interface PetPositionStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	if (max <= min) return min;
	return Math.min(Math.max(value, min), max);
}

/** Width of the travel box; `0` when the viewport cannot fit a margin on both sides. */
function travelWidth(viewport: PetViewportSize, box: PetBoxSize): number {
	return Math.max(0, viewport.width - box.width - PET_POSITION_MARGIN * 2);
}

function travelHeight(viewport: PetViewportSize, box: PetBoxSize): number {
	return Math.max(0, viewport.height - box.height - PET_POSITION_MARGIN * 2);
}

/** Keep a pixel position inside the travel box. */
export function clampPosition(
	position: PetPositionPixels,
	viewport: PetViewportSize,
	box: PetBoxSize,
): PetPositionPixels {
	const maxX = viewport.width - box.width - PET_POSITION_MARGIN;
	const maxY = viewport.height - box.height - PET_POSITION_MARGIN;
	return {
		x: clamp(position.x, Math.min(PET_POSITION_MARGIN, Math.max(0, maxX)), Math.max(0, maxX)),
		y: clamp(position.y, Math.min(PET_POSITION_MARGIN, Math.max(0, maxY)), Math.max(0, maxY)),
	};
}

/** Convert a dragged pixel position to the stored ratio. */
export function positionToRatio(
	position: PetPositionPixels,
	viewport: PetViewportSize,
	box: PetBoxSize,
): PetPositionRatio {
	const width = travelWidth(viewport, box);
	const height = travelHeight(viewport, box);
	const clamped = clampPosition(position, viewport, box);
	return {
		xRatio: width === 0 ? 0 : clamp((clamped.x - PET_POSITION_MARGIN) / width, 0, 1),
		yRatio: height === 0 ? 0 : clamp((clamped.y - PET_POSITION_MARGIN) / height, 0, 1),
	};
}

/** Convert a stored ratio back to pixels for the CURRENT viewport. */
export function ratioToPosition(
	ratio: PetPositionRatio,
	viewport: PetViewportSize,
	box: PetBoxSize,
): PetPositionPixels {
	return clampPosition(
		{
			x: PET_POSITION_MARGIN + travelWidth(viewport, box) * clamp(ratio.xRatio, 0, 1),
			y: PET_POSITION_MARGIN + travelHeight(viewport, box) * clamp(ratio.yRatio, 0, 1),
		},
		viewport,
		box,
	);
}

function isRatio(value: unknown): value is PetPositionRatio {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as { xRatio?: unknown; yRatio?: unknown };
	return (
		typeof candidate.xRatio === 'number' &&
		typeof candidate.yRatio === 'number' &&
		Number.isFinite(candidate.xRatio) &&
		Number.isFinite(candidate.yRatio) &&
		candidate.xRatio >= 0 &&
		candidate.xRatio <= 1 &&
		candidate.yRatio >= 0 &&
		candidate.yRatio <= 1
	);
}

/**
 * Parse one stored value. Anything that is not `{xRatio, yRatio}` in
 * `[0, 1]` is `null` — a half-written record, another site's key, or a
 * value from a future version must fall back to the resting corner
 * rather than to a guessed place.
 */
export function parseStoredPosition(raw: string | null): PetPositionRatio | null {
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isRatio(parsed) ? { xRatio: parsed.xRatio, yRatio: parsed.yRatio } : null;
	} catch {
		return null;
	}
}

/**
 * Read the stored position. `null` storage (the server, or a browser
 * that blocks storage entirely) is a normal answer, not an error.
 */
export function readStoredPosition(storage: PetPositionStorage | null): PetPositionRatio | null {
	if (storage === null) return null;
	try {
		return parseStoredPosition(storage.getItem(PET_POSITION_STORAGE_KEY));
	} catch {
		return null;
	}
}

/**
 * Persist the position, ignoring every failure.
 *
 * A full quota, a Safari private window and a `localStorage` getter that
 * throws must all degrade to "the character stays where it is until the
 * next page load" — never to an error the reader sees.
 */
export function writeStoredPosition(
	storage: PetPositionStorage | null,
	position: PetPositionRatio,
): void {
	if (storage === null) return;
	try {
		storage.setItem(
			PET_POSITION_STORAGE_KEY,
			JSON.stringify({ xRatio: position.xRatio, yRatio: position.yRatio }),
		);
	} catch {
		// Deliberately silent: persistence is a convenience, not a contract
		// the page can fail at.
	}
}

/**
 * The browser's `localStorage`, or `null` when touching it throws.
 *
 * The getter itself can throw (blocked third-party storage, some
 * private modes), which is why this is a function and not a constant.
 */
export function browserPetPositionStorage(): PetPositionStorage | null {
	try {
		if (typeof window === 'undefined') return null;
		return window.localStorage;
	} catch {
		return null;
	}
}
