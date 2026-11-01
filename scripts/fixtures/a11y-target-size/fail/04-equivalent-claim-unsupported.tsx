/**
 * FAIL fixture — an "equivalent" exception whose claim the page refuses.
 *
 * The declaration is well formed: it carries a reason and it names the
 * control that offers the same function. The named control is not on the
 * page, though, so the claim the browser half can check does not hold.
 * A claim the page does not support is a failure, not a pass — the same
 * rule the spacing exception follows.
 *
 * The static half cannot see this defect — the declaration has the shape
 * the criterion asks for — so the roster records that the defect is a
 * measured one.
 */
export const EquivalentClaimUnsupported = () => (
	<div data-target-specimen="equivalent-claim-unsupported" style={{ display: 'flex', gap: '24px' }}>
		<button
			type="button"
			data-target-target="compact"
			data-target-exception="equivalent"
			data-target-reason="the button in the footer offers the same function"
			data-target-equivalent="#a11y-target-size-absent-control"
			style={{ width: '16px', height: '16px' }}
		>
			A
		</button>
	</div>
);
