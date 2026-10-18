/**
 * Canonical nav roster shared by the Playwright gates.
 *
 * Mirrors `PUBLIC_NAV_ITEMS` in `src/editorial/nav/PublicNav.tsx` — order
 * is editorial, not alphabetical. `/design-system` is last because it is
 * a showcase surface, not part of the primary IA. Kept as a plain string
 * list so a node-side spec can assert the count without importing the
 * React component (and its Panda CSS runtime).
 */
export const NAV_ROSTER: ReadonlyArray<string> = [
	'/',
	'/portfolio',
	'/tools',
	'/about',
	'/contact',
	'/design-system',
];
