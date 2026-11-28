import type { ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';
import type {
	ActivityHighlightWork,
	ActivityHighlights,
	ActivityTimelineItem,
} from '../../activity/contract';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { Panel } from '../../editorial/primitives/Panel';
import { RecordList, RecordRow } from '../../editorial/primitives/RecordList';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import {
	focusRing,
	noteSansMdPlain,
	noteSansSmBody,
	tabularDateSm,
	vStackGap2,
} from '../../editorial/primitives/shared-styles';
import { ACTIVITY_HIGHLIGHT_WORK_COUNT } from './assemble';

/**
 * ActivityHighlights — the edited layer of `/activity` (Issue #1319).
 *
 * The page is an EDITED RECORD, not a raw feed dump: before the
 * chronology archive this band states what the observation actually
 * measured — the GitHub window and repo counts, the authored
 * commit/PR measures, the editorially selected works, and the
 * newest releases with their provable work links. Every value is a
 * projection the assembly already computed; this component renders
 * exactly what it is given and never re-derives a fact.
 *
 * Honest-state rules (same vocabulary as the archive)
 * ---------------------------------------------------
 *   - `windowDays` / `repoCount` are `null` when the GitHub read
 *     failed — the rows say 取得失敗, never a zero that would read
 *     as "nothing happened".
 *   - An empty `measures` / `releases` / `works` list omits its
 *     block entirely; the band never pads itself with placeholders.
 *   - A work card without a cover renders text-only — the selection
 *     is editorial, so a missing cover is a data fact shown honestly
 *     (no frame, no "media 未整備" tile: this is a summary rail, not
 *     the exhibition).
 */

const blockTitleClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '700',
	color: 'text.default',
});

const blockDescriptionClassName = css({
	...noteSansSmBody,
	margin: '0',
	marginBlockStart: '2',
});

const mutedClassName = css({ color: 'text.muted' });

const linkClassName = css({
	color: 'text.default',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_hover: { textDecorationThickness: '2px' },
});

const quietLinkClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.muted',
	textDecoration: 'none',
	_focusVisible: focusRing,
	_hover: { color: 'text.default', textDecoration: 'underline' },
});

const dateClassName = css(tabularDateSm);

const repoTitleClassName = css({
	fontFamily: 'mono',
});

const measureRowClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	justifyContent: 'space-between',
	gap: '2',
	paddingBlock: '3',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	'&:last-child': { borderBottomWidth: '0' },
});

const measureMetaClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
	whiteSpace: 'nowrap',
});

const releaseRowClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
	paddingBlock: '3',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	'&:last-child': { borderBottomWidth: '0' },
});

const workCardClassName = cx(css(vStackGap2), css({ minWidth: '0' }));

const workCoverClassName = css({
	display: 'block',
	width: '100%',
	aspectRatio: '4 / 3',
	objectFit: 'cover',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	borderRadius: 'sm',
	backgroundColor: 'bg.subtle',
});

const workCoverLinkClassName = css({
	display: 'block',
	_focusVisible: focusRing,
});

const workEyebrowClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	color: 'text.muted',
});

const workTitleClassName = css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	lineHeight: '1.4',
	color: 'text.default',
});

const workSummaryClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
	textWrap: 'pretty',
	lineClamp: '2',
});

function isInternalHref(href: string): boolean {
	return href.startsWith('/');
}

function ExternalAwareLink({
	href,
	className,
	children,
}: {
	href: string;
	className: string;
	children: ReactNode;
}) {
	return (
		<a
			href={href}
			className={className}
			{...(isInternalHref(href) ? {} : { rel: 'noopener noreferrer', target: '_blank' })}
		>
			{children}
		</a>
	);
}

/** The 「記録の要約」 panel — window, repo counts and archive totals. */
function SummaryPanel({ highlights }: { readonly highlights: ActivityHighlights }) {
	const { windowDays, repoCount, totals } = highlights;
	return (
		<Panel variant="subtle" padding="6" radius="md">
			<h3 className={blockTitleClassName}>記録の要約</h3>
			<p className={blockDescriptionClassName}>
				GitHub の観測値と Portfolio
				の公開作品を一つの記録にまとめたものです。日付は各ソースが記録した値だけを使います。
			</p>
			<RecordList>
				<RecordRow label="観測窓">
					{windowDays === null ? '取得失敗' : `直近 ${windowDays} 日間`}
				</RecordRow>
				<RecordRow label="観測リポジトリ">
					{repoCount === null
						? '取得失敗'
						: `公開 ${repoCount.public} · 非公開 ${repoCount.private}`}
				</RecordRow>
				<RecordRow label="期間内のリリース">{`${totals.releases} 件`}</RecordRow>
				<RecordRow label="掲載作品（全期間）">{`${totals.works} 件`}</RecordRow>
			</RecordList>
		</Panel>
	);
}

/** 「計測された貢献」 — the authored commit/PR measures per repo. */
function MeasuresBlock({ highlights }: { readonly highlights: ActivityHighlights }) {
	if (highlights.measures.length === 0) return null;
	return (
		<div>
			<h3 className={blockTitleClassName}>計測された貢献</h3>
			<p className={blockDescriptionClassName}>
				観測窓の中で計測された authored commits / PRs（貢献の多い順）。
			</p>
			<ul className={css({ margin: '0', marginBlockStart: '4', padding: '0', listStyle: 'none' })}>
				{highlights.measures.map((measure) => (
					<li key={measure.name} className={measureRowClassName}>
						{measure.href ? (
							<ExternalAwareLink href={measure.href} className={linkClassName}>
								{measure.name}
							</ExternalAwareLink>
						) : (
							<span className={css({ fontFamily: 'mono', fontSize: 'md' })}>{measure.name}</span>
						)}
						<span className={measureMetaClassName}>
							{`${measure.commits} コミット`}
							{measure.pullRequests !== undefined ? ` · ${measure.pullRequests} PR` : ''}
							{` · ${measure.windowDays} 日間`}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function HighlightWorkCard({ work }: { readonly work: ActivityHighlightWork }) {
	return (
		<li className={workCardClassName} data-highlight-work={work.slug}>
			{work.cover ? (
				<a href={work.href} className={workCoverLinkClassName} aria-label={work.cover.alt}>
					<img
						src={work.cover.url}
						alt={work.cover.alt}
						width={work.cover.width ?? undefined}
						height={work.cover.height ?? undefined}
						loading="lazy"
						className={workCoverClassName}
					/>
				</a>
			) : null}
			{work.periodLabel ? <p className={workEyebrowClassName}>{work.periodLabel}</p> : null}
			<h4 className={workTitleClassName}>
				<a href={work.href} className={linkClassName}>
					{work.title}
				</a>
			</h4>
			{work.summary ? <p className={workSummaryClassName}>{work.summary}</p> : null}
			<a href={work.href} className={quietLinkClassName}>
				case study
				<MaterialSymbol d={ARROW_FORWARD_PATH} size={14} />
			</a>
		</li>
	);
}

/** 「選定作品」 — the editorial selection, as summary cards. */
function WorksBlock({ highlights }: { readonly highlights: ActivityHighlights }) {
	if (highlights.works.length === 0) return null;
	return (
		<div>
			<h3 className={blockTitleClassName}>選定作品</h3>
			<p className={blockDescriptionClassName}>
				この記録を代表する作品を、Portfolio の editorial selection から選んでいます。
			</p>
			<Grid
				as="ul"
				columns={3}
				gap="6"
				className={css({ margin: '0', marginBlockStart: '6', padding: '0', listStyle: 'none' })}
			>
				{highlights.works.slice(0, ACTIVITY_HIGHLIGHT_WORK_COUNT).map((work) => (
					<HighlightWorkCard key={work.slug} work={work} />
				))}
			</Grid>
		</div>
	);
}

function ReleaseHighlightRow({ item }: { readonly item: ActivityTimelineItem }) {
	const dateText = item.dateLabel ?? item.at.slice(0, 10);
	return (
		<li className={releaseRowClassName}>
			<span className={dateClassName}>{dateText}</span>
			{item.href ? (
				<ExternalAwareLink href={item.href} className={cx(linkClassName, repoTitleClassName)}>
					{item.title}
				</ExternalAwareLink>
			) : (
				<span className={css({ fontFamily: 'mono', fontSize: 'md', fontWeight: '600' })}>
					{item.title}
				</span>
			)}
			<span className={css({ fontFamily: 'sans', fontSize: 'xs', color: 'text.muted' })}>
				リリース
			</span>
			{item.relatedWork ? (
				<a href={item.relatedWork.href} className={quietLinkClassName}>
					関連作品: {item.relatedWork.title}
				</a>
			) : null}
		</li>
	);
}

/** 「最新のリリース」 — the newest release events, with work joins. */
function ReleasesBlock({ highlights }: { readonly highlights: ActivityHighlights }) {
	if (highlights.releases.length === 0) return null;
	return (
		<div>
			<h3 className={blockTitleClassName}>
				最新のリリース
			</h3>
			<p className={blockDescriptionClassName}>
				観測窓の中で記録されたリリースイベント。リポジトリが Portfolio
				の作品に対応づくときは関連作品へリンクします。
			</p>
			<ul className={css({ margin: '0', marginBlockStart: '4', padding: '0', listStyle: 'none' })}>
				{highlights.releases.map((item) => (
					<ReleaseHighlightRow key={item.id} item={item} />
				))}
			</ul>
		</div>
	);
}

export function ActivityHighlightsView({
	highlights,
}: { readonly highlights: ActivityHighlights }) {
	const hasContent =
		highlights.windowDays !== null ||
		highlights.repoCount !== null ||
		highlights.measures.length > 0 ||
		highlights.releases.length > 0 ||
		highlights.works.length > 0;
	if (!hasContent) {
		return (
			<p className={css(noteSansMdPlain)} data-testid="activity-highlights">
				ハイライトを構成できる活動がまだありません。
			</p>
		);
	}
	return (
		<div
			className={css({ display: 'flex', flexDirection: 'column', gap: '10' })}
			data-testid="activity-highlights"
		>
			<Grid template="12" gap="6" columnGap={{ base: '4', lg: '10' }}>
				<GridItem span={{ base: 12, lg: 5 }} className={css({ minWidth: '0' })}>
					<SummaryPanel highlights={highlights} />
				</GridItem>
				<GridItem span={{ base: 12, lg: 7 }} className={css({ minWidth: '0' })}>
					<MeasuresBlock highlights={highlights} />
				</GridItem>
			</Grid>
			<WorksBlock highlights={highlights} />
			<ReleasesBlock highlights={highlights} />
		</div>
	);
}
