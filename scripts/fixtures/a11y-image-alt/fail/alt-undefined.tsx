/**
 * FAIL fixture — `alt={undefined}`.
 *
 * WCAG 2.2 SC 1.1.1 (A): React renders `alt={undefined}` as NO `alt`
 * attribute at all, so the alt is statically absent — the same fact as an
 * image that never declared one. This file must report `img-missing-alt`.
 */
export const AltUndefined = () => (
	// biome-ignore lint/a11y/useAltText: this fixture reproduces the defect the gate rejects
	<img src="/media/portfolio/example-undefined.png" alt={undefined} width={640} height={360} />
);
