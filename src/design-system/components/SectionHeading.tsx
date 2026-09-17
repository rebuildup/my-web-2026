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
}

/**
 * SectionHeading — `<h2>` + optional eyebrow + optional description.
 *
 * Establishes the section-rhythm rule used across the Marketing
 * layout family: one eyebrow / one title / one description per
 * section, sharing the same vertical spacing. When a section needs
 * no eyebrow or no description, simply omit the prop — do not
 * render an empty wrapper.
 */
export function SectionHeading({ eyebrow, title, description, id }: SectionHeadingProps) {
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
