import type { Meta, StoryObj } from '@storybook/react';
import { useId } from 'react';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	BRAND_NAME,
	BRAND_NAME_CARDS,
	BRAND_NAME_PUBLISHED_STATE,
	BRAND_NAME_SYMBOL,
} from './BrandNameMeanings.preview';

/**
 * Storybook preview for the Issue #521 brand naming note.
 *
 * What this shows
 * ---------------
 * The public half of `docs/brand/361do-name-meanings.md`: the NAME
 * (`361do`), the state of its SYMBOL (undefined — no 361do mark asset
 * exists in this repository, and whether one is adopted is Issue #61's
 * decision), the five competing readings of the name, and the short
 * copy candidates.
 *
 * The document is the source of truth; the words come from
 * `BrandNameMeanings.preview.ts`, which holds them as data. The
 * parity between the document and that data is checked by
 * `scripts/check-brand-name-meanings-preview-parity.test.mjs`, so the
 * preview cannot say anything the note does not say.
 *
 * The internal half of the note — the long-form drafts, the open
 * questions, the note about not-yet-rejected candidates — is NOT here
 * and must not be added here. It would publish an undecided position.
 *
 * Why the preview renders only the public half
 * --------------------------------------------
 * The five interpretations are all HELD: none of them has been adopted,
 * so the document cannot present one as the official reading. The
 * preview shows them as candidates side by side rather than resolving
 * them, and the "empty" state shows what a visitor would actually see
 * today — the record exists, but none of it has been decided.
 *
 * This story is a preview only: no route renders it, and the strings
 * it shows are not published site copy.
 */

const meta = {
	title: 'design-system/Brand name meanings',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The published state of the note: nothing adopted yet, so nothing to publish. */
function PublishedState() {
	return (
		<section
			aria-labelledby="brand-name-published-state"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				padding: '4',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: 'border.subtle',
				backgroundColor: 'bg.surface',
			})}
		>
			<h3
				id="brand-name-published-state"
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'lg',
					fontWeight: '700',
					color: 'text.default',
				})}
			>
				{BRAND_NAME_PUBLISHED_STATE.heading}
			</h3>
			<ul
				className={css({
					margin: '0',
					paddingInlineStart: '5',
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
					fontFamily: 'sans',
					fontSize: 'md',
					lineHeight: '1.6',
					color: 'text.muted',
				})}
			>
				{BRAND_NAME_PUBLISHED_STATE.points.map((point) => (
					<li key={point}>{point}</li>
				))}
			</ul>
		</section>
	);
}

/** The name and the state of its symbol. */
function IdentityRow() {
	return (
		<dl
			className={css({
				margin: '0',
				marginBlockStart: '6',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', sm: 'auto 1fr' },
				columnGap: '4',
				rowGap: '2',
				alignItems: 'baseline',
			})}
		>
			<dt
				className={css({
					margin: '0',
					fontFamily: 'mono',
					fontSize: 'sm',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				name
			</dt>
			<dd
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'xl',
					fontWeight: '700',
					letterSpacing: '-0.02em',
					color: 'text.default',
				})}
			>
				{BRAND_NAME}
			</dd>
			<dt
				className={css({
					margin: '0',
					fontFamily: 'mono',
					fontSize: 'sm',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				symbol
			</dt>
			<dd
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'md',
					lineHeight: '1.6',
					color: 'text.muted',
				})}
			>
				{BRAND_NAME_SYMBOL}
			</dd>
		</dl>
	);
}

/** One section of the note. */
function Card({ heading, points }: { heading: string; points: readonly string[] }) {
	// `useId` guarantees a unique id per mounted card. The previous key
	// was derived from the first bullet's length, which pointed at an id
	// no element carried and collided between cards of equal length.
	const headingId = useId();

	return (
		<section
			aria-labelledby={headingId}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				paddingBlock: '4',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<h3
				id={headingId}
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: 'lg',
					fontWeight: '700',
					lineHeight: '1.3',
					color: 'text.default',
				})}
			>
				{heading}
			</h3>
			<ul
				className={css({
					margin: '0',
					paddingInlineStart: '5',
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
					fontFamily: 'sans',
					fontSize: 'md',
					lineHeight: '1.7',
					color: 'text.default',
				})}
			>
				{points.map((point) => (
					<li key={point}>{point}</li>
				))}
			</ul>
		</section>
	);
}

/**
 * The preview body.
 *
 * `variant="empty"` renders the published state instead of the cards:
 * nothing has been adopted, so the published surface is empty. The
 * record is still there — it is simply not published.
 */
function BrandNameMeaningsPreview({ variant }: { variant: 'standard' | 'empty' }) {
	return (
		<Container as="section" className={css({ paddingBlock: { base: '8', lg: '12' } })}>
			<div data-brand-name-meanings-preview={variant}>
				<SectionHeading
					id="brand-name-meanings"
					eyebrow="Preview / Brand name meanings"
					title={BRAND_NAME}
					description="Issue #521 の brand naming note の公開 preview 部分。内部検討の節は載せていない。"
				/>
				<IdentityRow />
				{variant === 'empty' ? (
					<div className={css({ marginBlockStart: '8' })}>
						<PublishedState />
					</div>
				) : (
					<div className={css({ marginBlockStart: '8' })}>
						{BRAND_NAME_CARDS.map((card) => (
							<Card key={card.heading} heading={card.heading} points={card.points} />
						))}
					</div>
				)}
			</div>
		</Container>
	);
}

export const Standard: Story = {
	name: 'Preview / Brand name meanings',
	render: () => <BrandNameMeaningsPreview variant="standard" />,
};

export const Empty: Story = {
	name: 'Preview / Brand name meanings (empty)',
	render: () => <BrandNameMeaningsPreview variant="empty" />,
};

/**
 * The narrow state.
 *
 * The width is bounded by a fixed wrapper rather than by a viewport
 * preset, so the same column is what the capture photographs and what
 * a reader sees — the story is about how the note reads when it has to
 * wrap, not about one particular device.
 */
export const Narrow: Story = {
	name: 'Preview / Brand name meanings (narrow)',
	render: () => (
		<div
			className={css({
				display: 'flex',
				justifyContent: 'center',
				paddingInline: '4',
				backgroundColor: 'bg.subtle',
			})}
		>
			<div className={css({ width: '100%', maxWidth: '375px' })}>
				<BrandNameMeaningsPreview variant="standard" />
			</div>
		</div>
	),
};
