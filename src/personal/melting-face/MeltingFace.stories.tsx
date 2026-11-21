import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { MeltingFaceFallback, MeltingFaceMark, MeltingFaceMotif } from './MeltingFace';
import {
	MELTING_FACE_CHAIN,
	MELTING_FACE_COPY,
	MELTING_FACE_DOCUMENT,
	MELTING_FACE_EXPLANATIONS,
	MELTING_FACE_ICON,
	MELTING_FACE_LEGEND,
	MELTING_FACE_SECTIONS,
} from './MeltingFace.preview';

/**
 * Preview of the "melting face" brand motif (Issue #522).
 *
 * What this surface is
 * --------------------
 * A small independent display component for the motif chain
 * 361℃ → 『時間を溶かしています』 → melting face → SNS icon
 * character, plus the English line 『Lost in time. 🫠 Found it
 * nowhere.』. The issue scopes it as a standalone component whose
 * display position is undecided, so this Storybook story is the whole
 * surface: no route mounts it.
 *
 * Why the data lives in a separate module
 * ---------------------------------------
 * `MeltingFace.preview.ts` holds the CONTENT; `MeltingFace.tsx` holds
 * the drawing of the motif; this file holds the page chrome around
 * them. That split is what lets
 * `scripts/check-melting-face-preview-parity.test.mjs` import the data
 * directly and prove that the document (`docs/brand/melting-face.md`)
 * and the preview data still agree.
 *
 * What the screen deliberately does NOT do
 * -----------------------------------------
 * It invents nothing: every string is either verbatim from Issue #522
 * or a restatement of it, every copy role is marked as a candidate,
 * the three explanation candidates are shown UNRESOLVED, and the mark
 * is an explicitly-labelled placeholder because the original artwork
 * is unverified — no production asset is adopted.
 */

const pageClassName = css({
	fontFamily: 'sans',
	background: 'bg.canvas',
	color: 'text.default',
	padding: { base: '6', md: '10' },
});

const contentClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '10',
});

const headerClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	paddingBottom: '6',
});

const titleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '3xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.02em',
	color: 'text.default',
});

const metaListClassName = css({
	margin: '0',
	padding: '0',
	display: 'flex',
	flexWrap: 'wrap',
	gap: '3',
	listStyle: 'none',
});

const metaItemClassName = css({
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.7',
	color: 'text.muted',
});

const sectionClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
});

const sectionTitleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const listClassName = css({
	margin: '0',
	paddingInlineStart: '5',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.8',
	color: 'text.default',
});

/** One document section after the motif: heading + bullets. */
function NoteSection({ heading, bullets }: { heading: string; bullets: readonly string[] }) {
	return (
		<section className={sectionClassName} aria-label={heading}>
			<h2 className={sectionTitleClassName}>{heading}</h2>
			<ul className={listClassName} data-notes-list>
				{bullets.map((bullet) => (
					<li key={bullet}>{bullet}</li>
				))}
			</ul>
		</section>
	);
}

/** The document header every variant shares. */
function DocumentHeader() {
	return (
		<header className={headerClassName}>
			<h1 className={titleClassName}>{MELTING_FACE_DOCUMENT.title}</h1>
			<ul className={metaListClassName}>
				<li>
					<Badge tone="neutral">{MELTING_FACE_DOCUMENT.status}</Badge>
				</li>
				<li className={metaItemClassName}>{MELTING_FACE_DOCUMENT.source}</li>
				<li className={metaItemClassName}>{MELTING_FACE_DOCUMENT.verification}</li>
				<li className={metaItemClassName}>{MELTING_FACE_DOCUMENT.preview}</li>
			</ul>
		</header>
	);
}

/** The note sections every variant shares. */
function NoteSections() {
	return (
		<>
			{MELTING_FACE_SECTIONS.map((section) => (
				<NoteSection key={section.heading} heading={section.heading} bullets={section.bullets} />
			))}
		</>
	);
}

/**
 * The whole preview on one screen: document header, the motif
 * component, then the rule / source / verification / open sections.
 */
export function MeltingFacePreview() {
	return (
		<main className={pageClassName} data-testid="melting-face-preview">
			<Container>
				<div className={contentClassName}>
					<DocumentHeader />
					<MeltingFaceMotif
						chain={MELTING_FACE_CHAIN}
						copy={MELTING_FACE_COPY}
						icon={MELTING_FACE_ICON}
						explanations={MELTING_FACE_EXPLANATIONS}
						heading={MELTING_FACE_LEGEND.heading}
						lead={MELTING_FACE_LEGEND.lead}
					/>
					<NoteSections />
				</div>
			</Container>
		</main>
	);
}

/**
 * The fallback / alt rendering: the same motif as text only.
 *
 * This is what the surface says when no artwork is available — the
 * fallback glyph, the short copy, the alt text and the asset status,
 * all as visible text. It proves the message survives without the
 * drawing.
 */
export function MeltingFaceFallbackPreview() {
	return (
		<main className={pageClassName} data-testid="melting-face-fallback-preview">
			<Container>
				<div className={contentClassName}>
					<DocumentHeader />
					<section className={sectionClassName} aria-label="fallback / alt 表示">
						<h2 className={sectionTitleClassName}>fallback / alt 表示</h2>
						<p className={metaItemClassName}>
							アートワークが使えないときの文字だけの表示。alt
							テキストと同じ説明を可視テキストとしても出す。
						</p>
						<MeltingFaceFallback icon={MELTING_FACE_ICON} copy={MELTING_FACE_COPY} />
					</section>
					<NoteSections />
				</div>
			</Container>
		</main>
	);
}

const motionCompareClassName = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', sm: '1fr 1fr' },
	gap: '4',
});

const motionCompareCellClassName = css({
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	gap: '2',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

/**
 * The two motion states side by side.
 *
 * The left mark follows the live `prefers-reduced-motion` query; the
 * right mark is pinned to the reduced frame (`reducedMotion` prop),
 * so a reader can see that the resting markup is identical either
 * way — only the drip animation differs. In a reduced-motion
 * environment BOTH marks render the resting frame.
 */
export function MeltingFaceMotionStates() {
	return (
		<main className={pageClassName} data-testid="melting-face-motion-states">
			<Container>
				<div className={contentClassName}>
					<DocumentHeader />
					<section className={sectionClassName} aria-label="motion states">
						<h2 className={sectionTitleClassName}>motion states</h2>
						<p className={metaItemClassName}>
							左は live の prefers-reduced-motion、右は reducedMotion prop で固定した resting
							frame。drip の animation だけが違い、頭・目・口と alt テキストは同じ。
						</p>
						<div className={motionCompareClassName}>
							<div className={motionCompareCellClassName}>
								<MeltingFaceMark icon={MELTING_FACE_ICON} />
								<p className={metaItemClassName}>live preference</p>
							</div>
							<div className={motionCompareCellClassName}>
								<MeltingFaceMark icon={MELTING_FACE_ICON} reducedMotion />
								<p className={metaItemClassName}>reducedMotion pinned</p>
							</div>
						</div>
					</section>
					<NoteSections />
				</div>
			</Container>
		</main>
	);
}

const meta = {
	title: 'Preview / Melting face',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole motif: document header, chain, separated roles, candidates, notes. */
export const Default: Story = {
	render: () => <MeltingFacePreview />,
};

/** The text-only fallback / alt rendering of the same motif. */
export const Fallback: Story = {
	render: () => <MeltingFaceFallbackPreview />,
};

/** The two motion states side by side (live preference vs pinned reduced). */
export const MotionStates: Story = {
	render: () => <MeltingFaceMotionStates />,
};

/** The whole preview at the narrowest supported width (320 px). */
export const Narrow: Story = {
	render: () => (
		<div
			className={css({
				width: '320px',
				margin: '0 auto',
				borderWidth: '1px',
				borderStyle: 'dashed',
				borderColor: 'border.subtle',
			})}
		>
			<MeltingFacePreview />
		</div>
	),
};
