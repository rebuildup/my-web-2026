/**
 * FAIL fixture — a drag operation with no DECLARED alternative.
 *
 * WCAG 2.2 SC 2.5.7 Dragging Movements (AA) is the criterion this
 * defect belongs to: all functionality that uses a dragging movement for
 * operation can be achieved by a single pointer without dragging. A
 * pointer-only operation cannot be used with a keyboard, so the gesture
 * has to have an alternative, or the operation has to be a pointer-only
 * one the criterion does not reach.
 *
 * This is NOT a size defect, so the specimen is reported under SC 2.5.7
 * and not under SC 2.5.8 — a drag defect attributed to the size
 * criterion misstates both.
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
