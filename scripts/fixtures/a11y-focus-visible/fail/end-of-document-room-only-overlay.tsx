/**
 * FAIL fixture — a fixed bottom overlay with ONLY the room at the end of
 * the document.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the focused component is not entirely
 * hidden by author-created content. The room at the end of the document
 * (`padding-bottom` on `body`) lifts the LAST focusable element clear of
 * a fixed bottom overlay, but it does nothing for the elements in the
 * middle of the document: the browser scrolls those to the edge of the
 * viewport, which is where the overlay is.
 *
 * One half of the chain is not the chain: this file must report
 * `focus-obscured-no-compensation`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const EndOfDocumentRoomOnlyOverlay = () => {
	const publish = (element: HTMLElement | null) => {
		if (!element) return;
		document.documentElement.style.setProperty(
			'--fixture-end-of-document-offset',
			`${element.getBoundingClientRect().height}px`,
		);
	};
	return (
		<body
			className={css({
				// The room at the end of the document alone.
				paddingBottom: 'var(--fixture-end-of-document-offset)',
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
