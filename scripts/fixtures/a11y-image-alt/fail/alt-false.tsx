/**
 * FAIL fixture — `alt={false}`.
 *
 * WCAG 2.2 SC 1.1.1 (A): React renders `alt={false}` as NO `alt` attribute
 * at all, so the alt is statically absent. This file must report
 * `img-missing-alt`.
 */
export const AltFalse = () => (
	<img src="/media/portfolio/example-false.png" alt={false} width={640} height={360} />
);
