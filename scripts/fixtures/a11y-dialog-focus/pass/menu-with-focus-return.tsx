/**
 * PASS fixture — a disclosure menu that hands the focus back.
 *
 * WCAG 2.2 SC 2.4.3 (A): the panel is `hidden` while it is closed, so
 * closing it from the keyboard removes the focused element from the
 * accessibility tree. The file therefore restores the focus to the
 * trigger after the panel is hidden. This file must produce NO
 * violation.
 *
 * The shape is the one the shipped nav uses: an `aria-expanded` trigger,
 * a panel that is `hidden` while it is closed, and an `Escape` handler
 * that turns the open state off and hands the focus back.
 */
export function MenuWithFocusReturn() {
	let menuOpen = false;
	const triggerRef = { current: null as HTMLButtonElement | null };
	const setMenuOpen = (open: boolean) => {
		menuOpen = open;
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			setMenuOpen(false);
			triggerRef.current?.focus();
		}
	};

	return (
		<div onKeyDown={onKeyDown}>
			<button type="button" ref={triggerRef} aria-expanded={menuOpen} aria-controls="example-menu">
				Open the menu
			</button>
			<div id="example-menu" hidden={!menuOpen}>
				<a href="/example">Example link</a>
			</div>
		</div>
	);
}
