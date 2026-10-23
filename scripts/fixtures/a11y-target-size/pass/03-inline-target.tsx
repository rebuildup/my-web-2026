/**
 * PASS fixture — the "inline" exception of WCAG 2.2 SC 2.5.8 (AA).
 *
 * The link is part of a sentence, so its size is constrained by the
 * line-height of the surrounding text rather than chosen by the author.
 * The exception is not declared: the browser half DECIDES it, by reading
 * the computed `display` of the box. A link that were a standalone box
 * would be measured as a violation, which is what
 * `../fail/01-undersized-target.tsx` shows on the other side.
 */
export const InlineTarget = () => (
	<p data-target-specimen="inline-target">
		Every project is listed in{' '}
		<a data-target-target="link" href="/portfolio">
			the portfolio index
		</a>
		, and the index is the canonical list.
	</p>
);
