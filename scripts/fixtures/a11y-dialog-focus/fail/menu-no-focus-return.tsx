/**
 * FAIL fixture — a disclosure menu closed by Escape with no focus
 * hand-back.
 *
 * WCAG 2.2 SC 2.4.3 (A) / SC 2.1.2 (A): the panel is `hidden` while it
 * is closed and the `Escape` gesture turns its open state off, but the
 * file never restores the focus. Hiding the panel removes the focused
 * element from the accessibility tree, and the browser drops the focus
 * to the document body — the keyboard user loses their place. This file
 * must report `menu-focus-return-missing`.
 *
 * The shape is the one the shipped nav uses: an `aria-expanded` trigger,
 * a panel that is `hidden` while it is closed, and an `Escape` handler
 * that turns the open state off.
 */
export function MenuNoFocusReturn() {
	let menuOpen = false;
	const setMenuOpen = (open: boolean) => {
		menuOpen = open;
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			setMenuOpen(false);
		}
	};

	return (
		<div onKeyDown={onKeyDown}>
			<button type="button" aria-expanded={menuOpen} aria-controls="example-menu">
				Open the menu
			</button>
			<div id="example-menu" hidden={!menuOpen}>
				<a href="/example">Example link</a>
			</div>
		</div>
	);
}
