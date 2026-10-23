/**
 * PASS fixture — a decorative image declared with `data-decorative="true"`.
 *
 * WCAG 2.2 SC 1.1.1 (A): an image that carries no information is declared
 * decorative. The mark only counts when its value is `true`. This file must
 * produce NO violation.
 */
export const DecorativeDataDecorativeTrue = () => (
	<img src="/media/editorial/rule.png" alt="" data-decorative="true" width={640} height={1} />
);
