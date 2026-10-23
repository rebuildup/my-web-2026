/**
 * FAIL fixture — unbreakable content with wrapping forbidden.
 *
 * WCAG 2.2 SC 1.4.10 (AA): `white-space: nowrap` removes every break
 * opportunity, so even a declared `overflow-wrap` cannot reflow the run
 * and the box overflows the viewport. This file must report
 * `reflow-specimen-nowrap` (and only that rule).
 */
const LONG_URL =
	'https://example.com/very/long/path/segment/that/never/breaks/at/a/space/and/keeps/going/forever';

export const FailNowrap = () => (
	<div
		data-reflow-specimen="nowrap"
		data-reflow-kind="long-url"
		style={{ overflowWrap: 'anywhere', whiteSpace: 'nowrap' }}
	>
		{LONG_URL}
	</div>
);
