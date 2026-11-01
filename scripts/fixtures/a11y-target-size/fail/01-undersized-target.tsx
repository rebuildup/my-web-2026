/**
 * FAIL fixture — a target that declares a size below the 24 px minimum.
 *
 * WCAG 2.2 SC 2.5.8 (AA): a pointer target must be at least 24 × 24 CSS px.
 * The button declares a 16 × 16 box and claims no exception, so the
 * static half reports `target-specimen-undersized` and the browser half
 * measures a box that misses the minimum.
 */
export const UndersizedTarget = () => (
	<div data-target-specimen="undersized-target" style={{ display: 'flex', gap: '24px' }}>
		<button type="button" data-target-target="primary" style={{ width: '16px', height: '16px' }}>
			A
		</button>
	</div>
);
