import { describe, expect, it } from 'vitest';
import { Breadcrumbs, resolveBreadcrumbChain } from './Breadcrumbs';
import { BREADCRUMB_ORIGIN, SUPPRESS_BREADCRUMB_LEAF_IDS } from './route-labels';

/**
 * `resolveBreadcrumbChain` unit tests — pure helper coverage.
 *
 * The chain is the single source of truth for both the visible
 * nav and the JSON-LD script, so its edge cases (suppressed
 * leaves, dynamic-label resolution, missing data) are the load-
 * bearing decisions of Issue #173.
 *
 * The test runs on the default Vitest pool (workerd) because the
 * helper takes its `matches` argument as a parameter — there is
 * no `useMatches()` dependency to mock. Component-level rendering
 * tests live in `Breadcrumbs.client.test.tsx` against happy-dom.
 */

interface FakeMatch {
	routeId: string;
	pathname: string;
	params: Record<string, unknown>;
	loaderData: unknown;
}

function match(
	routeId: string,
	pathname: string,
	loaderData: unknown = undefined,
	params: Record<string, unknown> = {},
): FakeMatch {
	return { routeId, pathname, params, loaderData };
}

const root = match('__root__', '/');

describe('resolveBreadcrumbChain — leaf suppression', () => {
	it.each(['/', '/admin/login', '/admin/invitations_/accept', '/design-system'])(
		'suppresses when leaf is %s',
		(leafRouteId) => {
			const chain = resolveBreadcrumbChain([root, match(leafRouteId, leafRouteId)]);
			expect(chain).toBeNull();
		},
	);

	it('exposes the suppressed set as a frozen export so routes can introspect', () => {
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/')).toBe(true);
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/admin/login')).toBe(true);
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/admin/invitations_/accept')).toBe(true);
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/design-system')).toBe(true);
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/admin')).toBe(false);
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/about')).toBe(false);
		expect(SUPPRESS_BREADCRUMB_LEAF_IDS.has('/portfolio')).toBe(false);
	});
});

describe('resolveBreadcrumbChain — chain construction', () => {
	it('returns the static label for a simple top-level route', () => {
		const chain = resolveBreadcrumbChain([root, match('/about', '/about')]);
		expect(chain).toEqual([{ routeId: '/about', label: 'About', href: '/about' }]);
	});

	it('skips unlabeled intermediate matches (e.g. /admin layout)', () => {
		const chain = resolveBreadcrumbChain([
			root,
			match('/admin', '/admin/invitations'),
			match('/admin/invitations', '/admin/invitations'),
		]);
		expect(chain).toEqual([
			{ routeId: '/admin', label: 'Admin', href: '/admin/invitations' },
			{ routeId: '/admin/invitations', label: '招待', href: '/admin/invitations' },
		]);
	});

	it('resolves the /portfolio/$slug label from loaderData.project.title', () => {
		const chain = resolveBreadcrumbChain([
			root,
			match('/portfolio/', '/portfolio/aulymo', undefined, {}),
			match(
				'/portfolio/$slug',
				'/portfolio/aulymo',
				{ project: { title: 'Aulymo', slug: 'aulymo' }, adjacent: {} },
				{ slug: 'aulymo' },
			),
		]);
		expect(chain).toEqual([
			{ routeId: '/portfolio/', label: 'Portfolio', href: '/portfolio/aulymo' },
			{
				routeId: '/portfolio/$slug',
				label: 'Aulymo',
				href: '/portfolio/aulymo',
			},
		]);
	});

	it('falls back to slug when /portfolio/$slug has no project title', () => {
		const chain = resolveBreadcrumbChain([
			root,
			match('/portfolio/', '/portfolio/foo'),
			match(
				'/portfolio/$slug',
				'/portfolio/foo',
				{ project: { title: undefined, slug: 'foo' } },
				{ slug: 'foo' },
			),
		]);
		expect(chain?.[1]?.label).toBe('foo');
	});

	it('resolves /tools/$slug from loaderData.display_name', () => {
		const chain = resolveBreadcrumbChain([
			root,
			match('/tools/', '/tools/multi-slicer'),
			match(
				'/tools/$slug',
				'/tools/multi-slicer',
				{ display_name: 'MultiSlicer', slug: 'multi-slicer' },
				{ slug: 'multi-slicer' },
			),
		]);
		expect(chain).toEqual([
			{ routeId: '/tools/', label: 'Tools', href: '/tools/multi-slicer' },
			{
				routeId: '/tools/$slug',
				label: 'MultiSlicer',
				href: '/tools/multi-slicer',
			},
		]);
	});

	// Issue #196 — TanStack Router emits index route IDs with a
	// trailing slash (`/tools/`, `/portfolio/`). The keys in
	// `ROUTE_LABELS` must match those IDs exactly, or the lookup
	// misses and the breadcrumb chain is empty for `/tools` /
	// `/portfolio`. This is a regression guard for both index
	// routes.
	it('matches /tools/ index routeId (Issue #196 — trailing slash)', () => {
		const chain = resolveBreadcrumbChain([root, match('/tools/', '/tools')]);
		expect(chain).toEqual([{ routeId: '/tools/', label: 'Tools', href: '/tools' }]);
	});

	it('matches /portfolio/ index routeId (Issue #196 — trailing slash)', () => {
		const chain = resolveBreadcrumbChain([root, match('/portfolio/', '/portfolio')]);
		expect(chain).toEqual([{ routeId: '/portfolio/', label: 'Portfolio', href: '/portfolio' }]);
	});

	it('returns null when the only match is root', () => {
		expect(resolveBreadcrumbChain([root])).toBeNull();
	});

	it('returns null when every non-root match is unlabeled', () => {
		// `/admin/` (the admin dashboard) is intentionally unlabeled
		// at the leaf level — only the parent `/admin` contributes.
		const chain = resolveBreadcrumbChain([
			root,
			match('/admin', '/admin'),
			match('/admin/', '/admin/'),
		]);
		// Only `/admin` carries a label, so the chain has one item
		// — the admin dashboard's own breadcrumb is just "Admin".
		expect(chain).toEqual([{ routeId: '/admin', label: 'Admin', href: '/admin' }]);
	});

	it('handles missing loaderData on dynamic routes without throwing', () => {
		const chain = resolveBreadcrumbChain([
			root,
			match('/portfolio/', '/portfolio/x'),
			match('/portfolio/$slug', '/portfolio/x', undefined, { slug: 'x' }),
		]);
		// No resolver output → falls back to the static `Project` label.
		expect(chain?.[1]?.label).toBe('Project');
	});

	it('drops /tools/$slug from the chain when loaderData is undefined (Issue #183)', () => {
		// The route opted into `dropOnMissingLoaderData: true` (see
		// route-labels.ts), so the leaf match is skipped when its
		// loader threw notFound(). The visible chain stops at the
		// intermediate "/tools" segment — surfacing a stub "Tool"
		// segment for a slug that does not exist would mislead the
		// visitor about where they are.
		const chain = resolveBreadcrumbChain([
			root,
			match('/tools/', '/tools/unknown'),
			match('/tools/$slug', '/tools/unknown', undefined, { slug: 'unknown' }),
		]);
		expect(chain).toEqual([{ routeId: '/tools/', label: 'Tools', href: '/tools/unknown' }]);
	});

	it('still includes /tools/$slug in the chain when loaderData is present', () => {
		// Regression guard for the opt-in drop: a real Tool must
		// still appear as the breadcrumb leaf.
		const chain = resolveBreadcrumbChain([
			root,
			match('/tools/', '/tools/prototype'),
			match(
				'/tools/$slug',
				'/tools/prototype',
				{ display_name: 'ProtoType', slug: 'prototype' },
				{
					slug: 'prototype',
				},
			),
		]);
		expect(chain?.[1]?.label).toBe('ProtoType');
	});
});

describe('Breadcrumbs component — module surface', () => {
	it('exports the visible nav primitive', () => {
		expect(typeof Breadcrumbs).toBe('function');
	});

	it('exports the canonical production origin constant', () => {
		expect(BREADCRUMB_ORIGIN).toBe('https://rebuildup.dev');
	});
});
