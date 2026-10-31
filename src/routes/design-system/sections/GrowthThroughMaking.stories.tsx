import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../../styled-system/css';
import { Badge } from '../../../editorial/primitives/Badge';
import { Container } from '../../../editorial/primitives/Container';
import { SectionHeading } from '../../../editorial/primitives/SectionHeading';
import {
	type GrowthBlock,
	type GrowthSection,
	GROWTH_THROUGH_MAKING,
} from './GrowthThroughMaking.preview';

/**
 * Preview of the growth-through-making content specification
 * (Issue #513).
 *
 * The preview renders the SAME strings the specification carries
 * (`docs/personal/growth-through-making.md`), not a paraphrase: the
 * data module holds them, and
 * `scripts/check-growth-through-making-preview-parity.test.mjs`
 * fails when the Markdown and the preview stop agreeing.
 *
 * The story composes the shipped `editorial` primitives only — no
 * route, no binding, no other obligation — so it stands on its own
 * and can be read without the rest of the site (Issue #380's preview
 * contract, referenced but not depended on).
 */

/** The Japanese label of a section kind, used as the section badge. */
const SECTION_KIND_LABEL: Record<GrowthSection['kind'], string> = {
	scope: '目的',
	evidence: '典拠',
	criteria: '選別基準',
	prohibition: '禁止事項',
	separation: '分離',
	'adopted-case': '採用',
	'held-case': '保留',
	implementation: '実装',
	open: '未確認',
};

/** The Japanese label of a block kind, used as the block badge. */
const BLOCK_KIND_LABEL: Record<GrowthBlock['kind'], string> = {
	list: '規則',
	case: '事例',
	held: '保留',
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
	borderTopWidth: '1',
	borderTopStyle: 'solid',
	borderTopColor: 'border.subtle',
});

const caseFrameClassName = css({
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.subtle',
});

/**
 * Split a labelled bullet into its label and its body.
 *
 * The specification writes a case as `before: …` / `after: …` and a
 * held candidate as `理由: …` / `採らない根拠: …` / `解除条件: …`.
 * Splitting on the first colon lets the preview set the label apart
 * from the sentence, which is the whole difference between a case
 * study and a wall of prose. The text itself is unchanged — the
 * parity test compares the joined form against the Markdown.
 */
function splitLabel(bullet: string): { label: string; body: string } | null {
	const index = bullet.indexOf(':');
	if (index <= 0) return null;
	return {
		label: bullet.slice(0, index + 1),
		body: bullet.slice(index + 1).trimStart(),
	};
}

function BlockView({ block }: { block: GrowthBlock }) {
	const isLabelled = block.kind === 'case' || block.kind === 'held';
	return (
		<div className={isLabelled ? caseFrameClassName : undefined}>
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

function SectionView({ section }: { section: GrowthSection }) {
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

function PreviewBody({ sections }: { sections: readonly GrowthSection[] }) {
	return (
		<Container>
			<header>
				<h1 className={documentTitleClassName}>{GROWTH_THROUGH_MAKING.document.title}</h1>
				<ul className={metaListClassName}>
					<li>
						<Badge tone="neutral">{GROWTH_THROUGH_MAKING.document.status}</Badge>
					</li>
					<li>
						<span className={bodyClassName}>{GROWTH_THROUGH_MAKING.document.source}</span>
					</li>
					<li>
						<span className={bodyClassName}>{GROWTH_THROUGH_MAKING.document.verification}</span>
					</li>
					<li>
						<span className={bodyClassName}>{GROWTH_THROUGH_MAKING.document.preview}</span>
					</li>
				</ul>
			</header>
			{sections.map((section) => (
				<SectionView key={section.heading} section={section} />
			))}
		</Container>
	);
}

const meta = {
	title: 'Preview / Growth through making',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The whole specification at the standard page width.
 */
export const Default: Story = {
	render: () => <PreviewBody sections={GROWTH_THROUGH_MAKING.sections} />,
};

/**
 * The same specification at the narrowest width the platform
 * supports (320 px), so the reading order is checkable without the
 * rest of the page.
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
			<PreviewBody sections={GROWTH_THROUGH_MAKING.sections} />
		</div>
	),
};

/**
 * The empty state: the document shell with no section at all.
 *
 * It proves the shell does not depend on a section being present,
 * which is what a future "this specification has no published
 * section yet" state would render.
 */
export const Empty: Story = {
	render: () => <PreviewBody sections={[]} />,
};
