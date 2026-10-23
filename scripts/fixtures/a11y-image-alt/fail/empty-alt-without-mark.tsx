/**
 * FAIL fixture — `alt=""` with nothing saying the image is decorative.
 *
 * WCAG 2.2 SC 1.1.1 (A): an empty alt is a decorative declaration, and a
 * declaration nobody marked is indistinguishable from a forgotten alt. This
 * file must report `img-empty-alt-not-decorative`.
 */
export const EmptyAltWithoutMark = () => (
	<img src="/media/portfolio/example-unmarked.png" alt="" width={640} height={360} />
);
