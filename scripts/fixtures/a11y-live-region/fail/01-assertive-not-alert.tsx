/**
 * FAIL fixture — a hand-written assertive region.
 *
 * WCAG 2.2 SC 4.1.3 (AA): `aria-live="assertive"` interrupts the reader
 * mid-sentence. The repository's one assertive announcement is an error,
 * and the spelling for it is `role="alert"`. This file must report
 * `live-region-assertive-not-alert`.
 */
export const AssertiveStatus = ({ message }: { message: string }) => (
	<div aria-live="assertive">{message}</div>
);
