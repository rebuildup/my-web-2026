import { type ComponentType, useEffect, useState } from 'react';
import { useMediaQuery } from '../use-media-query';

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
 *
 * Issue #1110 — the companion does not mount below the `md`
 * breakpoint. The fixed overlay needs a permanent inline-end corridor
 * (`./safe-area.ts`) so scrolling text never sits under it; on a
 * phone-width viewport that corridor is ~20% of the measure and turns
 * every section into a narrow ribbon. Phones get the full reading
 * column instead; the character appears once the viewport reaches
 * `md`, where the reserved corridor leaves a workable measure.
 */
export function PetCompanion() {
	const [Sprite, setSprite] = useState<ComponentType | null>(null);
	const wideEnough = useMediaQuery('(min-width: 768px)');

	useEffect(() => {
		if (!wideEnough) return;
		let cancelled = false;
		void import('./PetSprite').then((module) => {
			if (!cancelled) setSprite(() => module.PetSprite);
		});
		return () => {
			cancelled = true;
		};
	}, [wideEnough]);

	return Sprite === null || !wideEnough ? null : <Sprite />;
}
