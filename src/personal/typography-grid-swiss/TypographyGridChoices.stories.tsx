import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	COMPARISON_PARAGRAPH,
	COMPARISON_SCREEN,
	type InfluenceBlock,
	type InfluenceSection,
	STATUS_ROWS,
	TYPOGRAPHY_GRID_CHOICES,
} from './TypographyGridChoices.preview';

/**
 * Preview of the typography / grid / Swiss design influence record
 * (Issue #527).
 *
 * The preview renders the SAME strings the record carries
 * (`docs/influences/typography-grid-swiss-design.md`), not a paraphrase:
 * the data module holds them, and
 * `scripts/check-typography-grid-choices-preview-parity.test.mjs`
 * fails when the Markdown and the preview stop agreeing.
 *
 * The story composes the shipped `editorial` primitives only — no
 * route, no binding, no other obligation — so it stands on its own and
 * can be read without the rest of the site (Issue #380's preview
 * contract, referenced but not depended on).
 *
 * The `Before / after` story is the comparison the record asks for: the
 * same screen, once in the shipped combination and once with the three
 * concepts applied as rules, plus the two cases where the same rules
 * lose their effect. It changes nothing that ships — it is a fixture.
 */

/** The Japanese label of a section kind, used as the section badge. */
const SECTION_KIND_LABEL: Record<InfluenceSection['kind'], string> = {
	scope: '対象',
	evidence: '典拠',
	concepts: '概念',
	example: '具体例',
	'counter-example': '反例',
	decision: '採否',
	comparison: '比較',
	open: '未確認',
};

/** The Japanese label of a block kind, used as the block badge. */
const BLOCK_KIND_LABEL: Record<InfluenceBlock['kind'], string> = {
	list: '規則',
	example: '具体例',
	'counter-example': '反例',
	strings: '文字列',
	adopted: '採用',
	held: '保留',
	rejected: '却下',
};

const bodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.7',
	color: 'text.default',
	textWrap: 'pretty',
});

const listClassName = css({
	margin: '0',
	paddingInlineStart: '5',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const blockHeadingClassName = css({
	margin: '0',
	marginBlockStart: '8',
	marginBlockEnd: '3',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
});

const labelClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '700',
	color: 'text.default',
});

const documentTitleClassName = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '2xl',
	fontWeight: '700',
	lineHeight: '1.2',
	color: 'text.default',
});

const metaListClassName = css({
	margin: '0',
	padding: '0',
	marginBlockStart: '4',
	display: 'flex',
	flexWrap: 'wrap',
	gap: '3',
	listStyle: 'none',
});

const sectionClassName = css({
	marginBlockStart: '12',
	paddingBlockStart: '8',
	borderTop: '1px solid {colors.border.subtle}',
});

/** The frame of a comparison panel (before / after / counter-example). */
const panelClassName = css({
	marginBlockStart: '12',
	paddingBlockStart: '8',
	borderTop: '1px solid {colors.border.subtle}',
});

/** The caption that names what a panel shows. */
const panelCaptionClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
	marginBlockEnd: '6',
});

const panelCaptionTitleClassName = css({
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	color: 'text.default',
});

const panelCaptionNoteClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
});

/** The two-column frame that holds a counter-example's two variants. */
const variantGridClassName = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
	columnGap: '6',
	rowGap: '10',
	alignItems: 'start',
});

const variantClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const variantLabelClassName = css({
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '700',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

/** The shipped "before" row: badge, label and summary stacked. */
const beforeListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '10',
});

const beforeRowClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const beforeLabelClassName = css({
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	lineHeight: '1.2',
	letterSpacing: '-0.01em',
	color: 'text.default',
});

const beforeValueClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
});

/** The "after" row: a 1/3 - 2/3 sub-grid inside the content span. */
const afterListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '10',
});

const afterRowClassName = css({
	display: 'grid',
	gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
	columnGap: '10',
	alignItems: 'start',
});

const afterLabelCellClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const afterLabelClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	letterSpacing: '0.04em',
	lineHeight: '1.4',
	color: 'text.default',
});

const afterValueClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.default',
});

/** The status-row shape used by the first counter-example. */
const statusListClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const statusFixedRowClassName = css({
	display: 'grid',
	gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
	columnGap: '10',
	alignItems: 'start',
});

const statusAutoRowClassName = css({
	display: 'grid',
	gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr) auto',
	columnGap: '4',
	alignItems: 'baseline',
});

const statusLabelClassName = css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '700',
	color: 'text.default',
});

const statusBindingClassName = css({
	fontFamily: 'mono',
	fontSize: 'sm',
	color: 'text.muted',
	letterSpacing: '0.04em',
});

const statusDetailClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
});

/** The Japanese paragraph used by the second counter-example. */
const paragraphClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.default',
	textWrap: 'pretty',
});

/**
 * The Latin typographic rules applied on top of the shipped treatment:
 * a measure of 45 `ch`, a wider leading and a little tracking.
 *
 * `ch` is the advance width of "0", which is about half an em in the
 * platform Japanese face — so the Latin "45 to 75 characters per line"
 * rule lands on roughly half as many Japanese characters. That is the
 * point of the counter-example, and the capture measures it.
 */
const latinParagraphClassName = css({
	margin: '0',
	maxWidth: '45ch',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.8',
	letterSpacing: '0.02em',
	color: 'text.default',
	textWrap: 'pretty',
});

/**
 * Split a labelled bullet into its label and its body.
 *
 * The record writes a decision as `採用: …` / `理由: …` / `根拠: …` /
 * `解除条件: …`. Splitting on the first colon lets the preview set the
 * label apart from the sentence, which is the whole difference between
 * a decision record and a wall of prose. The text itself is unchanged —
 * the parity test compares the joined form against the Markdown.
 */
function splitLabel(bullet: string): { label: string; body: string } | null {
	const index = bullet.indexOf(':');
	if (index <= 0) return null;
	return {
		label: bullet.slice(0, index + 1),
		body: bullet.slice(index + 1).trimStart(),
	};
}

function BlockView({ block }: { block: InfluenceBlock }) {
	const isLabelled = block.kind === 'held' || block.kind === 'rejected';
	return (
		<div>
			{block.heading ? <h3 className={blockHeadingClassName}>{block.heading}</h3> : null}
			<ul className={listClassName}>
				{block.bullets.map((bullet) => {
					const split = isLabelled ? splitLabel(bullet) : null;
					return (
						<li key={bullet}>
							{split ? (
								<>
									<span className={labelClassName}>{split.label}</span> {split.body}
								</>
							) : (
								bullet
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function SectionView({ section }: { section: InfluenceSection }) {
	return (
		<section className={sectionClassName}>
			<SectionHeading
				eyebrow={SECTION_KIND_LABEL[section.kind]}
				title={section.heading}
				description={section.lead}
			/>
			{section.blocks.map((block) => (
				<BlockView key={block.heading ?? 'inline'} block={block} />
			))}
		</section>
	);
}

function PreviewBody({ sections }: { sections: readonly InfluenceSection[] }) {
	return (
		<Container>
			<header>
				<h1 className={documentTitleClassName}>{TYPOGRAPHY_GRID_CHOICES.document.title}</h1>
				<ul className={metaListClassName}>
					<li>
						<Badge tone="neutral">{TYPOGRAPHY_GRID_CHOICES.document.status}</Badge>
					</li>
					<li>
						<span className={bodyClassName}>{TYPOGRAPHY_GRID_CHOICES.document.source}</span>
					</li>
					<li>
						<span className={bodyClassName}>{TYPOGRAPHY_GRID_CHOICES.document.verification}</span>
					</li>
					<li>
						<span className={bodyClassName}>{TYPOGRAPHY_GRID_CHOICES.document.preview}</span>
					</li>
				</ul>
			</header>
			{sections.map((section) => (
				<SectionView key={section.heading} section={section} />
			))}
		</Container>
	);
}

/**
 * The screen in the shipped combination: the spread heading, then the
 * stacked rows the home capabilities section renders today.
 */
function BeforePanel() {
	return (
		<section className={panelClassName} data-testid="typography-grid-before">
			<header className={panelCaptionClassName}>
				<span className={panelCaptionTitleClassName}>before — 現状の組合せ</span>
				<span className={panelCaptionNoteClassName}>
					段は spread の 4/8。行は label と summary の積み上げ（src/home/capabilities/grid.tsx
					と同じ形）。
				</span>
			</header>
			<Container>
				<SectionHeading
					eyebrow={COMPARISON_SCREEN.eyebrow}
					title={COMPARISON_SCREEN.title}
					description={COMPARISON_SCREEN.description}
					variant="spread"
				>
					<ul className={beforeListClassName} data-testid="typography-grid-before-rows">
						{COMPARISON_SCREEN.rows.map((row) => (
							<li key={row.label} className={beforeRowClassName}>
								<Badge tone={row.tone}>{row.status}</Badge>
								<span className={beforeLabelClassName}>{row.label}</span>
								<span className={beforeValueClassName}>{row.value}</span>
							</li>
						))}
					</ul>
				</SectionHeading>
			</Container>
		</section>
	);
}

/**
 * The same screen with the three concepts applied as rules: the rows sit
 * on a 1/3 - 2/3 sub-grid inside the content span, the label drops to
 * the support tier, and no ornament is added.
 */
function AfterPanel() {
	return (
		<section className={panelClassName} data-testid="typography-grid-after">
			<header className={panelCaptionClassName}>
				<span className={panelCaptionTitleClassName}>after — 3 概念を規則として適用</span>
				<span className={panelCaptionNoteClassName}>
					行を content span 内の 1/3・2/3 の sub-grid に置き、label を support tier
					に落とす。文字列と token 値は変えない。
				</span>
			</header>
			<Container>
				<SectionHeading
					eyebrow={COMPARISON_SCREEN.eyebrow}
					title={COMPARISON_SCREEN.title}
					description={COMPARISON_SCREEN.description}
					variant="spread"
				>
					<ul className={afterListClassName} data-testid="typography-grid-after-rows">
						{COMPARISON_SCREEN.rows.map((row) => (
							<li key={row.label} className={afterRowClassName}>
								<span className={afterLabelCellClassName}>
									<span className={afterLabelClassName}>{row.label}</span>
									<Badge tone={row.tone}>{row.status}</Badge>
								</span>
								<span className={afterValueClassName}>{row.value}</span>
							</li>
						))}
					</ul>
				</SectionHeading>
			</Container>
		</section>
	);
}

/**
 * Counter-example 1: the same fixed sub-grid applied to the status row.
 *
 * The status row carries three cells (label / detail / badge). A
 * two-column sub-grid has no place for the third one, so the badge
 * falls to the next line. The shipped expression sizes the label column
 * to its content instead and keeps all three cells on one line.
 */
function CounterExampleOnePanel() {
	return (
		<section className={panelClassName} data-testid="typography-grid-counterexample-grid">
			<header className={panelCaptionClassName}>
				<span className={panelCaptionTitleClassName}>
					効果を失う場面 1 — 固定 sub-grid を status 行に当てた場合
				</span>
				<span className={panelCaptionNoteClassName}>
					参照: src/home/status/tiles.tsx、src/editorial/layout-system.md §3.1
				</span>
			</header>
			<Container>
				<div className={variantGridClassName}>
					<div className={variantClassName}>
						<span className={variantLabelClassName}>
							after と同じ固定 sub-grid（1/3・2/3 の 2 列）
						</span>
						<ul className={statusListClassName} data-testid="typography-grid-fixed-rows">
							{STATUS_ROWS.map((row) => (
								<li key={row.label} className={statusFixedRowClassName}>
									<span className={statusLabelClassName}>{row.label}</span>
									<span className={statusDetailClassName}>
										<span className={statusBindingClassName}>{row.binding}</span> — {row.detail}
									</span>
								</li>
							))}
						</ul>
					</div>
					<div className={variantClassName}>
						<span className={variantLabelClassName}>
							既存表現（label 列を内容幅に合わせる 3 列）
						</span>
						<ul className={statusListClassName} data-testid="typography-grid-auto-rows">
							{STATUS_ROWS.map((row) => (
								<li key={row.label} className={statusAutoRowClassName}>
									<span className={statusLabelClassName}>{row.label}</span>
									<span className={statusDetailClassName}>
										<span className={statusBindingClassName}>{row.binding}</span> — {row.detail}
									</span>
									<Badge tone="neutral">observed</Badge>
								</li>
							))}
						</ul>
					</div>
				</div>
			</Container>
		</section>
	);
}

/**
 * Counter-example 2: the Latin typographic rules added to a Japanese
 * paragraph.
 *
 * The shipped treatment leaves the Japanese line breaking to the
 * browser's phrase analysis. The Latin rule of "45 to 75 characters per
 * line" is expressed in `ch`, and `ch` is half an em in the platform
 * Japanese face — so the same rule lands on about half the characters
 * and the paragraph grows. The capture measures both.
 */
function CounterExampleTwoPanel() {
	return (
		<section className={panelClassName} data-testid="typography-grid-counterexample-type">
			<header className={panelCaptionClassName}>
				<span className={panelCaptionTitleClassName}>
					効果を失う場面 2 — 欧文の組版規則を日本語本文に足した場合
				</span>
				<span className={panelCaptionNoteClassName}>
					参照: src/styles.css（auto-phrase / text-wrap: pretty）、src/editorial/layout-system.md
					§3.4
				</span>
			</header>
			<Container>
				<div className={variantGridClassName}>
					<div className={variantClassName}>
						<span className={variantLabelClassName}>現状（出荷の規則）</span>
						<p className={paragraphClassName} data-testid="typography-grid-paragraph-shipped">
							{COMPARISON_PARAGRAPH}
						</p>
					</div>
					<div className={variantClassName}>
						<span className={variantLabelClassName}>
							欧文の組版規則を足した版（measure 45ch / leading 1.8 / 字間 0.02em）
						</span>
						<p className={latinParagraphClassName} data-testid="typography-grid-paragraph-latin">
							{COMPARISON_PARAGRAPH}
						</p>
					</div>
				</div>
			</Container>
		</section>
	);
}

const meta = {
	title: 'Preview / Typography & grid choices',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The whole record at the standard page width.
 */
export const Default: Story = {
	render: () => <PreviewBody sections={TYPOGRAPHY_GRID_CHOICES.sections} />,
};

/**
 * The one-screen comparison the record asks for: before, after, and the
 * two cases where the same rules lose their effect.
 */
export const BeforeAfter: Story = {
	render: () => (
		<Container>
			<BeforePanel />
			<AfterPanel />
			<CounterExampleOnePanel />
			<CounterExampleTwoPanel />
		</Container>
	),
};

/**
 * The same comparison at the narrowest width the platform supports
 * (320 px), so the reading order is checkable without the rest of the
 * page.
 */
export const Narrow: Story = {
	render: () => (
		<div
			style={{
				width: '320px',
				margin: '0 auto',
				border: '1px dashed #cbd5e1',
			}}
		>
			<Container>
				<BeforePanel />
				<AfterPanel />
			</Container>
		</div>
	),
};

/**
 * The empty state: the document shell with no section at all.
 *
 * It proves the shell does not depend on a section being present,
 * which is what a future "this record has no published section yet"
 * state would render.
 */
export const Empty: Story = {
	render: () => <PreviewBody sections={[]} />,
};
