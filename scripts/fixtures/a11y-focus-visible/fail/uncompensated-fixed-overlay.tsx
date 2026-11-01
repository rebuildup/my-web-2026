/**
 * FAIL fixture — a fixed overlay with NO focus compensation.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the rule the gate exists to enforce.
 * A fixed overlay is author-created content that sits over the page, and
 * the browser scrolls a focused element to the edge of the viewport —
 * where this overlay is. Without a compensation bound to it, the focused
 * element can be entirely hidden. This file must report
 * `focus-obscured-no-compensation`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const UncompensatedFixedOverlay = () => (
	<div
		aria-label="Example overlay"
		className={css({
			position: 'fixed',
			insetInline: '0',
			bottom: '0',
		})}
	/>
);
