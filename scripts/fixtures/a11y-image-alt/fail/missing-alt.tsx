/**
 * FAIL fixture — an image with no `alt` attribute at all.
 *
 * WCAG 2.2 SC 1.1.1 (A): the rule the gate exists to enforce. This file
 * must report `img-missing-alt`.
 */
export const MissingAlt = () => (
	<figure>
		{/* biome-ignore lint/a11y/useAltText: this fixture reproduces the defect the gate rejects */}
		<img src="/media/portfolio/example-no-alt.png" width={640} height={360} />
		<figcaption>An image whose alternative text was never written</figcaption>
	</figure>
);
