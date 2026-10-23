/**
 * PASS fixture — a decorative image declared with `aria-hidden="true"`.
 *
 * WCAG 2.2 SC 1.1.1 (A): an image that carries no information is declared
 * decorative. This file must produce NO violation.
 */
export const DecorativeAriaHidden = () => (
	<img src="/media/home/digit-0.webp" alt="" aria-hidden="true" width={32} height={48} />
);
