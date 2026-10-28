import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	type AppliedExample,
	type PreviewSection,
	type SectionKind,
	usableProductAdopted,
	usableProductExamples,
	usableProductHeld,
	usableProductLabels,
	usableProductLead,
	usableProductOpenDecisions,
	usableProductSections,
	usableProductStages,
	usableProductTitle,
} from './UsableProductPublication.preview';

/**
 * UsableProductPublication — the standalone preview of the publication
 * checklist (Issue #515).
 *
 * What this surface is
 * --------------------
 * The document `docs/personal/usable-product-publication.md` translates
 * the Miro heading「哲学 > 使えるものをつくる > DL配布/APIサービス」into a
 * five-stage publication contract: 入手 / 操作 / 説明 / 失敗 / 廃止, each
 * with the exit the user can reach. This story renders that contract on
 * one screen so it can be reviewed WITHOUT the rest of the site — the
 * preview contract of Issue #380, applied to a document rather than to a
 * page.
 *
 * Why the data lives in a separate module
 * ---------------------------------------
 * `UsableProductPublication.preview.ts` holds the CONTENT; this file
 * holds the drawing. That split is what lets
 * `scripts/check-usable-product-preview-parity.test.mjs` import the data
 * directly and prove that the document and this screen carry the same
 * strings — a preview that quietly diverged from the prose it claims to
 * illustrate would be worse than no preview at all.
 *
 * Why it draws with editorial primitives only
 * --------------------------------------------
 * This file imports `Container`, `SectionHeading` and `Badge` from
 * `src/editorial/primitives/` and nothing else: no `home`, no `routes`,
 * no `http`, no `cloudflare`, no `portfolio`, no binding. The screen is
 * a document, and it is drawn with the shipped visual language.
 *
 * Why there is no table on this screen
 * ------------------------------------
 * The five stages are read one after another, not compared column by
 * column, so each stage is a block: its exit, its judgement and its
 * checks. A three-column matrix would have to scroll sideways at 320 px
 * to stay legible, and a hand-rolled scroll box is a keyboard question
 * this screen does not need to open.
 *
 * What it deliberately does NOT claim
 * -----------------------------------
 * The facts on the screen were read from two committed records — the Tool
 * Registry manifest and the public API directory — and the parity test
 * re-reads those records, so a path or an error form cannot drift. The
 * Miro board itself is NOT reachable from here: only the heading the
 * Issue quotes is a source, and everything the owner alone can decide is
 * printed as 未確認（owner 確認待ち）rather than asserted.
 */

/** The eyebrow each section kind carries. Presentation only, not document content. */
const EYEBROW: Record<SectionKind, string> = {
	sources: '典拠',
	stages: '公開条件',
	checklist: 'チェックリスト',
	example: '適用例',
	decisions: '判断',
	open: '未決',
};

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

const leadClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.8',
	color: 'text.default',
	maxWidth: '52rem',
});

const sourceNoteClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.8',
	color: 'text.muted',
	maxWidth: '52rem',
});

const sectionClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '4',
});

const bodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.9',
	color: 'text.default',
	maxWidth: '52rem',
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
	maxWidth: '52rem',
});

const cardClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	padding: '4',
	borderRadius: '3',
	background: 'bg.subtle',
});

const cardTitleClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '700',
	color: 'text.default',
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	flexWrap: 'wrap',
});

const cardLabelClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const cardBodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.8',
	color: 'text.default',
});

const gapBodyClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.8',
	color: 'text.muted',
});

const metaClassName = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	lineHeight: '1.8',
	color: 'text.muted',
	overflowWrap: 'anywhere',
});

const factListClassName = css({
	margin: '0',
	paddingInlineStart: '5',
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	fontFamily: 'mono',
	fontSize: 'xs',
	lineHeight: '1.7',
	color: 'text.muted',
	overflowWrap: 'anywhere',
});

/** One example's per-stage note: what the record says, and what it does not. */
function Note({ example, stageId }: { example: AppliedExample; stageId: string }) {
	const note = example.notes.find((item) => item.stageId === stageId);
	const stage = usableProductStages.find((item) => item.id === stageId);
	if (!note || !stage) return null;
	return (
		<div className={cardClassName} data-stage={note.stageId}>
			<p className={cardTitleClassName}>{stage.name}</p>
			<p className={cardLabelClassName}>{usableProductLabels.evidence}</p>
			<p className={cardBodyClassName}>{note.evidence}</p>
			{note.gap === null ? null : (
				<>
					<p className={cardLabelClassName}>{usableProductLabels.gap}</p>
					<p className={gapBodyClassName}>{note.gap}</p>
				</>
			)}
		</div>
	);
}

/** One section of the checklist, dispatched by its kind. */
function Section({ section }: { section: PreviewSection }) {
	const example = section.exampleId
		? usableProductExamples.find((item) => item.id === section.exampleId)
		: undefined;
	return (
		<section className={sectionClassName} aria-labelledby={`usable-product-${section.id}`}>
			<SectionHeading
				id={`usable-product-${section.id}`}
				eyebrow={EYEBROW[section.kind]}
				title={section.heading}
			/>
			{section.paragraphs.map((paragraph) => (
				<p className={bodyClassName} key={paragraph}>
					{paragraph}
				</p>
			))}

			{section.kind === 'sources' ? (
				<ul className={listClassName}>
					{section.bullets.map((bullet) => (
						<li key={bullet}>{bullet}</li>
					))}
				</ul>
			) : null}

			{section.kind === 'stages' ? (
				<>
					<ul className={listClassName}>
						{section.bullets.map((bullet) => (
							<li key={bullet}>{bullet}</li>
						))}
					</ul>
					{usableProductStages.map((stage) => (
						<div className={cardClassName} key={stage.id} data-stage={stage.id}>
							<p className={cardTitleClassName}>{stage.name}</p>
							<p className={cardLabelClassName}>利用者の出口</p>
							<p className={cardBodyClassName}>{stage.exit}</p>
							<p className={cardLabelClassName}>判定</p>
							<p className={cardBodyClassName}>{stage.judgement}</p>
						</div>
					))}
				</>
			) : null}

			{section.kind === 'checklist' ? (
				<>
					{usableProductStages.map((stage) => (
						<div className={cardClassName} key={stage.id} data-stage={stage.id}>
							<p className={cardTitleClassName}>{stage.name}</p>
							<ul className={listClassName}>
								{stage.items.map((item) => (
									<li key={item.id}>{item.label}</li>
								))}
							</ul>
						</div>
					))}
				</>
			) : null}

			{section.kind === 'example' && example ? (
				<>
					<div className={cardClassName}>
						<p className={cardTitleClassName}>
							{example.subject}
							<Badge tone="neutral">{example.kind}</Badge>
						</p>
						<p className={cardLabelClassName}>{usableProductLabels.record}</p>
						<p className={metaClassName}>
							{example.record}（{example.pointer}）
						</p>
						<p className={cardLabelClassName}>{usableProductLabels.facts}</p>
						<ul className={factListClassName}>
							{example.facts.map((fact) => (
								<li key={fact.label}>
									{fact.label} = {fact.value}
								</li>
							))}
						</ul>
					</div>
					{usableProductStages.map((stage) => (
						<Note example={example} key={stage.id} stageId={stage.id} />
					))}
				</>
			) : null}

			{section.kind === 'decisions' ? (
				<>
					<div className={cardClassName}>
						<p className={cardTitleClassName}>{usableProductLabels.adopted}</p>
						<ul className={listClassName}>
							{usableProductAdopted.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</div>
					<div className={cardClassName}>
						<p className={cardTitleClassName}>{usableProductLabels.held}</p>
						<ul className={listClassName}>
							{usableProductHeld.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</div>
				</>
			) : null}

			{section.kind === 'open' ? (
				<ul className={listClassName}>
					{usableProductOpenDecisions.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

/**
 * The whole checklist on one screen.
 *
 * `withExamples={false}` renders the TEMPLATE: the five stages and their
 * checks, with no worked example attached. That is the "empty" state of
 * the contract — the form a NEW publication is checked against, before
 * anyone has applied it to a real Tool or API.
 */
export function UsableProductPublication({ withExamples = true }: { withExamples?: boolean }) {
	const sections = withExamples
		? usableProductSections
		: usableProductSections.filter(
				(section) => section.kind !== 'example' && section.kind !== 'decisions',
			);
	return (
		<main className={pageClassName} data-testid="usable-product-publication">
			<Container>
				<div className={contentClassName}>
					<header className={headerClassName}>
						<h1 className={titleClassName}>{usableProductTitle}</h1>
						<p className={leadClassName}>{usableProductLead}</p>
						<p className={sourceNoteClassName}>
							典拠: Issue #515 が引用した Miro board の見出し語 「哲学 &gt; 使えるものをつくる &gt;
							DL配布/APIサービス」のみ。付箋本文にはアクセスできないため、Miro
							にしか無い情報は載せていない。owner しか決められない項目は「未確認（owner
							確認待ち）」と記す。
						</p>
					</header>
					{sections.map((section) => (
						<Section key={section.id} section={section} />
					))}
				</div>
			</Container>
		</main>
	);
}

const meta = {
	title: 'Preview / UsableProductPublication (#515)',
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof UsableProductPublication>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The whole contract: stages, checks, three worked examples, decisions. */
export const Checklist: Story = {
	args: { withExamples: true },
};

/** The template: the five stages and their checks, with nothing applied yet. */
export const Template: Story = {
	args: { withExamples: false },
};

/** The same contract at 320 px — the narrow end of the supported range. */
export const Narrow: Story = {
	args: { withExamples: true },
	parameters: { viewport: { defaultViewport: 'mobile1' } },
};
