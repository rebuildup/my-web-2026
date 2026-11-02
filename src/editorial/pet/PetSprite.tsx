import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { css } from '../../../styled-system/css';
import { ANALYTICS_CONSENT_OFFSET_PROPERTY } from '../analytics/consent';
import {
	PET_REACTION_MOTION,
	resolveReducedMotion,
	usePrefersReducedMotion,
} from '../reduced-motion';
import {
	PET_POSITION_MARGIN,
	PET_TRAVEL_INSETS,
	type PetPositionPixels,
	type PetTravelInsets,
	browserPetPositionStorage,
	clampPosition,
	positionToRatio,
	ratioToPosition,
	readStoredPosition,
	restingBlockEndInset,
	writeStoredPosition,
} from './position';
import { PET_DRAG_THRESHOLD_PX, type PetPose, dragPose, lookPose, scrollPose } from './reactions';

/**
 * PetSprite — Melty, the platform's companion character (Issue #274).
 *
 * What it is
 * ----------
 * A page-level overlay, not a section. The owner's second instruction
 * (2026-11-01) replaced the first design — a Home section and an
 * `/about` hero column — with a free-floating character:
 *
 *   > ペットはセクションに制限せず、自由に上から重ねる形式にする。
 *   > 実際のCodexペットのように、ドラッグすると移動画像などになるように。
 *   > そしてユーザーの操作に対して自動で反応するように。ボタンなどを使わずに。
 *
 * `docs/domain/pet-companion.md` §5.2-§5.9 is the contract this file
 * implements; §5.9 records which reference behaviours were adopted and
 * which were rejected, with the primary-source evidence for each.
 *
 * What it deliberately does NOT do
 * --------------------------------
 *   - No full-screen layer. The fixed box is exactly the sprite, so the
 *     links, buttons and scrolling underneath are never captured.
 *   - No buttons, tooltips or settings. Reactions are driven by what
 *     the reader is already doing (arrival, scroll, pointer approach,
 *     drag) and the drag is direct manipulation.
 *   - No fake state. The running strip plays only while the character
 *     is actually being moved; the gaze never claims travel; the
 *     desktop overlay's "working / waiting / failed" states are not
 *     drawn because this site has no such state.
 *   - No autoplay loop. Every reaction is finite (0.7 s greeting,
 *     0.9 s gaze) or bound to an interaction (drag). The platform
 *     ships no content that moves by itself for longer than five
 *     seconds — WCAG 2.2 SC 2.2.2 — and the resting frame is still.
 *   - No JS frame-stepping. Multi-frame poses are committed strips
 *     translated by a CSS `steps()` animation, so the motion is
 *     visible to the reduced-motion gate and can be stopped by the
 *     stylesheet as well as by the render-time branch.
 *
 * Accessibility
 * -------------
 * The character is decoration. The root is `aria-hidden="true"` with no
 * `role` and no `tabindex`, every image is `alt=""`, and nothing inside
 * is focusable — the owner asked for no button, and a focusable element
 * inside `aria-hidden` would be an invalid tree. That is also why this
 * file must never grow a control: a keyboard path would have to undo
 * both choices at once.
 *
 * Position
 * --------
 * The state is the visitor's, not the page's: a dragged position is
 * persisted as a ratio of the travel box (`./position.ts`) and restored
 * on the next visit. Storage is optional in every direction — the
 * server renders the resting corner, and a browser without storage
 * simply keeps that position.
 */

/** Display size in CSS px: the 192 x 208 atlas cell at DPR 2. */
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 104;

/** Resting scale — the character shrinks so it never covers the column. */
const REST_SCALE = 0.62;

/** The greeting, played once when the character first appears. */
const ARRIVAL_MS = 700;

/** How long a gaze is held before the character returns to resting. */
const GAZE_HOLD_MS = 900;

/** Silence before the character goes back to its resting scale. */
const REST_AFTER_MS = 12_000;

/**
 * The custom property that carries this overlay's footprint to the
 * document's focus compensation.
 *
 * WCAG 2.2 SC 2.4.11 (Focus Not Obscured — Minimum) is enforced for
 * every author-created fixed overlay by
 * `scripts/check-a11y-focus-visible.mjs`: the overlay's own file
 * publishes the offset it occupies, and `src/styles.css` consumes it as
 * the document's `scroll-padding` and as the room at the end of the
 * document. This file is the publishing end; the chain is closed only
 * when both ends exist, which is why the property is listed in
 * `src/styles.css` and not only here.
 *
 * The value is the overlay's LAYOUT footprint measured from the bottom
 * edge — the current bottom inset plus the full 96 x 104 box — rather
 * than its shrunken resting render: the character grows to full size
 * whenever it reacts, and the compensation must clear the largest form
 * it takes. It is published while the component is mounted and removed
 * with it, so a page without the companion reserves nothing. It is
 * re-published when the consent surface changes shape, because the
 * character's own footprint moves with it.
 */
const FOCUS_OFFSET_PROPERTY = '--pet-overlay-offset';

/**
 * Read the height the analytics-consent surface occupies (Issue #783).
 *
 * The consent surface publishes `--analytics-consent-offset` on `:root`
 * and keeps it current through a `ResizeObserver`, so this component
 * only has to notice the property changing. That is a
 * `MutationObserver` on the root's `style` attribute plus a `resize`
 * listener; both are dropped with the component.
 *
 * Reading it is a convenience, never a dependency: with no consent
 * surface on the page (or before hydration) the value is absent and the
 * resting inset falls back to its own constant. A malformed value is
 * treated the same way as an absent one.
 */
function useConsentOffset(): number {
	const [offset, setOffset] = useState(0);
	useEffect(() => {
		const root = document.documentElement;
		const read = () => {
			const raw = getComputedStyle(root).getPropertyValue(ANALYTICS_CONSENT_OFFSET_PROPERTY).trim();
			const parsed = Number.parseFloat(raw);
			const next = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
			setOffset((previous) => (previous === next ? previous : next));
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(root, { attributeFilter: ['style'], attributes: true });
		window.addEventListener('resize', read);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', read);
		};
	}, []);
	return offset;
}

const BOX = { width: FRAME_WIDTH, height: FRAME_HEIGHT } as const;

/** Committed files produced by `scripts/build-pet-sprites.mjs`. */
const POSE_SOURCE: Readonly<Record<PetPose, string>> = {
	idle: '/pets/melty/idle-rest.webp',
	wave: '/pets/melty/waving.webp',
	'run-right': '/pets/melty/running-right.webp',
	'run-left': '/pets/melty/running-left.webp',
	'look-up': '/pets/melty/look-up.webp',
	'look-right': '/pets/melty/look-right.webp',
	'look-down': '/pets/melty/look-down.webp',
	'look-left': '/pets/melty/look-left.webp',
};

const POSE_FRAMES: Readonly<Record<PetPose, number>> = {
	idle: 1,
	wave: 4,
	'run-right': 8,
	'run-left': 8,
	'look-up': 1,
	'look-right': 1,
	'look-down': 1,
	'look-left': 1,
};

/** What caused the current pose, so a reaction can end only itself. */
type PoseSource = 'wave' | 'scroll' | 'pointer' | 'drag';

interface DragState {
	pointerId: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly startX: number;
	readonly startY: number;
	lastX: number;
	moved: boolean;
	direction: 'run-left' | 'run-right' | null;
}

export interface PetSpriteProps {
	/**
	 * Force the preference answer instead of reading the media query.
	 *
	 * Production callers pass nothing: the component asks the shared
	 * contract, which answers `false` on the server and the visitor's
	 * real preference after hydration. A unit test and a Storybook
	 * fixture pass a value so the renders are deterministic.
	 */
	readonly reducedMotion?: boolean;
}

export function PetSprite({ reducedMotion: override }: PetSpriteProps = {}) {
	const systemPrefersReducedMotion = usePrefersReducedMotion();
	const reducedMotion = override ?? systemPrefersReducedMotion;

	const boxRef = useRef<HTMLDivElement | null>(null);
	const [pose, setPose] = useState<PetPose>('idle');
	const [position, setPosition] = useState<PetPositionPixels | null>(null);
	const [dragging, setDragging] = useState(false);
	const [active, setActive] = useState(false);
	const consentOffset = useConsentOffset();

	/**
	 * The edges the sprite stays inside. The bottom one follows the
	 * analytics-consent surface, so the character rests above a band or a
	 * pill instead of on top of it (Issue #783).
	 */
	const insets = useMemo<PetTravelInsets>(
		() => ({ inline: PET_POSITION_MARGIN, blockEnd: restingBlockEndInset(consentOffset) }),
		[consentOffset],
	);

	const poseRef = useRef<PetPose>('idle');
	const poseSourceRef = useRef<PoseSource | null>(null);
	const poseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const positionRef = useRef<PetPositionPixels | null>(null);
	const dragRef = useRef<DragState | null>(null);
	// The listeners registered once in an effect cannot see a later
	// render's insets, so the current value is mirrored where they read.
	const insetsRef = useRef<PetTravelInsets>(PET_TRAVEL_INSETS);
	useEffect(() => {
		insetsRef.current = insets;
	}, [insets]);

	const clearPoseTimer = useCallback(() => {
		if (poseTimerRef.current !== null) {
			clearTimeout(poseTimerRef.current);
			poseTimerRef.current = null;
		}
	}, []);

	const showPose = useCallback(
		(next: PetPose, durationMs: number | null, source: PoseSource) => {
			clearPoseTimer();
			poseRef.current = next;
			poseSourceRef.current = source;
			setPose(next);
			if (durationMs === null) return;
			poseTimerRef.current = setTimeout(() => {
				poseTimerRef.current = null;
				poseRef.current = 'idle';
				poseSourceRef.current = null;
				setPose('idle');
			}, durationMs);
		},
		[clearPoseTimer],
	);

	/** The character has the reader's attention: full size for a while. */
	const markActive = useCallback(() => {
		setActive(true);
		if (restTimerRef.current !== null) clearTimeout(restTimerRef.current);
		restTimerRef.current = setTimeout(() => {
			restTimerRef.current = null;
			setActive(false);
		}, REST_AFTER_MS);
	}, []);

	useEffect(() => {
		positionRef.current = position;
	}, [position]);

	useEffect(
		() => () => {
			clearPoseTimer();
			if (restTimerRef.current !== null) clearTimeout(restTimerRef.current);
		},
		[clearPoseTimer],
	);

	// The greeting is a reaction to arriving on the page, so it starts
	// after hydration and never in the server document. The preference
	// is read LIVE here rather than taken from the render: the first
	// client render still carries the server snapshot (`false`), so a
	// render-time guard would start the greeting for exactly the
	// visitors who asked it not to start. Reading it inside the effect
	// also means a later preference flip cannot replay it — the effect
	// has no dependency that changes with the preference.
	useEffect(() => {
		if (resolveReducedMotion(override)) return;
		showPose('wave', ARRIVAL_MS, 'wave');
	}, [override, showPose]);

	// Publish the footprint the document reserves so a focused element is
	// never left behind the character (see FOCUS_OFFSET_PROPERTY). The
	// footprint grows with the consent surface, so it is re-published
	// whenever the bottom inset moves.
	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty(FOCUS_OFFSET_PROPERTY, `${insets.blockEnd + FRAME_HEIGHT}px`);
		return () => {
			root.style.removeProperty(FOCUS_OFFSET_PROPERTY);
		};
	}, [insets.blockEnd]);

	// A saved position is applied once, on the client. The server document
	// and the first client render both draw the resting corner, so this is
	// not a hydration mismatch — it is one deliberate snap after mount.
	useEffect(() => {
		const stored = readStoredPosition(browserPetPositionStorage());
		if (stored === null) return;
		setPosition(
			ratioToPosition(
				stored,
				{ width: window.innerWidth, height: window.innerHeight },
				BOX,
				insetsRef.current,
			),
		);
	}, []);

	// A resized window can leave a stored position outside the viewport.
	useEffect(() => {
		const onResize = () => {
			const current = positionRef.current;
			if (current === null) return;
			setPosition(
				clampPosition(
					current,
					{ width: window.innerWidth, height: window.innerHeight },
					BOX,
					insetsRef.current,
				),
			);
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// A consent surface that changes shape — the panel collapsing into its
	// pill after a decision, or a band replacing it — moves the bottom edge
	// after the position is already known. The stored ratio keeps its
	// relative place; the CLAMP is what stops a position that is now below
	// the new edge from resting under the surface.
	useEffect(() => {
		const current = positionRef.current;
		if (current === null) return;
		const next = clampPosition(
			current,
			{ width: window.innerWidth, height: window.innerHeight },
			BOX,
			insets,
		);
		if (next.x !== current.x || next.y !== current.y) setPosition(next);
	}, [insets]);

	// Reaction 2 — the reader's scroll direction. Asking for an animation
	// frame first keeps a fast scroll from flooding React with renders.
	useEffect(() => {
		if (reducedMotion) return;
		let last = window.scrollY;
		let frame: number | null = null;
		const onScroll = () => {
			if (frame !== null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				if (dragRef.current !== null) return;
				const current = window.scrollY;
				const next = scrollPose(false, current - last);
				if (next === null) return;
				last = current;
				markActive();
				showPose(next, GAZE_HOLD_MS, 'scroll');
			});
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			if (frame !== null) cancelAnimationFrame(frame);
		};
	}, [reducedMotion, markActive, showPose]);

	// Reaction 3 — the pointer coming near. This only reads coordinates:
	// the listener is passive and the page keeps every event it had.
	useEffect(() => {
		if (reducedMotion) return;
		const onPointerMove = (event: PointerEvent) => {
			if (dragRef.current !== null) return;
			const box = boxRef.current;
			if (box === null) return;
			const next = lookPose(
				false,
				{ x: event.clientX, y: event.clientY },
				box.getBoundingClientRect(),
			);
			if (next === null) {
				if (poseSourceRef.current === 'pointer') showPose('idle', null, 'pointer');
				return;
			}
			markActive();
			if (next !== poseRef.current) showPose(next, null, 'pointer');
		};
		window.addEventListener('pointermove', onPointerMove, { passive: true });
		return () => window.removeEventListener('pointermove', onPointerMove);
	}, [reducedMotion, markActive, showPose]);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const rect = event.currentTarget.getBoundingClientRect();
		// The rendered box is the LAYOUT box multiplied by the resting
		// scale, so a grab point measured in rendered pixels has to be
		// converted back before it can offset a layout position —
		// otherwise grabbing a resting character moves it by the
		// difference (a visible jump on the very first frame of a drag).
		const renderedScale = rect.width / FRAME_WIDTH || 1;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			offsetX: (event.clientX - rect.left) / renderedScale,
			offsetY: (event.clientY - rect.top) / renderedScale,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			moved: false,
			direction: null,
		};
		setDragging(true);
		markActive();
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (drag === null || drag.pointerId !== event.pointerId) return;
		if (
			!drag.moved &&
			Math.abs(event.clientX - drag.startX) < PET_DRAG_THRESHOLD_PX &&
			Math.abs(event.clientY - drag.startY) < PET_DRAG_THRESHOLD_PX
		) {
			return;
		}
		drag.moved = true;
		drag.direction = dragPose(reducedMotion, event.clientX - drag.lastX, drag.direction);
		drag.lastX = event.clientX;
		setPosition(
			clampPosition(
				{ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
				{ width: window.innerWidth, height: window.innerHeight },
				BOX,
				insets,
			),
		);
		markActive();
		if (drag.direction !== null && drag.direction !== poseRef.current) {
			showPose(drag.direction, null, 'drag');
		}
	};

	const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (drag === null || drag.pointerId !== event.pointerId) return;
		dragRef.current = null;
		setDragging(false);
		if (poseSourceRef.current === 'drag') showPose('idle', null, 'drag');
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const current = positionRef.current;
		if (!drag.moved || current === null) return;
		writeStoredPosition(
			browserPetPositionStorage(),
			positionToRatio(
				current,
				{ width: window.innerWidth, height: window.innerHeight },
				BOX,
				insets,
			),
		);
	};

	const overlayStyle = css({
		position: 'fixed',
		zIndex: '30',
		width: `${FRAME_WIDTH}px`,
		height: `${FRAME_HEIGHT}px`,
		transformOrigin: '100% 100%',
		transition: 'transform 200ms ease',
		pointerEvents: 'none',
	});

	const boxStyle = css({
		position: 'relative',
		width: '100%',
		height: '100%',
		overflow: 'hidden',
		pointerEvents: 'auto',
		touchAction: 'none',
		userSelect: 'none',
		cursor: dragging ? 'grabbing' : 'grab',
		filter: dragging ? 'drop-shadow(0 4px 12px rgba(11, 16, 32, 0.28))' : 'none',
	});

	const frameStyle = css({
		position: 'absolute',
		left: '0',
		top: '0',
		display: 'block',
		maxWidth: 'none',
		height: `${FRAME_HEIGHT}px`,
	});

	const waveStyle = css({ animation: `petReaction ${ARRIVAL_MS}ms steps(4, jump-none) 1` });
	// One keyframe for both directions: only the committed strip differs.
	const runStyle = css({ animation: 'petRun 1060ms steps(8, jump-none) infinite' });

	let animationStyle: string | null = null;
	if (!reducedMotion) {
		if (pose === 'wave') animationStyle = waveStyle;
		else if (pose === 'run-right' || pose === 'run-left') animationStyle = runStyle;
	}

	// Growing is itself a reaction, so it is one of the things reduced
	// motion turns off: the character keeps its resting size and never
	// resizes on scroll, approach or drag.
	const scale = active && !reducedMotion ? 1 : REST_SCALE;
	const positionStyle: CSSProperties =
		position === null
			? {
					insetBlockEnd: `${insets.blockEnd}px`,
					insetInlineEnd: `${insets.inline}px`,
				}
			: { left: `${position.x}px`, top: `${position.y}px` };

	return (
		<div
			className={overlayStyle}
			style={{ ...positionStyle, transform: `scale(${scale})` }}
			aria-hidden="true"
		>
			<div
				ref={boxRef}
				className={boxStyle}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerEnd}
				onPointerCancel={handlePointerEnd}
			>
				<img
					key={pose}
					className={`${frameStyle} ${animationStyle ?? ''}`}
					src={POSE_SOURCE[pose]}
					alt=""
					aria-hidden="true"
					data-motion={PET_REACTION_MOTION}
					width={FRAME_WIDTH * POSE_FRAMES[pose]}
					height={FRAME_HEIGHT}
					draggable={false}
					loading="lazy"
					decoding="async"
					fetchPriority="low"
					onAnimationEnd={pose === 'wave' ? () => showPose('idle', null, 'wave') : undefined}
				/>
			</div>
		</div>
	);
}
