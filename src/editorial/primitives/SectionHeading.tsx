import type { ReactNode } from 'react';
import { css } from '../../../styled-system/css';

export interface SectionHeadingProps {
	/**
	 * Short, all-caps label above the title. Stays in `text.accent`
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
	 * - `default` (default value): the existing single-column
	 *   stack — eyebrow → title → description. The title sits in
	 *   `xl` (24px) and the whole heading stays above the section
	 *   content.
	 * - `spread`: editorial 2-column layout used by the body
	 *   sections below the hero. The title renders at `4xl` (48px)
	 *   in a sticky left column (40%) so it stays visible while
	 *   long content scrolls; the right column carries the eyebrow,
	 *   description, and a `children` slot for the section's own
	 *   list / grid / table. Below `lg` the columns stack into a
	 *   vertical flow with the title on top.
	 *
	 * Spread exists so editors can translate the magazine-spread
	 * section pattern (large left title + dense right column) into
	 * the home page without re-implementing the layout per call
	 * site. Issue #31 added the variant.
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
 * layout family. The `default` variant keeps one eyebrow / one title
 * / one description per section, sharing the same vertical spacing.
 * The `spread` variant promotes the title to the section's visual
 * anchor in a sticky left column and lets the caller drop its own
 * list / grid / table into the right column via `children`.
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
					gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 2fr) minmax(0, 5fr)' },
					gap: { base: '6', lg: '12' },
					alignItems: 'start',
					marginBlockEnd: { base: '8', lg: '12' },
				})}
			>
				<header
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '4',
						position: { base: 'static', lg: 'sticky' },
						top: { base: 'auto', lg: '8' },
					})}
				>
					<h2
						id={id}
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: { base: '3xl', lg: '4xl' },
							fontWeight: '700',
							lineHeight: { base: '1.2', lg: '1.1' },
							letterSpacing: '-0.02em',
							color: 'text.default',
						})}
					>
						{title}
					</h2>
				</header>
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '4',
						minWidth: '0',
					})}
				>
					{eyebrow ? (
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'xs',
								fontWeight: '600',
								letterSpacing: '0.08em',
								textTransform: 'uppercase',
								color: 'text.accent',
							})}
						>
							{eyebrow}
						</span>
					) : null}
					{description ? (
						<p
							className={css({
								margin: '0',
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
				gap: '2',
				marginBlockEnd: '8',
			})}
		>
			{eyebrow ? (
				<span
					className={css({
						fontFamily: 'sans',
						fontSize: 'xs',
						fontWeight: '600',
						letterSpacing: '0.08em',
						textTransform: 'uppercase',
						color: 'text.accent',
					})}
				>
					{eyebrow}
				</span>
			) : null}
			<h2
				id={id}
				className={css({
					margin: '0',
					fontFamily: 'sans',
					fontSize: 'xl',
					fontWeight: '700',
					lineHeight: '1.2',
					color: 'text.default',
				})}
			>
				{title}
			</h2>
			{description ? (
				<p
					className={css({
						margin: '0',
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
