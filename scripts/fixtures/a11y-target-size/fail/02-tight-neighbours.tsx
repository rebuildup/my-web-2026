/**
 * FAIL fixture — a spacing exception whose claim the geometry refuses.
 *
 * The two chips declare 16 px boxes and 2 px of space between them, so a
 * 24 CSS px diameter circle centred on either chip DOES intersect the
 * other one. The specimen declares the spacing exception with a reason,
 * and the browser half checks that claim instead of believing it: a
 * declared exception is a claim, and a claim the geometry does not
 * support is a failure.
 *
 * The static half cannot see this defect — the declaration is well
 * formed — so the roster records that the defect is a measured one.
 */
export const TightNeighbours = () => (
	<div
		data-target-specimen="tight-neighbours"
		data-target-exception="spacing"
		data-target-reason="the chips are 2 px apart, so a 24 px circle centred on either one does not reach the other"
		style={{ display: 'flex', gap: '2px' }}
	>
		<button type="button" data-target-target="primary" style={{ width: '16px', height: '16px' }}>
			A
		</button>
		<button type="button" data-target-target="secondary" style={{ width: '16px', height: '16px' }}>
			B
		</button>
	</div>
);
