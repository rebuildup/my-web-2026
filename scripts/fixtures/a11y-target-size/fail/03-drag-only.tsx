/**
 * FAIL fixture — a drag operation with no click (or keyboard) alternative.
 *
 * A pointer-only operation cannot be used with a keyboard, so the
 * "Equivalent" exception of WCAG 2.2 SC 2.5.8 (AA) does not apply: the
 * gesture has to have an alternative, or the operation has to be a
 * pointer-only one the criterion does not reach.
 *
 * The box itself is 24 × 24, so the browser half measures a compliant
 * size and reports no size violation. The defect the specimen stands for
 * is the missing alternative, and that is a defect the source shows.
 */
export const DragOnlyTarget = () => (
	<div data-target-specimen="drag-only" style={{ display: 'flex', gap: '24px' }}>
		<div
			data-target-target="draggable"
			draggable
			onDragStart={() => {}}
			style={{ width: '24px', height: '24px' }}
		>
			A
		</div>
	</div>
);
