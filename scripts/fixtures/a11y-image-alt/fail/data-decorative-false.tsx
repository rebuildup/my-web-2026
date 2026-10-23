/**
 * FAIL fixture — `data-decorative={false}` next to an empty alt.
 *
 * WCAG 2.2 SC 1.1.1 (A): a decorative mark that carries a value counts only
 * when that value is `true`. `data-decorative={false}` says "NOT
 * decorative", so it must not be able to turn an empty alt into a pass.
 * This file must report `img-empty-alt-not-decorative`.
 */
export const DataDecorativeFalse = () => (
	<img
		src="/media/portfolio/example-not-decorative.png"
		alt=""
		data-decorative={false}
		width={640}
		height={360}
	/>
);
