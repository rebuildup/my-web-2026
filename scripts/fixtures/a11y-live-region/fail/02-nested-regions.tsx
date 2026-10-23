/**
 * FAIL fixture — a live region inside a live region.
 *
 * WCAG 2.2 SC 4.1.3 (AA): the inner change is announced by both regions,
 * so one event produces two messages. The outer region carries no dynamic
 * slot of its own, so this file reports exactly
 * `live-region-nested`.
 */
export const NestedRegions = () => (
	// biome-ignore lint/a11y/useSemanticElements: this fixture reproduces the defect the gate rejects.
	<div role="status">
		{/* biome-ignore lint/a11y/useSemanticElements: this fixture reproduces the defect the gate rejects. */}
		<span role="alert">Saved</span>
	</div>
);
