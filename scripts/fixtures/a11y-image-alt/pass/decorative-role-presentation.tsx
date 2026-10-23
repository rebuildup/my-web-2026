/**
 * PASS fixture — a decorative image declared with `role="presentation"`.
 *
 * WCAG 2.2 SC 1.1.1 (A): an image that carries no information is declared
 * decorative. This file must produce NO violation.
 */
export const DecorativeRolePresentation = () => (
	// biome-ignore lint/a11y/noRedundantRoles: this fixture proves the gate accepts the role mark
	<img src="/media/editorial/divider.png" alt="" role="presentation" width={640} height={2} />
);
