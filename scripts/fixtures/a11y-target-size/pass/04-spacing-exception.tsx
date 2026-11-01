/**
 * PASS fixture — the "spacing" exception of WCAG 2.2 SC 2.5.8 (AA).
 *
 * The two chips are 16 px wide but 24 px apart, so a 24 CSS px diameter
 * circle centred on either chip reaches no other target. The exception is
 * DECLARED here, with a reason, and the browser half CHECKS the claim
 * against the rendered boxes: a claim the geometry does not support is a
 * failure, not a pass. `../fail/02-tight-neighbours.tsx` is the same
 * declaration with a claim the geometry refuses.
 */
export const SpacingException = () => (
	<div
		data-target-specimen="spacing-exception"
		data-target-exception="spacing"
		data-target-reason="the chips are 24 px apart, so a 24 px circle centred on either one does not reach the other"
		style={{ display: 'flex', gap: '24px' }}
	>
		<button type="button" data-target-target="primary" style={{ width: '16px', height: '16px' }}>
			A
		</button>
		<button type="button" data-target-target="secondary" style={{ width: '16px', height: '16px' }}>
			B
		</button>
	</div>
);
