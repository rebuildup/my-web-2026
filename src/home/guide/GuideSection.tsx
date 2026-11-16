import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { GUIDE_LEDGER } from './ledger';
import type { GuideRow } from './select';
import { selectGuideRows } from './select';

/**
 * Site guide — the "構内案内" section of the home page (Issue #930,
 * Epic #928).
 *
 * What it is
 * ----------
 * A station-directory-style index of the site's destinations: each
 * public facility is a same-level entry with a one-line orientation,
 * subordinate destinations expand in place, and a small set of
 * explicitly chosen external bases is marked as leaving the site.
 * The guide answers "what exists and how do I get there" — it never
 * copies the destination's own content.
 *
 * Design rules (from the Epic)
 * ----------------------------
 *   - Meaningful structure only: the ordinal, the expansion state and
 *     the external marker carry the "current location" motif; there
 *     are no decorative routes, connectors or ambient animation.
 *   - No-JS safe: expansion is a native `<details>`/`<summary>`, so
 *     the whole guide works with scripting disabled and every link is
 *     reachable by keyboard and screen reader without extra ARIA.
 *   - Promotion emphasis is a border + badge, not a reorder: the
 *     featured facility keeps its authored position.
 *   - Colour stays inside the editorial system: monochrome ground,
 *     `border.strong` / `bg.accent` only for the featured state and
 *     link affordances — identical to the rest of the page.
 */

const facilityListClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '0',
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

const facilityItemClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '5',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	'&:first-child': { paddingBlockStart: '0' },
	'&:last-child': { borderBottomWidth: '0', paddingBlockEnd: '0' },
});

const facilityLinkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'baseline',
	gap: '3',
	fontFamily: 'sans',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.3',
	letterSpacing: '-0.015em',
	color: 'text.default',
	textDecoration: 'none',
	_hover: { color: 'accent.interactive' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const ordinalClassName = /*#__PURE__*/ css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontWeight: '600',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const summaryClassName = /*#__PURE__*/ css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
	textWrap: 'pretty',
});

const featuredBadgeClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingInline: '2',
	paddingBlock: '1',
	borderRadius: 'sm',
	backgroundColor: 'bg.accent',
	color: 'text.inverse',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '700',
	letterSpacing: '0.02em',
});

const childrenClassName = /*#__PURE__*/ css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const detailsClassName = /*#__PURE__*/ css({
	margin: '0',
});

const summaryToggleClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	padding: '1',
	marginInlineStart: '-1',
	borderRadius: 'sm',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.muted',
	cursor: 'pointer',
	_hover: { color: 'text.default' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	// The disclosure triangle is the user agent's; we only hint the
	// expanded state through the marker's rotation-free text cue.
	'&::marker': { color: 'text.muted' },
});

const childLinkClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	paddingInlineStart: '5',
	paddingBlock: '2',
	textDecoration: 'none',
	borderInlineStartWidth: '2px',
	borderInlineStartStyle: 'solid',
	borderInlineStartColor: 'border.subtle',
	_hover: { borderInlineStartColor: 'border.strong' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const childLabelClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'text.default',
});

const externalMarkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	color: 'text.muted',
});

export interface GuideSectionProps {
	/** Base date (`YYYY-MM-DD`) promotion windows are evaluated against. */
	readonly today: string;
}

/**
 * The guide section. `today` comes from the same `observedAt` the
 * status tiles use, so a promotion boundary and the page's "now" can
 * never disagree.
 */
export function GuideSection({ today }: GuideSectionProps) {
	const rows = selectGuideRows(GUIDE_LEDGER, today);
	return (
		<section aria-labelledby="site-guide-heading">
			<Container>
				<SectionHeading
					id="site-guide-heading"
					eyebrow="Site guide"
					title="サイト内案内"
					titleEn="Site guide"
					description="このサイトに何があり、どう辿るか。主要ページは同列の施設として、必要なときだけ下の階層まで開けます。"
					variant="spread"
				>
					<ul className={facilityListClassName}>
						{rows.map(({ entry, featured }, index) => (
							<li key={entry.id} className={facilityItemClassName}>
								<div
									className={css({
										display: 'flex',
										flexWrap: 'wrap',
										alignItems: 'baseline',
										gap: '3',
									})}
								>
									<a href={entry.href} className={facilityLinkClassName}>
										<span className={ordinalClassName} aria-hidden="true">
											{String(index + 1).padStart(2, '0')}
										</span>
										<span>{entry.titleJa}</span>
									</a>
									{featured ? <span className={featuredBadgeClassName}>注目</span> : null}
									{entry.kind === 'external' ? (
										<span className={externalMarkClassName}>外部 ↗</span>
									) : null}
								</div>
								<p className={summaryClassName}>{entry.summaryJa}</p>
								{entry.children && entry.children.length > 0 ? (
									<details className={detailsClassName}>
										<summary className={summaryToggleClassName}>
											下の階層を見る ({entry.children.length})
										</summary>
										<ul className={childrenClassName}>
											{entry.children.map((child) => (
												<li key={child.id}>
													<a href={child.href} className={childLinkClassName}>
														<span className={childLabelClassName}>{child.labelJa}</span>
														<span className={summaryClassName}>{child.summaryJa}</span>
													</a>
												</li>
											))}
										</ul>
									</details>
								) : null}
							</li>
						))}
					</ul>
				</SectionHeading>
			</Container>
		</section>
	);
}
