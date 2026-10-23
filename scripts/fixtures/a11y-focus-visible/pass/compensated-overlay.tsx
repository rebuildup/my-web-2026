/**
 * PASS fixture — a fixed overlay WITH a bound focus compensation.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): the focused component is not entirely
 * hidden by author-created content. The compensation is a CHAIN: the
 * overlay's own file publishes the offset it occupies, and the scroll
 * container consumes it, so the browser keeps a focused element out from
 * under the overlay when it scrolls the element into view.
 *
 * This file must produce NO violation.
 */
const css = (styles: Record<string, unknown>) => styles;

export const CompensatedOverlay = () => {
	const publish = (element: HTMLElement | null) => {
		if (!element) return;
		document.documentElement.style.setProperty(
			'--fixture-overlay-offset',
			`${element.getBoundingClientRect().height}px`,
		);
	};
	return (
		<div
			className={css({
				// The scroll container keeps the focused element clear of
				// the overlay below it.
				scrollPaddingBottom: 'var(--fixture-overlay-offset)',
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
		</div>
	);
};
