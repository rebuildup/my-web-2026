/**
 * PASS fixture — a hand-written polite region.
 *
 * WCAG 2.2 SC 4.1.3 (AA): a region may use the `aria-live` attribute
 * directly instead of a role, as long as it is `polite`. This file must
 * produce NO violation.
 */
export const PoliteRegion = ({ text }: { text: string }) => (
	<div aria-live="polite">
		<span>{text}</span>
	</div>
);
