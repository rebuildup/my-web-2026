/**
 * FAIL fixture — `alt={null}`.
 *
 * WCAG 2.2 SC 1.1.1 (A): React renders `alt={null}` as NO `alt` attribute
 * at all, so the alt is statically absent. This file must report
 * `img-missing-alt`.
 */
export const AltNull = () => (
	// biome-ignore lint/a11y/useAltText: this fixture reproduces the defect the gate rejects
	<img src="/media/portfolio/example-null.png" alt={null} width={640} height={360} />
);
