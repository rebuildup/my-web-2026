import type { ReactNode } from 'react';
import { css } from '../../../styled-system/css';

export interface SectionHeadingProps {
	/**
	 * Short, all-caps label above the title. Stays in `text.muted`
	 * so the eyebrow reads as a section identifier rather than a
	 * heading. Keep it to a single word or two — never a sentence.
	 */
	eyebrow?: string;
	title: string;
	/**
	 * Optional description rendered as a muted paragraph below
	 * the title. Rendered as plain text; pass JSX only when the
	 * content genuinely needs formatting.
	 */
	description?: ReactNode;
	/**
	 * Optional id. When provided, the rendered `<h2>` uses it and
	 * sections that wrap themselves in `<section aria-labelledby>`
	 * can reference the heading programmatically.
	 */
	id?: string;
	/**
	 * Two layouts:
	 *
	 * - `default` (default value): single-column stack —
	 *   eyebrow → title → description. Used when the section has
	 *   no children slot (no list / grid / table of its own).
	 * - `spread`: editorial 2-column layout used by the body
	 *   sections. The left column carries the heading cluster
	 *   (eyebrow → h2 → description) on the 4/12 grid column; the
	 *   right column carries a `children` slot on the 8/12 grid
	 *   column. Below `lg` the columns stack with the heading on
	 *   top.
	 *
	 * The split is part of the 12-column grid system documented in
	 * `src/home/brief.md`. Spread sections reserve one column for
	 * the heading cluster so the heading sits on its own visual
	 * axis; the right column carries the section body.
	 */
	variant?: 'default' | 'spread';
	/**
	 * Optional content rendered in the right column of a `spread`
	 * variant. Ignored by the `default` variant.
	 */
	children?: ReactNode;
}

/**
 * SectionHeading — `<h2>` + optional eyebrow + optional description.
 *
 * Establishes the section-rhythm rule used across the Marketing
 * layout family. The `default` variant keeps one eyebrow / one
 * title / one description per section, sharing the same vertical
 * spacing. The `spread` variant promotes the heading to the
 * section's visual anchor in a narrow left column (4/12) and lets
 * the caller drop its own list / grid / table into the right
 * column (8/12) via `children`.
 *
 * Issue #31 — editorial spread (fourth pass). The `spread` variant
 * is restored. The heading cluster (eyebrow / h2 / description)
 * fills the left column so it carries semantic content instead of
 * an empty space below the title. Per-element `marginBlockStart`
 * encodes the proximity rule within the cluster.
 *
 * When a section needs no eyebrow or no description, simply omit the
 * prop — do not render an empty wrapper.
 */
export function SectionHeading({
	eyebrow,
	title,
	description,
	id,
	variant = 'default',
	children,
}: SectionHeadingProps) {
	if (variant === 'spread') {
		return (
			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
					columnGap: { base: '0', lg: '10' },
					rowGap: { base: '10', lg: '0' },
					marginBlockEnd: '0',
				})}
			>
				<header
					className={css({
						display: 'flex',
						flexDirection: 'column',
					})}
				>
					{eyebrow ? (
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'sm',
								fontWeight: '600',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								color: 'text.muted',
							})}
						>
							{eyebrow}
						</span>
					) : null}
					<h2
						id={id}
						className={css({
							margin: '0',
							marginBlockStart: eyebrow ? '2' : '0',
							fontFamily: 'sans',
							fontSize: { base: '2xl', lg: '3xl' },
							fontWeight: '700',
							lineHeight: { base: '1.15', lg: '1.05' },
							letterSpacing: '-0.025em',
							color: 'text.default',
						})}
					>
						{title}
					</h2>
					{description ? (
						<p
							className={css({
								margin: '0',
								marginBlockStart: '4',
								fontFamily: 'sans',
								fontSize: 'md',
								lineHeight: '1.6',
								color: 'text.muted',
							})}
						>
							{description}
						</p>
					) : null}
				</header>
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						minWidth: '0',
					})}
				>
					{children}
				</div>
			</div>
		);
	}

	return (
		<header
			className={css({
				display: 'flex',
				flexDirection: 'column',
				marginBlockEnd: '10',
			})}
		>
			{eyebrow ? (
				<span
					className={css({
						fontFamily: 'sans',
						fontSize: 'sm',
						fontWeight: '600',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{eyebrow}
				</span>
			) : null}
			<h2
				id={id}
				className={css({
					margin: '0',
					marginBlockStart: eyebrow ? '2' : '0',
					fontFamily: 'sans',
					fontSize: { base: 'xl', lg: '2xl' },
					fontWeight: '700',
					lineHeight: '1.15',
					letterSpacing: '-0.02em',
					color: 'text.default',
				})}
			>
				{title}
			</h2>
			{description ? (
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
					{description}
				</p>
			) : null}
		</header>
	);
}
