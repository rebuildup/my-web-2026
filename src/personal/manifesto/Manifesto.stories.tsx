import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import {
	MANIFESTO_DOCUMENT,
	MANIFESTO_LINKS,
	MANIFESTO_MATERIALS,
	MANIFESTO_NOTES,
	MANIFESTO_QUESTIONS,
	MANIFESTO_SOURCES,
	type ManifestoQuestion,
	type ManifestoSource,
} from './Manifesto.preview';

/**
 * Manifesto — the Issue #535 presentation experiment.
 *
 * What this surface is
 * --------------------
 * ONE material (two real works/decisions from committed records) and
 * TWO one-screen presentations of it:
 *
 *   - `Article` — the article-style (記事) rendering: a reading
 *     order of kicker → title → questions → evidence → sources.
 *   - `Landing` — the landing-page-style (LP) rendering: a hero with
 *     one claim and calls to action, the same two questions as cards,
 *     and the same sources compressed into a strip.
 *
 * The experiment compares CONTAINERS, not answers: both variants
 * render the same `Manifesto.preview.ts` data, so any difference a
 * reviewer sees is the container's doing. That is the question
 * Issue #535 asks — does the philosophy read better as a document or
 * as a landing page — and it is why the two stories share one data
 * module.
 *
 * What it deliberately does NOT do
 * ---------------------------------
 * No route, no navigation chrome, no site position. The two Miro
 * values stay two independent questions (the Issue's acceptance
 * condition); nothing is collapsed into a slogan. Unpublished works,
 * achievements and personal information are absent by construction —
 * every statement cites a committed record, and the parity test
 * (`scripts/check-manifesto-preview-parity.test.mjs`) re-reads those
 * records.
 */
const meta = {
	title: 'Preview / Manifesto',
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'why-I-make-things manifesto preview（Issue #535）— 記事案と LP 案の 2 表示を同一データで比較',
			},
		},
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The readiness markers the capture script waits for. */
export const ARTICLE_TEST_ID = 'manifesto-article-preview';
export const LANDING_TEST_ID = 'manifesto-landing-preview';

export const Article: Story = {
	render: () => <ManifestoArticle />,
};

export const Landing: Story = {
	render: () => <ManifestoLanding />,
};

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
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

function SourceLabel({ source }: { source: ManifestoSource }) {
	return (
		<span className={css({ display: 'inline-flex', flexDirection: 'column', gap: '0.5' })}>
			<span className={css({ fontFamily: 'sans', fontSize: 'sm', fontWeight: '600' })}>
				{source.label}
			</span>
			<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
				{source.path}
			</code>
		</span>
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
			<MetaFact term="status" value={MANIFESTO_DOCUMENT.status} />
			<MetaFact term="source" value={MANIFESTO_DOCUMENT.source} />
			<MetaFact term="verification" value={MANIFESTO_DOCUMENT.verification} />
			<MetaFact term="document" value={MANIFESTO_DOCUMENT.document} />
		</dl>
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

function SourceIndex({ compact = false }: { compact?: boolean }) {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'grid',
				gridTemplateColumns: compact
					? { base: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }
					: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
				gap: '3',
			})}
		>
			{MANIFESTO_SOURCES.map((source) => (
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
					<SourceLabel source={source} />
					{compact ? null : (
						<span className={css({ fontFamily: 'sans', fontSize: 'xs', color: 'text.muted' })}>
							{source.note}
						</span>
					)}
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
			{MANIFESTO_NOTES.map((note) => (
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
			{MANIFESTO_LINKS.map((link) => (
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

/* ------------------------------------------------------------------ */
/* Variant 1 — article (記事)                                          */
/* ------------------------------------------------------------------ */

/**
 * ManifestoArticle — the document container.
 *
 * Reading order is the argument: title → the two questions in order →
 * the material behind them → the sources → the colophon. Each
 * question keeps its own Miro axis citation and its own 未確認 list,
 * so the article cannot quietly merge the values into one slogan.
 */
export function ManifestoArticle() {
	return (
		<div data-testid={ARTICLE_TEST_ID} data-manifesto-variant="article">
			<Container>
				<article
					className={css({
						paddingBlock: { base: '10', lg: '16' },
						display: 'flex',
						flexDirection: 'column',
						gap: { base: '10', lg: '14' },
						maxWidth: '720px',
					})}
				>
					<header className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
						<Kicker>{MANIFESTO_DOCUMENT.kicker}</Kicker>
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
							{MANIFESTO_DOCUMENT.title}
						</h1>
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: { base: 'md', lg: 'lg' },
								lineHeight: '1.7',
								color: 'text.muted',
							})}
						>
							公開済みの記録から読んだ 2 つの判断を材料に、「作る理由」を記事として読ませる場合と LP
							として読ませる場合の 2 案を比較する preview。答えではなく容れ物を比べる。
						</p>
						<DocumentMeta />
					</header>

					{MANIFESTO_QUESTIONS.map((question, index) => (
						<QuestionSection key={question.id} question={question} index={index} />
					))}

					<MaterialSection />
					<SourceSection />

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
				</article>
			</Container>
		</div>
	);
}

function QuestionSection({
	question,
	index,
}: {
	question: ManifestoQuestion;
	index: number;
}) {
	const sourceById = new Map(MANIFESTO_SOURCES.map((source) => [source.id, source]));
	return (
		<section
			data-manifesto-question={question.id}
			aria-labelledby={`manifesto-q-${index}`}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				paddingBlockStart: '8',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<Kicker>{`question ${String(index + 1).padStart(2, '0')} — 独立した問い`}</Kicker>
				<h2
					id={`manifesto-q-${index}`}
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: { base: 'xl', lg: '2xl' },
						fontWeight: '700',
						lineHeight: '1.25',
						color: 'text.default',
					})}
				>
					{question.heading}
				</h2>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: { base: 'md', lg: 'lg' },
						lineHeight: '1.7',
						color: 'text.default',
					})}
				>
					{question.question}
				</p>
				<code
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
					})}
				>
					miro: {question.miroAxis}
				</code>
			</div>

			<ul
				className={css({
					margin: '0',
					padding: '0',
					listStyle: 'none',
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
				})}
			>
				{question.evidence.map((item) => {
					const source = sourceById.get(item.sourceId);
					return (
						<li
							key={item.statement}
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '1',
								padding: '3',
								borderInlineStart: '3px solid {colors.border.accent}',
								backgroundColor: 'bg.surface',
							})}
						>
							<span
								className={css({
									fontFamily: 'sans',
									fontSize: 'sm',
									lineHeight: '1.7',
									color: 'text.default',
								})}
							>
								{item.statement}
							</span>
							{source ? (
								<span className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
									source: {source.path}
								</span>
							) : null}
						</li>
					);
				})}
			</ul>

			<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
						textTransform: 'uppercase',
						letterSpacing: '0.04em',
					})}
				>
					未確認（owner 確認待ち）
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
					{question.open.map((item) => (
						<li
							key={item}
							className={css({
								fontFamily: 'sans',
								fontSize: 'sm',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							・{item}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

function MaterialSection() {
	const sourceById = new Map(MANIFESTO_SOURCES.map((source) => [source.id, source]));
	return (
		<section
			aria-labelledby="manifesto-materials"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				paddingBlockStart: '8',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<h2
				id="manifesto-materials"
				className={css({
					margin: '0',
					fontFamily: 'heading',
					fontSize: { base: 'xl', lg: '2xl' },
					fontWeight: '700',
					lineHeight: '1.25',
					color: 'text.default',
				})}
			>
				材料 — 公開済みの記録だけ
			</h2>
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
				{MANIFESTO_MATERIALS.map((material) => (
					<li
						key={material.id}
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
							{material.label}
						</span>
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'sm',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							{material.summary}
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
							{material.sourceIds.map((sourceId) => {
								const source = sourceById.get(sourceId);
								return source ? (
									<li
										key={sourceId}
										className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}
									>
										{source.path}
									</li>
								) : null;
							})}
						</ul>
					</li>
				))}
			</ul>
		</section>
	);
}

function SourceSection() {
	return (
		<section
			aria-labelledby="manifesto-sources"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				paddingBlockStart: '8',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<h2
				id="manifesto-sources"
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
	);
}

/* ------------------------------------------------------------------ */
/* Variant 2 — landing page (LP)                                       */
/* ------------------------------------------------------------------ */

/**
 * ManifestoLanding — the landing-page container.
 *
 * Same data, opposite rhetoric: one hero claim, two calls to action,
 * the two questions compressed into cards, the sources into a strip.
 * The comparison the Issue asks for is visible HERE — what the LP
 * gains (a single entry point, an obvious next step) and what it
 * gives up (the reading order, the per-question 未確認 lists stay one
 * click deeper in the data but not on this screen).
 */
export function ManifestoLanding() {
	return (
		<div data-testid={LANDING_TEST_ID} data-manifesto-variant="landing">
			<Container>
				<div
					className={css({
						paddingBlock: { base: '10', lg: '16' },
						display: 'flex',
						flexDirection: 'column',
						gap: { base: '10', lg: '14' },
					})}
				>
					{/* Hero — the one claim a landing page is allowed to make. */}
					<header
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '4',
							paddingBlockEnd: '8',
							borderBottom: '1px solid {colors.border.subtle}',
						})}
					>
						<Kicker>{MANIFESTO_DOCUMENT.kicker}</Kicker>
						<h1
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: '3xl', lg: '5xl' },
								fontWeight: '700',
								lineHeight: '1.1',
								color: 'text.default',
							})}
						>
							{MANIFESTO_DOCUMENT.title}
						</h1>
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: { base: 'md', lg: 'lg' },
								lineHeight: '1.7',
								color: 'text.muted',
								maxWidth: '640px',
							})}
						>
							作る理由は標語ではなく、判断の記録から読める。公開済みの 2
							つの記録を材料に、制作哲学を 2 つの問いとして残す preview。
						</p>
						<div className={css({ display: 'flex', flexWrap: 'wrap', gap: '3' })}>
							{MANIFESTO_LINKS.map((link, index) => (
								<a
									key={link.url}
									href={link.url}
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										padding: '3',
										borderRadius: 'md',
										backgroundColor: index === 0 ? 'bg.accent' : 'bg.surface',
										color: index === 0 ? 'text.inverse' : 'text.default',
										fontFamily: 'sans',
										fontSize: 'sm',
										fontWeight: '600',
										textDecoration: 'none',
									})}
								>
									{link.label}
								</a>
							))}
						</div>
						<DocumentMeta />
					</header>

					{/* The two questions — kept independent, as cards. */}
					<section
						aria-labelledby="manifesto-lp-questions"
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						<h2
							id="manifesto-lp-questions"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.25',
								color: 'text.default',
							})}
						>
							2 つの問い — 潰さない
						</h2>
						<div
							className={css({
								display: 'grid',
								gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
								gap: '4',
							})}
						>
							{MANIFESTO_QUESTIONS.map((question, index) => (
								<article
									key={question.id}
									data-manifesto-question={question.id}
									className={css({
										display: 'flex',
										flexDirection: 'column',
										gap: '3',
										padding: '5',
										border: '1px solid {colors.border.subtle}',
										borderRadius: 'lg',
										backgroundColor: 'bg.canvas',
									})}
								>
									<div
										className={css({
											display: 'flex',
											alignItems: 'center',
											gap: '2',
											flexWrap: 'wrap',
										})}
									>
										<Badge tone="neutral">{`Q${index + 1}`}</Badge>
										<span
											className={css({
												fontFamily: 'mono',
												fontSize: 'xs',
												color: 'text.muted',
											})}
										>
											{question.miroAxis}
										</span>
									</div>
									<h3
										className={css({
											margin: '0',
											fontFamily: 'heading',
											fontSize: 'lg',
											fontWeight: '700',
											lineHeight: '1.3',
											color: 'text.default',
										})}
									>
										{question.heading}
									</h3>
									<p
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'sm',
											lineHeight: '1.7',
											color: 'text.muted',
										})}
									>
										{question.question}
									</p>
									<span
										className={css({
											fontFamily: 'mono',
											fontSize: 'xs',
											color: 'text.muted',
										})}
									>
										証拠 {question.evidence.length} 件 / 未確認 {question.open.length} 件
									</span>
								</article>
							))}
						</div>
					</section>

					{/* Materials + sources, compressed to a strip. */}
					<section
						aria-labelledby="manifesto-lp-evidence"
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						<h2
							id="manifesto-lp-evidence"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: 'xl', lg: '2xl' },
								fontWeight: '700',
								lineHeight: '1.25',
								color: 'text.default',
							})}
						>
							材料と典拠
						</h2>
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
							{MANIFESTO_MATERIALS.map((material) => (
								<li
									key={material.id}
									className={css({
										display: 'flex',
										flexDirection: 'column',
										gap: '1',
										padding: '3',
										border: '1px solid {colors.border.subtle}',
										borderRadius: 'md',
										backgroundColor: 'bg.surface',
									})}
								>
									<span
										className={css({
											fontFamily: 'sans',
											fontSize: 'sm',
											fontWeight: '600',
											color: 'text.default',
										})}
									>
										{material.label}
									</span>
									<span
										className={css({
											fontFamily: 'sans',
											fontSize: 'xs',
											lineHeight: '1.6',
											color: 'text.muted',
										})}
									>
										{material.summary}
									</span>
								</li>
							))}
						</ul>
						<SourceIndex compact />
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
