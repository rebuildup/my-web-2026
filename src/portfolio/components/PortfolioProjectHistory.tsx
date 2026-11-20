import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';

/**
 * PortfolioProjectHistory — the production-history timeline of
 * Issue #518.
 *
 * What this element is for
 * -------------------------
 * A portfolio page shows WHAT was made; a case study (Issue #519)
 * shows HOW the decision was reached. This element shows WHEN — the
 * dated spine of one published work: when production started, which
 * revisions shipped, and which publication events are on the record.
 * The owner's direction (Miro「ポートフォリオ→歴史→思い出」) asks for
 * the work's own chronology, kept separate from the maker's personal
 * history (#389) and from the site's release notes (#336).
 *
 * Two axes stay visibly apart
 * ---------------------------
 * Every event carries TWO labels, and neither may borrow the other's
 * authority:
 *
 *   - `kind`   — what happened: 制作開始 / 改版 / 公開 / 補足.
 *                This is the chronology axis.
 *   - `basis`  — how we know it: `record` (記録 — a committed record
 *                can be pointed at) or `recollection` (記憶 — the
 *                maker's own account of what was believed or
 *                remembered AT THE TIME). A recollection is rendered
 *                as a recollection; the component never rewrites it
 *                into a fact, because 「制作の記憶を事実でない言葉に
 *                置き換えない」 is the issue's honesty rule.
 *
 * Sources are part of the element, not a footnote: every event
 * carries its `sources` list and the component renders it inline.
 * An event with no source is a defect the fixture tests refuse.
 *
 * Text-only fallback
 * ------------------
 * `image` is OPTIONAL per event. When a work has no published image
 * — the common case, `src/portfolio/seed.ts` ships `media: []` for
 * my-web-2026 — the event renders as text and nothing else: no
 * placeholder frame, no fabricated thumbnail. The image branch exists
 * so a future approved image can attach without a component change;
 * it is never a reason to invent one.
 *
 * Honesty contract
 * ----------------
 * The component renders ONLY what the caller supplies. It has no
 * default content, no filler event and no invented date: an empty
 * `events` list renders nothing, because a timeline frame around
 * zero events would itself be a claim. Dates are displayed exactly
 * as authored (`dateLabel`) — month-precision entries stay
 * month-precision and are never padded into a fake day.
 *
 * Data ownership
 * --------------
 * Presentation only. The timeline CONTENT is authored fixture data
 * (`src/portfolio/fixtures/project-history.ts`); wiring it into the
 * D1 project model is a separate decision needing a schema change
 * and owner-approved copy, so this Issue ships the element, its
 * fixture and its Storybook surface on their own (acceptance:
 * 単独 fixture / Storybook / 文書 preview で完成する 1 Issue / 1 PR).
 */

/** What happened — the chronology axis. */
export type PortfolioProjectHistoryKind = 'start' | 'revision' | 'publication' | 'note';

/**
 * How the event is known — the epistemic axis.
 *
 * `record`       — 記録: a committed record (doc, tag, verification
 *                  artefact, seed data) can be pointed at.
 * `recollection` — 記憶: the maker's own account of what was believed,
 *                  estimated or remembered at the time. It is kept
 *                  verbatim and labelled, never restated as fact.
 */
export type PortfolioProjectHistoryBasis = 'record' | 'recollection';

/** One committed record an event rests on. */
export interface PortfolioProjectHistorySource {
	/** What the source is — a repo path or a published name. */
	readonly label: string;
	/**
	 * Optional absolute `https:` URL when the record is published on
	 * the web (e.g. the repository). Repo-internal paths stay text —
	 * the component never fabricates a link for a path it cannot
	 * verify.
	 */
	readonly url?: string;
}

/** One dated entry on the work's production timeline. */
export interface PortfolioProjectHistoryEvent {
	readonly id: string;
	readonly kind: PortfolioProjectHistoryKind;
	/**
	 * The date exactly as it should be read, e.g. `2026-09-11` or
	 * `2025-09`. The fixture authors the granularity; the component
	 * never invents a more precise date.
	 */
	readonly dateLabel: string;
	/** `day` = the label is a full date; `month` = year-month only. */
	readonly precision: 'day' | 'month';
	readonly title: string;
	readonly detail?: string;
	readonly basis: PortfolioProjectHistoryBasis;
	readonly sources: readonly PortfolioProjectHistorySource[];
	/**
	 * Optional approved image. Absent means the event is text-only —
	 * the fallback the Issue requires, not an error state.
	 */
	readonly image?: { readonly src: string; readonly alt: string };
}

export interface PortfolioProjectHistoryProps {
	/** The work the timeline describes (its published title). */
	readonly title: string;
	/** Optional period line, e.g. the project's `periodLabel`. */
	readonly periodLabel?: string | null;
	/** Optional one-sentence framing shown under the title. */
	readonly summary?: string | null;
	readonly events: readonly PortfolioProjectHistoryEvent[];
}

const KIND_LABEL: Readonly<Record<PortfolioProjectHistoryKind, { ja: string; en: string }>> = {
	start: { ja: '制作開始', en: 'Start' },
	revision: { ja: '改版', en: 'Revision' },
	publication: { ja: '公開', en: 'Publication' },
	note: { ja: '補足', en: 'Note' },
};

const BASIS_LABEL: Readonly<
	Record<PortfolioProjectHistoryBasis, { ja: string; en: string; description: string }>
> = {
	record: {
		ja: '記録',
		en: 'Record',
		description: 'コミット済みの記録（文書・tag・検証記録・seed）で確認できる事実。',
	},
	recollection: {
		ja: '記憶',
		en: 'Recollection',
		description: '制作当時の記憶や見積もり。その時点の認識であり、確認済みの事実ではない。',
	},
};

const BASIS_ORDER: readonly PortfolioProjectHistoryBasis[] = ['record', 'recollection'];

/**
 * The epistemic mark. Same silhouette contract as the case-study
 * claim classes (Issue #519): a filled disc for a record, an open
 * ring for a recollection — "enclosing but not filled", because a
 * memory surrounds the work without being part of the record.
 */
function BasisMark({ basis }: { basis: PortfolioProjectHistoryBasis }) {
	const isRing = basis === 'recollection';
	return (
		<span
			aria-hidden="true"
			data-history-basis-mark={basis}
			className={css({
				display: 'inline-block',
				flexShrink: '0',
				width: '2',
				height: '2',
				backgroundColor: isRing ? 'transparent' : 'currentColor',
				borderRadius: '9999px',
				...(isRing ? { border: '1.5px solid currentColor', boxSizing: 'border-box' } : {}),
			})}
		/>
	);
}

const rootClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '8',
	maxWidth: '720px',
});

const titleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.02em',
	color: 'text.default',
});

const metaClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const summaryClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
});

const legendLabelClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const legendListClassName = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	display: 'grid',
	gridTemplateColumns: { base: '1fr', sm: 'repeat(2, 1fr)' },
	gap: '3',
});

const legendItemClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	padding: '3',
	backgroundColor: 'bg.subtle',
	borderRadius: '4',
});

const legendNameClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.default',
});

const legendDescriptionClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
});

const timelineClassName = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	display: 'flex',
	flexDirection: 'column',
});

const eventClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '4',
	paddingInlineStart: { base: '4', sm: '6' },
	borderInlineStartWidth: '2px',
	borderInlineStartStyle: 'solid',
	borderInlineStartColor: 'border.subtle',
});

const eventHeaderClassName = css({
	display: 'flex',
	flexDirection: { base: 'column', sm: 'row' },
	flexWrap: 'wrap',
	alignItems: { sm: 'baseline' },
	gap: { base: '2', sm: '3' },
});

const dateClassName = css({
	fontFamily: 'mono',
	fontSize: 'sm',
	fontWeight: '600',
	letterSpacing: '0.02em',
	color: 'text.default',
	flexShrink: '0',
});

const precisionClassName = css({
	fontFamily: 'sans',
	fontSize: 'xs',
	color: 'text.muted',
});

const badgesClassName = css({
	display: 'inline-flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '2',
});

const basisBadgeClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	color: 'text.muted',
});

const eventTitleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const detailClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.7',
	color: 'text.default',
});

const imageClassName = css({
	display: 'block',
	width: '100%',
	height: 'auto',
	borderRadius: '6px',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
});

const sourcesClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
});

const sourcesLabelClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const sourceListClassName = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
});

const sourcePathClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
	overflowWrap: 'anywhere',
});

// Same rule as the handle-map links: a link earns its affordance
// from an underline, never from a hue (`text.accent` IS ink).
const sourceLinkClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.default',
	textDecoration: 'underline',
	textUnderlineOffset: '0.2em',
	overflowWrap: 'anywhere',
	_hover: { color: 'text.muted' },
});

function HistoryEvent({ event }: { event: PortfolioProjectHistoryEvent }) {
	const kind = KIND_LABEL[event.kind];
	const basis = BASIS_LABEL[event.basis];
	return (
		<li
			className={eventClassName}
			data-history-event={event.id}
			data-history-kind={event.kind}
			data-history-basis={event.basis}
		>
			<div className={eventHeaderClassName}>
				<time className={dateClassName} dateTime={event.dateLabel}>
					{event.dateLabel}
					{event.precision === 'month' ? (
						<span className={precisionClassName}>（月まで）</span>
					) : null}
				</time>
				<span className={badgesClassName}>
					<Badge tone="neutral">
						{kind.ja}
						<span lang="en"> / {kind.en}</span>
					</Badge>
					<span className={basisBadgeClassName} data-history-basis-label={event.basis}>
						<BasisMark basis={event.basis} />
						{basis.ja}
						<span lang="en"> / {basis.en}</span>
					</span>
				</span>
			</div>
			<h3 className={eventTitleClassName}>{event.title}</h3>
			{event.detail ? <p className={detailClassName}>{event.detail}</p> : null}
			{event.image ? (
				<img
					className={imageClassName}
					src={event.image.src}
					alt={event.image.alt}
					loading="lazy"
				/>
			) : null}
			<div className={sourcesClassName}>
				<p className={sourcesLabelClassName}>出典 / Sources</p>
				<ul className={sourceListClassName}>
					{event.sources.map((source) => (
						<li key={source.label}>
							{source.url ? (
								<a
									className={sourceLinkClassName}
									href={source.url}
									target="_blank"
									rel="noreferrer noopener"
								>
									{source.label}
								</a>
							) : (
								<code className={sourcePathClassName}>{source.label}</code>
							)}
						</li>
					))}
				</ul>
			</div>
		</li>
	);
}

export function PortfolioProjectHistory({
	title,
	periodLabel,
	summary,
	events,
}: PortfolioProjectHistoryProps) {
	// Nothing to say → render nothing. A timeline frame around zero
	// events would read as "this work has no history", which is a
	// claim the data does not make.
	if (events.length === 0) return null;

	return (
		<article className={rootClassName} data-portfolio-project-history="">
			<header className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<h2 className={titleClassName}>{title}</h2>
				{periodLabel ? <p className={metaClassName}>{periodLabel}</p> : null}
				{summary ? <p className={summaryClassName}>{summary}</p> : null}
			</header>

			<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<p className={legendLabelClassName}>読み方 / How to read</p>
				<ul className={legendListClassName}>
					{BASIS_ORDER.map((basis) => {
						const label = BASIS_LABEL[basis];
						return (
							<li key={basis} className={legendItemClassName}>
								<span className={legendNameClassName}>
									<BasisMark basis={basis} />
									{label.ja}
									<span lang="en" className={css({ fontWeight: '400' })}>
										/ {label.en}
									</span>
								</span>
								<p className={legendDescriptionClassName}>{label.description}</p>
							</li>
						);
					})}
				</ul>
			</div>

			<ol className={timelineClassName}>
				{events.map((event) => (
					<HistoryEvent key={event.id} event={event} />
				))}
			</ol>
		</article>
	);
}
