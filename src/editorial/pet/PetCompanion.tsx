import { type ComponentType, useEffect, useState } from 'react';

/**
 * Loads the companion after hydration instead of with the page (Issue #274).
 *
 * The character is decoration. `PetSprite` carries the drag, gaze and
 * pose machinery, and the bundle budget (`quality/bundle-budget.json`)
 * charges everything a route imports STATICALLY to first paint. Shipping
 * the machinery to every visitor before the first frame — for a drawing
 * that greets, looks and can be dragged — is not a cost the decoration
 * justifies, so this wrapper holds the only static reference a page
 * makes and fetches the real module after mount.
 *
 * What the visitor sees is unchanged in kind: the server document and the
 * first client render are empty, then the character appears once its
 * chunk has arrived and plays the same arrival greeting it always did.
 * Reduced motion, persistence and the consent-surface inset all live in
 * `PetSprite` itself and are unaffected by when it mounts.
 *
 * If the chunk fails to load — offline, a stale deploy — the page simply
 * has no companion. That is the correct failure for decoration.
 */
export function PetCompanion() {
	const [Sprite, setSprite] = useState<ComponentType | null>(null);

	useEffect(() => {
		let cancelled = false;
		void import('./PetSprite').then((module) => {
			if (!cancelled) setSprite(() => module.PetSprite);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return Sprite === null ? null : <Sprite />;
}
