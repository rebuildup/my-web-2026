/**
 * FAIL fixture — a native `<dialog>` opened with `show()` instead of
 * `showModal()`.
 *
 * WCAG 2.2 SC 2.1.2 (A) / SC 2.4.3 (A): `show()` opens the dialog
 * NON-modally, so the user agent gives it no focus trap and does not return
 * the focus to the invoker — the same defect as the `open` attribute, in
 * the other spelling. This file must report `dialog-non-modal-open`.
 */
export function DialogNonModalShow() {
	const open = (dialog: HTMLDialogElement | null) => {
		dialog?.show();
	};
	return (
		<dialog ref={open} aria-label="Example modal">
			<p>Example modal</p>
		</dialog>
	);
}
