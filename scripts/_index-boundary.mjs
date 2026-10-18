/**
 * Index boundary contract — pure logic, no filesystem access (Issue #423).
 *
 * Why this module exists
 * ----------------------
 * Search-engine "index" state is decided in TWO independent places, and
 * they only work together:
 *
 *   1. `public/robots.txt` — a CRAWLER instruction evaluated before the
 *      document is fetched. `Disallow` keeps a URL out of the crawl.
 *   2. the document's own `<meta name="robots">` — an INDEX instruction
 *      evaluated after the document is fetched.
 *
 * Mixing them up is the classic failure this module makes impossible to
 * ship silently:
 *
 *   - A `noindex` page that is ALSO `Disallow`ed can never be
 *     de-indexed, because the crawler is not allowed to fetch the page
 *     that carries the `noindex`. Google then reports the URL as
 *     "Indexed, though blocked by robots.txt".
 *   - `Disallow` is NOT access control. `robots.txt` is a public file
 *     served to anonymous clients; `curl`, a browser, or a scraper
 *     ignores it entirely. Only the server-side gate (the admin
 *     loaders' `requireAdmin()`, the API-key middleware) protects a
 *     secret surface. This module therefore never emits a rule that
 *     would make the admin subtree reachable — it only adds crawler
 *     hygiene on top of the existing server-side gate.
 *
 * The contract is EXHAUSTIVE on purpose. `ROUTE_INTENT` below covers
 * every route in the generated route tree; a route that is added and
 * not classified here is a hard failure (`unclassified-route`), not a
 * silent pass. That is the whole point: an index boundary nobody
 * reviewed is indistinguishable from no boundary at all.
 *
 * `public/robots.txt` and `public/sitemap.xml` are GENERATED from this
 * module (`--write`) and verified byte-for-byte by the default check,
 * so the committed artefacts can never drift from the contract.
 *
 * Consumers:
 *   - `scripts/check-index-boundary.mjs` (CLI / gate)
 *   - `scripts/check-index-boundary.test.mjs` (node:test fixtures)
 */

import { PRODUCTION_BETTER_AUTH_URL } from './_cloudflare-contract.mjs';

/**
 * Canonical public origin. Imported, never restated: ADR-0014 makes
 * `https://rebuildup.dev` the only production origin, and
 * `_cloudflare-contract.mjs` already derives it from
 * `PRODUCTION_CUSTOM_DOMAIN`. A `*.workers.dev` URL here would make
 * the sitemap advertise the debug host to every crawler.
 */
export const CANONICAL_ORIGIN = PRODUCTION_BETTER_AUTH_URL;

/** Sitemap path served from `public/`. */
export const SITEMAP_PATH = '/sitemap.xml';

/** robots.txt path served from `public/`. */
export const ROBOTS_PATH = '/robots.txt';

/**
 * Paths owned by the Hono external boundary (`EXTERNAL_BOUNDARY_PREFIXES`
 * in `src/server.ts`). They are machine endpoints, not documents: no
 * HTML, no crawler value, and they must never appear in the sitemap.
 *
 * Kept as data here (not re-derived by importing `src/server.ts`) so
 * the check stays a Node-only script; the CLI asserts the two lists
 * agree by reading `src/server.ts` and failing when they diverge.
 */
export const EXTERNAL_BOUNDARY_PREFIXES = Object.freeze([
	'/api/v1',
	'/webhooks',
	'/oauth',
	'/integrations',
]);

/**
 * Framework-internal endpoints TanStack Start mounts on its own.
 * `/_serverFn/*` carries server-function payloads; there is no document
 * to index and no reason to spend crawl budget on it.
 */
export const FRAMEWORK_PREFIXES = Object.freeze(['/_serverFn']);

/**
 * Route files that must declare the `noindex` meta themselves.
 *
 * The admin subtree is one layout route (`src/routes/admin.tsx`) with
 * six children. TanStack Router merges `head().meta` along the matched
 * route chain (child wins on attribute collision, see
 * `buildTagsFromMatches` in `@tanstack/react-router`), so ONE
 * declaration on the layout covers `/admin`, `/admin/login`,
 * `/admin/keys`, `/admin/images`, `/admin/invitations`,
 * `/admin/invitations/accept` and `/admin/emoji-catalog`.
 *
 * Listing the owner as a ROUTE (rather than "any admin route must
 * mention noindex") keeps the static check meaningful: duplicating the
 * meta into seven files is drift, and a file that merely mentions the
 * word in a comment would be a false pass. The module path itself is
 * derived from the route inventory, so the constant and the route tree
 * cannot disagree.
 */
export const NOINDEX_META_OWNER_ROUTE = '/admin';

/**
 * How a route is indexed. One entry per route path (or path prefix).
 *
 *   zone   'public'  — a page for anonymous readers.
 *          'private' — a surface that must not be indexed at all
 *                      (admin gate, Tool shells marked noindex upstream).
 *   crawl  'allow'   — may be fetched. Required for any page whose
 *                      index intent is carried by HTML meta: a crawler
 *                      cannot read a `noindex` it is not allowed to fetch.
 *          'disallow'— `Disallow` in robots.txt (crawl budget hygiene).
 *   index  'sitemap' — indexable AND listed in `sitemap.xml`.
 *          'crawl'   — indexable but not listed; discovered by following
 *                      links from its index page (parameterised routes
 *                      whose concrete URLs exist only in D1).
 *          'no'      — must not be indexed; enforced by the document's
 *                      own `noindex` meta, never by `Disallow`.
 */
const ROUTE_INTENT = [
	{
		paths: ['/'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Canonical home surface.',
	},
	{
		paths: ['/about'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Public profile page.',
	},
	{
		paths: ['/contact'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Public contact channels.',
	},
	{
		paths: ['/design-system'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Public design-system reference (declares its own canonical).',
	},
	{
		paths: ['/portfolio'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Public portfolio index.',
	},
	{
		paths: ['/portfolio/$slug'],
		zone: 'public',
		crawl: 'allow',
		index: 'crawl',
		reason:
			'Project pages are indexable, but their concrete URLs come from D1 and cannot be ' +
			'enumerated into a static sitemap. They are discovered by crawling /portfolio.',
	},
	{
		paths: ['/tools'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Public Tool index.',
	},
	{
		paths: ['/tools/$slug'],
		zone: 'private',
		crawl: 'allow',
		index: 'no',
		reason:
			'Tool pages already ship `robots: noindex` in their route head (src/routes/tools.$slug.tsx). ' +
			'They must stay crawlable: Disallow would hide the noindex from the crawler and leave the ' +
			'URL indexed-without-content.',
	},
	{
		paths: ['/admin'],
		zone: 'private',
		crawl: 'disallow',
		index: 'no',
		reason:
			'Admin gate. Server-side requireAdmin() is the access control; robots.txt only keeps the ' +
			'crawl out of a surface that no reader should ever reach.',
	},
];

/** Flatten `ROUTE_INTENT` into a lookup keyed by normalised path. */
export const ROUTE_INTENT_BY_PATH = Object.freeze(
	Object.fromEntries(
		ROUTE_INTENT.flatMap((entry) =>
			entry.paths.map((path) => [
				path,
				Object.freeze({
					path,
					zone: entry.zone,
					crawl: entry.crawl,
					index: entry.index,
					reason: entry.reason,
				}),
			]),
		),
	),
);

/**
 * Route-tree paths whose declared intent is inherited by prefix.
 *
 * `/admin` is a layout route whose children (`/admin/keys`, …) are
 * separate entries in the generated tree. Classifying the subtree by
 * prefix means a newly added admin child inherits the gate's intent
 * instead of failing the build — while a newly added PUBLIC route
 * still fails loudly (`unclassified-route`), which is the direction
 * that matters.
 */
const INTENT_PREFIXES = Object.freeze(['/admin']);

/** `/portfolio/` and `/tools/` normalise to `/portfolio` and `/tools`. */
export function normalizeRoutePath(path) {
	if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
	return path;
}

/**
 * Repo-relative candidates for a generated route-tree import specifier.
 *
 * `src/routeTree.gen.ts` imports `./routes/index` with NO extension, so
 * a reader has to resolve it. The candidate order is the project's own
 * (tsx before ts), and the first existing file wins — the caller
 * decides what "missing" means.
 */
export function routeModuleCandidates(specifier) {
	const base = specifier.startsWith('./') ? `src/${specifier.slice(2)}` : specifier;
	return ['.tsx', '.ts', '.jsx', '.js'].map((extension) => `${base}${extension}`);
}

/**
 * Parse the generated route tree (`src/routeTree.gen.ts`).
 *
 * Only two generated blocks are read, both stable across TanStack
 * Router versions:
 *
 *   - the `Route as XRouteImport } from './routes/…'` import block,
 *     which maps a route variable to its source file;
 *   - `export interface FileRoutesByFullPath { '/path': typeof XRoute }`,
 *     the router's own full-path inventory.
 *
 * Reading the GENERATED tree (rather than globbing `src/routes/**`)
 * means the inventory can never contain a route the router does not
 * serve, and never misses one it does.
 *
 * @returns {{routes: Array<{path: string, file: string}>}}
 */
export function parseRouteTree(source) {
	const importBlock = new Map();
	const importPattern = /import \{ Route as (\w+) \} from '(\.\/routes\/[^']+)'/g;
	for (const match of source.matchAll(importPattern)) {
		importBlock.set(match[1], match[2]);
	}

	// `const IndexRoute = IndexRouteImport.update({…})` binds the LOCAL
	// route variable to the imported module alias. `FileRoutesByFullPath`
	// names the local variable, so the alias has to be resolved through
	// this second map before a source file can be attributed.
	const localToAlias = new Map();
	for (const match of source.matchAll(/^const (\w+) = (\w+)\.update\(\{/gm)) {
		localToAlias.set(match[1], match[2]);
	}
	// Layout routes are re-exported as `<Name>WithChildren`
	// (`const AdminRouteWithChildren = AdminRoute._addFileChildren(…)`),
	// and the generated interfaces reference THAT name. Follow the link
	// instead of special-casing it at the call site.
	const localToSource = new Map();
	for (const match of source.matchAll(/^const (\w+) = (\w+)\._addFileChildren\(/gm)) {
		localToSource.set(match[1], match[2]);
	}

	/** Resolve a local route variable to its `src/routes/...` module. */
	function resolveRouteFile(localName) {
		const seen = new Set();
		let name = localName;
		while (name && !seen.has(name)) {
			seen.add(name);
			const direct = importBlock.get(name);
			if (direct) return direct;
			const alias = localToAlias.get(name);
			if (alias && alias !== name) {
				name = alias;
				continue;
			}
			const owner = localToSource.get(name);
			if (owner && owner !== name) {
				name = owner;
				continue;
			}
			name = undefined;
		}
		return null;
	}

	const fullPathBlock = /export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/.exec(source);
	if (!fullPathBlock) {
		throw new Error('routeTree.gen.ts: FileRoutesByFullPath block not found');
	}

	const byPath = new Map();
	for (const match of fullPathBlock[1].matchAll(/^\s*'([^']+)':\s*typeof (\w+)\s*$/gm)) {
		const routePath = normalizeRoutePath(match[1]);
		const localName = match[2];
		const file = resolveRouteFile(localName);
		if (!file) {
			throw new Error(`routeTree.gen.ts: no import found for route variable ${localName}`);
		}
		const existing = byPath.get(routePath);
		if (existing) existing.files.push(file);
		else byPath.set(routePath, { path: routePath, files: [file] });
	}

	const routes = [...byPath.values()]
		.map(({ path, files }) => {
			// A layout route and its index child share one full path
			// (`/admin` is `admin.tsx` + `admin.index.tsx`). The LAYOUT
			// module is the head owner — it is the one whose `head().meta`
			// covers the whole matched chain — so the fewest-segments
			// module wins, with a lexicographic tie-break for stability.
			const sorted = [...files].sort(
				(a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
			);
			return { path, file: sorted[0], extraFiles: sorted.slice(1) };
		})
		.sort((a, b) => a.path.localeCompare(b.path));

	return { routes };
}

/** Intent lookup with prefix inheritance for the gated subtrees. */
export function intentForRoute(path) {
	const exact = ROUTE_INTENT_BY_PATH[path];
	if (exact) return exact;
	for (const prefix of INTENT_PREFIXES) {
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			return Object.freeze({
				path,
				zone: 'private',
				crawl: 'disallow',
				index: 'no',
				reason: `Inherits the ${prefix} gate intent (prefix rule).`,
			});
		}
	}
	return null;
}

/**
 * Cross-check the route inventory against `ROUTE_INTENT`.
 *
 * Both directions are violations:
 *   - `unclassified-route` — a shipped route with no declared intent.
 *   - `stale-intent`      — an intent entry for a route the router no
 *                           longer serves (deleted or renamed route).
 *
 * @returns {Array<{code: string, message: string}>}
 */
export function classifyRoutes(routes) {
	const violations = [];
	const classified = [];

	for (const route of routes) {
		const intent = intentForRoute(route.path);
		if (!intent) {
			violations.push({
				code: 'unclassified-route',
				message: `route ${route.path} (${route.file}) has no entry in ROUTE_INTENT — add its index intent, or the route ships with an unreviewed index boundary`,
			});
			continue;
		}
		classified.push({ ...route, intent });
	}

	// Which module owns the `head().meta` for a route. A child of a
	// gated layout inherits it from the layout module at runtime, so the
	// static check reads the layout module rather than demanding the
	// same declaration seven times.
	const fileByPath = new Map(classified.map((route) => [route.path, route.file]));
	for (const route of classified) {
		const inheritedPrefix = INTENT_PREFIXES.find((prefix) => route.path.startsWith(`${prefix}/`));
		route.metaFile = inheritedPrefix ? (fileByPath.get(inheritedPrefix) ?? route.file) : route.file;
	}

	const knownPaths = new Set(routes.map((route) => route.path));
	for (const path of Object.keys(ROUTE_INTENT_BY_PATH)) {
		if (!knownPaths.has(path) && !INTENT_PREFIXES.includes(path)) {
			violations.push({
				code: 'stale-intent',
				message: `ROUTE_INTENT declares ${path}, but the generated route tree has no such route (deleted or renamed route left behind)`,
			});
		}
	}

	return { classified, violations };
}

/**
 * robots.txt `Disallow` paths for every prefix that must stay out of
 * the crawl: private file routes plus the machine boundaries.
 *
 * Each entry is emitted twice — `X$` for the exact path and `X/` for
 * the subtree — because robots.txt matching is a raw PREFIX match. A
 * bare `Disallow: /admin` would also block a future `/administrator`,
 * and a bare `Disallow: /tools` would block the public `/tools` index.
 */
export function robotsDisallowPaths(classified) {
	const exactPaths = new Set();

	for (const { intent, path } of classified) {
		if (intent.crawl !== 'disallow') continue;
		// Collapse the gated subtree onto its own root: every admin child
		// contributes `/admin`, and `/admin$` + `/admin/` already covers
		// the whole tree.
		const root = INTENT_PREFIXES.find((prefix) => path.startsWith(prefix)) ?? path;
		exactPaths.add(root);
	}
	for (const prefix of [...EXTERNAL_BOUNDARY_PREFIXES, ...FRAMEWORK_PREFIXES]) {
		exactPaths.add(prefix);
	}

	return [...exactPaths].sort().flatMap((path) => [`${path}$`, `${path}/`]);
}

/** URLs that belong in `sitemap.xml`. */
export function sitemapLocations(classified, origin = CANONICAL_ORIGIN) {
	return classified
		.filter((route) => route.intent.index === 'sitemap')
		.map((route) => `${origin}${route.path === '/' ? '/' : route.path}`)
		.sort();
}

/** The generated robots.txt body. */
export function buildRobotsTxt(classified, origin = CANONICAL_ORIGIN) {
	const disallow = robotsDisallowPaths(classified);
	const lines = [
		`# robots.txt — ${origin} (Issue #423)`,
		'#',
		'# GENERATED by `node scripts/check-index-boundary.mjs --write`. Do not edit by hand:',
		'# `pnpm run index:boundary:check` fails when this file differs from the contract in',
		'# scripts/_index-boundary.mjs.',
		'#',
		'# This file is NOT access control. It is a public document served to anonymous',
		'# clients, so it can only keep well-behaved crawlers away from a surface — every',
		'# secret surface stays protected by its server-side gate (`requireAdmin()` for',
		'# /admin, the API-key middleware for /api/v1/*). Removing this file must not, and',
		'# does not, expose anything.',
		'#',
		'# `Disallow` and `noindex` are used deliberately in different places:',
		'#   * noindex is carried by the page itself (src/routes/admin.tsx, Tool shells), so',
		'#     the page MUST stay crawlable — a blocked page cannot deliver its own noindex.',
		'   * Disallow is used only for crawl budget: the gated admin subtree and the',
		'#     machine endpoints that have no document to index.',
		'',
		'User-agent: *',
		'Allow: /',
		...disallow.map((path) => `Disallow: ${path}`),
		'',
		`Sitemap: ${origin}${SITEMAP_PATH}`,
		'',
	];
	return lines.join('\n');
}

/** The generated sitemap.xml body. */
export function buildSitemapXml(classified, origin = CANONICAL_ORIGIN) {
	const locations = sitemapLocations(classified, origin);
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!-- GENERATED by `node scripts/check-index-boundary.mjs --write` (Issue #423). -->',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...locations.map((loc) => `  <url>\n    <loc>${loc}</loc>\n  </url>`),
		'</urlset>',
		'',
	];
	return lines.join('\n');
}

/**
 * Parse a robots.txt body into groups. Lines before any `User-agent`
 * line are ignored; comments and blank lines are stripped.
 *
 * @returns {{sitemaps: string[], groups: Array<{agents: string[], allow: string[], disallow: string[]}>, disallow: string[]}}
 */
export function parseRobotsTxt(text) {
	const sitemaps = [];
	const groups = [];
	let current = null;
	let expectingAgent = false;

	for (const rawLine of text.split('\n')) {
		const line = rawLine.replace(/#.*$/, '').trim();
		if (line === '') continue;
		const separator = line.indexOf(':');
		if (separator === -1) continue;
		const field = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();

		if (field === 'user-agent') {
			if (!current || !expectingAgent) {
				current = { agents: [], allow: [], disallow: [] };
				groups.push(current);
				expectingAgent = true;
			}
			current.agents.push(value);
			continue;
		}
		if (!current) continue;
		expectingAgent = false;
		if (field === 'allow') current.allow.push(value);
		else if (field === 'disallow') current.disallow.push(value);
		else if (field === 'sitemap') sitemaps.push(value);
	}

	return { sitemaps, groups, disallow: groups.flatMap((group) => group.disallow) };
}

/** `<loc>` values in a sitemap.xml body. */
export function parseSitemapLocs(xml) {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
}

/** Does a robots.txt prefix rule (without its trailing `$`) cover `path`? */
export function robotsRuleCovers(rule, path) {
	if (!rule.startsWith('/')) return false;
	if (rule.endsWith('$')) return path === rule.slice(0, -1);
	return path.startsWith(rule);
}

const ROBOTS_META_RE = /name:\s*['"]robots['"]/;
const NOINDEX_CONTENT_RE = /content:\s*['"][^'"]*noindex/;

/**
 * Evaluate the whole index boundary.
 *
 * Every violation is reported with a code so a failure names the exact
 * invariant that broke; there is no "OK" path that skips an unknown
 * route, an unknown directive, or an unlisted indexable page.
 *
 * @param {object} input
 * @param {string} input.routeTreeSource  contents of src/routeTree.gen.ts
 * @param {string} input.robotsTxt        contents of public/robots.txt
 * @param {string} input.sitemapXml       contents of public/sitemap.xml
 * @param {(file: string) => string} input.readRouteFile route-module reader
 * @param {string} [input.origin]         canonical origin override (tests)
 * @param {string} [input.serverSource]   src/server.ts, for prefix agreement
 * @returns {{violations: Array<{code: string, message: string}>, classified: Array<object>, summary: object}}
 */
export function evaluateIndexBoundary(input) {
	const origin = input.origin ?? CANONICAL_ORIGIN;
	const violations = [];

	const { routes } = parseRouteTree(input.routeTreeSource);
	const { classified, violations: classifyViolations } = classifyRoutes(routes);
	violations.push(...classifyViolations);

	// ---- robots.txt ----------------------------------------------------
	const robots = parseRobotsTxt(input.robotsTxt);
	const expectedRobots = buildRobotsTxt(classified, origin);

	if (input.robotsTxt !== expectedRobots) {
		violations.push({
			code: 'robots-drift',
			message:
				'public/robots.txt does not match the generated contract — run ' +
				'`node scripts/check-index-boundary.mjs --write` and commit the result',
		});
	}

	const expectedSitemaps = [`${origin}${SITEMAP_PATH}`];
	if (robots.sitemaps.length !== expectedSitemaps.length) {
		violations.push({
			code: 'sitemap-directive',
			message: `robots.txt must declare exactly one Sitemap: line (${expectedSitemaps.join(', ')}), found ${robots.sitemaps.length}`,
		});
	}
	for (const sitemap of robots.sitemaps) {
		if (!expectedSitemaps.includes(sitemap)) {
			violations.push({
				code: 'sitemap-directive',
				message: `robots.txt Sitemap directive ${sitemap} is not the canonical ${expectedSitemaps[0]}`,
			});
		}
	}

	// An unintended site-wide noindex: `Disallow: /`, `Disallow: /*` or
	// `Disallow: /?` in ANY group. This is the exact shape of the
	// "whole site quietly disappeared from search" incident.
	for (const group of robots.groups) {
		for (const rule of group.disallow) {
			if (rule === '/' || rule === '/*' || rule === '/?' || rule === '') {
				violations.push({
					code: 'global-noindex',
					message: `robots.txt disallows the whole site (Disallow: ${rule || '<empty>'}) — every public page would drop out of the index`,
				});
			}
		}
	}

	// Every Disallow rule must be exact (`X$`) or a subtree (`X/`), so
	// it can never shadow a sibling public route by raw prefix match.
	for (const rule of robots.disallow) {
		if (!rule.endsWith('$') && !rule.endsWith('/')) {
			violations.push({
				code: 'robots-overbroad-rule',
				message: `Disallow: ${rule} is a raw prefix rule; write ${rule}$ (exact) or ${rule}/ (subtree) so it cannot shadow a sibling route`,
			});
		}
	}

	// Every gated / machine prefix must actually be disallowed …
	for (const { intent, path } of classified) {
		if (intent.crawl !== 'disallow') continue;
		const root = INTENT_PREFIXES.find((prefix) => path.startsWith(prefix)) ?? path;
		const covered = robots.disallow.some((rule) => robotsRuleCovers(rule, root));
		if (!covered) {
			violations.push({
				code: 'missing-disallow',
				message: `robots.txt has no Disallow rule covering the gated route ${path}`,
			});
		}
	}
	for (const prefix of [...EXTERNAL_BOUNDARY_PREFIXES, ...FRAMEWORK_PREFIXES]) {
		const covered = robots.disallow.some((rule) => robotsRuleCovers(rule, prefix));
		if (!covered) {
			violations.push({
				code: 'missing-disallow',
				message: `robots.txt has no Disallow rule covering the machine boundary ${prefix}`,
			});
		}
	}

	// … and no Disallow rule may shadow an indexable public route.
	const indexablePaths = classified
		.filter((route) => route.intent.index !== 'no')
		.map((route) => route.path);
	for (const rule of robots.disallow) {
		for (const path of indexablePaths) {
			if (robotsRuleCovers(rule, path)) {
				violations.push({
					code: 'indexable-blocked',
					message: `Disallow: ${rule} blocks indexable route ${path}; use noindex meta for de-indexing instead of blocking the crawl`,
				});
			}
		}
	}

	// The external-boundary prefix list must not drift from src/server.ts.
	if (input.serverSource) {
		const declared = /EXTERNAL_BOUNDARY_PREFIXES = \[([^\]]*)\]/.exec(input.serverSource);
		if (!declared) {
			violations.push({
				code: 'boundary-prefix-unreadable',
				message: 'could not read EXTERNAL_BOUNDARY_PREFIXES from src/server.ts',
			});
		} else {
			const live = [...declared[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
			for (const prefix of live) {
				if (!EXTERNAL_BOUNDARY_PREFIXES.includes(prefix)) {
					violations.push({
						code: 'boundary-prefix-drift',
						message: `src/server.ts owns external boundary ${prefix}, which this contract does not know about`,
					});
				}
			}
			for (const prefix of EXTERNAL_BOUNDARY_PREFIXES) {
				if (!live.includes(prefix)) {
					violations.push({
						code: 'boundary-prefix-drift',
						message: `this contract claims external boundary ${prefix}, but src/server.ts no longer routes it`,
					});
				}
			}
		}
	}

	// ---- sitemap.xml ---------------------------------------------------
	const expectedXml = buildSitemapXml(classified, origin);
	if (input.sitemapXml !== expectedXml) {
		violations.push({
			code: 'sitemap-drift',
			message:
				'public/sitemap.xml does not match the generated contract — run ' +
				'`node scripts/check-index-boundary.mjs --write` and commit the result',
		});
	}

	const locs = parseSitemapLocs(input.sitemapXml);
	const expectedLocs = sitemapLocations(classified, origin);
	for (const loc of locs) {
		if (!loc.startsWith(`${origin}/`)) {
			violations.push({
				code: 'sitemap-non-canonical-host',
				message: `sitemap entry ${loc} is not on the canonical origin ${origin}`,
			});
		}
		if (!expectedLocs.includes(loc)) {
			violations.push({
				code: 'sitemap-unexpected-entry',
				message: `sitemap entry ${loc} has no matching index intent`,
			});
		}
	}
	for (const loc of expectedLocs) {
		if (!locs.includes(loc)) {
			violations.push({
				code: 'sitemap-missing-entry',
				message: `sitemap is missing ${loc}`,
			});
		}
	}

	// ---- HTML meta side ------------------------------------------------
	// `metaFile` is the extension-less specifier from the generated import
	// block (`./routes/contact`); the reader resolves the real module and
	// reports `route-file-missing` when it cannot.
	for (const { path, file, metaFile, intent } of classified) {
		let source;
		try {
			source = input.readRouteFile(metaFile);
		} catch {
			violations.push({
				code: 'route-file-missing',
				message: `route module ${metaFile} (${path}) could not be read`,
			});
			continue;
		}
		const declaresNoindex = ROBOTS_META_RE.test(source) && NOINDEX_CONTENT_RE.test(source);
		if (intent.index === 'no' && !declaresNoindex) {
			violations.push({
				code: 'missing-noindex-meta',
				message: `route ${path} (${metaFile}) must declare a robots noindex meta; a Disallow alone cannot de-index a URL`,
			});
		}
		if (intent.zone === 'public' && declaresNoindex) {
			violations.push({
				code: 'unexpected-noindex-meta',
				message: `public route ${path} (${metaFile}) declares a noindex meta — this is an unintended site-wide de-index`,
			});
		}
		if (intent.index === 'sitemap') {
			const expectedUrl = `${origin}${path === '/' ? '/' : path}`;
			if (!canonicalOf(source)) {
				violations.push({
					code: 'missing-canonical',
					message: `${path} is listed in the sitemap at ${expectedUrl} but ${file} declares no rel="canonical"`,
				});
			} else if (canonicalOf(source) !== expectedUrl) {
				violations.push({
					code: 'canonical-sitemap-mismatch',
					message: `${file} declares canonical ${canonicalOf(source)}, but the sitemap lists ${expectedUrl}`,
				});
			}
		}
	}

	// The gated subtree's noindex meta must have exactly one owner: the
	// layout module behind the gate, whose `head()` the router merges into
	// every child match.
	const owner = classified.find((route) => route.path === NOINDEX_META_OWNER_ROUTE);
	if (owner && input.readRouteFile) {
		try {
			const ownerSource = input.readRouteFile(owner.metaFile);
			if (!(ROBOTS_META_RE.test(ownerSource) && NOINDEX_CONTENT_RE.test(ownerSource))) {
				violations.push({
					code: 'missing-noindex-meta',
					message: `${owner.metaFile} must declare the robots noindex meta for the whole ${NOINDEX_META_OWNER_ROUTE} subtree`,
				});
			}
		} catch {
			violations.push({
				code: 'route-file-missing',
				message: `route module ${owner.metaFile} could not be read`,
			});
		}
	}

	return {
		violations,
		classified,
		summary: {
			origin,
			routes: classified.length,
			indexable: classified.filter((route) => route.intent.index !== 'no').length,
			sitemapEntries: expectedLocs.length,
			disallowRules: robots.disallow.length,
			noindexRoutes: classified.filter((route) => route.intent.index === 'no').map((r) => r.path),
		},
	};
}

/**
 * Canonical URL declared by a route module, or null when it declares
 * none.
 *
 * The href may be an inline literal (`href: 'https://rebuildup.dev/contact'`)
 * or a local binding (`const url = '…'` then `href: url`, the shape
 * `src/routes/about.tsx` uses). A binding that is not a plain string
 * literal (a template string over loader data, as in
 * `src/routes/portfolio/$slug.tsx`) resolves to null — those routes
 * build their canonical at request time and are not sitemap-listed.
 */
export function canonicalOf(source) {
	const link = /rel:\s*['"]canonical['"]\s*,\s*href:\s*([^,}\]]+)/.exec(source);
	if (!link) return null;
	const expression = link[1].trim();
	const literal = /^['"]([^'"]+)['"]$/.exec(expression);
	if (literal) return literal[1];
	const binding = new RegExp(`\\b${expression}\\s*=\\s*['"]([^'"]+)['"]`).exec(source);
	return binding ? binding[1] : null;
}
