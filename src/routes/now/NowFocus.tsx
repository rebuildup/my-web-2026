import { css } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { TextLink } from '../../editorial/primitives/TextLink';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { metaRows } from '../../home/current/CurrentProjects';
import { SOURCE_LABELS } from '../../home/current/source';
import type { CurrentProjectRecord } from '../../home/current/types';
import { PortfolioMediaFigure } from '../../portfolio/components/PortfolioMedia';
import { NOW_FOCUS_LIMIT, type NowFocusItem, nowFocusLevelLabel } from './focus';

/**
 * NowFocus — the `/now` "いまの焦点 / In focus" band (Issue #1316).
 *
 * The page's job is to say what the owner is focused on NOW, and the
 * enumeration below only proves it exists. This band is the editorial
 * answer: the records the owner marked 主軸 / 並行, presented as
 * features — name at display scale, the status sentence as the lead,
 * the measured facts compressed to one strip — with the portfolio
 * cover as evidence where a case study is mapped
 * (`NOW_FOCUS_PORTFOLIO_SLUGS`). A record without evidence keeps its
 * slot as a typographic plate at the SAME 16/9 frame, so the band
 * never reflows around missing imagery and never borrows an unrelated
 * cover to look complete.
 *
 * Everything here is presentation: the selection rule lives in
 * `./focus.ts`, the records in `home/current`, the covers in
 * `portfolio`. This component only arranges them.
 */
export interface NowFocusProps {
	readonly items: readonly NowFocusItem[];
	/** The loader's base date — the same `today` the enumeration uses. */
	readonly today: string;
}

const FOCUS_MEDIA_RATIO = '16 / 9';

const itemClassName = /* @__PURE__ */ css({
	paddingBlock: '8',
	borderBlockStart: '1px solid {colors.border.subtle}',
	'&:first-child': {
		borderBlockStart: 'none',
		paddingBlockStart: '0',
	},
});

const nameClassName = /* @__PURE__ */ css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '3xl',
	fontWeight: '700',
	color: 'text.default',
	lineHeight: '1.15',
	letterSpacing: '-0.02em',
});

const statusClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '4',
	fontFamily: 'sans',
	fontSize: 'lg',
	lineHeight: '1.7',
	color: 'text.default',
	maxWidth: '34rem',
});

const levelTagClassName = /* @__PURE__ */ css({
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	letterSpacing: '0.08em',
	color: 'text.muted',
});

const factsStripClassName = /* @__PURE__ */ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	margin: '0',
	marginBlockStart: '5',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
	fontVariantNumeric: 'tabular-nums',
});

const factValueClassName = /* @__PURE__ */ css({
	color: 'text.default',
});

const sourceTagClassName = /* @__PURE__ */ css({
	fontSize: 'xs',
	color: 'text.muted',
	letterSpacing: '0.04em',
});

const linkRowClassName = /* @__PURE__ */ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '6',
	marginBlockStart: '5',
});

const mediaLinkClassName = /* @__PURE__ */ css({
	display: 'block',
	textDecoration: 'none',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '4px',
		borderRadius: '6px',
	},
});

/**
 * The typographic plate — the media column's honest empty state.
 * Same 16/9 frame as a cover, so the grid never shifts; the plate
 * carries the project's own name at display scale instead of
 * pretending to be a screenshot.
 */
const plateClassName = /* @__PURE__ */ css({
	aspectRatio: FOCUS_MEDIA_RATIO,
	width: '100%',
	display: 'grid',
	placeItems: 'center',
	backgroundColor: 'bg.subtle',
	border: '1px solid {colors.border.subtle}',
	borderRadius: '6px',
	padding: '6',
	textAlign: 'center',
});

const plateNameClassName = /* @__PURE__ */ css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '2xl',
	fontWeight: '700',
	color: 'text.muted',
	lineHeight: '1.2',
	letterSpacing: '-0.01em',
});

const plateNoteClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '3',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

/**
 * The compressed fact strip: the same measured rows the ledger
 * renders, folded to one line — `label value（source）` pieces
 * separated by a hairline dot. A record with no measured facts
 * renders no strip at all.
 */
function FocusFacts({ record, today }: { record: CurrentProjectRecord; today: string }) {
	const rows = metaRows(record, today);
	if (rows.length === 0) return null;
	return (
		<p data-testid="now-focus-facts" className={factsStripClassName}>
			{rows.map((row, index) => (
				<span key={row.label} style={{ display: 'contents' }}>
					{index > 0 ? <span aria-hidden="true">·</span> : null}
					<span>{row.label}</span>
					<span className={factValueClassName}>{row.value}</span>
					<span className={sourceTagClassName}>{SOURCE_LABELS[row.source]}</span>
				</span>
			))}
		</p>
	);
}

function FocusMedia({ item, eager }: { item: NowFocusItem; eager: boolean }) {
	const { record, cover } = item;
	if (cover?.media) {
		return (
			<a
				href={`/portfolio/${cover.slug}`}
				className={mediaLinkClassName}
				data-testid="now-focus-cover-link"
			>
				<PortfolioMediaFigure
					media={cover.media}
					loading={eager ? 'eager' : 'lazy'}
					frameAspectRatio={FOCUS_MEDIA_RATIO}
				/>
			</a>
		);
	}
	return (
		<div className={plateClassName} data-testid="now-focus-plate">
			<div>
				<p className={plateNameClassName}>{record.name}</p>
				<p className={plateNoteClassName}>No cover published</p>
			</div>
		</div>
	);
}

function FocusItem({
	item,
	today,
	index,
}: {
	item: NowFocusItem;
	today: string;
	index: number;
}) {
	const { record, cover } = item;
	const levelLabel = nowFocusLevelLabel(record);
	return (
		<li data-testid="now-focus-item" data-project-id={record.id} className={itemClassName}>
			<Grid template="12" gap="4" columnGap={{ base: '4', lg: '6' }}>
				<GridItem span={{ base: 12, lg: 5 }} start={{ base: 1, lg: 1 }}>
					<div>
						{levelLabel ? (
							<span data-testid="now-focus-level" className={levelTagClassName}>
								{levelLabel}
							</span>
						) : null}
						<h3 className={nameClassName}>{record.name}</h3>
					</div>
					<p lang="ja" className={statusClassName}>
						{record.statusJa}
					</p>
					<FocusFacts record={record} today={today} />
					<div className={linkRowClassName}>
						{record.link ? (
							<TextLink href={record.link.href} variant="standalone">
								<span>{record.link.label}</span>
								<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
							</TextLink>
						) : null}
						{cover ? (
							<TextLink href={`/portfolio/${cover.slug}`} variant="standalone">
								<span>case study を読む</span>
								<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
							</TextLink>
						) : null}
					</div>
				</GridItem>
				<GridItem span={{ base: 12, lg: 6 }} start={{ base: 1, lg: 7 }}>
					<FocusMedia item={item} eager={index === 0} />
				</GridItem>
			</Grid>
		</li>
	);
}

export function NowFocus({ items, today }: NowFocusProps) {
	if (items.length === 0) return null;
	return (
		<Stack as="ul" gap="0" data-testid="now-focus-list" className={listResetClassName}>
			{items.slice(0, NOW_FOCUS_LIMIT).map((item, index) => (
				<FocusItem key={item.record.id} item={item} today={today} index={index} />
			))}
			{/* C-8 — the rendered set is bounded by the focus limit. */}
		</Stack>
	);
}
