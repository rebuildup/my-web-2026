import { useSyncExternalStore } from 'react';

/**
 * useMediaQuery — viewport predicate for composition decisions that
 * CSS alone cannot express (e.g. whether a `<details>` disclosure
 * starts open).
 *
 * The server snapshot is `true`: callers use the predicate to pick a
 * post-hydration DOM state (e.g. whether a `<details>` disclosure
 * opens on mount), never to change the SSR markup itself — SSR
 * attributes the standards gate validates must stay viewport-free.
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
