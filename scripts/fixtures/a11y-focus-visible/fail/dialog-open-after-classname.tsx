/**
 * FAIL fixture — a NON-modal `<dialog open>` whose `open` attribute is
 * written AFTER the `css({...})` call.
 *
 * JSX attribute order is free, so the gate has to read the whole start tag
 * and not only the text before the `css(` call: otherwise this dialog is
 * mistaken for the modal one in the same file and the overlay is exempted.
 * This file must report `focus-obscured-no-compensation`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const DialogOpenAfterClassName = () => {
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
				aria-label="A non-modal dialog"
				className={css({ position: 'fixed', bottom: '0' })}
				open
			>
				<p>Opened with the open attribute, written last</p>
			</dialog>
		</>
	);
};
