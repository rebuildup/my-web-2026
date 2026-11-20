import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { EngagementInteractivePreview, EngagementStaticPreview } from './Engagement';
import {
	ENGAGEMENT_CRITERIA,
	ENGAGEMENT_DOCUMENT,
	ENGAGEMENT_LINKS,
	ENGAGEMENT_NOTES,
	ENGAGEMENT_SOURCES,
	ENGAGEMENT_VARIANTS,
	ENGAGEMENT_WORKS,
} from './Engagement.preview';

/**
 * Engagement — the Issue #517 "見てて楽しい" experiment.
 *
 * What this surface is
 * --------------------
 * ONE information set (the six published portfolio works, restated
 * from `src/portfolio/seed.ts`) and TWO presentations of it:
 *
 *   - `Static` — the readable document: every work's facts on one
 *     page, no state, no motion.
 *   - `Interactive` — the operable deck: one work at a time behind
 *     prev/next buttons and ArrowLeft / ArrowRight, with a position
 *     readout, a progress track and one step transition.
 *
 * The Miro phrase 「見てて楽しい」 carries two meanings — fun to MAKE
 * and fun to LOOK AT. This preview puts both readings of the same
 * facts side by side so the owner can compare 視認性 / 操作可能性 /
 * 読み込み負荷 / reduced motion before deciding anything. It decides
 * nothing itself: no route, no page adoption, no published claim.
 *
 * What it deliberately does NOT do
 * ---------------------------------
 * No invented content: every field is a restatement of the committed
 * portfolio seed, and the parity test
 * (`scripts/check-engagement-preview-parity.test.mjs`) re-reads those
 * records. The interactive variant is honest about its cost — one
 * piece of state, two buttons, one keydown handler, one animation —
 * and degrades honestly under reduced motion: the swap becomes
 * instant and the `aria-live` readout still announces the change.
 */
const meta = {
	title: 'Preview / Engagement',
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'「見てて楽しい」の 2 体験比較（Issue #517）— 同一の portfolio 事実を静的文書と操作デッキで描き分け',
			},
		},
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The readiness markers the capture script waits for. */
export const STATIC_TEST_ID = 'engagement-static-preview';
export const INTERACTIVE_TEST_ID = 'engagement-interactive-preview';

export const Static: Story = {
	render: () => <EngagementPage variant="static" />,
};

export const Interactive: Story = {
	render: () => <EngagementPage variant="interactive" />,
};

/* ------------------------------------------------------------------ */
/* Shared page chrome                                                  */
/* ------------------------------------------------------------------ */

function Kicker({ children }: { children: string }) {
	return (
		<span
			className={css({
				fontFamily: 'mono',
				fontSize: 'sm',
				color: 'text.muted',
				letterSpacing: '0.04em',
				textTransform: 'uppercase',
			})}
		>
			{children}
		</span>
	);
}

function MetaFact({ term, value }: { term: string; value: string }) {
	return (
		<div>
			<dt className={css({ textTransform: 'uppercase', letterSpacing: '0.04em' })}>{term}</dt>
			<dd className={css({ margin: '0', color: 'text.default' })}>{value}</dd>
		</div>
	);
}

function DocumentMeta() {
	return (
		<dl
			className={css({
				margin: '0',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
				gap: '2',
				fontFamily: 'mono',
				fontSize: 'xs',
				color: 'text.muted',
			})}
		>
			<MetaFact term="status" value={ENGAGEMENT_DOCUMENT.status} />
			<MetaFact term="source" value={ENGAGEMENT_DOCUMENT.source} />
			<MetaFact term="verification" value={ENGAGEMENT_DOCUMENT.verification} />
			<MetaFact term="document" value={ENGAGEMENT_DOCUMENT.document} />
		</dl>
	);
}

function SourceIndex() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
				gap: '3',
			})}
		>
			{ENGAGEMENT_SOURCES.map((source) => (
				<li
					key={source.id}
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
						padding: '3',
						border: '1px solid {colors.border.subtle}',
						borderRadius: 'md',
						backgroundColor: 'bg.canvas',
					})}
				>
					<span className={css({ fontFamily: 'sans', fontSize: 'sm', fontWeight: '600' })}>
						{source.label}
					</span>
					<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
						{source.path}
					</code>
					<span className={css({ fontFamily: 'sans', fontSize: 'xs', color: 'text.muted' })}>
						{source.note}
					</span>
				</li>
			))}
		</ul>
	);
}

function NotesFooter() {
	return (
		<ul
			data-notes-list
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
			})}
		>
			{ENGAGEMENT_NOTES.map((note) => (
				<li
					key={note}
					className={css({
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.muted',
						paddingInlineStart: '3',
						borderInlineStart: '2px solid {colors.border.subtle}',
					})}
				>
					{note}
				</li>
			))}
		</ul>
	);
}

function LinkList() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'flex',
				flexWrap: 'wrap',
				gap: '3',
			})}
		>
			{ENGAGEMENT_LINKS.map((link) => (
				<li key={link.url}>
					<a
						href={link.url}
						className={css({
							fontFamily: 'sans',
							fontSize: 'sm',
							fontWeight: '600',
							color: 'text.accent',
							textDecoration: 'underline',
							textUnderlineOffset: '3px',
						})}
					>
						{link.label}
					</a>
				</li>
			))}
		</ul>
	);
}

function VariantCard({ variant }: { variant: (typeof ENGAGEMENT_VARIANTS)[number] }) {
	return (
		<li
			data-engagement-variant-card={variant.id}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				padding: '4',
				border: '1px solid {colors.border.subtle}',
				borderRadius: 'md',
				backgroundColor: 'bg.canvas',
			})}
		>
			<span
				className={css({
					fontFamily: 'sans',
					fontSize: 'md',
					fontWeight: '600',
					color: 'text.default',
				})}
			>
				{variant.label}
			</span>
			<span
				className={css({
					fontFamily: 'sans',
					fontSize: 'sm',
					lineHeight: '1.6',
					color: 'text.muted',
				})}
			>
				{variant.description}
			</span>
			<ul
				className={css({
					margin: '0',
					padding: '0',
					listStyle: 'none',
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				{variant.facts.map((fact) => (
					<li
						key={fact}
						className={css({
							fontFamily: 'sans',
							fontSize: 'xs',
							lineHeight: '1.6',
							color: 'text.muted',
						})}
					>
						・{fact}
					</li>
				))}
			</ul>
		</li>
	);
}

function CriteriaList() {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
				gap: '3',
			})}
		>
			{ENGAGEMENT_CRITERIA.map((criterion) => (
				<li
					key={criterion.id}
					data-engagement-criterion={criterion.id}
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
						padding: '3',
						border: '1px solid {colors.border.subtle}',
						borderRadius: 'md',
						backgroundColor: 'bg.canvas',
					})}
				>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
							textTransform: 'uppercase',
						})}
					>
						{criterion.label}
					</span>
					<span
						className={css({
							fontFamily: 'sans',
							fontSize: 'sm',
							lineHeight: '1.6',
							color: 'text.default',
						})}
					>
						{criterion.question}
					</span>
				</li>
			))}
		</ul>
	);
}

/* ------------------------------------------------------------------ */
/* The page                                                             */
/* ------------------------------------------------------------------ */

function EngagementPage({ variant }: { variant: 'static' | 'interactive' }) {
	const testId = variant === 'static' ? STATIC_TEST_ID : INTERACTIVE_TEST_ID;
	return (
		<div data-testid={testId} data-engagement-page={variant}>
			<Container>
				<div
					className={css({
						paddingBlock: { base: '10', lg: '14' },
						display: 'flex',
						flexDirection: 'column',
						gap: { base: '8', lg: '10' },
					})}
				>
					<header className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
						<Kicker>{ENGAGEMENT_DOCUMENT.kicker}</Kicker>
						<h1
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: '3xl', lg: '4xl' },
								fontWeight: '700',
								lineHeight: '1.15',
								color: 'text.default',
							})}
						>
							{ENGAGEMENT_DOCUMENT.title}
						</h1>
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: { base: 'md', lg: 'lg' },
								lineHeight: '1.7',
								color: 'text.muted',
								maxWidth: '680px',
							})}
						>
							Miro の「見てて楽しい」は、作る側の楽しさと見せる側の楽しさの両方を指す。同じ 6
							作品の事実を、読むだけの静的な文書と、操作してめくる deck の 2 案で比較する
							preview。採用もページ適用も決めない。
						</p>
						<DocumentMeta />
					</header>

					<section
						aria-labelledby="engagement-variants"
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						<h2
							id="engagement-variants"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.25',
								color: 'text.default',
							})}
						>
							2 つの表示 — 同一データ
						</h2>
						<ul
							className={css({
								margin: '0',
								padding: '0',
								listStyle: 'none',
								display: 'grid',
								gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
								gap: '4',
							})}
						>
							{ENGAGEMENT_VARIANTS.map((entry) => (
								<VariantCard key={entry.id} variant={entry} />
							))}
						</ul>
					</section>

					<section
						aria-labelledby="engagement-stage"
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						<h2
							id="engagement-stage"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.25',
								color: 'text.default',
							})}
						>
							{variant === 'static' ? '静的プレビュー' : '操作プレビュー'}
						</h2>
						{variant === 'static' ? (
							<EngagementStaticPreview works={ENGAGEMENT_WORKS} />
						) : (
							<EngagementInteractivePreview works={ENGAGEMENT_WORKS} />
						)}
					</section>

					<section
						aria-labelledby="engagement-criteria"
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						<h2
							id="engagement-criteria"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.25',
								color: 'text.default',
							})}
						>
							比較の 4 軸
						</h2>
						<CriteriaList />
					</section>

					<section
						aria-labelledby="engagement-sources"
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						<h2
							id="engagement-sources"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.25',
								color: 'text.default',
							})}
						>
							典拠 — 読んだ記録
						</h2>
						<SourceIndex />
					</section>

					<footer
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '4',
							paddingBlockStart: '6',
							borderTop: '1px solid {colors.border.subtle}',
						})}
					>
						<NotesFooter />
						<LinkList />
					</footer>
				</div>
			</Container>
		</div>
	);
}
