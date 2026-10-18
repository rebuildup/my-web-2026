import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeEntities, parseHeadTags } from './seo-head-contract.mjs';
import {
	CANONICAL_ORIGIN,
	DESCRIPTION_MAX_LENGTH,
	DYNAMIC_ROUTE_SAMPLES,
	TITLE_MAX_LENGTH,
	buildInventory,
	canonicalPathFor,
	discoverRouteModules,
	evaluateHeadInventory,
	evaluateObservation,
	expectedCanonicalFor,
	isNonPublicPath,
	renderTextReport,
	summarizeHead,
} from './seo-head-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = resolve(HERE, '../src/routes');

/** A fully compliant public head. Each test perturbs exactly one field. */
function goodPublicHead(path) {
	return [
		{ title: `page ${path}` },
		{ name: 'description', content: 'A description long enough to clear the lower bound.' },
		{ property: 'og:url', content: `${CANONICAL_ORIGIN}${path}` },
		{ rel: 'canonical', href: `${CANONICAL_ORIGIN}${path}` },
	];
}

function observationFor(path, tags, extra = {}) {
	return {
		routeId: path,
		path,
		surface: 'public',
		status: 200,
		tags,
		head: summarizeHead(tags),
		expectedCanonical: `${CANONICAL_ORIGIN}${path}`,
		...extra,
	};
}

/** A search-query observation: same document, `?query` appended. */
function queryObservationFor(path, query, tags, extra = {}) {
	return {
		...observationFor(`${path}?${query}`, tags, extra),
		routeId: path,
		path: `${path}?${query}`,
		query,
		queryProbe: true,
		expectedCanonical: `${CANONICAL_ORIGIN}${path}`,
	};
}

function rulesFor(observation, inventoryEntry = null) {
	return evaluateObservation(observation, inventoryEntry).map((f) => f.rule);
}

describe('seo-head-contract: public route policy', () => {
	it('accepts a compliant public head', () => {
		const observation = observationFor('/about', goodPublicHead('/about'));
		assert.deepEqual(rulesFor(observation), []);
	});

	it('detects a duplicate title across two routes', () => {
		const shared = 'rebuildup.dev';
		const result = evaluateHeadInventory({
			inventory: buildInventory([
				{ routeId: '/about', file: 'a' },
				{ routeId: '/contact', file: 'b' },
			]),
			observations: [
				observationFor('/about', [
					{ title: shared },
					{ name: 'description', content: 'About page description text.' },
					{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
				]),
				observationFor('/contact', [
					{ title: shared },
					{ name: 'description', content: 'Contact page description text.' },
					{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/contact` },
				]),
			],
		});
		const duplicates = result.findings.filter((f) => f.rule === 'public.duplicate-title');
		assert.equal(duplicates.length, 1, JSON.stringify(result.findings));
		assert.match(duplicates[0].message, /\/about/);
		assert.match(duplicates[0].message, /\/contact/);
	});

	it('detects a missing canonical', () => {
		const observation = observationFor('/about', [
			{ title: 'About' },
			{ name: 'description', content: 'About page description text.' },
		]);
		assert.ok(rulesFor(observation).includes('public.canonical-missing'));
	});

	it('detects a missing title and description', () => {
		const rules = rulesFor(
			observationFor('/about', [{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` }]),
		);
		assert.ok(rules.includes('public.title-missing'));
		assert.ok(rules.includes('public.description-missing'));
	});

	it('detects a canonical that points at the wrong URL', () => {
		const observation = observationFor('/about', [
			{ title: 'About' },
			{ name: 'description', content: 'About page description text.' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/contact` },
		]);
		const rules = rulesFor(observation);
		assert.ok(rules.includes('public.canonical-mismatch'));
	});

	it('detects a relative canonical', () => {
		const observation = observationFor('/about', [
			{ title: 'About' },
			{ name: 'description', content: 'About page description text.' },
			{ rel: 'canonical', href: '/about' },
		]);
		assert.ok(rulesFor(observation).includes('public.canonical-not-absolute'));
	});

	it('detects a canonical carrying a search query or fragment', () => {
		for (const canonical of [
			`${CANONICAL_ORIGIN}/portfolio?facets=develop`,
			`${CANONICAL_ORIGIN}/portfolio#top`,
		]) {
			const observation = observationFor('/portfolio', [
				{ title: 'Portfolio' },
				{ name: 'description', content: 'Portfolio page description text.' },
				{ rel: 'canonical', href: canonical },
			]);
			assert.ok(
				rulesFor(observation).includes('public.canonical-has-query'),
				`expected canonical-has-query for ${canonical}`,
			);
		}
	});

	it('detects an empty and an over-long title / description', () => {
		const long = 'あ'.repeat(TITLE_MAX_LENGTH + 1);
		const observation = observationFor('/about', [
			{ title: long },
			{ name: 'description', content: 'あ'.repeat(DESCRIPTION_MAX_LENGTH + 1) },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
		]);
		const rules = rulesFor(observation);
		assert.ok(rules.includes('public.title-too-long'));
		assert.ok(rules.includes('public.description-length'));
	});

	it('detects an og:url that disagrees with the canonical', () => {
		const observation = observationFor('/about', [
			{ title: 'About' },
			{ name: 'description', content: 'About page description text.' },
			{ property: 'og:url', content: `${CANONICAL_ORIGIN}/home` },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
		]);
		assert.ok(rulesFor(observation).includes('public.ogurl-mismatch'));
	});

	it('detects a public route that opts out of indexing', () => {
		const observation = observationFor('/about', [
			{ title: 'About' },
			{ name: 'description', content: 'About page description text.' },
			{ name: 'robots', content: 'noindex' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
		]);
		assert.ok(rulesFor(observation).includes('public.unexpected-noindex'));
	});

	it('does not report an identical title on one 404 and one live route', () => {
		const title = 'Not Found';
		const result = evaluateHeadInventory({
			inventory: buildInventory([{ routeId: '/about', file: 'a' }]),
			observations: [
				observationFor('/about', [
					{ title: 'About' },
					{ name: 'description', content: 'About page description text.' },
					{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
				]),
				{
					routeId: '404:portfolio-detail',
					path: '/portfolio/missing-slug',
					surface: 'not-found',
					status: 404,
					tags: [{ title }],
					head: summarizeHead([{ title }]),
				},
			],
		});
		assert.equal(result.findings.filter((f) => f.rule === 'public.duplicate-title').length, 0);
	});
});

describe('seo-head-contract: non-public policy', () => {
	const adminObservation = (tags) => ({
		routeId: '/admin/login',
		path: '/admin/login',
		surface: 'non-public',
		status: 200,
		tags,
		head: summarizeHead(tags),
	});

	it('accepts a noindex admin document', () => {
		const observation = adminObservation([
			{ title: 'Admin' },
			{ name: 'robots', content: 'noindex' },
		]);
		assert.deepEqual(rulesFor(observation), []);
	});

	it('detects an admin document that can be indexed', () => {
		const rules = rulesFor(adminObservation([{ title: 'Admin' }]));
		assert.ok(rules.includes('non-public.missing-noindex'));
	});

	it('detects a canonical declared on an admin document', () => {
		const rules = rulesFor(
			adminObservation([
				{ title: 'Admin' },
				{ name: 'robots', content: 'noindex' },
				{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/admin/login` },
			]),
		);
		assert.ok(rules.includes('non-public.canonical-present'));
	});

	it('does not let a lookalike path inherit the admin policy', () => {
		assert.equal(isNonPublicPath('/admin'), true);
		assert.equal(isNonPublicPath('/admin/login'), true);
		assert.equal(isNonPublicPath('/administrator'), false);
		assert.equal(isNonPublicPath('/about'), false);
	});
});

describe('seo-head-contract: 404 policy', () => {
	const notFound = (tags, status = 404) => ({
		routeId: '404:portfolio-detail',
		path: '/portfolio/missing-slug',
		surface: 'not-found',
		status,
		tags,
		head: summarizeHead(tags),
	});

	it('accepts a 404 with no canonical', () => {
		assert.deepEqual(rulesFor(notFound([{ title: 'Not Found' }])), []);
	});

	it('detects a canonical on a 404', () => {
		const rules = rulesFor(
			notFound([
				{ title: 'Not Found' },
				{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/portfolio/x` },
			]),
		);
		assert.ok(rules.includes('not-found.canonical-present'));
	});

	it('detects a 404 that asks to be indexed', () => {
		assert.ok(
			rulesFor(notFound([{ name: 'robots', content: 'index, follow' }])).includes(
				'not-found.indexable',
			),
		);
	});

	it('detects a probe that did not actually 404', () => {
		assert.ok(rulesFor(notFound([], 200)).includes('not-found.not-404'));
	});

	it('fails a probe that produced no response at all (never a silent pass)', () => {
		// `status: null` is what an unreadable request leaves behind.
		// Reading "no status" as "nothing to check" is exactly the
		// silent pass the gate exists to prevent: an operator running
		// --live against an origin where only these two URLs fail to
		// resolve would otherwise read two green "the 404 policy is
		// fine" rows that were never tested.
		const rules = rulesFor(notFound([], null));
		assert.ok(rules.includes('not-found.not-404'), JSON.stringify(rules));
		const [first] = evaluateObservation(notFound([], null));
		assert.match(first.message, /no response/);
	});

	it('reports a request that errored as its own finding, not as missing metadata', () => {
		const failed = (extra) => ({
			routeId: '/about',
			path: '/about',
			surface: 'public',
			status: null,
			tags: [],
			head: summarizeHead([]),
			requestFailed: true,
			requestError: 'fetch failed',
			...extra,
		});
		// One network error, one finding: attributing it to
		// title/description/canonical would report three metadata
		// defects for a document that never arrived.
		assert.deepEqual(rulesFor(failed()), ['observation.request-failed']);
		assert.deepEqual(rulesFor(failed({ surface: 'not-found', routeId: '404:tool-detail' })), [
			'observation.request-failed',
		]);
		assert.deepEqual(
			rulesFor({
				...failed({ routeId: '/portfolio', path: '/portfolio?facets=develop' }),
				queryProbe: true,
			}),
			['observation.request-failed'],
		);
		const [finding] = evaluateObservation(failed());
		assert.equal(finding.severity, 'error');
		assert.match(finding.message, /GET \/about failed: fetch failed/);
	});
});

describe('seo-head-contract: coverage (no silent pass)', () => {
	it('fails when a discovered route was never observed', () => {
		const inventory = buildInventory([
			{ routeId: '/about', file: 'a' },
			{ routeId: '/contact', file: 'b' },
		]);
		const result = evaluateHeadInventory({
			inventory,
			observations: [
				observationFor('/about', [
					{ title: 'About' },
					{ name: 'description', content: 'About page description text.' },
					{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
				]),
			],
		});
		const unobserved = result.findings.filter((f) => f.rule === 'inventory.unobserved');
		assert.equal(unobserved.length, 1);
		assert.equal(unobserved[0].routeId, '/contact');
	});

	it('fails when a dynamic route declares no sample', () => {
		const inventory = buildInventory([{ routeId: '/portfolio/$slug', file: 'a' }], {});
		const result = evaluateHeadInventory({
			inventory,
			observations: [
				observationFor('/portfolio/anything', [
					{ title: 'Project' },
					{ name: 'description', content: 'Project description text.' },
					{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/portfolio/anything` },
				]),
			],
		});
		assert.equal(result.findings.filter((f) => f.rule === 'inventory.dynamic-no-sample').length, 1);
	});

	it('does not count a skipped route as a public duplicate', () => {
		const result = evaluateHeadInventory({
			inventory: buildInventory([
				{ routeId: '/about', file: 'a' },
				{ routeId: '/portfolio/$slug', file: 'b' },
			]),
			observations: [
				observationFor('/about', [
					{ title: 'Same title' },
					{ name: 'description', content: 'About page description text.' },
					{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/about` },
				]),
				{
					routeId: '/portfolio/$slug',
					path: '/portfolio/my-web-2026',
					surface: 'public',
					status: null,
					skipped: true,
					tags: [{ title: 'Same title' }],
					head: summarizeHead([{ title: 'Same title' }]),
					findings: [],
				},
			],
		});
		assert.equal(result.findings.filter((f) => f.rule === 'public.duplicate-title').length, 0);
	});
});

describe('seo-head-contract: search-query policy', () => {
	it('flags a query URL that canonicalizes elsewhere', () => {
		const base = observationFor('/portfolio', [
			{ title: 'Portfolio' },
			{ name: 'description', content: 'Portfolio page description text.' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/portfolio` },
		]);
		const query = queryObservationFor('/portfolio', 'facets=develop', [
			{ title: 'Portfolio' },
			{ name: 'description', content: 'Portfolio page description text.' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/portfolio?facets=develop` },
		]);
		const result = evaluateHeadInventory({
			inventory: buildInventory([{ routeId: '/portfolio', file: 'a' }]),
			observations: [base, query],
		});
		const rules = result.findings.map((f) => f.rule);
		assert.ok(rules.includes('public.canonical-has-query'));
		assert.ok(rules.includes('public.query-canonical-mismatch'));
		// Same title on the query URL is the same document, not a duplicate.
		assert.ok(!rules.includes('public.duplicate-title'));
	});

	it('accepts a query URL that canonicalizes to the query-free URL', () => {
		const tags = [
			{ title: 'Portfolio' },
			{ name: 'description', content: 'Portfolio page description text.' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/portfolio` },
		];
		const result = evaluateHeadInventory({
			inventory: buildInventory([{ routeId: '/portfolio', file: 'a' }]),
			observations: [
				observationFor('/portfolio', tags),
				queryObservationFor('/portfolio', 'facets=develop', tags),
			],
		});
		assert.deepEqual(
			result.findings.filter((f) => f.rule !== 'public.duplicate-title').map((f) => f.rule),
			[],
		);
	});
});

describe('seo-head-contract: head normalization', () => {
	it('treats rendered HTML and the TanStack tag shape identically', () => {
		const html = `<!doctype html><html><head>
<meta charSet="utf-8"/>
<title>  Portfolio
 — rebuildup.dev  </title>
<meta name="description" content="Portfolio &amp; friends" />
<meta property="og:url" content="https://rebuildup.dev/portfolio" />
<link rel="canonical" href="https://rebuildup.dev/portfolio" />
</head><body></body></html>`;
		const fromHtml = summarizeHead(parseHeadTags(html));
		const fromRoute = summarizeHead([
			{ title: 'Portfolio — rebuildup.dev' },
			{ name: 'description', content: 'Portfolio & friends' },
			{ property: 'og:url', content: 'https://rebuildup.dev/portfolio' },
			{ rel: 'canonical', href: 'https://rebuildup.dev/portfolio' },
		]);
		assert.deepEqual(fromHtml, fromRoute);
		assert.equal(fromHtml.description, 'Portfolio & friends');
		assert.equal(fromHtml.canonical, 'https://rebuildup.dev/portfolio');
	});

	it('keeps the deepest title and first robots of a merged head (deepest-route-wins)', () => {
		// `buildTagsFromMatches` dedupes `meta` deepest-first, so a
		// route's own title renders BEFORE the root fallback it
		// overrides, and first-in-document is what a crawler reads.
		const summary = summarizeHead([
			{ title: 'Portfolio — rebuildup.dev' },
			{ title: 'my-web-2026' },
			{ name: 'robots', content: 'noindex' },
		]);
		assert.equal(summary.title, 'Portfolio — rebuildup.dev');
		assert.equal(summary.robots, 'noindex');
	});

	it('renders two canonicals root-first, so the summary reads the root one', () => {
		// Pinned because it is the assumption a future
		// `src/routes/__root.tsx` canonical would silently violate:
		// links are flat-mapped root-first by the router (unlike
		// meta), so the ROOT's canonical would be what every route
		// resolves to and reported against.
		const summary = summarizeHead([
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/` },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/portfolio` },
		]);
		assert.equal(summary.canonical, `${CANONICAL_ORIGIN}/`);
	});

	it('decodes numeric and named entities', () => {
		assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x4e2d;'), "a & b 'c' 中");
	});
});

describe('seo-head-contract: route discovery against the real src/routes', () => {
	const modules = discoverRouteModules(ROUTES_DIR);
	const inventory = buildInventory(modules);

	it('discovers every routed module and skips colocated components', () => {
		const ids = inventory.map((entry) => entry.routeId);
		for (const expected of [
			'/',
			'/about',
			'/contact',
			'/design-system',
			'/portfolio/',
			'/portfolio/$slug',
			'/tools/',
			'/tools/$slug',
			'/admin',
			'/admin/login',
		]) {
			assert.ok(
				ids.includes(expected),
				`expected discovered route ${expected} in ${ids.join(', ')}`,
			);
		}
		// `src/routes/design-system/**` holds colocated page
		// components; they must not become inventory entries.
		assert.ok(!ids.some((id) => id.includes('DesignSystemPage')));
		assert.ok(inventory.every((entry) => entry.file.endsWith('.tsx')));
	});

	it('declares a sample for every dynamic route (otherwise the gate would skip it)', () => {
		for (const entry of inventory.filter((candidate) => candidate.dynamic)) {
			assert.ok(entry.sample, `dynamic route ${entry.routeId} has no sample`);
			assert.ok(DYNAMIC_ROUTE_SAMPLES[entry.routeId].segment.length > 0);
			assert.ok(!entry.expectedCanonical.includes('UNSAMPLED'));
		}
	});

	it('normalizes canonical paths: no trailing slash, params substituted', () => {
		assert.equal(canonicalPathFor('/'), '/');
		assert.equal(canonicalPathFor('/portfolio/'), '/portfolio');
		assert.equal(canonicalPathFor('/tools/$slug', 'prototype'), '/tools/prototype');
		assert.equal(expectedCanonicalFor('/about'), `${CANONICAL_ORIGIN}/about`);
	});

	it('keeps one inventory entry per requestable URL (layout + index are one route)', () => {
		// `src/routes/admin.tsx` and `src/routes/admin.index.tsx`
		// both normalize to `/admin`. One URL is one document to
		// check; reporting both would fetch it twice and, once such a
		// pair is PUBLIC, raise a duplicate title against itself.
		const merged = buildInventory([
			{ routeId: '/admin', file: 'src/routes/admin.tsx' },
			{ routeId: '/admin/', file: 'src/routes/admin.index.tsx' },
		]);
		assert.equal(merged.length, 1);
		assert.equal(merged[0].path, '/admin');
		assert.equal(merged[0].routeId, '/admin');

		const publicPair = buildInventory([
			{ routeId: '/portfolio', file: 'src/routes/portfolio.tsx' },
			{ routeId: '/portfolio/', file: 'src/routes/portfolio/index.tsx' },
			{ routeId: '/portfolio/$slug', file: 'src/routes/portfolio/$slug.tsx' },
		]);
		assert.deepEqual(
			publicPair.map((entry) => entry.path),
			['/portfolio', '/portfolio/my-web-2026'],
		);

		// The real tree: exactly one `/admin` entry, no duplicates.
		const paths = inventory.map((entry) => entry.path);
		assert.equal(new Set(paths).size, paths.length, `duplicate paths: ${paths.join(', ')}`);
	});
});

describe('seo-head-contract: report rendering', () => {
	it('prints a verdict and the findings for every observed route', () => {
		const inventory = buildInventory([{ routeId: '/about', file: 'a' }]);
		const result = evaluateHeadInventory({
			inventory,
			observations: [observationFor('/about', [{ title: 'About' }])],
		});
		const text = renderTextReport(result);
		assert.match(text, /FAIL\s+\/about/);
		assert.match(text, /public\.canonical-missing/);
		assert.match(text, /public\.description-missing/);
	});

	it('states that a row was not fetched instead of omitting the status line', () => {
		const result = evaluateHeadInventory({
			inventory: buildInventory([{ routeId: '/about', file: 'a' }]),
			observations: [
				observationFor('/about', [{ title: 'About' }], {
					status: null,
					requestFailed: true,
					requestError: 'fetch failed',
				}),
			],
		});
		const text = renderTextReport(result);
		assert.match(text, /FAIL\s+\/about/);
		assert.match(text, /status\s+\(not fetched\)/);
		assert.match(text, /!! \[observation\.request-failed\]/);
	});
});
