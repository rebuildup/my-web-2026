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
 *
 * Issue #1162 — the narrow-viewport summon control is GONE, and the
 * companion mounts on every viewport.
 *
 * The contract (`docs/domain/pet-companion.md` §5.4) says the
 * character has no button: 「ユーザーの操作に対して自動で反応するように。
 * ボタンなどを使わずに。」 and §5.6 forbids adding a focusable element to
 * the companion's surface. Issue #1110 answered a different question
 * — "the phone must not give up its reading measure" — with a fixed
 * 44 px button at the bottom-LEFT of the viewport, and that answer
 * was never recorded in the contract. Two consequences showed up in the
 * L-C review (F-7):
 *
 *   1. The button contradicted the contract's "no button" rule.
 *   2. A fixed control at the bottom-LEFT covers the START of every
 *      line it lands on — the first characters of a Japanese line,
 *      the most-read part of it. The companion's own resting place
 *      is the bottom-RIGHT (contract §5.2), where it covers the
 *      TRAILING edge of the column — the part a reader reaches last,
 *      and mostly empty space on a narrow screen.
 *
 * So the companion now auto-mounts everywhere and the summon control
 * is gone: the contract's rule is restored, the phone keeps its full
 * reading measure (no corridor is reserved below `md` — see
 * `./safe-area.ts`), and the only overlay left on a phone is the
 * small resting sprite at the trailing edge, which the visitor can
 * drag anywhere (§5.2).
 */
export function PetCompanion() {
	const [Sprite, setSprite] = useState<ComponentType | null>(null);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted) return;
		let cancelled = false;
		void import('./PetSprite').then((module) => {
			if (!cancelled) setSprite(() => module.PetSprite);
		});
		return () => {
			cancelled = true;
		};
	}, [mounted]);

	if (!mounted || Sprite === null) return null;
	return <Sprite />;
}
