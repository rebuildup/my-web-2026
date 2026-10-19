import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WAITING_STATE_COPY, WaitingSurface } from './WaitingState';
import waitingSurfaceSource from './WaitingState.tsx?raw';

/**
 * SSR markup contract for the waiting surface (Issue #489).
 *
 * Acceptance condition under test: 「画面が永続白紙にならず情報/再試行が
 * ある」. The renderer is `react-dom/server` — the same renderer the
 * Worker uses — so a surface that renders readable markup in this suite
 * renders readable markup in a streamed document, and a visitor whose
 * connection stalls mid-navigation gets words rather than an empty
 * outlet.
 *
 * Three things are pinned here, and each one can fail silently:
 *
 *   1. the surface publishes INFORMATION (a status region with text), so
 *      the measurement script's `[data-testid="waiting-state"]` probe is
 *      reading the real contract and not a marker that happens to match;
 *   2. the retry control is a REAL anchor with the destination href and
 *      carries NO click handler — the same progressive-enhancement rule
 *      `src/editorial/error-states/ErrorState.test.tsx` pins for the
 *      failure surfaces;
 *   3. the surface adds no motion: an animated element here would be a
 *      motion surface `scripts/check-reduced-motion.mjs` governs, and the
 *      waiting state has to stay legible on the slowest possible link.
 */
describe('WaitingSurface', () => {
	const markup = renderToStaticMarkup(<WaitingSurface retryHref="/portfolio?facets=develop" />);

	it('names itself as the router pending surface', () => {
		expect(markup).toContain('data-testid="waiting-state"');
		expect(markup).toContain('data-waiting-surface="router-pending"');
		expect(markup).toContain('aria-busy="true"');
	});

	it('publishes a status region with readable text', () => {
		// `<output>` is the element this platform ships for a polite
		// status message: its implicit ARIA role is `status`, which is
		// what makes the wait announced without stealing focus.
		expect(markup).toContain('<output');
		expect(markup).not.toMatch(/<output[^>]*role=/i);
		expect(markup).toContain('読み込み中');
		expect(markup).toContain('Loading this page');
		expect(markup).toContain('The connection is slow');
	});

	it('offers the retry control as a plain anchor at the destination', () => {
		expect(markup).toContain('data-waiting-action="retry"');
		expect(markup).toContain('href="/portfolio?facets=develop"');
		expect(markup).toContain('Try again');
	});

	it('wires no click handler, so the control works without the router', () => {
		expect(markup).not.toMatch(/<a[^>]*onclick/i);
		expect(markup).not.toMatch(/<button/i);
	});

	it('emits no motion', () => {
		// Panda CSS emits ABBREVIATED atomic class names, not property
		// names: a `transition` or `animation` declaration would render as
		// `trs_…` / `anim_…`, so asserting on the full words in the markup
		// alone would pass for a surface that animates. Assert both the
		// emitted utilities and the declaration that produces them.
		expect(markup).not.toMatch(/\b(?:trs|anim)_/);
		expect(waitingSurfaceSource).not.toMatch(/\b(?:transition|animation|@keyframes)\b/);
	});

	it('emits no heading element — the waiting surface is not the page', () => {
		expect(markup).not.toMatch(/<h1/i);
		expect(markup).not.toMatch(/<h2/i);
	});

	it('publishes no invented progress, retry count or duration', () => {
		for (const needle of ['%', '秒', 'second', 'retrying', '試行回数']) {
			expect(WAITING_STATE_COPY.description).not.toContain(needle);
		}
	});
});
