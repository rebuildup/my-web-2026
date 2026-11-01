/**
 * FAIL fixture — a modal `<dialog>` whose `Escape` key press is
 * swallowed before the user agent ever sees it.
 *
 * WCAG 2.2 SC 2.1.2 (A): preventing the default of the `Escape` key
 * press stops the user agent from making the close request, so the
 * `cancel` event is never dispatched and the native close never
 * happens. This file declares no replacement close path (no
 * `dialog.close()`), so `Escape` does not close the dialog and the
 * keyboard user is trapped. This file must report
 * `dialog-escape-close-missing`.
 *
 * This is the other half of the same defect: the default can be taken
 * away at the `cancel` event (see `dialog-no-close-path.tsx`) or at the
 * key press that would have caused it.
 */
export function DialogEscapeKeySuppressed() {
	const open = (dialog: HTMLDialogElement | null) => {
		dialog?.showModal();
	};
	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
	};
	return (
		<dialog ref={open} aria-label="Example modal" onKeyDown={handleKeyDown}>
			<p>Example modal</p>
		</dialog>
	);
}
