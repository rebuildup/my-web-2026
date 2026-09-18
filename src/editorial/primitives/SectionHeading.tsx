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
	 * Optional content rendered after the description. Use this for
	 * the section's own list / grid / table.
	 */
	children?: ReactNode;
}

/**
 * SectionHeading — `<h2>` + optional eyebrow + optional description.
 *
 * Establishes the section-rhythm rule used across the Marketing
 * layout family. One eyebrow / one title / one description per
 * section, sharing the same vertical spacing.
 *
 * Issue #31 — proximity revision (second iteration). The header has
 * no `gap` on the parent; each child carries its own
 * `marginBlockStart` to encode the semantic relationship:
 *
 * - eyebrow ↔ title: 2 (8px) — they are one heading cluster.
 * - title ↔ description: 3 (12px) — description is the lead into
 *   the section body but stays close to its label.
 * - description ↔ children: 6 (24px) — heading block ends, section
 *   content begins. The reader meets the description first, then
 *   crosses a deliberate gap into the body.
 *
 * When a section needs no eyebrow or no description, simply omit the
 * prop — do not render an empty wrapper.
 */
export function SectionHeading({ eyebrow, title, description, id, children }: SectionHeadingProps) {
	return (
		<header
			className={css({
				display: 'flex',
				flexDirection: 'column',
				marginBlockEnd: '8',
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
			{children ? (
				<div
					className={css({
						marginBlockStart: '6',
						display: 'flex',
						flexDirection: 'column',
					})}
				>
					{children}
				</div>
			) : null}
		</header>
	);
}
