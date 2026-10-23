/**
 * FAIL fixture — the same result published by two live regions.
 *
 * WCAG 2.2 SC 4.1.3 (AA): both regions render the same expression, so the
 * one result is announced twice. This file must report exactly
 * `live-region-duplicate-announce`.
 */
export const DuplicateAnnounce = ({ message }: { message: string }) => (
	<>
		{/* biome-ignore lint/a11y/useSemanticElements: this fixture reproduces the defect the gate rejects. */}
		<div role="status">{message}</div>
		{/* biome-ignore lint/a11y/useSemanticElements: this fixture reproduces the defect the gate rejects. */}
		<div role="status">{message}</div>
	</>
);
