/**
 * PASS fixture — a fixed overlay compensated by ROOM AT THE END of the
 * document.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the focused component is not entirely
 * hidden by author-created content. A scroll compensation alone cannot
 * help the LAST focusable element of a page: the browser cannot scroll
 * past the end of the document, so that element stays at the bottom edge
 * of the viewport — exactly where a fixed bottom overlay is. The room
 * reserved at the end of the document is what lifts it clear.
 *
 * This file must produce NO violation.
 */
const css = (styles: Record<string, unknown>) => styles;

export const CompensatedOverlayEndOfDocument = () => {
	const publish = (element: HTMLElement | null) => {
		if (!element) return;
		document.documentElement.style.setProperty(
			'--fixture-document-offset',
			`${element.getBoundingClientRect().height}px`,
		);
	};
	return (
		<body
			className={css({
				// The room at the end of the document.
				paddingBottom: 'var(--fixture-document-offset)',
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
