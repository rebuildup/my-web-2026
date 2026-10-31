/**
 * FAIL fixture — a modal `<dialog>` with no declared close path.
 *
 * WCAG 2.2 SC 2.1.2 (A): a modal opened with `showModal()` that declares no
 * `close()`, no `onCancel` and no `cancel` listener has no way out —
 * a keyboard trap. This file must report `dialog-close-path-missing`.
 */
export function DialogNoClosePath() {
	const open = (dialog: HTMLDialogElement | null) => {
		dialog?.showModal();
	};
	return (
		<dialog ref={open} aria-label="Example modal">
			<p>Example modal</p>
		</dialog>
	);
}
