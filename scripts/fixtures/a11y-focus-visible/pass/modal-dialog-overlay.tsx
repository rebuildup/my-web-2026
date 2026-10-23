/**
 * PASS fixture — a fixed overlay that is a NATIVE MODAL DIALOG.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the focused component is not entirely
 * hidden by author-created content. A `<dialog>` opened with `showModal()`
 * makes the rest of the document inert, so nothing outside the dialog can
 * be focused while it is open — the focus cannot be obscured by it.
 *
 * This file must produce NO violation.
 */
const css = (styles: Record<string, unknown>) => styles;

export const ModalDialogOverlay = () => {
	const open = (dialog: HTMLDialogElement | null) => {
		if (!dialog) return;
		dialog.showModal();
	};
	return (
		<dialog
			ref={open}
			aria-label="Example dialog"
			className={css({
				position: 'fixed',
				inset: '0',
				margin: 'auto',
			})}
		>
			<p>An example modal dialog</p>
		</dialog>
	);
};
