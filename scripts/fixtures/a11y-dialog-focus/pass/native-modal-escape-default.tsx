/**
 * PASS fixture — a plain native modal that relies on the user agent's
 * `Escape` close.
 *
 * WCAG 2.2 SC 2.1.2 (A) / SC 2.4.3 (A): a `<dialog>` opened with
 * `showModal()` closes on `Escape` through the DEFAULT ACTION of the
 * `cancel` event, and the user agent returns the focus to the invoker.
 * The file spells out no close token at all, and it does not suppress
 * that default — so the modal is escapable and this file must produce
 * NO violation.
 *
 * This is the ordinary native modal: the gate must NOT report it as a
 * keyboard trap just because it does not name `dialog.close()`.
 */
export function NativeModalEscapeDefault() {
	const open = (dialog: HTMLDialogElement | null) => {
		dialog?.showModal();
	};
	return (
		<dialog ref={open} aria-label="Example modal">
			<p>Example modal</p>
		</dialog>
	);
}
