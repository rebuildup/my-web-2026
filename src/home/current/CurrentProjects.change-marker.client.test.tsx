import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CurrentProjects } from './CurrentProjects';
import type { CurrentProjectRecord } from './types';
import { CHANGE_SIGNATURE_STORAGE_KEY } from './use-changed-projects';

/**
 * The change marker's non-colour cue (Issue #887).
 *
 * `CurrentProjects.test.tsx` pins the SSR document, and the marker is
 * deliberately absent from it — it is a client-only fact about what THIS
 * browser saw last time, so it can only be asserted after hydration. That
 * is what this file is for: the DOM test the SSR smoke test cannot be.
 *
 * Why the assertion is about CLASSES and not about colour: direction B
 * removed the hue the marker used to carry (`text.accent` was brand blue,
 * now ink), and the replacement cue has to be a shape the reader can see
 * without the hue. The marker is also NOT a link, so an underline would
 * promise navigation it cannot deliver — the cue is a raised chip
 * (`bg.surface` + full radius + padding) next to the word that states the
 * fact. This test fails if either half regresses: a chip that loses its
 * fill, or an underline that turns a status word into a fake link.
 *
 * The store is replaced rather than trusted for the same reason the
 * analytics fixtures replace it: the assertion is about what the browser
 * holds, so the test owns the store instead of inheriting the
 * environment's (happy-dom's `localStorage` is not the browser's).
 */
const record = {
	id: 'p1',
	name: 'Demo',
	statusJa: '進行中',
	link: { href: 'https://example.com', label: 'repo' },
} as unknown as CurrentProjectRecord;

let storageFixture: ReturnType<typeof installFakeStorage>;

/**
 * Replaces `globalThis.localStorage` with an in-memory store.
 *
 * The same fixture pattern `analytics-mount.client.test.tsx` and
 * `AnalyticsConsent.client.test.tsx` use, so one test never reads a store
 * another test wrote.
 */
function installFakeStorage() {
	const values = new Map<string, string>();
	const storage = {
		get length() {
			return values.size;
		},
		key(index: number) {
			return [...values.keys()][index] ?? null;
		},
		getItem(key: string) {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			values.set(key, String(value));
		},
		removeItem(key: string) {
			values.delete(key);
		},
		clear() {
			values.clear();
		},
	};
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', {
		value: storage,
		configurable: true,
		writable: true,
	});
	return {
		values,
		remove() {
			if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		},
	};
}

afterEach(() => {
	storageFixture?.remove();
});

describe('Issue #887 — the change marker carries shape, not hue', () => {
	it('renders the marker as a raised chip and never as an underline', () => {
		storageFixture = installFakeStorage();
		// An empty (but object-shaped) store makes every project count as
		// "appeared since last visit", which is the branch that renders the
		// marker at all — see `changedProjectIds`.
		storageFixture.values.set(CHANGE_SIGNATURE_STORAGE_KEY, JSON.stringify({}));

		render(<CurrentProjects projects={[record]} today="2026-11-04" />);

		const marker = document.querySelector('[data-testid="home-current-project-changed"]');
		expect(marker, 'the marker renders after hydration').toBeTruthy();
		const className = (marker as HTMLElement).className;

		// The shape half of the cue: a raised, rounded, padded chip.
		expect(className).toContain('bg-c_bg.surface');
		expect(className).toContain('bdr_full');
		expect(className).toContain('px_2');
		expect(className).toContain('py_1');

		// Not a link, so no underline: an underline here would promise
		// navigation the marker cannot deliver.
		expect(className).not.toMatch(/(^|\s)td_|\bunderline\b/);
	});
});
