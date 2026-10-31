/**
 * PASS fixture — a long URL with no whitespace break opportunity.
 *
 * WCAG 2.2 SC 1.4.10 (AA): a URL is the classic unbreakable run. The
 * specimen declares `overflow-wrap: break-word`, which keeps the URL
 * inside the 320 px column even when a single path segment is wider than
 * the column. This file must produce NO violation.
 */
const LONG_URL =
	'https://example.com/very/long/path/segment/that/never/breaks/at/a/space/and/keeps/going/forever';

export const PassLongUrl = () => (
	<div
		data-reflow-specimen="long-url"
		data-reflow-kind="long-url"
		style={{ overflowWrap: 'break-word', maxWidth: '100%' }}
	>
		{LONG_URL}
	</div>
);
