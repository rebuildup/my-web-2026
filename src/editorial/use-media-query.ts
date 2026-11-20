import { useSyncExternalStore } from 'react';

/**
 * useMediaQuery — viewport predicate for composition decisions that
 * CSS alone cannot express (e.g. whether a `<details>` disclosure
 * starts open).
 *
 * The server snapshot is `true`: the SSR document is the
 * desktop-first editorial surface, so the emitted markup is the
 * expanded one. A narrow viewport closes the disclosure during
 * hydration — the same "server renders the common case, the client
 * corrects" contract `usePrefersReducedMotion` documents for the
 * inverse preference.
 */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onStoreChange) => {
			if (typeof globalThis.matchMedia !== 'function') return () => {};
			const mql = globalThis.matchMedia(query);
			mql.addEventListener('change', onStoreChange);
			return () => mql.removeEventListener('change', onStoreChange);
		},
		() => {
			if (typeof globalThis.matchMedia !== 'function') return true;
			try {
				return globalThis.matchMedia(query).matches;
			} catch {
				return true;
			}
		},
		() => true,
	);
}
