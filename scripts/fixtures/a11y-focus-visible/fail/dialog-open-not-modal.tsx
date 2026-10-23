/**
 * FAIL fixture — a NON-modal `<dialog open>` in a file that also calls
 * `showModal()` somewhere.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): only a `<dialog>` opened with
 * `showModal()` makes the rest of the document inert. A `<dialog open>`
 * is non-modal, so it can still obscure a focused element; the modal
 * exemption must not be granted at FILE scope just because some other
 * dialog in the file is opened modally. This file must report
 * `focus-obscured-no-compensation` (for the `open` dialog).
 */
const css = (styles: Record<string, unknown>) => styles;

export const DialogOpenNotModal = () => {
	const openModal = (dialog: HTMLDialogElement | null) => {
		if (!dialog) return;
		dialog.showModal();
	};
	return (
		<>
			<dialog
				ref={openModal}
				aria-label="A modal dialog"
				className={css({ position: 'fixed', inset: '0', margin: 'auto' })}
			>
				<p>Opened with showModal()</p>
			</dialog>
			<dialog
				open
				aria-label="A non-modal dialog"
				className={css({ position: 'fixed', bottom: '0' })}
			>
				<p>Opened with the open attribute</p>
			</dialog>
		</>
	);
};
