/**
 * PASS fixture — a target that is exactly the 24 px minimum.
 *
 * WCAG 2.2 SC 2.5.8 (AA): a pointer target must be at least 24 × 24 CSS px.
 * This specimen declares exactly the minimum, so it produces NO violation
 * in the static half, and the browser half measures a 24 × 24 box.
 */
export const MinimumTarget = () => (
	<div data-target-specimen="minimum-target" style={{ display: 'flex', gap: '24px' }}>
		<button type="button" data-target-target="primary" style={{ width: '24px', height: '24px' }}>
			A
		</button>
	</div>
);
