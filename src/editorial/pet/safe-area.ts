import { css } from '../../../styled-system/css';
import { PET_FRAME_WIDTH, PET_POSITION_MARGIN, PET_REST_SCALE } from './position';

/**
 * The inline-end corridor the page content leaves for the companion
 * (Issue #767).
 *
 * Why a corridor exists
 * ---------------------
 * The character is a fixed overlay in the bottom-right corner
 * (`docs/domain/pet-companion.md` §5.2). On a desktop page the reading
 * column is centred, so the corner is outside the text and the overlay
 * only covers background. Below roughly 1127 px the page margins are
 * narrower than the sprite's fixed box, so the bottom-right corner sits
 * *on* the text column instead: measured at 390 x 844 the resting
 * sprite (`306–366 x 708–772`) covered the right end of three lines of
 * the Home NOW lead (`16–374 x 704–781`). The same happened at every
 * scroll position, because a fixed overlay follows the viewport while
 * the text moves under it.
 *
 * The only way to keep a fixed overlay clear of a scrolling text column
 * is to reserve the column it occupies. This style is applied by the
 * two pages that draw the companion (`Home`, `/about`) to the page
 * wrapper, so their content never enters the corridor. It is a layout
 * reservation, not a second position: the character still drags
 * anywhere, and a visitor who moves it takes the same responsibility
 * the character's own contract gives them (§5.2).
 *
 * The numbers
 * -----------
 * The corridor must cover the character's resting render plus its own
 * right margin plus a visible gap:
 *
 *     resting width = 96px * 0.62 = 59.52px
 *     + right margin 24px
 *     + clearance 8px
 *     = 91.52px from the viewport's inline end (ceil: 92px)
 *
 * `Container` already applies page padding (16 / 24 / 32 px at
 * base / md / lg), and this style is additional padding on the page
 * wrapper, so the reserve per breakpoint is the remainder:
 *
 *     base: 92 - 16 = 76px
 *     md:   92 - 24 = 68px
 *     lg:   92 - 32 = 60px
 *     xl:   0     (the centred 1024 px column clears the box)
 *
 * The values in `petSafeAreaStyle` are LITERALS because Panda's static
 * extractor does not evaluate expressions: a computed value silently
 * produces no class. `safe-area.test.ts` re-derives the three numbers
 * from the geometry constants, so the literals cannot drift from the
 * sprite they reserve space for. If `Container`'s page padding changes,
 * that test still passes but the comment above and the three paddings
 * must change with it.
 *
 * The character's active pose (1.0 scale, `PetSprite`) is what the
 * reserve must also survive: below `xl` the sprite is held at its
 * resting scale, and from `xl` up the centred column's own margin
 * clears the full 96 px box.
 */
export const PET_SAFE_AREA_INLINE_END = {
	base: '76px',
	md: '68px',
	lg: '60px',
	xl: '0px',
} as const;

/** Geometry the literals must keep up with — see `safe-area.test.ts`. */
export const PET_RESERVED_FOOTPRINT_PX = Math.ceil(
	PET_FRAME_WIDTH * PET_REST_SCALE + PET_POSITION_MARGIN + 8,
);

/** Page padding `Container` applies, in CSS px (base / md / lg). */
export const PET_PAGE_PADDING_PX = { base: 16, md: 24, lg: 32 } as const;

/**
 * The page-level reservation. Apply once to the wrapper that contains
 * the page's reading content.
 */
export const petSafeAreaStyle = css({
	paddingInlineEnd: {
		base: '76px',
		md: '68px',
		lg: '60px',
		xl: '0px',
	},
});
