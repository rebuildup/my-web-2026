import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
	COUNTER_ROLL_MOTION,
	MOTION_HOOK_ATTRIBUTE,
	REDUCED_MOTION_QUERY,
	prefersReducedMotion,
	resolveReducedMotion,
	subscribeToReducedMotion,
	usePrefersReducedMotion,
} from './reduced-motion';

/**
 * reduced-motion contract tests (Issue #403).
 *
 * The workerd pool has no `window.matchMedia`, which is the honest
 * starting point for this file: the preference is genuinely
 * unanswerable in the Worker, and the contract must answer "motion
 * allowed" without touching a global that may not exist. Each test
 * that needs the other branch installs its own `matchMedia` and
 * removes it again, so a test that leaks a stub fails the next one
 * rather than quietly depending on it.
 */

type MatchMediaStub = (query: string) => {
	matches: boolean;
	addEventListener: (type: string, listener: () => void) => void;
	removeEventListener: (type: string, listener: () => void) => void;
};

const globalWithMedia = globalThis as { matchMedia?: MatchMediaStub };

function installMatchMedia(matches: boolean) {
	const listeners = new Set<() => void>();
	globalWithMedia.matchMedia = ((query: string) => ({
		matches: query === REDUCED_MOTION_QUERY ? matches : false,
		addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
	})) as MatchMediaStub;
	return {
		queryMatches: (query: string) =>
			globalWithMedia.matchMedia ? globalWithMedia.matchMedia(query).matches : null,
		emitChange: () => {
			for (const listener of listeners) listener();
		},
		listenerCount: () => listeners.size,
	};
}

afterEach(() => {
	globalWithMedia.matchMedia = undefined;
});

describe('reduced-motion contract', () => {
	it('publishes the query it asks the browser about', () => {
		expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
	});

	it('publishes the attribute and the counter hook the stylesheet pairs with', () => {
		expect(MOTION_HOOK_ATTRIBUTE).toBe('data-motion');
		expect(COUNTER_ROLL_MOTION).toBe('counter-roll');
	});

	it('answers "motion allowed" where the query cannot be asked', () => {
		globalWithMedia.matchMedia = undefined;
		expect(prefersReducedMotion()).toBe(false);
		expect(subscribeToReducedMotion(() => {})).toBeTypeOf('function');
	});

	it('answers from the live preference when the query can be asked', () => {
		installMatchMedia(true);
		expect(prefersReducedMotion()).toBe(true);
		globalWithMedia.matchMedia = undefined;
		installMatchMedia(false);
		expect(prefersReducedMotion()).toBe(false);
	});

	it('treats a throwing matchMedia as "cannot be asked", not as a crash', () => {
		globalWithMedia.matchMedia = (() => {
			throw new Error('matchMedia is unavailable in this environment');
		}) as MatchMediaStub;
		expect(prefersReducedMotion()).toBe(false);
	});

	it('subscribes to preference changes and detaches on unsubscribe', () => {
		const media = installMatchMedia(false);
		const seen: number[] = [];
		const unsubscribe = subscribeToReducedMotion(() => seen.push(seen.length));
		expect(media.listenerCount()).toBe(1);
		media.emitChange();
		expect(seen).toHaveLength(1);
		unsubscribe();
		expect(media.listenerCount()).toBe(0);
	});

	it('lets an explicit override win over the live preference', () => {
		installMatchMedia(true);
		expect(resolveReducedMotion(true)).toBe(true);
		expect(resolveReducedMotion(false)).toBe(false);
		expect(resolveReducedMotion()).toBe(true);
		globalWithMedia.matchMedia = undefined;
		expect(resolveReducedMotion()).toBe(false);
		expect(resolveReducedMotion(true)).toBe(true);
	});

	it('renders the server snapshot during SSR and lets the client re-read', () => {
		// The SSR document is one static artefact, so the server snapshot
		// is "motion allowed". The client re-reads the real preference at
		// hydration; `useSyncExternalStore` treats the difference as the
		// ordinary store update it is, so this is not a mismatch.
		installMatchMedia(true);
		function Probe() {
			return <span>{usePrefersReducedMotion() ? 'reduced' : 'animated'}</span>;
		}
		expect(renderToStaticMarkup(<Probe />)).toContain('animated');
	});
});
