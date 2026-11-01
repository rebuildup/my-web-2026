/**
 * PASS fixture — a target that is comfortably above the 24 px minimum.
 *
 * WCAG 2.2 SC 2.5.8 (AA): a pointer target must be at least 24 × 24 CSS px.
 * A target well above the minimum produces NO violation in the static
 * half, and the browser half measures a 40 × 40 box.
 */
export const OversizedTarget = () => (
	<div data-target-specimen="oversized-target" style={{ display: 'flex', gap: '24px' }}>
		<button type="button" data-target-target="primary" style={{ width: '40px', height: '40px' }}>
			A
		</button>
	</div>
);
