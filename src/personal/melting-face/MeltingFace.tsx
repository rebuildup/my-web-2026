import { css } from '../../../styled-system/css';
import { MELTING_FACE_MOTION, usePrefersReducedMotion } from '../../editorial/reduced-motion';
import type {
	MeltingFaceChainStep,
	MeltingFaceCopy,
	MeltingFaceExplanation,
	MeltingFaceIcon,
} from './MeltingFace.preview';

/**
 * MeltingFace — the "melting face" brand-motif component (Issue #522).
 *
 * What this component is
 * ----------------------
 * A small independent display component for the motif chain
 * 361℃ → 『時間を溶かしています』 → melting face → SNS icon
 * character. It renders three SEPARATED roles, which is the issue's
 * first acceptance criterion:
 *
 *   - the ICON role (`MeltingFaceMark`) — the melting face itself,
 *     drawn as an explicitly-labelled placeholder because the original
 *     artwork is unverified (the Miro board cannot be read) and the
 *     issue forbids adopting a production asset;
 *   - the COPY roles (`short` / `long` / `english`) — the words, each
 *     in its own typographic role, none of them adopted copy;
 *   - the EXPLANATION candidates — 熱中 / 時間を惜しみなく投資 /
 *     無駄なこと, kept side by side because they contradict and the
 *     issue requires the tension to survive.
 *
 * `MeltingFaceFallback` is the text-only rendering of the same motif:
 * what the surface says when no artwork is available. It carries the
 * same copy and the same alt text as visible text, so the fallback is
 * a rendering, not a different message.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It owns no facts. The chain, the copy, the icon strings and the
 * candidates arrive as props; this file decides only how a motif, a
 * mark and a fallback are drawn. It is not mounted on any route — the
 * issue scopes it as a standalone component whose display position is
 * undecided, so the Storybook story is the whole surface.
 */

const motifClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '6',
});

const motifHeaderClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const motifHeadingClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const motifLeadClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
});

const chainClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '2',
});

const chainStepClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingBlock: '1',
	paddingInline: '3',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	lineHeight: '1.5',
	color: 'text.default',
});

const chainArrowClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
});

const chainItemClassName = css({
	display: 'contents',
});

const bodyClassName = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
	gap: '6',
	alignItems: 'start',
});

const markCardClassName = css({
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	gap: '3',
	padding: '6',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const markFrameClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.subtle',
	color: 'text.default',
});

// The placeholder face: a blob head with two drip shapes and two
// cut-out features. It is deliberately schematic — it says "a face
// melting" without claiming to be the unverified original artwork.
// The shapes inherit `fill="currentColor"` from the `<svg>`, so the
// mark follows `text.default` (and therefore light / dark) with the
// rest of the page; the cut-outs read `--colors-bg-subtle` instead.
const markArtClassName = css({
	display: 'block',
	width: '96px',
	height: '96px',
});

/**
 * The cut-out colour for the eyes and mouth.
 *
 * The mark is drawn with SVG presentation attributes, not Panda
 * `fill` utilities: `fill` is not in the repository's CSS vocabulary
 * (`scripts/check-css-syntax.mjs`), so the shapes inherit
 * `fill="currentColor"` from the `<svg>` and the cut-outs override
 * only their `color`. `--colors-bg-subtle` is the semantic token
 * variable, so the cut-outs follow light / dark with the page.
 */
const markCutoutStyle = { color: 'var(--colors-bg-subtle)' } as const;

const markCaptionClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
	textAlign: 'center',
	overflowWrap: 'anywhere',
});

const copyCardClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const roleLabelClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const shortCopyClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '2xl',
	fontWeight: '700',
	lineHeight: '1.3',
	letterSpacing: '-0.01em',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

const longCopyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.8',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

const englishCopyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.7',
	fontStyle: 'italic',
	color: 'text.muted',
	overflowWrap: 'anywhere',
});

const explanationListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'grid',
	gridTemplateColumns: { base: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
	gap: '3',
});

const explanationCardClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'dashed',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const explanationLabelClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const explanationStanceClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
});

/**
 * The mark itself: the icon role of the motif.
 *
 * `alt` is the accessible name — the mark is `role="img"` so the
 * placeholder drawing is announced as ONE image with a description,
 * not as anonymous shapes. `reducedMotion` is the fixture override the
 * contract publishes (`REDUCED_MOTION_PROP`): production callers pass
 * nothing and the live `prefers-reduced-motion` query decides; a
 * story or test may pin either answer.
 *
 * The only motion is the slow drip bob on the two drips — decoration.
 * Under reduced motion NO `animation-name` is emitted at all: the
 * resting frame IS the reduced frame, and the same head, eyes and
 * mouth carry the same meaning.
 */
export function MeltingFaceMark({
	icon,
	reducedMotion,
}: {
	icon: MeltingFaceIcon;
	reducedMotion?: boolean;
}) {
	const prefersReduced = usePrefersReducedMotion();
	const reduced = reducedMotion ?? prefersReduced;
	return (
		<span
			className={markFrameClassName}
			data-motion={MELTING_FACE_MOTION}
			data-motion-state={reduced ? 'reduced' : 'animated'}
			data-melting-face-mark
		>
			<svg
				className={markArtClassName}
				viewBox="0 0 64 64"
				role="img"
				aria-label={icon.alt}
				focusable="false"
				fill="currentColor"
			>
				{/* The drip group is the ONLY animated part. The
				    declarations stay LITERAL inside the component for the
				    same reason `src/home/access/tiles.tsx` keeps them
				    literal: Panda extracts the utility classes by reading
				    this object at build time. */}
				<g
					data-motion-part="drip"
					className={css({
						...(reduced
							? {}
							: {
									animationName: 'meltingFaceDrip',
									animationDuration: '3.6s',
									animationTimingFunction: 'ease-in-out',
									animationIterationCount: 'infinite',
								}),
					})}
				>
					<rect x="17" y="42" width="9" height="13" rx="4.5" />
					<rect x="38" y="45" width="9" height="10" rx="4.5" />
				</g>
				<path d="M32 7c-12 0-20 8-20 21 0 12 8 20 20 20s20-8 20-20c0-13-8-21-20-21z" />
				<circle style={markCutoutStyle} fill="currentColor" cx="25" cy="26" r="2.6" />
				<circle style={markCutoutStyle} fill="currentColor" cx="39" cy="26" r="2.6" />
				<rect
					style={markCutoutStyle}
					fill="currentColor"
					x="26"
					y="34"
					width="12"
					height="3.4"
					rx="1.7"
				/>
			</svg>
		</span>
	);
}

const fallbackClassName = css({
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	gap: '3',
	padding: '8',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'dashed',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
	textAlign: 'center',
});

const fallbackGlyphClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: '3xl',
	lineHeight: '1.4',
});

/**
 * The text-only rendering of the same motif.
 *
 * This is what the surface says when no artwork is available: the
 * fallback glyph, the short copy, the alt text as a visible
 * description, and the asset status. It is a RENDERING of the same
 * facts — the fallback story proves the message survives without the
 * drawing.
 */
export function MeltingFaceFallback({
	icon,
	copy,
}: {
	icon: MeltingFaceIcon;
	copy: MeltingFaceCopy;
}) {
	return (
		<div className={fallbackClassName} data-melting-face-fallback>
			<p className={fallbackGlyphClassName}>{icon.fallbackText}</p>
			<p className={shortCopyClassName}>{copy.short}</p>
			<p className={markCaptionClassName}>{icon.alt}</p>
			<p className={markCaptionClassName}>{icon.assetNote}</p>
		</div>
	);
}

/**
 * The whole motif: heading, chain, the separated roles, the
 * explanations.
 *
 * `heading` / `lead` come from the caller's data so the same component
 * can sit under a document heading or inside a page section without
 * owning the surrounding chrome.
 */
export function MeltingFaceMotif({
	chain,
	copy,
	icon,
	explanations,
	heading,
	lead,
	reducedMotion,
}: {
	chain: readonly MeltingFaceChainStep[];
	copy: MeltingFaceCopy;
	icon: MeltingFaceIcon;
	explanations: readonly MeltingFaceExplanation[];
	heading: string;
	lead: string;
	reducedMotion?: boolean;
}) {
	return (
		<section className={motifClassName} aria-label={heading} data-melting-face-motif>
			<div className={motifHeaderClassName}>
				<h2 className={motifHeadingClassName}>{heading}</h2>
				<p className={motifLeadClassName}>{lead}</p>
			</div>
			<ol className={chainClassName} data-melting-face-chain>
				{chain.map((step, index) => (
					<li key={step.id} className={chainItemClassName}>
						{index > 0 ? (
							<span className={chainArrowClassName} aria-hidden="true">
								→
							</span>
						) : null}
						<span className={chainStepClassName} data-melting-face-chain-step>
							{step.label}
						</span>
					</li>
				))}
			</ol>
			<div className={bodyClassName}>
				<div className={markCardClassName} data-melting-face-icon-role>
					<MeltingFaceMark icon={icon} reducedMotion={reducedMotion} />
					<p className={markCaptionClassName}>{icon.label}</p>
					<p className={markCaptionClassName}>{icon.assetNote}</p>
				</div>
				<div className={copyCardClassName} data-melting-face-copy-roles>
					<div>
						<p className={roleLabelClassName}>short copy</p>
						<p className={shortCopyClassName}>{copy.short}</p>
					</div>
					<div>
						<p className={roleLabelClassName}>long copy — candidate, not adopted</p>
						<p className={longCopyClassName}>{copy.long}</p>
					</div>
					<div>
						<p className={roleLabelClassName}>english line</p>
						<p className={englishCopyClassName}>{copy.english}</p>
					</div>
				</div>
			</div>
			<div data-melting-face-explanations>
				<p className={roleLabelClassName}>explanation candidates — kept unresolved</p>
				<ul className={explanationListClassName}>
					{explanations.map((explanation) => (
						<li key={explanation.id} className={explanationCardClassName}>
							<p className={explanationLabelClassName}>{explanation.label}</p>
							<p className={explanationStanceClassName}>{explanation.stance}</p>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
