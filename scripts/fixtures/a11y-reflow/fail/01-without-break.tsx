/**
 * FAIL fixture — a long unbreakable run with no break boundary.
 *
 * WCAG 2.2 SC 1.4.10 (AA): this is the defect the gate exists to catch.
 * The specimen injects an unbreakable word and declares no
 * `overflow-wrap` / `word-break`, so the widest token becomes the
 * minimum content width and the page scrolls horizontally at 320 px.
 * This file must report `reflow-specimen-without-break`.
 */
const LONG_WORD = 'Donaudampfschifffahrtsgesellschaftskapitaenswitwenrentenversicherungsanstalt';

export const FailWithoutBreak = () => (
	<div data-reflow-specimen="without-break" data-reflow-kind="long-word">
		{LONG_WORD}
	</div>
);
