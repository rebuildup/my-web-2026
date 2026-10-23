/**
 * FAIL fixture — an alt that is whitespace only.
 *
 * WCAG 2.2 SC 1.1.1 (A): `alt=" "` is neither a description nor a
 * decorative declaration, so it fails the same way a missing alt does while
 * looking like it was answered. This file must report `img-alt-blank`.
 */
export const BlankAlt = () => (
	<img src="/media/portfolio/example-blank.png" alt=" " width={640} height={360} />
);
