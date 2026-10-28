import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import {
	AUDIENCE_PURPOSE_SECTIONS,
	AUDIENCE_PURPOSE_TITLE,
	type AudiencePurposeMatrix,
	type AudiencePurposeSection,
} from './AudiencePurposeMatrix.preview';

/**
 * AudiencePurposeMatrix — the standalone preview of Issue #516's
 * editorial policy.
 *
 * What this preview is
 * --------------------
 * A reading surface for the policy document, and nothing else: it does
 * not add a route, a navigation entry or a published page. The policy
 * is an internal editorial rule, so the place it can be reviewed
 * without publishing it is a preview — and the preview renders the
 * SAME strings the Markdown document carries, which
 * `scripts/check-audience-purpose-preview-parity.test.mjs` proves.
 *
 * Why only editorial primitives
 * -----------------------------
 * The preview composes `Container` and `SectionHeading` — the shipped
 * editorial primitives — and the generated Panda style layer. It
 * imports no other obligation: no route, no home surface, no HTTP
 * boundary, no binding owner. A preview that reached into a published
 * surface would make the policy document depend on what it is trying
 * to decide, and `scripts/check-storybook-ownership.mjs` fails a story
 * that does.
 *
 * The table
 * ---------
 * The matrix is a real `<table>` with a `<caption>` and `scope` on
 * every header cell, which is the structure contract
 * `scripts/check-table-code-a11y.mjs` enforces on any table that is
 * not rendered by the shipped `DataTable` primitive. The primitive
 * itself is not used here because the preview is not a data surface:
 * this table has no empty and no failure state — every cell is a
 * decision that was taken, so a "no rows" rendering would be a lie
 * rather than a state.
 *
 * The bullets
 * -----------
 * A bullet keeps its label (`実例` / `反例` / `判断根拠` / `主張種別` /
 * `決定`) in bold, so a reader can scan the document by label. The
 * rendered TEXT is byte-identical to the document's bullet line: the
 * emphasis is a style, not an edit.
 */

/** The labels a policy bullet may start with. */
const BULLET_LABELS = ['実例', '反例', '判断根拠', '主張種別', '決定', '採用', '保留'] as const;

/** Split a bullet into its label and the rest, when it starts with a known label. */
function splitLabel(point: string): { label: string; rest: string } | null {
	for (const label of BULLET_LABELS) {
		const prefix = `${label}:`;
		if (point.startsWith(prefix)) return { label: prefix, rest: point.slice(prefix.length) };
	}
	return null;
}

/** The matrix table: one `<caption>`, a scoped header row and scoped row headers. */
function MatrixTable({ matrix }: { matrix: AudiencePurposeMatrix }) {
	return (
		<table
			className={css({
				width: '100%',
				borderCollapse: 'collapse',
				fontFamily: 'sans',
				fontSize: 'sm',
				color: 'text.default',
			})}
		>
			<caption
				className={css({
					captionSide: 'top',
					textAlign: 'start',
					fontFamily: 'sans',
					fontSize: 'sm',
					fontWeight: '600',
					color: 'text.default',
					paddingBlockEnd: '2',
				})}
			>
				{matrix.caption}
			</caption>
			<thead>
				<tr>
					{matrix.columns.map((column) => (
						<th
							key={column}
							scope="col"
							className={css({
								textAlign: 'start',
								fontWeight: '600',
								backgroundColor: 'bg.subtle',
								borderBottom: '1px solid {colors.border.strong}',
								padding: '2',
								verticalAlign: 'top',
							})}
						>
							{column}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{matrix.rows.map((row) => (
					<tr key={row[0]}>
						<th
							scope="row"
							className={css({
								textAlign: 'start',
								fontWeight: '600',
								backgroundColor: 'bg.subtle',
								borderBottom: '1px solid {colors.border.subtle}',
								padding: '2',
								verticalAlign: 'top',
								whiteSpace: 'nowrap',
							})}
						>
							{row[0]}
						</th>
						{row.slice(1).map((cell) => (
							<td
								key={cell}
								className={css({
									borderBottom: '1px solid {colors.border.subtle}',
									padding: '2',
									verticalAlign: 'top',
									lineHeight: '1.6',
								})}
							>
								{cell}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** One policy section: heading, the sentence it decides, its table and its bullets. */
function PolicySection({
	section,
	id,
}: {
	section: AudiencePurposeSection;
	id: string;
}) {
	const headingId = `audience-purpose-${id}`;
	return (
		<section
			aria-labelledby={headingId}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				paddingBlock: '8',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<SectionHeading
				id={headingId}
				eyebrow="編集方針"
				title={section.heading}
				description={section.intent}
			/>
			{section.matrix ? <MatrixTable matrix={section.matrix} /> : null}
			{section.points ? (
				<ul
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
						margin: '0',
						paddingInlineStart: '5',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.7',
						color: 'text.default',
					})}
				>
					{section.points.map((point) => {
						const split = splitLabel(point);
						return (
							<li key={point}>
								{split ? <strong>{split.label}</strong> : null}
								{split ? split.rest : point}
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
}

/** The whole policy document, rendered on its own. */
export function AudiencePurposeMatrixPreview({ width }: { width?: number }) {
	return (
		<div
			style={width === undefined ? undefined : { maxWidth: `${width}px` }}
			className={css({
				backgroundColor: 'bg.canvas',
				paddingBlock: '8',
			})}
		>
			<Container>
				<h1
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: { base: '2xl', lg: '3xl' },
						fontWeight: '700',
						lineHeight: '1.15',
						letterSpacing: '-0.03em',
						color: 'text.default',
					})}
				>
					{AUDIENCE_PURPOSE_TITLE}
				</h1>
				{AUDIENCE_PURPOSE_SECTIONS.map((section, index) => (
					<PolicySection key={section.heading} section={section} id={String(index + 1)} />
				))}
			</Container>
		</div>
	);
}

const meta: Meta<typeof AudiencePurposeMatrixPreview> = {
	title: 'personal/audience-purpose',
	component: AudiencePurposeMatrixPreview,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The standard reading width — the same container the public surfaces use. */
export const Preview: Story = {
	args: {},
};

/**
 * The narrow reading width (375 px), where the matrix has to stay
 * readable without the document scrolling sideways.
 */
export const PreviewNarrow: Story = {
	args: { width: 375 },
};
