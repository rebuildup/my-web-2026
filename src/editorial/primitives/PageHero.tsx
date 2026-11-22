import type { ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';
import { Grid, GridItem } from './Grid';
import { PageSection } from './PageSection';
import { ledeSansLg, pageTitleFlush } from './shared-styles';

/**
 * PageHero — the entry composition every public page opens with
 * (Issue #1163, ADR-0023 §3).
 *
 * Why a primitive
 * --------------
 * The L-C review (F-12) recorded the same defect on every public
 * page: the entry block sat in the left half of the measure and the
 * right half stayed empty from the masthead to the first section.
 * The home had already answered it with a 12-track asymmetric
 * composition (`src/home/hero.tsx`), but copying that composition
 * onto the other pages would have been a template, not a design:
 * each page's right-hand column has to carry THAT page's own
 * content — the inventory of a catalogue, the source status of a
 * timeline, the group index of a link directory.
 *
 * So the design system owns the STRUCTURE (the two columns, their
 * tracks, the alignment) and every page owns the CONTENT of the
 * right column. The composition is shared; the meaning is not.
 *
 * The structure
 * -------------
 *   - the title block takes 7 of 12 tracks: the eyebrow, the h1,
 *     the optional second title line, the lead and any chips stay
 *     on one measure, so the reading column is unchanged from the
 *     pages that had no right column;
 *   - the aside takes 4 tracks starting at track 9 (one track of
 *     deliberate air between the columns), and is aligned to the
 *     BOTTOM of the title block, so the two columns read as one
 *     band rather than two floating boxes;
 *   - below `md` the columns stack (the grid's `base` behaviour), so
 *     a phone gets the title first and the aside under it.
 *
 * The aside is optional. A page with nothing worth putting in the
 * right column keeps the title-led hero — the whitespace is then a
 * deliberate title page, not a hole.
 */
export interface PageHeroProps {
	/**
	 * The `id` of the `<h1>`. The section wires `aria-labelledby` to
	 * it, so the hero is a labelled landmark.
	 */
	readonly labelledBy: string;
	/** The small mono line above the title (the page's path, usually). */
	readonly eyebrow?: ReactNode;
	/** The `<h1>` content. */
	readonly title: ReactNode;
	/** An optional second title line (the English half). */
	readonly titleEn?: ReactNode;
	/** The lead paragraph under the title. */
	readonly description?: ReactNode;
	/** A small label above the aside (the page's own vocabulary). */
	readonly asideLabel?: ReactNode;
	/** The page's own right-column content. */
	readonly aside?: ReactNode;
	/** Extra content under the title block (chips, a status line). */
	readonly children?: ReactNode;
}

const eyebrowClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'sm',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

/**
 * The title is the page's DISPLAY size (`pageTitleFlush`), the same
 * one the pages used before the primitive — the primitive changes the
 * composition, not the type scale.
 */
const titleClassName = css(pageTitleFlush);

const descriptionClassName = css({
	...ledeSansLg,
	marginBlockStart: '4',
	textWrap: 'pretty',
});

const asideLabelClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

export function PageHero({
	labelledBy,
	eyebrow,
	title,
	titleEn,
	description,
	asideLabel,
	aside,
	children,
}: PageHeroProps) {
	return (
		<PageSection rhythm="hero" labelledBy={labelledBy}>
			<Grid template="12" gap="6">
				<GridItem span={{ base: 12, md: 12, lg: 7 }}>
					{eyebrow ? <p className={eyebrowClassName}>{eyebrow}</p> : null}
					<h1
						id={labelledBy}
						className={cx(titleClassName, css({ marginBlockStart: eyebrow ? '4' : '0' }))}
					>
						{title}
					</h1>
					{titleEn ? (
						<p
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: '2xl',
								fontWeight: '700',
								letterSpacing: '-0.02em',
								lineHeight: '1.2',
								color: 'text.default',
							})}
						>
							{titleEn}
						</p>
					) : null}
					{description ? (
						<p className={cx(descriptionClassName, css({ marginBlockStart: titleEn ? '4' : '6' }))}>
							{description}
						</p>
					) : null}
					{children}
				</GridItem>
				{aside ? (
					<GridItem
						span={{ base: 12, md: 12, lg: 4 }}
						start={{ base: 1, lg: 9 }}
						className={css({ alignSelf: 'end' })}
					>
						{asideLabel ? <p className={asideLabelClassName}>{asideLabel}</p> : null}
						{aside}
					</GridItem>
				) : null}
			</Grid>
		</PageSection>
	);
}
