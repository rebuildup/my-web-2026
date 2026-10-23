/**
 * FAIL fixture — a native `<dialog>` opened with the `open` attribute.
 *
 * WCAG 2.2 SC 2.1.2 (A) / SC 2.4.3 (A): the `open` attribute opens the
 * dialog NON-modally, so the user agent gives it no focus trap and does not
 * return the focus to the invoker. This file must report
 * `dialog-non-modal-open`.
 */
export function DialogOpenAttribute({ open }: { open: boolean }) {
	return (
		<dialog open={open} aria-label="Example modal">
			<p>Example modal</p>
		</dialog>
	);
}
