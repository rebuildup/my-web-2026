/**
 * FAIL fixture — a fixed overlay that "compensates" ITSELF.
 *
 * WCAG 2.2 SC 2.4.11 (AA, Minimum): a scroll compensation only reserves
 * space when it is declared on the DOCUMENT's scrolling element. The same
 * declaration on the overlay's own element is a no-op — it reserves
 * nothing — so the chain is open and the focused element can still be
 * hidden. This file must report `focus-obscured-no-compensation`.
 */
const css = (styles: Record<string, unknown>) => styles;

export const OverlaySelfCompensation = () => {
	const publish = (element: HTMLElement | null) => {
		if (!element) return;
		document.documentElement.style.setProperty(
			'--fixture-self-offset',
			`${element.getBoundingClientRect().height}px`,
		);
	};
	return (
		<div
			ref={publish}
			aria-label="Example overlay"
			className={css({
				position: 'fixed',
				insetInline: '0',
				bottom: '0',
				// Declared on the overlay itself: a no-op, not a document
				// consumption.
				scrollPaddingBottom: 'var(--fixture-self-offset)',
			})}
		/>
	);
};
