import { type KeyboardEvent, useState } from 'react';
import { css } from '../../../styled-system/css';
import { ENGAGEMENT_STEP_MOTION, usePrefersReducedMotion } from '../../editorial/reduced-motion';
import type { EngagementWork } from './Engagement.preview';

/**
 * Engagement — the Issue #517 "見てて楽しい" presentation pair.
 *
 * What this file is
 * -----------------
 * TWO renderings of the SAME `EngagementWork` facts:
 *
 *   - `EngagementStaticPreview` — the readable document: every work's
 *     facts on the page at once, in seed order, no state, no motion.
 *   - `EngagementInteractivePreview` — the operable deck: one work at
 *     a time behind prev/next buttons and ArrowLeft / ArrowRight,
 *     with a position readout and a progress track.
 *
 * Both render through `EngagementWorkFacts`, so a fact that appears
 * in one variant and not the other is a bug in this file, not a
 * difference in the data — that is the experiment's control.
 *
 * Reduced motion
 * --------------
 * The deck's only motion is the `engagementStep` arrival on the
 * swapped-in panel. Under `prefers-reduced-motion: reduce` the
 * component emits NO `animation-name` at all: the swap is instant and
 * every fact remains in the resting document. The `reducedMotion`
 * prop is the contract's fixture override (`REDUCED_MOTION_PROP`) —
 * production callers pass nothing.
 */

const workCardClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	padding: '5',
	border: '1px solid {colors.border.subtle}',
	borderRadius: 'lg',
	backgroundColor: 'bg.canvas',
});

const workTitleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: { base: 'lg', md: 'xl' },
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const workMetaClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	gap: '2',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
});

const workFactClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const techListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexWrap: 'wrap',
	gap: '2',
});

const techItemClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingBlock: '1',
	paddingInline: '2',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.default',
});

const workLinksClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexWrap: 'wrap',
	gap: '3',
});

const linkClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '3px',
});

/**
 * The ONE fact renderer both variants share.
 *
 * Title → period/role → technologies → fact → links, always in this
 * order. The interactive deck renders this same block for whichever
 * work is current, so "the same information" is a structural fact of
 * the code, not a promise in prose.
 */
function EngagementWorkFacts({ work }: { work: EngagementWork }) {
	return (
		<article className={workCardClassName} data-engagement-work={work.id}>
			<h3 className={workTitleClassName}>{work.title}</h3>
			<p className={workMetaClassName}>
				<span>{work.periodLabel}</span>
				<span aria-hidden="true">·</span>
				<span>{work.role}</span>
			</p>
			<ul className={techListClassName} aria-label="technologies">
				{work.technologies.map((technology) => (
					<li key={technology} className={techItemClassName}>
						{technology}
					</li>
				))}
			</ul>
			<p className={workFactClassName}>{work.fact}</p>
			{work.links.length > 0 ? (
				<ul className={workLinksClassName}>
					{work.links.map((link) => (
						<li key={link.url}>
							<a className={linkClassName} href={link.url}>
								{link.label}
							</a>
						</li>
					))}
				</ul>
			) : null}
		</article>
	);
}

const staticListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

/**
 * Variant 1 — the readable document.
 *
 * Every work at once, in seed order. There is deliberately no state,
 * no handler and no animation here: this is the "内容が面白い"
 * reading of 見てて楽しい, and its cost is paid in scroll length,
 * not in JavaScript.
 */
export function EngagementStaticPreview({ works }: { works: readonly EngagementWork[] }) {
	return (
		<ol className={staticListClassName} data-engagement-variant="static">
			{works.map((work) => (
				<li key={work.id}>
					<EngagementWorkFacts work={work} />
				</li>
			))}
		</ol>
	);
}

const deckClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const deckControlsClassName = css({
	display: 'flex',
	alignItems: 'center',
	gap: '3',
	flexWrap: 'wrap',
});

const deckButtonClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingBlock: '2',
	paddingInline: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
	color: 'text.default',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	cursor: 'pointer',
	// Hover/focus affordance is a colour + weight change, not motion:
	// transitions are decoration and the universal reduced-motion
	// floor already clamps them, so no per-component opt-out is owed.
	transitionProperty: 'background-color, color',
	transitionDuration: '120ms',
	_hover: {
		backgroundColor: 'bg.subtle',
	},
	_focusVisible: {
		outlineWidth: '2px',
		outlineStyle: 'solid',
		outlineColor: 'border.accent',
		outlineOffset: '2px',
	},
	_disabled: {
		opacity: '0.5',
		cursor: 'default',
	},
});

const deckPositionClassName = css({
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.muted',
	minWidth: '4ch',
	textAlign: 'center',
});

const deckProgressClassName = css({
	height: '4px',
	borderRadius: 'full',
	backgroundColor: 'bg.subtle',
	overflow: 'hidden',
});

const deckProgressFillClassName = css({
	height: '100%',
	backgroundColor: 'bg.accent',
	transitionProperty: 'width',
	transitionDuration: '120ms',
});

/**
 * Variant 2 — the operable deck.
 *
 * One work visible at a time; the rest are one control away. The
 * controls are real `<button>`s (so Tab + Enter/Space work natively,
 * and `aria-keyshortcuts` advertises the arrow keys on each) and the
 * deck answers ArrowLeft / ArrowRight through a bubbled `onKeyDown`,
 * so a keyboard-only visitor never needs a mouse. The position
 * readout is `aria-live="polite"` — the state change is ANNOUNCED,
 * not merely animated, which is what makes the reduced-motion swap
 * honest. The progress track is decorative (`aria-hidden`) because
 * the readout already carries the state.
 *
 * The step transition is the only motion: a short transform-only
 * arrival on the swapped-in panel, emitted only when the visitor did
 * not ask for reduced motion.
 */
export function EngagementInteractivePreview({
	works,
	reducedMotion,
}: {
	works: readonly EngagementWork[];
	reducedMotion?: boolean;
}) {
	const prefersReduced = usePrefersReducedMotion();
	const reduced = reducedMotion ?? prefersReduced;
	const [index, setIndex] = useState(0);
	const work = works[index];
	const total = works.length;

	function go(delta: number) {
		setIndex((current) => Math.min(Math.max(current + delta, 0), total - 1));
	}

	function onKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			go(-1);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			go(1);
		}
	}

	if (!work) return null;

	return (
		<div
			className={deckClassName}
			data-engagement-variant="interactive"
			data-engagement-deck
			onKeyDown={onKeyDown}
		>
			<div className={deckControlsClassName}>
				<button
					type="button"
					className={deckButtonClassName}
					data-engagement-prev
					disabled={index === 0}
					aria-keyshortcuts="ArrowLeft"
					onClick={() => go(-1)}
				>
					← 前の作品
				</button>
				<span className={deckPositionClassName} data-engagement-position aria-live="polite">
					{index + 1} / {total}
				</span>
				<button
					type="button"
					className={deckButtonClassName}
					data-engagement-next
					disabled={index === total - 1}
					aria-keyshortcuts="ArrowRight"
					onClick={() => go(1)}
				>
					次の作品 →
				</button>
			</div>
			{/*
			 * The track is decoration: the deck's state is already
			 * carried accessibly by the `aria-live` position readout,
			 * so the bar is hidden from the accessibility tree rather
			 * than given a role it cannot honestly fulfil.
			 */}
			<div className={deckProgressClassName} data-engagement-progress aria-hidden="true">
				<div
					className={deckProgressFillClassName}
					style={{ width: `${((index + 1) / total) * 100}%` }}
				/>
			</div>
			{/*
			 * `key={work.id}` remounts the panel on every step, so the
			 * arrival animation replays per work. The declarations stay
			 * LITERAL inside the component for the same reason
			 * `MeltingFace.tsx` keeps them literal: Panda extracts the
			 * utility classes by reading this object at build time.
			 */}
			<div
				key={work.id}
				data-motion={ENGAGEMENT_STEP_MOTION}
				data-motion-state={reduced ? 'reduced' : 'animated'}
				className={css({
					...(reduced
						? {}
						: {
								animationName: 'engagementStep',
								animationDuration: '180ms',
								animationTimingFunction: 'ease-out',
								animationFillMode: 'both',
							}),
				})}
			>
				<EngagementWorkFacts work={work} />
			</div>
		</div>
	);
}
