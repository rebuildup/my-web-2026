import { describe, expect, it } from 'vitest';
import { isActiveRoute, PUBLIC_NAV_ITEMS } from './PublicNav';

/**
 * `isActiveRoute` — pure predicate powering the nav's `aria-current`
 * attribute (Issue #168).
 *
 * The contract:
 *   - `/` is active only when the current path is exactly `/`
 *     (otherwise every page would highlight Home as well).
 *   - `/<segment>` is active when the current path is exactly the
 *     segment OR starts with `/<segment>/`. This covers both
 *     `/tools` and `/tools/prototype`.
 *
 * The predicate is the public, observable part of the nav — the
 * rest of the component is presentational chrome over it. Keeping
 * the predicate pure and exported lets the entire surface be unit
 * tested without rendering React.
 */
describe('isActiveRoute — public nav active-route predicate', () => {
	it('highlights / only when the path is exactly /', () => {
		expect(isActiveRoute('/', '/')).toBe(true);
		expect(isActiveRoute('/portfolio', '/')).toBe(false);
		expect(isActiveRoute('/tools', '/')).toBe(false);
		expect(isActiveRoute('/about', '/')).toBe(false);
		expect(isActiveRoute('/contact', '/')).toBe(false);
		expect(isActiveRoute('/admin', '/')).toBe(false);
	});

	it('highlights /portfolio for the list and the slug detail', () => {
		expect(isActiveRoute('/portfolio', '/portfolio')).toBe(true);
		expect(isActiveRoute('/portfolio/aurorae', '/portfolio')).toBe(true);
		expect(isActiveRoute('/portfolio/aurorae/deep', '/portfolio')).toBe(true);
	});

	it('does NOT highlight /portfolio for /portfolioxyz (no separator)', () => {
		// Prefix-matching must require the `/` separator so
		// `/portfolioxyz` does not falsely light up Portfolio.
		expect(isActiveRoute('/portfolioxyz', '/portfolio')).toBe(false);
	});

	it('highlights /tools for the index and any tool slug', () => {
		expect(isActiveRoute('/tools', '/tools')).toBe(true);
		expect(isActiveRoute('/tools/prototype', '/tools')).toBe(true);
		expect(isActiveRoute('/tools/text-counter', '/tools')).toBe(true);
	});

	it('highlights /about and /contact for the exact segment', () => {
		expect(isActiveRoute('/about', '/about')).toBe(true);
		expect(isActiveRoute('/contact', '/contact')).toBe(true);
		expect(isActiveRoute('/about/me', '/about')).toBe(true);
		expect(isActiveRoute('/contact/me', '/contact')).toBe(true);
	});

	it('does not cross-match unrelated segments', () => {
		expect(isActiveRoute('/tools', '/portfolio')).toBe(false);
		expect(isActiveRoute('/about', '/contact')).toBe(false);
		expect(isActiveRoute('/portfolio', '/about')).toBe(false);
	});

	it('PUBLIC_NAV_ITEMS covers the documented canonical roster', () => {
		const targets = PUBLIC_NAV_ITEMS.map((i) => i.to);
		expect(targets).toEqual(['/', '/portfolio', '/tools', '/about', '/contact']);
	});
});
