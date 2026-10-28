import type { Meta, StoryObj } from '@storybook/react';
import { css, cx } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	CURRENT_RECOMMENDATIONS,
	INTEREST_CATEGORY_LABELS,
	INTEREST_STATE_LABELS,
	SUPERSEDED_OBSERVATIONS,
	TECH_INTEREST_ENTRY_BY_ID,
	TECH_INTEREST_SECTIONS,
	type InterestState,
	type TechInterestEntry,
	type TechInterestSection,
} from './TechInterests.preview';

/**
 * Tech-interest inventory — the standalone preview (Issue #528).
 *
 * What this preview shows
 * -----------------------
 * The four states of the tech-interest inventory
 * (`docs/influences/tech-interests.md`) as they are recorded: every
 * entry carries its state, the date it was observed, the record it was
 * observed from, and — when the observation was replaced by a later
 * one — the observation that replaced it.
 *
 * The two lists at the top and the bottom are the point of the
 * preview:
 *
 *   - **現在の推奨** is derived from the data (`CURRENT_RECOMMENDATIONS`),
 *     so an observation that has been replaced can never appear in it.
 *   - **保留（置き換わった観察）** lists the replaced observations
 *     together with the observation that replaced them, so a stale
 *     recommendation is visible as history instead of disappearing.
 *
 * Why no `StateMark`
 * ------------------
 * `StateMark` owns the SHAPE vocabulary of the status and category
 * obligations (reachable / degraded / unreachable / not-read, and the
 * four content categories). The four interest states are a different
 * vocabulary, and borrowing those silhouettes would declare a mapping
 * this surface does not own. The state is therefore written as a word
 * next to the badge, which is what carries the meaning — the tone is
 * never the only channel (WCAG 2.2 SC 1.4.1).
 *
 * Scope
 * -----
 * This story renders committed data and reads nothing at request
 * time. It imports the editorial primitives and the preview data
 * module, and nothing else: no route, no HTTP boundary, no binding.
 */
const meta = {
	title: 'personal/Tech interests',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<{
	title: string;
	parameters: Record<string, unknown>;
	tags: string[];
	component?: unknown;
}>;

export default meta;
type Story = StoryObj<typeof meta>;

const pageStyle = css({
	paddingBlock: { base: '6', lg: '10' },
	backgroundColor: 'bg.canvas',
	minHeight: '100%',
});

const narrowPageStyle = css({
	maxWidth: '375px',
	marginInline: 'auto',
});

const leadStyle = css({
	margin: '0',
	marginBlockStart: '3',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.7',
	color: 'text.muted',
	maxWidth: '72ch',
});

const legendStyle = css({
	display: 'grid',
	gap: '2',
	gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
	padding: '4',
	borderRadius: 'md',
	border: '1px solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
	listStyle: 'none',
	margin: '0',
});

const legendItemStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

const entryListStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	listStyle: 'none',
	padding: '0',
	margin: '0',
});

const entryStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	padding: '4',
	borderRadius: 'md',
	border: '1px solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const entryTitleStyle = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'lg',
	fontWeight: '700',
	color: 'text.default',
});

const entryMetaStyle = css({
	display: 'flex',
	flexWrap: 'wrap',
	gap: '2',
	alignItems: 'center',
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
});

const definitionStyle = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', sm: 'max-content minmax(0, 1fr)' },
	columnGap: '3',
	rowGap: '1',
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const definitionTermStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
});

const definitionDescriptionStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const codeStyle = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	paddingInline: '1',
	borderRadius: 'sm',
	backgroundColor: 'bg.subtle',
	color: 'text.default',
});

const pointsStyle = css({
	margin: '0',
	paddingInlineStart: '4',
	listStyle: 'disc',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const panelStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	padding: '4',
	borderRadius: 'md',
	border: '1px solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const panelTitleStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'lg',
	fontWeight: '700',
	color: 'text.default',
});

const heldStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.muted',
});

const sectionStyle = css({
	paddingBlock: '6',
	borderTop: '1px solid {colors.border.subtle}',
});

/** The badge tone a state is drawn with. Tone is never the only channel. */
function toneForState(state: InterestState): 'accent' | 'neutral' {
	return state === 'currently-using' ? 'accent' : 'neutral';
}

function StateBadge({ state }: { state: InterestState }) {
	return <Badge tone={toneForState(state)}>{INTEREST_STATE_LABELS[state]}</Badge>;
}

function EntryCard({ entry }: { entry: TechInterestEntry }) {
	const successor = entry.supersededBy
		? TECH_INTEREST_ENTRY_BY_ID.get(entry.supersededBy)
		: undefined;
	return (
		<li className={entryStyle}>
			<h3 className={entryTitleStyle}>{entry.name}</h3>
			<p className={entryMetaStyle}>
				<StateBadge state={entry.state} />
				<Badge>{INTEREST_CATEGORY_LABELS[entry.category]}</Badge>
				<span>観測日 {entry.observedOn}</span>
			</p>
			<dl className={definitionStyle}>
				<dt className={definitionTermStyle}>根拠</dt>
				<dd className={definitionDescriptionStyle}>
					<code className={codeStyle}>{entry.evidence}</code>
					{entry.corroborating ? (
						<>
							{' / '}
							<code className={codeStyle}>{entry.corroborating}</code>
						</>
					) : null}
				</dd>
				<dt className={definitionTermStyle}>備考</dt>
				<dd className={definitionDescriptionStyle}>{entry.note}</dd>
				{successor ? (
					<>
						<dt className={definitionTermStyle}>置き換え</dt>
						<dd className={definitionDescriptionStyle}>
							{successor.name}（観測日 {successor.observedOn}
							）に置き換わった。この観察は現在の推奨ではない。
						</dd>
					</>
				) : null}
			</dl>
		</li>
	);
}

export interface TechInterestsPreviewProps {
	readonly sections?: readonly TechInterestSection[];
	readonly recommendations?: readonly TechInterestEntry[];
	readonly held?: readonly TechInterestEntry[];
	/** `narrow` renders the same inventory in a 375px column. */
	readonly width?: 'wide' | 'narrow';
}

/**
 * The preview surface. Exported so the verification capture can render
 * the shipped component rather than a copy of it.
 */
export function TechInterestsPreview({
	sections = TECH_INTEREST_SECTIONS,
	recommendations = CURRENT_RECOMMENDATIONS,
	held = SUPERSEDED_OBSERVATIONS,
	width = 'wide',
}: TechInterestsPreviewProps) {
	return (
		<div
			className={cx(pageStyle, width === 'narrow' ? narrowPageStyle : undefined)}
			lang="ja"
			data-testid="tech-interests-preview"
			data-width={width}
		>
			<Container>
				<header>
					<h1
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: { base: '2xl', lg: '3xl' },
							fontWeight: '700',
							lineHeight: '1.2',
							color: 'text.default',
						})}
					>
						技術関心 inventory
					</h1>
					<p className={leadStyle}>
						AI・OS・言語・フレームワーク・ライブラリに対する関心を、4 状態（現在使用 / 制作で使った
						/ 試した / 好き / 関心）に分けた事実ベースの記録。すべての項目に観測日と根拠があり、
						置き換わった観察は現在の推奨から外れる。
					</p>
				</header>

				<section aria-labelledby="tech-interests-legend" className={panelStyle}>
					<h2 id="tech-interests-legend" className={panelTitleStyle}>
						状態の定義
					</h2>
					<ul className={legendStyle}>
						{(
							[
								['currently-using', 'いま手元の開発環境と運用で実際に使っている。'],
								['used-in-production', '出荷済み作品で実際に使った。'],
								['tried', '触れて評価したが採用には至っていない。'],
								['liked', '関心はあるが利用の記録がない。'],
							] as const
						).map(([state, description]) => (
							<li key={state} className={legendItemStyle}>
								<StateBadge state={state} />
								<span>{description}</span>
							</li>
						))}
					</ul>
				</section>

				<section aria-labelledby="tech-interests-current" className={panelStyle}>
					<h2 id="tech-interests-current" className={panelTitleStyle}>
						現在の推奨（{recommendations.length} 件）
					</h2>
					<p className={heldStyle}>
						この一覧はデータから導出する。置き換わった観察はここに現れないため、古い推奨を現在の推奨として表示しない。
					</p>
					{recommendations.length === 0 ? (
						<p className={heldStyle}>記録された推奨はまだありません。</p>
					) : (
						<ul className={entryListStyle}>
							{recommendations.map((entry) => (
								<EntryCard key={entry.id} entry={entry} />
							))}
						</ul>
					)}
				</section>

				{sections.map((section, index) => (
					<section
						key={section.id}
						aria-labelledby={`tech-interests-section-${section.id}`}
						className={sectionStyle}
					>
						<SectionHeading
							id={`tech-interests-section-${section.id}`}
							eyebrow={`${String(index + 1).padStart(2, '0')} — inventory`}
							title={section.heading}
							description={section.summary}
							variant="spread"
						>
							{section.points.length > 0 ? (
								<ul className={pointsStyle}>
									{section.points.map((point) => (
										<li key={point}>{point}</li>
									))}
								</ul>
							) : null}
							{section.entries.length > 0 ? (
								<ul className={entryListStyle}>
									{section.entries.map((entry) => (
										<EntryCard key={entry.id} entry={entry} />
									))}
								</ul>
							) : null}
						</SectionHeading>
					</section>
				))}

				<section aria-labelledby="tech-interests-held" className={panelStyle}>
					<h2 id="tech-interests-held" className={panelTitleStyle}>
						保留（置き換わった観察 {held.length} 件）
					</h2>
					{held.length === 0 ? (
						<p className={heldStyle}>置き換わった観察はまだありません。</p>
					) : (
						<ul className={entryListStyle}>
							{held.map((entry) => (
								<EntryCard key={entry.id} entry={entry} />
							))}
						</ul>
					)}
				</section>
			</Container>
		</div>
	);
}

/** The standard view: the whole inventory at the reading width. */
export const Default: Story = {
	render: () => <TechInterestsPreview />,
};

/** The narrow view: the same inventory in a 375px column. */
export const Narrow: Story = {
	render: () => <TechInterestsPreview width="narrow" />,
};

/** The empty view: no observation recorded yet. */
export const Empty: Story = {
	render: () => <TechInterestsPreview sections={[]} recommendations={[]} held={[]} />,
};
