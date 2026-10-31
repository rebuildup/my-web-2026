/**
 * PASS fixture — a native `<dialog>` with the full modal focus contract.
 *
 * WCAG 2.2 SC 2.1.2 (A) / SC 2.4.3 (A): the dialog is opened with
 * `showModal()`, so the user agent traps the focus and returns it to the
 * invoker on close, and the file declares a close path (`close()` plus an
 * `onClose` handler). This file must produce NO violation.
 */
export function NativeModalContract() {
	const open = (dialog: HTMLDialogElement | null) => {
		dialog?.showModal();
	};
	const close = (dialog: HTMLDialogElement | null) => {
		dialog?.close();
	};
	return (
		<>
			<button type="button">Open the modal</button>
			<dialog ref={open} aria-label="Example modal" onClose={() => close(null)}>
				<p>Example modal</p>
			</dialog>
		</>
	);
}
