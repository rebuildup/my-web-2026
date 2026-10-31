/**
 * PASS fixture — a CUSTOM modal with an explicit focus-return contract.
 *
 * WCAG 2.2 SC 2.4.3 (A): a custom `role="dialog"` does not get the user
 * agent's focus return, so the file saves `document.activeElement` before
 * opening and calls `.focus()` on it when it closes. This file must
 * produce NO violation.
 */
export function CustomModalWithFocusReturn() {
	let invoker: Element | null = null;
	const open = () => {
		invoker = document.activeElement;
	};
	const close = () => {
		if (invoker instanceof HTMLElement) invoker.focus();
	};
	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: the fixture reproduces a CUSTOM modal (a role="dialog" div), which is exactly the case the gate must read */}
			<div role="dialog" aria-modal="true" aria-label="Example custom modal">
				<button type="button" onClick={open}>
					Open
				</button>
				<button type="button" onClick={close}>
					Close
				</button>
			</div>
		</>
	);
}
