import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	FLAT_VS_DEPTH_CANDIDATES,
	FLAT_VS_DEPTH_METHOD,
	FLAT_VS_DEPTH_SCREENS,
	FLAT_VS_DEPTH_SECTIONS,
	type FlatVsDepthCandidate,
	type FlatVsDepthCompositionBlock,
	type FlatVsDepthDecision,
	type FlatVsDepthScreen,
	type FlatVsDepthSection,
} from './FlatVsDepth.preview';

/**
 * FlatVsDepth — the preview surface of the Issue #520 visual review.
 *
 * What this story shows
 * ---------------------
 * The review itself, in the same order the document reads:
 *
 *   - the two screens it compares, each with the **composition traits**
 *     reproduced as a schematic (not a screenshot) and the measurements
 *     the document quotes;
 *   - the improvement candidates, each marked as deferred (保留);
 *   - the decisions, each marked as adopted (採用) or deferred (保留).
 *
 * Why a schematic and not the screens themselves
 * ----------------------------------------------
 * The two screens are the site, and embedding them here would make the
 * preview a copy of the site rather than a review of it. The schematic
 * reproduces what the review argues — which column a block sits in, how
 * tall it reads, which block the screen does NOT have — using the
 * measured numbers, so the difference between the two screens is
 * readable without a second surface to keep in sync.
 *
 * Where the content comes from
 * ----------------------------
 * `FlatVsDepth.preview.ts` holds every string. The document
 * (`docs/visual/flat-vs-depth-review.md`) and this story are two
 * renderings of the same data, and
 * `scripts/check-flat-vs-depth-preview-parity.test.mjs` fails when they
 * drift apart.
 */
const meta = {
	title: 'Preview / Flat vs Depth',
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component: 'flat vs depth visual review（Issue #520）— 観測値のプレビュー',
			},
		},
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The readiness marker the capture script waits for. */
export const PREVIEW_TEST_ID = 'flat-vs-depth-preview';

export const Default: Story = {
	render: () => <FlatVsDepthPreview />,
};

/**
 * The focused comparison: the two screens, side by side, with their
 * traits, their composition schematic and their measurements.
 *
 * This is the state the verification artefact photographs — the review
 * as a whole is long, and a PR body needs the comparison itself.
 */
export const Comparison: Story = {
	render: () => <FlatVsDepthComparison />,
};

export const Narrow: Story = {
	render: () => (
		<div className={css({ maxWidth: '480px', mx: 'auto' })}>
			<FlatVsDepthPreview />
		</div>
	),
};

export const Empty: Story = {
	render: () => <FlatVsDepthPreview screens={[]} sections={[]} candidates={[]} />,
};

/**
 * FlatVsDepthComparison — the two compared screens, side by side.
 */
export function FlatVsDepthComparison({
	screens = FLAT_VS_DEPTH_SCREENS,
}: {
	screens?: readonly FlatVsDepthScreen[];
}) {
	return (
		<div data-testid={PREVIEW_TEST_ID}>
			<Container>
				<header className={css({ paddingBlock: { base: '6', lg: '10' } })}>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
						})}
					>
						preview / flat vs depth — 2 画面の比較
					</span>
					<h1
						className={css({
							margin: '0',
							marginBlockStart: '2',
							fontFamily: 'heading',
							fontSize: { base: '2xl', lg: '3xl' },
							fontWeight: '700',
							lineHeight: '1.15',
							color: 'text.default',
						})}
					>
						flat vs depth
					</h1>
					<p
						className={css({
							margin: '0',
							marginBlockStart: '3',
							fontFamily: 'sans',
							fontSize: 'md',
							lineHeight: '1.6',
							color: 'text.muted',
							maxWidth: '640px',
						})}
					>
						{FLAT_VS_DEPTH_METHOD.origin} の 2 画面の実測に基づく比較。図は実画面の
						スクリーンショットではなく、計測した構成を再現した模式図である。
					</p>
				</header>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
						gap: '4',
						paddingBlockEnd: { base: '10', lg: '16' },
					})}
				>
					{screens.map((screen) => (
						<ScreenPanel key={screen.id} screen={screen} />
					))}
				</div>
			</Container>
		</div>
	);
}

/**
 * FlatVsDepthPreview — the review, rendered.
 *
 * `screens` / `sections` / `candidates` are props so the `Empty` story
 * can prove the preview states its emptiness instead of rendering a
 * blank page.
 */
export function FlatVsDepthPreview({
	screens = FLAT_VS_DEPTH_SCREENS,
	sections = FLAT_VS_DEPTH_SECTIONS,
	candidates = FLAT_VS_DEPTH_CANDIDATES,
}: {
	screens?: readonly FlatVsDepthScreen[];
	sections?: readonly FlatVsDepthSection[];
	candidates?: readonly FlatVsDepthCandidate[];
}) {
	if (screens.length === 0 || sections.length === 0) {
		return <EmptyState />;
	}
	return (
		<div data-testid={PREVIEW_TEST_ID}>
			<Container>
				<header className={css({ paddingBlock: { base: '10', lg: '16' } })}>
					<span
						className={css({
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
						})}
					>
						preview / flat vs depth
					</span>
					<h1
						className={css({
							margin: '0',
							marginBlockStart: '2',
							fontFamily: 'heading',
							fontSize: { base: '2xl', lg: '3xl' },
							fontWeight: '700',
							lineHeight: '1.15',
							color: 'text.default',
						})}
					>
						flat vs depth
					</h1>
					<p
						className={css({
							margin: '0',
							marginBlockStart: '4',
							fontFamily: 'sans',
							fontSize: 'md',
							lineHeight: '1.6',
							color: 'text.muted',
							maxWidth: '640px',
						})}
					>
						{FLAT_VS_DEPTH_METHOD.origin} の 2 画面の実測に基づく visual review。図は実画面の
						スクリーンショットではなく、計測した構成を再現した模式図である。
					</p>
					<dl
						className={css({
							margin: '0',
							marginBlockStart: '4',
							display: 'grid',
							gridTemplateColumns: { base: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
							gap: '2',
							fontFamily: 'mono',
							fontSize: 'xs',
							color: 'text.muted',
						})}
					>
						<Fact term="viewport" value={FLAT_VS_DEPTH_METHOD.viewport} />
						<Fact term="browser" value={FLAT_VS_DEPTH_METHOD.browser} />
						<Fact term="measured" value={FLAT_VS_DEPTH_METHOD.measuredOn} />
						<Fact term="command" value={FLAT_VS_DEPTH_METHOD.command} />
						<Fact term="document" value={FLAT_VS_DEPTH_METHOD.document} />
						<Fact term="report" value={FLAT_VS_DEPTH_METHOD.report} />
					</dl>
				</header>
				<main>
					{sections.map((section, index) => (
						<Section
							key={section.heading}
							section={section}
							index={index}
							screens={screens}
							candidates={candidates}
						/>
					))}
				</main>
			</Container>
		</div>
	);
}

function Fact({ term, value }: { term: string; value: string }) {
	return (
		<div>
			<dt className={css({ textTransform: 'uppercase', letterSpacing: '0.04em' })}>{term}</dt>
			<dd className={css({ margin: '0', color: 'text.default' })}>{value}</dd>
		</div>
	);
}

function Section({
	section,
	index,
	screens,
	candidates,
}: {
	section: FlatVsDepthSection;
	index: number;
	screens: readonly FlatVsDepthScreen[];
	candidates: readonly FlatVsDepthCandidate[];
}) {
	const sectionScreens = section.screenIds
		.map((id) => screens.find((screen) => screen.id === id))
		.filter((screen): screen is FlatVsDepthScreen => screen !== undefined);
	const sectionCandidates = candidates.filter((candidate) =>
		section.candidateIds.includes(candidate.id),
	);
	return (
		<section
			aria-labelledby={`flat-vs-depth-${index}`}
			className={css({
				paddingBlock: { base: '10', lg: '16' },
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<SectionHeading
				id={`flat-vs-depth-${index}`}
				eyebrow={`${String(index + 1).padStart(2, '0')} — review`}
				title={section.heading}
				description={section.intent}
				variant="spread"
			>
				<div className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
					{section.notes.length > 0 ? <Notes notes={section.notes} /> : null}
					{sectionScreens.length > 0 ? (
						<div
							className={css({
								display: 'grid',
								gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
								gap: '4',
							})}
						>
							{sectionScreens.map((screen) => (
								<ScreenPanel key={screen.id} screen={screen} />
							))}
						</div>
					) : null}
					{sectionCandidates.length > 0 ? <CandidateList candidates={sectionCandidates} /> : null}
					{section.decisions.length > 0 ? <DecisionList decisions={section.decisions} /> : null}
				</div>
			</SectionHeading>
		</section>
	);
}

function Notes({ notes }: { notes: readonly string[] }) {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
			})}
		>
			{notes.map((note) => (
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

/**
 * ScreenPanel — one compared screen: its traits, its schematic and its
 * measurements.
 */
function ScreenPanel({ screen }: { screen: FlatVsDepthScreen }) {
	return (
		<article
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				padding: '4',
				border: '1px solid {colors.border.subtle}',
				borderRadius: 'md',
				backgroundColor: 'bg.canvas',
			})}
		>
			<header className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						color: 'text.muted',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
					})}
				>
					{screen.id}
				</span>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'lg',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					{screen.label}
				</h3>
				<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.accent' })}>
					{screen.url}
				</code>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.6',
						color: 'text.muted',
					})}
				>
					{screen.summary}
				</p>
			</header>
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
				{screen.traits.map((trait) => (
					<li
						key={trait}
						className={css({
							fontFamily: 'sans',
							fontSize: 'xs',
							lineHeight: '1.6',
							color: 'text.default',
						})}
					>
						・{trait}
					</li>
				))}
			</ul>
			<Schematic screen={screen} />
			<Measurements screen={screen} />
		</article>
	);
}

/**
 * Schematic — the composition reproduction.
 *
 * The blocks are placed in the columns the screen puts them in: a
 * heading block opens a row, a body block fills the body column of the
 * current row (and opens a new row when that row is already taken).
 * A block the screen does NOT have is drawn as an outline.
 */
function Schematic({ screen }: { screen: FlatVsDepthScreen }) {
	const placement = placeBlocks(screen.composition.blocks);
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
			<div
				className={css({
					display: 'flex',
					gap: '2',
					fontFamily: 'mono',
					fontSize: 'xs',
					color: 'text.muted',
				})}
			>
				{screen.composition.columns.map((column) => (
					<span key={column.id}>
						{column.id} {column.fraction} / {column.measured}
					</span>
				))}
			</div>
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: '1fr 2fr',
					gap: '2',
					padding: '2',
					border: '1px solid {colors.border.subtle}',
					borderRadius: 'md',
					backgroundColor: 'bg.surface',
				})}
			>
				{placement.map(({ block, row, column }) => (
					<div
						key={`${block.label}-${row}-${column}`}
						style={{ gridRow: row, gridColumn: column }}
						className={css({
							display: 'flex',
							flexDirection: 'column',
							justifyContent: 'center',
							gap: '1',
							minHeight: `${block.weight * 14 + 12}px`,
							padding: '2',
							border: block.absent
								? '1px dashed {colors.border.subtle}'
								: '1px solid {colors.border.subtle}',
							borderRadius: 'sm',
							backgroundColor: block.absent ? 'transparent' : 'bg.canvas',
						})}
					>
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'xs',
								fontWeight: '600',
								color: block.absent ? 'text.muted' : 'text.default',
							})}
						>
							{block.label}
						</span>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								color: 'text.muted',
							})}
						>
							{block.note}
						</span>
					</div>
				))}
			</div>
			<span className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
				模式図 — 実画面のスクリーンショットではない
			</span>
		</div>
	);
}

/** Place each composition block in its column and row (pure). */
export function placeBlocks(
	blocks: readonly FlatVsDepthCompositionBlock[],
): { block: FlatVsDepthCompositionBlock; row: number; column: number }[] {
	let row = 0;
	let bodyTaken = false;
	return blocks.map((block) => {
		if (block.column === 'heading') {
			row += 1;
			bodyTaken = false;
			return { block, row, column: 1 };
		}
		if (bodyTaken) row += 1;
		bodyTaken = true;
		return { block, row, column: 2 };
	});
}

/** Measurements — the numbers the document quotes. */
function Measurements({ screen }: { screen: FlatVsDepthScreen }) {
	return (
		<table
			className={css({
				width: '100%',
				borderCollapse: 'collapse',
				fontSize: 'xs',
			})}
		>
			<caption
				className={css({
					captionSide: 'top',
					textAlign: 'left',
					fontFamily: 'mono',
					fontSize: 'xs',
					color: 'text.muted',
					paddingBlockEnd: '1',
				})}
			>
				実測値
			</caption>
			<thead>
				<tr>
					<th
						scope="col"
						className={css({
							textAlign: 'left',
							fontFamily: 'sans',
							fontWeight: '600',
							color: 'text.muted',
							borderBottom: '1px solid {colors.border.subtle}',
							paddingBlockEnd: '1',
						})}
					>
						観測
					</th>
					<th
						scope="col"
						className={css({
							textAlign: 'left',
							fontFamily: 'sans',
							fontWeight: '600',
							color: 'text.muted',
							borderBottom: '1px solid {colors.border.subtle}',
							paddingBlockEnd: '1',
						})}
					>
						値
					</th>
				</tr>
			</thead>
			<tbody>
				{screen.measurements.map((measurement) => (
					<tr key={measurement.id}>
						<th
							scope="row"
							className={css({
								textAlign: 'left',
								fontWeight: '500',
								color: 'text.default',
								verticalAlign: 'top',
								paddingBlock: '1',
								paddingInlineEnd: '2',
							})}
						>
							{measurement.label}
						</th>
						<td
							className={css({
								fontFamily: 'mono',
								color: 'text.default',
								verticalAlign: 'top',
								paddingBlock: '1',
							})}
						>
							{measurement.value}
							<span
								className={css({
									display: 'block',
									color: 'text.muted',
								})}
							>
								{measurement.how}
							</span>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** CandidateList — the improvement candidates, all deferred in this Issue. */
function CandidateList({ candidates }: { candidates: readonly FlatVsDepthCandidate[] }) {
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
			{candidates.map((candidate) => (
				<article
					key={candidate.id}
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
					<div
						className={css({
							display: 'flex',
							alignItems: 'center',
							gap: '2',
							flexWrap: 'wrap',
						})}
					>
						<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
							{candidate.id}
						</code>
						<Badge tone="neutral">{candidate.verdict}</Badge>
					</div>
					<span
						className={css({
							fontFamily: 'sans',
							fontSize: 'sm',
							fontWeight: '600',
							color: 'text.default',
						})}
					>
						{candidate.title}
					</span>
					<span className={css({ fontFamily: 'sans', fontSize: 'xs', color: 'text.muted' })}>
						根拠: {candidate.basis}
					</span>
					<span className={css({ fontFamily: 'sans', fontSize: 'xs', color: 'text.default' })}>
						{candidate.proposal}
					</span>
				</article>
			))}
		</div>
	);
}

/** DecisionList — the decisions the review records. */
function DecisionList({ decisions }: { decisions: readonly FlatVsDepthDecision[] }) {
	return (
		<ul
			className={css({
				margin: '0',
				padding: '0',
				listStyle: 'none',
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
			})}
		>
			{decisions.map((decision) => (
				<li
					key={decision.id}
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
						padding: '3',
						borderInlineStart: '3px solid {colors.border.accent}',
						backgroundColor: 'bg.surface',
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
						<code className={css({ fontFamily: 'mono', fontSize: 'xs', color: 'text.muted' })}>
							{decision.id}
						</code>
						<Badge tone={decision.verdict === '採用' ? 'accent' : 'neutral'}>
							{decision.verdict}
						</Badge>
					</div>
					<span
						className={css({
							fontFamily: 'sans',
							fontSize: 'sm',
							fontWeight: '600',
							color: 'text.default',
						})}
					>
						{decision.statement}
					</span>
					<span className={css({ fontFamily: 'sans', fontSize: 'xs', color: 'text.muted' })}>
						{decision.reason}
					</span>
				</li>
			))}
		</ul>
	);
}

/** EmptyState — the explicit empty state (Issue #380 の preview 契約の方向). */
function EmptyState() {
	return (
		<div data-testid={PREVIEW_TEST_ID}>
			<Container>
				<section className={css({ paddingBlock: { base: '16', lg: '24' } })}>
					<SectionHeading
						eyebrow="preview / flat vs depth"
						title="比較する画面が無い"
						description="この preview は 2 画面を実測値つきで比較する。データが空のときは空の画面の代わりにこの状態を出し、空白ページを作らない。"
					/>
				</section>
			</Container>
		</div>
	);
}
