/**
 * PASS fixture — a fixed bottom overlay with the FULL compensation chain.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the focused component is not entirely
 * hidden by author-created content. A fixed overlay at the BOTTOM of the
 * viewport needs BOTH halves of the compensation:
 *
 *   - the scroll compensation (`scroll-padding-bottom` on the document's
 *     scrolling element) keeps an element in the middle of the document
 *     clear when the browser scrolls it into view;
 *   - the room at the END of the document (`padding-bottom` on `body`)
 *     lifts the LAST focusable element clear, which the scroll
 *     compensation cannot do because the browser cannot scroll past the
 *     end of the document.
 *
 * The chain is closed when the overlay's own file publishes the offset it
 * occupies AND the document consumes it in both places.
 *
 * This file must produce NO violation.
 */
const css = (styles: Record<string, unknown>) => styles;

export const CompensatedBottomOverlay = () => {
	const publish = (element: HTMLElement | null) => {
		if (!element) return;
		document.documentElement.style.setProperty(
			'--fixture-overlay-offset',
			`${element.getBoundingClientRect().height}px`,
		);
	};
	return (
		<body
			className={css({
				// The scroll compensation: the elements in the middle of
				// the document.
				scrollPaddingBottom: 'var(--fixture-overlay-offset)',
				// The room at the end of the document: the last focusable
				// element.
				paddingBottom: 'var(--fixture-overlay-offset)',
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
