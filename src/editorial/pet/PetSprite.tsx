import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { PET_REACTION_MOTION, usePrefersReducedMotion } from '../reduced-motion';

/**
 * PetSprite — Melty, the platform's companion character (Issue #274).
 *
 * Why this is an `editorial` primitive
 * ------------------------------------
 * Two shipped surfaces render it: the Home page and `/about`. Neither
 * may import the other (AGENTS.md §3), and `/about` may only reach the
 * visual language (`about -> editorial`), so a display component with
 * two consumers has exactly one place it can live. The earlier design
 * note (`docs/domain/pet-companion.md` §5.1) put it in `src/home/` and
 * named the promotion trigger — "a second consumer appears" — which
 * this ticket then met. It is a DISPLAY primitive: it reads no
 * binding, fetches nothing, owns no route, and carries no page copy.
 *
 * What it deliberately does NOT do
 * --------------------------------
 *   - No autoplay. `src/editorial/reduced-motion.ts` states that the
 *     platform ships no content that moves by itself for longer than
 *     five seconds (WCAG 2.2 SC 2.2.2, level A). A looping idle
 *     animation would make that sentence false, so the resting state is
 *     a still frame and the reaction is finite, discrete and explicitly
 *     triggered.
 *   - No JS frame-stepping. The four `waving` frames are one committed
 *     strip translated by a CSS `steps()` animation, so the motion is
 *     visible to the reduced-motion gate and can be slowed to nothing
 *     by a stylesheet the same way every other animated box is.
 *   - No layout shift. The frame is a fixed 96 x 104 box reserved
 *     before the image decodes; the strip is absolutely positioned
 *     inside it, so gaining or losing the animation moves nothing.
 *
 * Accessibility
 * -------------
 * The character is decoration: every image is `alt=""` +
 * `aria-hidden="true"`, so it never enters the reading order or the
 * accessible name computation. The single control carries the entire
 * accessible name, and it is removed entirely under reduced motion —
 * a button whose only effect is motion is a button that should not be
 * offered to a visitor who asked for less motion.
 */

/**
 * Display size in CSS px. The atlas cell is 192 x 208, so this is
 * exactly half: a 2x device gets the source pixels 1:1 and a 3x device
 * upscales by 1.5. Going smaller (72 x 78) is not a clean divisor and
 * visibly softens the outline on 2x screens.
 */
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 104;

/** Frames in the `waving` row of the v2 atlas contract. */
const WAVING_FRAMES = 4;

/** Committed files produced by `scripts/build-pet-sprites.mjs`. */
const PET_RESTING_SOURCE = '/pets/melty/idle-rest.webp';
const PET_WAVING_SOURCE = '/pets/melty/waving.webp';

export interface PetSpriteProps {
	/**
	 * Force the preference answer instead of reading the media query.
	 *
	 * Production callers pass nothing: the component asks the shared
	 * contract, which answers `false` on the server and the visitor's
	 * real preference after hydration. A unit test and a Storybook
	 * fixture pass a value so the two renders are deterministic.
	 *
	 * The live read goes through `usePrefersReducedMotion` — the
	 * hydration-safe form — rather than `resolveReducedMotion`, which
	 * would read the media query directly during the first client render
	 * and produce markup the server did not send.
	 */
	readonly reducedMotion?: boolean;
}

/**
 * Render the character with its one reaction.
 *
 * The display decision (size, frames, trigger) is the visual
 * language's, so there is no size / shape prop: a per-surface
 * variation would be a second visual language nobody asked for.
 */
export function PetSprite({ reducedMotion: override }: PetSpriteProps = {}) {
	const systemPrefersReducedMotion = usePrefersReducedMotion();
	const reducedMotion = override ?? systemPrefersReducedMotion;
	const [wave, setWave] = useState(0);
	const waving = wave > 0;

	const boxStyle = css({
		position: 'relative',
		flex: 'none',
		overflow: 'hidden',
		width: `${FRAME_WIDTH}px`,
		height: `${FRAME_HEIGHT}px`,
	});

	const restingStyle = css({
		display: 'block',
		width: `${FRAME_WIDTH}px`,
		height: `${FRAME_HEIGHT}px`,
	});

	// The resting frame steps aside for the strip rather than showing
	// through it: both files carry alpha, and two poses overlapping
	// would ghost.
	const restingHiddenStyle = css({ visibility: 'hidden' });

	const stripBaseStyle = css({
		position: 'absolute',
		left: '0',
		top: '0',
		display: 'block',
		maxWidth: 'none',
		width: `${FRAME_WIDTH * WAVING_FRAMES}px`,
		height: `${FRAME_HEIGHT}px`,
	});

	// Pre-loaded but invisible until triggered: the strip is mounted
	// from the first render so the first click animates instead of
	// waiting for 15 kB to arrive.
	const stripIdleStyle = css({ visibility: 'hidden' });

	const stripPlayingStyle = css({
		animation: `petReaction 0.6s steps(${WAVING_FRAMES}, jump-none) 1`,
	});

	const buttonStyle = css({
		display: 'inline-flex',
		alignItems: 'center',
		gap: '2',
		minHeight: '44px',
		paddingInline: '4',
		borderRadius: 'md',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: 'border.subtle',
		backgroundColor: 'bg.canvas',
		color: 'text.default',
		fontFamily: 'sans',
		fontSize: 'sm',
		fontWeight: '600',
		cursor: 'pointer',
		transition: 'background-color 120ms ease',
		_hover: { borderColor: 'border.strong' },
		_focusVisible: {
			outline: '2px solid {colors.border.focus}',
			outlineOffset: '2px',
		},
	});

	return (
		<div
			className={css({
				display: 'flex',
				alignItems: 'center',
				gap: '4',
				flexWrap: 'wrap',
			})}
		>
			<span className={boxStyle}>
				<img
					className={`${restingStyle} ${waving ? restingHiddenStyle : ''}`}
					src={PET_RESTING_SOURCE}
					alt=""
					aria-hidden="true"
					width={FRAME_WIDTH}
					height={FRAME_HEIGHT}
					loading="lazy"
					decoding="async"
					fetchPriority="low"
				/>
				{reducedMotion ? null : (
					<img
						key={wave}
						className={`${stripBaseStyle} ${waving ? stripPlayingStyle : stripIdleStyle}`}
						src={PET_WAVING_SOURCE}
						alt=""
						aria-hidden="true"
						data-motion={PET_REACTION_MOTION}
						width={FRAME_WIDTH * WAVING_FRAMES}
						height={FRAME_HEIGHT}
						loading="lazy"
						decoding="async"
						fetchPriority="low"
						onAnimationEnd={() => setWave(0)}
					/>
				)}
			</span>
			{reducedMotion ? null : (
				<button type="button" className={buttonStyle} onClick={() => setWave((count) => count + 1)}>
					<span lang="ja">あいさつしてもらう</span>
				</button>
			)}
		</div>
	);
}
