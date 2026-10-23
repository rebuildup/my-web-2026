/**
 * PASS fixture — a polite status region with a batched update.
 *
 * WCAG 2.2 SC 4.1.3 (AA): the change is announced through `role="status"`
 * (polite), and `aria-busy` batches the update while it is in flight. The
 * `aria-busy` value is a runtime expression, which this gate accepts
 * without deciding it statically. This file must produce NO violation.
 */
export const StatusRegion = ({ message, pending }: { message: string; pending: boolean }) => (
	// biome-ignore lint/a11y/useSemanticElements: this fixture proves the role="status" live-region contract.
	<div role="status" aria-live="polite" aria-atomic="true" aria-busy={pending}>
		{message}
	</div>
);
