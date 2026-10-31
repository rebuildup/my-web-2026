/**
 * FAIL fixture — a CUSTOM modal with no focus-return contract.
 *
 * WCAG 2.2 SC 2.4.3 (A): a custom `role="dialog"` does not get the user
 * agent's focus return, and this file never saves `document.activeElement`
 * or restores it. This file must report
 * `custom-dialog-focus-return-missing`.
 */
export function CustomModalNoFocusReturn() {
	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: the fixture reproduces a CUSTOM modal (a role="dialog" div), which is exactly the case the gate must read */}
			<div role="dialog" aria-modal="true" aria-label="Example custom modal">
				<p>Example custom modal</p>
			</div>
		</>
	);
}
