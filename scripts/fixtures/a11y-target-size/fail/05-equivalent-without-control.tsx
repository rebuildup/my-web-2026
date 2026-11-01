/**
 * FAIL fixture — an "equivalent" exception that names no control.
 *
 * The "equivalent" exception is a claim about a DIFFERENT control, so a
 * declaration that names none is not an exception at all: it is a hole
 * with a label on it. The static half reports it as an invalid
 * declaration, and the target behind it is a size defect with no valid
 * exception to carry it.
 */
export const EquivalentWithoutControl = () => (
	<div data-target-specimen="equivalent-without-control" style={{ display: 'flex', gap: '24px' }}>
		<button
			type="button"
			data-target-target="compact"
			data-target-exception="equivalent"
			data-target-reason="the same function is offered elsewhere on the page"
			style={{ width: '16px', height: '16px' }}
		>
			A
		</button>
	</div>
);
