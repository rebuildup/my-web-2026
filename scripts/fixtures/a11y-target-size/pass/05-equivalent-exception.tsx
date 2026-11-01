/**
 * PASS fixture — the "equivalent" exception of WCAG 2.2 SC 2.5.8 (AA).
 *
 * The compact chip is 16 × 16 px, but the function it offers is offered
 * by the full-size button beside it as well, and that button meets the
 * 24 × 24 minimum itself. The exception is DECLARED here, with a reason
 * AND the name of the equivalent control, and the browser half CHECKS
 * the claim it can check: the named control has to be on the same page
 * and has to meet the minimum itself.
 *
 * What NO half can check is that the other control offers the same
 * FUNCTION — that stays human evaluation, and the capture says so
 * instead of claiming it.
 *
 * `../fail/04-equivalent-claim-unsupported.tsx` is the same declaration
 * with a claim the page does not support.
 */
export const EquivalentException = () => (
	<div data-target-specimen="equivalent-exception" style={{ display: 'flex', gap: '24px' }}>
		<button
			type="button"
			data-target-target="compact"
			data-target-exception="equivalent"
			data-target-reason="the full-size button beside it offers the same function and meets the 24 px minimum itself"
			data-target-equivalent="#a11y-target-size-equivalent-control"
			style={{ width: '16px', height: '16px' }}
		>
			A
		</button>
		<button
			type="button"
			id="a11y-target-size-equivalent-control"
			data-target-target="full"
			style={{ width: '24px', height: '24px' }}
		>
			B
		</button>
	</div>
);
