/**
 * PASS fixture — a long unbreakable word inside a 320 px column.
 *
 * WCAG 2.2 SC 1.4.10 (AA): the widest token must not become the minimum
 * content width. The specimen declares a break boundary, so the line
 * breaker has an emergency break and the box stays inside the budget.
 * This file must produce NO violation.
 */
const LONG_WORD = 'Donaudampfschifffahrtsgesellschaftskapitaenswitwenrentenversicherungsanstalt';

export const PassLongWord = () => (
	<div
		data-reflow-specimen="long-word"
		data-reflow-kind="long-word"
		style={{ overflowWrap: 'anywhere', maxWidth: '100%' }}
	>
		{LONG_WORD}
	</div>
);
