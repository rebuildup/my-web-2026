/**
 * PASS fixture — a decorative image declared with the repository's own hook.
 *
 * WCAG 2.2 SC 1.1.1 (A): an image that carries no information is declared
 * decorative. A value-free `data-decorative` is the `true` shorthand, so it
 * counts as a decorative mark. This file must produce NO violation.
 */
export const DecorativeDataDecorative = () => (
	<img src="/media/editorial/rule.png" alt="" data-decorative width={640} height={1} />
);
