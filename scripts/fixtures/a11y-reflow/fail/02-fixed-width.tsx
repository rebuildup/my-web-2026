/**
 * FAIL fixture — a box pinned to a fixed width wider than the budget.
 *
 * WCAG 2.2 SC 1.4.10 (AA): the break boundary is present, but the box
 * itself is `min-width: 640px`, wider than the 320 px reflow viewport, so
 * no amount of wrapping can fit it. This file must report
 * `reflow-specimen-fixed-width` (and only that rule).
 */
const LONG_WORD = 'Donaudampfschifffahrtsgesellschaftskapitaenswitwenrentenversicherungsanstalt';

export const FailFixedWidth = () => (
	<div
		data-reflow-specimen="fixed-width"
		data-reflow-kind="long-word"
		style={{ overflowWrap: 'anywhere', minWidth: '640px' }}
	>
		{LONG_WORD}
	</div>
);
