/**
 * The companion's reactions, as decisions (Issue #274).
 *
 * `PetSprite` owns the browser wiring — listeners, timers, pointer
 * capture — and this module owns the question those listeners ask:
 * *given what the visitor just did, which pose (if any) should the
 * character take?* Keeping the decision here means the rules can be
 * tested without a DOM, and that "reduced motion stops the automatic
 * reactions" is a property of one argument rather than of an
 * untestable side effect.
 *
 * Every constant is a product decision recorded in
 * `docs/domain/pet-companion.md` §5.4, not a tuning knob.
 */

/** Poses the shipped atlas rows make available. */
export type PetPose =
	| 'idle'
	| 'wave'
	| 'run-right'
	| 'run-left'
	| 'look-up'
	| 'look-right'
	| 'look-down'
	| 'look-left';

/**
 * Horizontal travel, in CSS px, before a pointer-down becomes a drag.
 *
 * The reference implementation uses the same threshold (its drag
 * handler flips the run pose at `>= 4` px), and it is what keeps a
 * click on the sprite from nudging it by a pixel.
 */
export const PET_DRAG_THRESHOLD_PX = 4;

/** Page scroll, in CSS px, that counts as "the reader is moving". */
export const PET_SCROLL_REACTION_PX = 24;

/** How close the pointer has to come before the character looks at it. */
export const PET_POINTER_NEAR_PX = 120;

/**
 * Inside this radius around the sprite's centre the pointer has no
 * direction worth showing, so the character keeps its resting frame
 * instead of flickering between four poses.
 */
export const PET_POINTER_DEAD_ZONE_PX = 24;

/** Poses drawn as a multi-frame strip rather than a single cell. */
export function isAnimatedPose(pose: PetPose): boolean {
	return pose === 'wave' || pose === 'run-right' || pose === 'run-left';
}

/**
 * The travel pose for a horizontal pointer delta.
 *
 * `previous` is the pose already showing: a mostly-vertical drag keeps
 * the last horizontal direction rather than snapping to a default, so
 * the character does not reverse mid-drag.
 *
 * Under reduced motion the character keeps its resting frame — the drag
 * still moves it, but nothing plays while it moves.
 */
export function dragPose(
	reducedMotion: boolean,
	deltaX: number,
	previous: 'run-left' | 'run-right' | null,
): 'run-left' | 'run-right' | null {
	if (reducedMotion) return null;
	if (deltaX >= PET_DRAG_THRESHOLD_PX) return 'run-right';
	if (deltaX <= -PET_DRAG_THRESHOLD_PX) return 'run-left';
	return previous;
}

/**
 * The gaze for a page scroll: the character looks the way the reader is
 * heading. `deltaY > 0` is scrolling down the document.
 *
 * It is a gaze and not the running strip on purpose — the reader is
 * moving, the character is not, and showing travel would draw a state
 * that is not happening.
 */
export function scrollPose(reducedMotion: boolean, deltaY: number): PetPose | null {
	if (reducedMotion) return null;
	if (deltaY >= PET_SCROLL_REACTION_PX) return 'look-down';
	if (deltaY <= -PET_SCROLL_REACTION_PX) return 'look-up';
	return null;
}

export interface PetPointerPosition {
	readonly x: number;
	readonly y: number;
}

export interface PetBoxRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The gaze for a pointer near the sprite, or `null` when it is too far
 * away or has no direction (inside the dead zone).
 *
 * Quantised to four cardinal poses: the atlas defines sixteen at 22.5
 * degrees, and shipping eight more cells to tell up-left from left
 * would cost more bytes than the decoration is worth
 * (`docs/domain/pet-companion.md` §5.4).
 */
export function lookPose(
	reducedMotion: boolean,
	pointer: PetPointerPosition,
	box: PetBoxRect,
): PetPose | null {
	if (reducedMotion) return null;
	const deltaX = pointer.x - (box.left + box.width / 2);
	const deltaY = pointer.y - (box.top + box.height / 2);
	if (Math.hypot(deltaX, deltaY) > PET_POINTER_NEAR_PX) return null;
	if (Math.hypot(deltaX, deltaY) <= PET_POINTER_DEAD_ZONE_PX) return null;
	if (Math.abs(deltaX) >= Math.abs(deltaY)) {
		return deltaX > 0 ? 'look-right' : 'look-left';
	}
	return deltaY > 0 ? 'look-down' : 'look-up';
}
