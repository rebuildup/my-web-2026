/**
 * Guide ledger contract tests (Issue #929).
 *
 * Two halves:
 *   1. Selection semantics — promotion windows, priority, fail-closed
 *      malformed config, internal/external href rules.
 *   2. Route truth — every `site` href and child href must name a
 *      route the router actually serves, and no ledger entry may
 *      point into `/admin*` or another private surface. The route
 *      inventory is read from the GENERATED route tree so a route
 *      rename fails here instead of shipping a dead guide link.
 */

import { describe, expect, it } from 'vitest';
import routeTreeSource from '../../routeTree.gen.ts?raw';
import { GUIDE_LEDGER } from './ledger';
import {
	isExternalGuideHref,
	isInternalGuideHref,
	isPromotionActive,
	selectGuideRows,
} from './select';
import type { GuideEntry } from './ledger';

const TODAY = '2026-11-16';

function entry(overrides: Partial<GuideEntry> & { id: string }): GuideEntry {
	return {
		kind: 'site',
		href: '/about',
		titleJa: 't',
		summaryJa: 's',
		...overrides,
	} as GuideEntry;
}

describe('promotion windows', () => {
	it('is active inside the inclusive window and inactive outside', () => {
		const promo = { startsOn: '2026-11-01', endsOn: '2026-11-30' };
		expect(isPromotionActive(promo, '2026-11-01')).toBe(true);
		expect(isPromotionActive(promo, '2026-11-30')).toBe(true);
		expect(isPromotionActive(promo, '2026-10-31')).toBe(false);
		expect(isPromotionActive(promo, '2026-12-01')).toBe(false);
	});

	it('fails closed on malformed or reversed windows', () => {
		expect(
			isPromotionActive({ startsOn: '2026-11-30', endsOn: '2026-11-01' }, TODAY),
		).toBe(false);
		expect(isPromotionActive({ startsOn: 'x', endsOn: '2026-11-30' }, TODAY)).toBe(false);
		expect(isPromotionActive({ startsOn: '2026-11-01', endsOn: '2026-13-01' }, TODAY)).toBe(
			false,
		);
		expect(isPromotionActive(undefined, TODAY)).toBe(false);
	});
});

describe('selectGuideRows', () => {
	it('marks at most one featured row — the highest priority inside its window', () => {
		const ledger = [
			entry({ id: 'a', promotion: { startsOn: '2026-11-01', endsOn: '2026-11-30' } }),
			entry({
				id: 'b',
				promotion: { startsOn: '2026-11-10', endsOn: '2026-11-20', priority: 5 },
			}),
			entry({ id: 'c' }),
		];
		const rows = selectGuideRows(ledger, TODAY);
		expect(rows.map((r) => r.featured)).toEqual([false, true, false]);
	});

	it('keeps ledger order and never removes permanent entries after a window ends', () => {
		const ledger = [
			entry({ id: 'a', promotion: { startsOn: '2026-01-01', endsOn: '2026-01-31' } }),
			entry({ id: 'b' }),
		];
		const rows = selectGuideRows(ledger, TODAY);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => !r.featured)).toBe(true);
	});
});

describe('href rules', () => {
	it('accepts internal paths and https externals, refuses the rest', () => {
		expect(isInternalGuideHref('/about')).toBe(true);
		expect(isInternalGuideHref('//evil.example')).toBe(false);
		expect(isInternalGuideHref('/\\evil')).toBe(false);
		expect(isInternalGuideHref('https://x')).toBe(false);
		expect(isExternalGuideHref('https://github.com/x')).toBe(true);
		expect(isExternalGuideHref('http://github.com/x')).toBe(false);
		expect(isExternalGuideHref('/about')).toBe(false);
	});
});

describe('shipped ledger vs the route tree', () => {
	// Static `path: '…'` entries in the generated tree. Dynamic
	// segments (`$slug`) are matched by prefix against the pattern.
	const staticPaths = new Set(
		[...routeTreeSource.matchAll(/path: '([^']+)'/g)].map((m) => m[1]),
	);
	const dynamicPrefixes = [...routeTreeSource.matchAll(/path: '([^']*\$[^']*)'/g)].map(
		(m) => m[1],
	);

	function routeExists(href: string): boolean {
		if (staticPaths.has(href)) return true;
		// '/portfolio' is served as '/portfolio/' in the tree.
		if (staticPaths.has(`${href}/`)) return true;
		for (const pattern of dynamicPrefixes) {
			const prefix = pattern.split('$')[0];
			if (href.startsWith(prefix) && href.length > prefix.length) return true;
		}
		return false;
	}

	it('every site entry and child resolves to a real public route', () => {
		for (const item of GUIDE_LEDGER) {
			if (item.kind === 'external') {
				expect(isExternalGuideHref(item.href), item.id).toBe(true);
				continue;
			}
			expect(isInternalGuideHref(item.href), item.id).toBe(true);
			expect(routeExists(item.href), `${item.id} → ${item.href}`).toBe(true);
			for (const child of item.children ?? []) {
				expect(isInternalGuideHref(child.href), child.id).toBe(true);
				expect(routeExists(child.href), `${child.id} → ${child.href}`).toBe(true);
			}
		}
	});

	it('never points into the admin or another private surface', () => {
		for (const item of GUIDE_LEDGER) {
			for (const href of [item.href, ...(item.children ?? []).map((c) => c.href)]) {
				expect(href.startsWith('/admin'), `${item.id} → ${href}`).toBe(false);
			}
		}
	});

	it('has no duplicate ids or hrefs', () => {
		const ids = GUIDE_LEDGER.map((e) => e.id);
		const hrefs = GUIDE_LEDGER.map((e) => e.href);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(hrefs).size).toBe(hrefs.length);
	});
});
