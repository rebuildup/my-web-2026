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
 * The travel box is the viewport minus the sprite minus the insets on
 * each edge, so ratio 1,1 is the resting corner the component draws
 * before any drag (`inset-block-end` = `blockEnd`, `inset-inline-end` =
 * `inline`).
 *
 * The bottom inset is NOT a constant (Issue #783). The analytics
 * consent surface occupies the bottom of the viewport — a full-width
 * band while a decision is pending, a small pill afterwards — and the
 * companion must rest above it rather than on top of it. The surface
 * publishes its height as `--analytics-consent-offset`; the component
 * turns that into `blockEnd` and passes the result here, so the same
 * arithmetic governs the resting position, the drag limits and the
 * stored ratio.
 */

export const PET_POSITION_STORAGE_KEY = 'pet-position.v1';

/** Space kept between the sprite and the viewport edge, in CSS px. */
export const PET_POSITION_MARGIN = 24;

/**
 * The resting bottom inset with no consent surface on the page.
 *
 * The bottom-right corner belongs to the analytics-consent pill (a
 * 36 px button 12 px off the edge): at the plain 24 px corner the
 * decorative overlay covered part of that real control. Measured in the
 * browser at 1440 x 900 — `docs/verification/visual/pet-companion/`.
 */
export const PET_REST_INSET_BLOCK_END = PET_POSITION_MARGIN + 36 + 12;

/** Gap kept between the sprite and the consent surface above it. */
export const PET_CONSENT_GAP_PX = 12;

/**
 * The bottom inset for a consent surface that occupies
 * `consentOffsetPx` of the viewport's bottom edge.
 *
 * `consentOffsetPx` is the PUBLISHED value, which the consent surface
 * already computes as `ceil(height + 12)` — its own focus-compensation
 * gap is included. Adding the sprite's own 12 px gap therefore leaves
 * 24 px of visible clearance above a band, which is the measured result
 * in `docs/verification/visual/pet-companion/`.
 *
 * `max()`, not a sum: with the surface collapsed to its pill the
 * formula must land back on the ordinary resting inset (a 48 px pill
 * value + 12 px = 60 px, below 72 px), while a full-width band pushes
 * the character up.
 *
 * This is the ONLY implementation of the expression. The component
 * draws the server document with the constant 72 px because the
 * property does not exist until the consent surface mounts, and reads
 * this function for every branch after hydration — there is no second
 * `max()` in CSS to drift from this one.
 */
export function restingBlockEndInset(consentOffsetPx: number): number {
	const offset = Number.isFinite(consentOffsetPx) && consentOffsetPx > 0 ? consentOffsetPx : 0;
	return Math.max(PET_REST_INSET_BLOCK_END, offset + PET_CONSENT_GAP_PX);
}

/**
 * The edges the sprite must stay inside.
 *
 * `inline` applies to left, right and top; `blockEnd` only to the
 * bottom, because that is the edge a fixed surface can occupy. The
 * travel box therefore runs from `inline` at the top to
 * `viewport.height - box.height - blockEnd` at the bottom.
 */
export interface PetTravelInsets {
	readonly inline: number;
	readonly blockEnd: number;
}

export const PET_TRAVEL_INSETS: PetTravelInsets = {
	inline: PET_POSITION_MARGIN,
	blockEnd: PET_REST_INSET_BLOCK_END,
};

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
function travelWidth(viewport: PetViewportSize, box: PetBoxSize, insets: PetTravelInsets): number {
	return Math.max(0, viewport.width - box.width - insets.inline * 2);
}

function travelHeight(viewport: PetViewportSize, box: PetBoxSize, insets: PetTravelInsets): number {
	return Math.max(0, viewport.height - box.height - insets.blockEnd - insets.inline);
}

/**
 * Keep a pixel position inside the travel box.
 *
 * The top edge uses `insets.inline` and the bottom edge uses
 * `insets.blockEnd`, so raising the inset for a consent surface shrinks
 * the travel box from below rather than moving the sprite out of it. A
 * viewport too short for the inset degrades to the top edge — the
 * character is then over the surface, but there is nowhere else on that
 * screen for it to be.
 */
export function clampPosition(
	position: PetPositionPixels,
	viewport: PetViewportSize,
	box: PetBoxSize,
	insets: PetTravelInsets,
): PetPositionPixels {
	const maxX = Math.max(0, viewport.width - box.width - insets.inline);
	const maxY = Math.max(0, viewport.height - box.height - insets.blockEnd);
	return {
		x: clamp(position.x, Math.min(insets.inline, maxX), maxX),
		y: clamp(position.y, Math.min(insets.inline, maxY), maxY),
	};
}

/** Convert a dragged pixel position to the stored ratio. */
export function positionToRatio(
	position: PetPositionPixels,
	viewport: PetViewportSize,
	box: PetBoxSize,
	insets: PetTravelInsets,
): PetPositionRatio {
	const width = travelWidth(viewport, box, insets);
	const height = travelHeight(viewport, box, insets);
	const clamped = clampPosition(position, viewport, box, insets);
	return {
		xRatio: width === 0 ? 0 : clamp((clamped.x - insets.inline) / width, 0, 1),
		yRatio: height === 0 ? 0 : clamp((clamped.y - insets.inline) / height, 0, 1),
	};
}

/**
 * Convert a stored ratio back to pixels for the CURRENT viewport.
 *
 * A ratio is a fraction of the travel box, so the same value keeps its
 * relative place when the box changes shape — a wider window, or a
 * consent surface that grows from a pill into a band and lifts the
 * bottom edge. That is a deliberate choice over storing pixels: the
 * character stays where the visitor put it relative to the page
 * instead of drifting off-screen on a different display.
 */
export function ratioToPosition(
	ratio: PetPositionRatio,
	viewport: PetViewportSize,
	box: PetBoxSize,
	insets: PetTravelInsets,
): PetPositionPixels {
	return clampPosition(
		{
			x: insets.inline + travelWidth(viewport, box, insets) * clamp(ratio.xRatio, 0, 1),
			y: insets.inline + travelHeight(viewport, box, insets) * clamp(ratio.yRatio, 0, 1),
		},
		viewport,
		box,
		insets,
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
