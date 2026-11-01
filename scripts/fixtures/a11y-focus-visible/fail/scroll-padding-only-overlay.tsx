/**
 * FAIL fixture — a fixed bottom overlay with ONLY the scroll compensation.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the focused component is not entirely
 * hidden by author-created content. `scroll-padding` on the document's
 * scrolling element keeps a focused element clear when the browser scrolls
 * it into view — but it cannot help the LAST focusable element of a page:
 * the browser cannot scroll past the end of the document, so that element
 * stays at the bottom edge of the viewport, exactly where a fixed bottom
 * overlay is.
 *
 * One half of the chain is not the chain: this file must report
 * `focus-obscured-no-compensation`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const ScrollPaddingOnlyOverlay = () => {
	const publish = (element: HTMLElement | null) => {
		if (!element) return;
		document.documentElement.style.setProperty(
			'--fixture-scroll-padding-offset',
			`${element.getBoundingClientRect().height}px`,
		);
	};
	return (
		<body
			className={css({
				// The scroll compensation alone.
				scrollPaddingBottom: 'var(--fixture-scroll-padding-offset)',
			})}
		>
			<div
				ref={publish}
				aria-label="Example overlay"
				className={css({
					position: 'fixed',
					insetInline: '0',
					bottom: '0',
				})}
			/>
		</body>
	);
};
