/**
 * FAIL fixture — an `aria-busy` value that is not a boolean.
 *
 * WCAG 2.2 SC 4.1.2 (A): the invalid value is dropped by the user agent
 * and the batching silently stops, so the region re-announces every
 * intermediate change. This file must report `live-region-busy-invalid`.
 */
export const BusyInvalid = ({ message }: { message: string }) => (
	// biome-ignore lint/a11y/useSemanticElements: this fixture reproduces the defect the gate rejects.
	// biome-ignore lint/a11y/useValidAriaValues: this fixture reproduces the invalid aria-busy value the gate rejects.
	<div role="status" aria-busy="yes">
		{message}
	</div>
);
