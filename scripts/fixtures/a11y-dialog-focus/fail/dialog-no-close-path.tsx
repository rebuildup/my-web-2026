/**
 * FAIL fixture — a modal `<dialog>` whose native `Escape` close is
 * suppressed and nothing replaces it.
 *
 * WCAG 2.2 SC 2.1.2 (A): a modal opened with `showModal()` closes on
 * `Escape` because the DEFAULT ACTION of the `cancel` event is to close
 * the dialog. This file takes that default away — the `cancel` handler
 * calls `preventDefault()` — and declares no replacement close path (no
 * `dialog.close()`), so `Escape` no longer closes the dialog and the
 * keyboard user is trapped. This file must report
 * `dialog-escape-close-missing`.
 *
 * Note what this fixture is NOT: a plain `showModal()` modal with no
 * close token at all. That one closes on `Escape` through the user
 * agent's default and is NOT a trap.
 */
export function DialogNoClosePath() {
	const open = (dialog: HTMLDialogElement | null) => {
		dialog?.showModal();
	};
	const handleCancel = (event: Event) => {
		event.preventDefault();
	};
	return (
		<dialog ref={open} aria-label="Example modal" onCancel={handleCancel}>
			<p>Example modal</p>
		</dialog>
	);
}
