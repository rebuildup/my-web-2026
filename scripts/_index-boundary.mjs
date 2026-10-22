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
 *     "Indexed, though blocked by robots.txt". This is ENFORCED, not
 *     merely documented: the `noindex-blocked` violation fires both on
 *     a declared intent that pairs `index: 'no'` with
 *     `crawl: 'disallow'` and on a robots.txt rule that covers such a
 *     route, so the combination cannot be written by hand either.
 *   - `Disallow` is NOT access control. `robots.txt` is a public file
 *     served to anonymous clients; `curl`, a browser, or a scraper
 *     ignores it entirely. Only the server-side gate (the admin
 *     loaders' `requireAdmin()`, the API-key middleware) protects a
 *     secret surface. Because the gate already refuses anonymous
 *     reads, the admin subtree is left CRAWLABLE on purpose: the only
 *     mechanism that de-indexes it is the `noindex` meta its own
 *     documents carry, and a crawler that never fetches those documents
 *     cannot read it.
 *
 * The contract is EXHAUSTIVE on purpose. `ROUTE_INTENT` below covers
 * every route in the generated route tree; a route that is added and
 * not classified here is a hard failure (`unclassified-route`), not a
 * silent pass. That is the whole point: an index boundary nobody
 * reviewed is indistinguishable from no boundary at all.
 *
 * Who SERVES the two crawler documents
 * ------------------------------------
 * `src/http/seo/` owns delivery: Issue #420 proved that TanStack Start
 * 1.168 cannot answer a non-HTML document from a route file, so
 * `/robots.txt` and `/sitemap.xml` are Hono routes on the external
 * boundary (`GET /robots.txt` renders `renderRobotsTxt()`,
 * `/sitemap.xml` renders the static inventory plus the published D1
 * rows). This module therefore does NOT generate them — a second
 * generator would be a second owner for the same URL, and Cloudflare
 * Static Assets answers a matching asset BEFORE the Worker runs, so a
 * committed `public/robots.txt` would silently shadow the route.
 *
 * What this module owns is the POLICY and its proof: every route's
 * crawl / index intent, and whether the document the owner actually
 * serves is consistent with that intent.
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

/** Sitemap path served by the SEO router (`src/http/seo/router.ts`). */
export const SITEMAP_PATH = '/sitemap.xml';

/** robots.txt path served by the SEO router (`src/http/seo/router.ts`). */
export const ROBOTS_PATH = '/robots.txt';

/**
 * Paths owned by the Hono external boundary (`EXTERNAL_BOUNDARY_PREFIXES`
 * in `src/server.ts`). They are machine endpoints, not documents: no
 * HTML, no crawler value, and they must never appear in the sitemap.
 *
 * Kept as data here (not re-derived by importing `src/server.ts`) so
 * the check stays a Node-only script; the CLI asserts the two lists
 * agree by reading `src/server.ts` and failing when they diverge. The
 * two SEO documents joined the list in Issue #420 — they are routes on
 * the same boundary, and a contract that had never heard of them
 * would call a correct `src/server.ts` drifted.
 *
 * `/.well-known` joined it in Issue #468 for the same reason plus one:
 * RFC 9116's `security.txt` is a `text/plain` document (so Hono owns
 * delivery, not a route file), AND the whole well-known namespace is
 * machine-readable by definition — a crawler has no business indexing
 * any of it, so the namespace is declared once here rather than being
 * re-classified path by path if a future well-known document lands.
 *
 * `/media` joined it in Issue #634: it streams gated R2 objects, not
 * documents. There is no HTML to index, and the path is deliberately
 * unguessable-by-design (an unapproved key answers the same 404 as a
 * missing one), so a sitemap entry would be wrong twice over.
 */
export const EXTERNAL_BOUNDARY_PREFIXES = Object.freeze([
	'/api/v1',
	'/webhooks',
	'/oauth',
	'/integrations',
	'/media',
	ROBOTS_PATH,
	SITEMAP_PATH,
	'/.well-known',
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
 *   crawl  'allow'   — may be fetched. Required for ANY page whose index
 *                      intent is carried by HTML meta (`index: 'no'`):
 *                      a crawler cannot read a `noindex` it is not
 *                      allowed to fetch, so pairing the two is a
 *                      `noindex-blocked` violation.
 *          'disallow'— `Disallow` in robots.txt (crawl budget hygiene).
 *                      Legal only for a page that is NOT de-indexed by
 *                      its own meta (i.e. `index !== 'no'`).
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
		paths: ['/keyboard'],
		zone: 'public',
		crawl: 'allow',
		index: 'crawl',
		reason:
			'Public read-only keyboard reference. Indexable and linked from /about, but not a ' +
			'public-nav destination and therefore not listed in the sitemap.',
	},
	{
		paths: ['/contact'],
		zone: 'public',
		crawl: 'allow',
		index: 'sitemap',
		reason: 'Public contact channels.',
	},
	{
		paths: ['/projects/dotfiles'],
		zone: 'public',
		crawl: 'allow',
		index: 'crawl',
		reason:
			'Public project introduction generated from a committed README snapshot. It is not a nav ' +
			'destination and is deliberately not advertised in the sitemap; crawlers discover it from ' +
			'the GitHub repository and other external links, never from a generated inventory entry.',
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
		crawl: 'allow',
		index: 'no',
		reason:
			'Admin gate. De-indexing is carried by the `noindex` meta on the admin layout ' +
			'(src/routes/admin.tsx), which is read at fetch time, so the subtree MUST stay crawlable: ' +
			'a `Disallow` here would leave the URLs "indexed, though blocked by robots.txt". Access ' +
			'control is requireAdmin() in the child loaders / server functions, not robots.txt.',
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
				crawl: 'allow',
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

/** URLs that belong in `sitemap.xml`, per the declared intent. */
export function sitemapLocations(classified, origin = CANONICAL_ORIGIN) {
	return classified
		.filter((route) => route.intent.index === 'sitemap')
		.map((route) => `${origin}${route.path === '/' ? '/' : route.path}`)
		.sort();
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

/** Does a robots.txt prefix rule (without its trailing `$`) cover `path`? */
export function robotsRuleCovers(rule, path) {
	if (!rule.startsWith('/')) return false;
	if (rule.endsWith('$')) return path === rule.slice(0, -1);
	return path.startsWith(rule);
}

/**
 * Blank out every comment in a TypeScript/JSX source, preserving the
 * length of the code so offsets stay meaningful.
 *
 * The static checks below read route modules as TEXT, and a comment is
 * the easiest way to make a text check lie: a commented-out
 * `name: 'robots', content: 'noindex'` would satisfy a noindex
 * requirement for a page that renders none, and a commented-out
 * `rel: 'canonical'` would satisfy the sitemap cross-check.
 *
 * It is a scanner, not a parser, and it deliberately understands only
 * what route modules actually contain: line comments, block comments,
 * single- and double-quoted strings, and template literals (with
 * `${…}` interpolation). String bodies are COPIED, never blanked —
 * `'https://rebuildup.dev/contact'` is full of `//` and must survive.
 * A regex literal or a template nested inside an interpolation is not
 * tracked; both would only ever blank too much, which makes a static
 * check fail loudly rather than pass silently.
 */
export function stripComments(source) {
	const out = [];
	// Stack of open template literals, so a `${}` expression that
	// itself contains a backtick closes the right one.
	const templates = [];
	let i = 0;

	while (i < source.length) {
		const char = source[i];
		const next = source[i + 1];

		if (char === '/' && next === '/') {
			while (i < source.length && source[i] !== '\n') {
				out.push(' ');
				i += 1;
			}
			continue;
		}
		if (char === '/' && next === '*') {
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
				out.push(source[i] === '\n' ? '\n' : ' ');
				i += 1;
			}
			out.push('  ');
			i += 2;
			continue;
		}
		if (char === "'" || char === '"') {
			const end = skipQuoted(source, i, char);
			out.push(source.slice(i, end));
			i = end;
			continue;
		}
		if (char === '`') {
			templates.push({ depth: 0 });
			out.push('`');
			i += 1;
			continue;
		}
		if (templates.length > 0) {
			const template = templates[templates.length - 1];
			if (char === '\\') {
				out.push(source.slice(i, i + 2));
				i += 2;
				continue;
			}
			if (char === '{') template.depth += 1;
			else if (char === '}') {
				if (template.depth === 0) {
					templates.pop();
					out.push('}');
					i += 1;
					continue;
				}
				template.depth -= 1;
			} else if (char === '`') {
				templates.pop();
			}
			out.push(char);
			i += 1;
			continue;
		}
		out.push(char);
		i += 1;
	}

	return out.join('');
}

/** Index just past the closing quote of the quoted string starting at `start`. */
function skipQuoted(source, start, quote) {
	let i = start + 1;
	while (i < source.length) {
		if (source[i] === '\\') {
			i += 2;
			continue;
		}
		if (source[i] === quote) return i + 1;
		if (source[i] === '\n') return i;
		i += 1;
	}
	return i;
}

/**
 * A `noindex` is only declared when ONE meta entry carries both the
 * `robots` name and a `noindex` content.
 *
 * Two independent file-wide patterns were too loose: `name: 'robots'`
 * on one entry plus `content: '…noindex'` on another (or in a comment)
 * passed the check for a page that renders no noindex at all. The
 * pattern below requires the pair inside a single `content:` value, and
 * the caller matches it against `stripComments()` output.
 */
const NOINDEX_META_RE = /name:\s*['"]robots['"]\s*,\s*content:\s*['"][^'"]*\bnoindex\b/;

/** Does a route module really declare a `robots` noindex meta? */
export function declaresNoindexMeta(source) {
	return NOINDEX_META_RE.test(stripComments(source));
}

/**
 * Routes the contract declares crawl-blocked that the served
 * robots.txt does not actually block.
 *
 * Machine endpoints (`/api/v1`, `/webhooks`, …) are deliberately NOT
 * required here: they answer 401/404 rather than serving a document, so
 * whether spending crawl budget on them is worth a `Disallow` line is
 * the SEO owner's call (`src/http/seo/sitemap.ts`), not this
 * contract's. A rule that IS declared for them is still checked for
 * shape (`robots-overbroad-rule`) and for collateral damage
 * (`indexable-blocked`), so adding one later is safe.
 *
 * @param {Array<{path: string, intent: {crawl: string}}>} classified
 * @param {string[]} disallowRules parsed `Disallow:` values
 * @returns {Array<{code: string, message: string}>}
 */
export function missingDisallowViolations(classified, disallowRules) {
	const violations = [];
	for (const { intent, path } of classified) {
		if (intent.crawl !== 'disallow') continue;
		const root = INTENT_PREFIXES.find((prefix) => path.startsWith(prefix)) ?? path;
		if (!disallowRules.some((rule) => robotsRuleCovers(rule, root))) {
			violations.push({
				code: 'missing-disallow',
				message: `robots.txt has no Disallow rule covering the crawl-blocked route ${path}`,
			});
		}
	}
	return violations;
}

/**
 * The forbidden combination, from BOTH sides.
 *
 * A route that is de-indexed by its own `noindex` meta must stay
 * crawlable; a route that is kept out of the crawl can never deliver
 * that meta. Google then reports the URL as "Indexed, though blocked
 * by robots.txt" — the exact silent failure this gate exists to make
 * impossible to ship.
 *
 * Two inputs are checked because there are two ways to create it:
 *
 *   - the DECLARED intent pairs `index: 'no'` with `crawl: 'disallow'`
 *     (a contract authoring error — the generator would then emit the
 *     blocking rules itself);
 *   - a `Disallow` rule in the parsed robots.txt covers a noindex route
 *     (a hand-edited or drifted artefact).
 *
 * @param {Array<{path: string, intent: {crawl: string, index: string}}>} classified
 * @param {string[]} [disallowRules] parsed `Disallow:` values
 * @returns {Array<{code: string, message: string}>}
 */
export function noindexBlockedViolations(classified, disallowRules = []) {
	const violations = [];
	for (const { path, intent } of classified) {
		if (intent.index !== 'no') continue;
		if (intent.crawl === 'disallow') {
			violations.push({
				code: 'noindex-blocked',
				message: `route ${path} is declared index:'no' AND crawl:'disallow'; a crawler that cannot fetch the page can never read its own noindex, so the URL stays "Indexed, though blocked by robots.txt". Keep it crawlable (crawl:'allow') and de-index it with its own noindex meta`,
			});
			continue;
		}
		for (const rule of disallowRules) {
			if (robotsRuleCovers(rule, path)) {
				violations.push({
					code: 'noindex-blocked',
					message: `Disallow: ${rule} blocks ${path}, which is de-indexed by its own noindex meta; a page the crawler may not fetch can never deliver that meta, so it can only end up "Indexed, though blocked by robots.txt"`,
				});
			}
		}
	}
	return violations;
}

/**
 * Evaluate the whole index boundary.
 *
 * Every violation is reported with a code so a failure names the exact
 * invariant that broke; there is no "OK" path that skips an unknown
 * route, an unknown directive, or an unlisted indexable page.
 *
 * @param {object} input
 * @param {string} input.routeTreeSource  contents of src/routeTree.gen.ts
 * @param {string} input.robotsTxt        the SERVED robots.txt body (renderRobotsTxt())
 * @param {string[]} input.sitemapPaths   paths the served sitemap advertises (static inventory)
 * @param {string} input.sitemapOrigin    origin the sitemap document is rendered with
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

	// ---- the served robots.txt -----------------------------------------
	// Not a committed artefact: `src/http/seo/router.ts` answers this
	// path (Issue #420), and the CLI passes the exact body the router
	// would return.
	const robots = parseRobotsTxt(input.robotsTxt);

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
	//
	// An EMPTY value is a different failure and gets its own code:
	// per RFC 9309 `Disallow:` with no value means "allow everything",
	// so it cannot de-index anything — it is a botched edit that fails
	// silently rather than loudly.
	for (const group of robots.groups) {
		for (const rule of group.disallow) {
			if (rule === '/' || rule === '/*' || rule === '/?') {
				violations.push({
					code: 'global-noindex',
					message: `robots.txt disallows the whole site (Disallow: ${rule}) — every public page would drop out of the index`,
				});
			} else if (rule === '') {
				violations.push({
					code: 'empty-disallow',
					message:
						'robots.txt has an empty Disallow value; per RFC 9309 that allows everything, so the rule ' +
						'does nothing at all — a no-op directive is almost always a botched edit',
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

	// Every crawl-blocked / machine prefix must actually be disallowed …
	violations.push(...missingDisallowViolations(classified, robots.disallow));

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

	// A route de-indexed by its own noindex meta may never be kept out of
	// the crawl — that combination can only end as "Indexed, though
	// blocked by robots.txt". Checked against the declared intent AND
	// the rules actually present in the file.
	violations.push(...noindexBlockedViolations(classified, robots.disallow));

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

	// ---- the served sitemap --------------------------------------------
	// The document is rendered at request time (static inventory + the
	// published D1 rows), so what can be compared is its STATIC entry
	// set against the declared `index: 'sitemap'` intent. The dynamic
	// half is the portfolio project's own obligation
	// (`/portfolio/$slug` is `index: 'crawl'` here for exactly that
	// reason) and `scripts/check-sitemap-route-coverage.test.mjs` guards
	// the rendered inventory.
	if (input.sitemapOrigin && input.sitemapOrigin !== origin) {
		violations.push({
			code: 'sitemap-non-canonical-host',
			message: `the sitemap is rendered with origin ${input.sitemapOrigin}, but ADR-0014 makes ${origin} canonical`,
		});
	}

	const served = (input.sitemapPaths ?? []).map((path) => normalizeRoutePath(path));
	const expectedPaths = classified
		.filter((route) => route.intent.index === 'sitemap')
		.map((route) => route.path);
	for (const path of served) {
		if (!expectedPaths.includes(path)) {
			violations.push({
				code: 'sitemap-unexpected-entry',
				message: `the sitemap advertises ${path}, which this contract does not classify as index:'sitemap'`,
			});
		}
	}
	for (const path of expectedPaths) {
		if (!served.includes(path)) {
			violations.push({
				code: 'sitemap-missing-entry',
				message: `the sitemap does not advertise ${path}, which the contract classifies as index:'sitemap'`,
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
		const declaresNoindex = declaresNoindexMeta(source);
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
			const canonical = canonicalOf(source);
			if (!canonical) {
				violations.push({
					code: 'missing-canonical',
					message: `${path} is listed in the sitemap at ${expectedUrl} but ${file} declares no rel="canonical"`,
				});
			} else if (canonical !== expectedUrl) {
				violations.push({
					code: 'canonical-sitemap-mismatch',
					message: `${file} declares canonical ${canonical}, but the sitemap lists ${expectedUrl}`,
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
			if (!declaresNoindexMeta(ownerSource)) {
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
			sitemapEntries: served.length,
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
 *
 * Comments are stripped first, so a commented-out canonical cannot
 * satisfy `missing-canonical`. The match is still whole-file: a
 * canonical declared outside a `head()` (a JSON-LD `links` block, say)
 * would be accepted here. That is recorded as known looseness rather
 * than over-engineered — every sitemap page today declares its
 * canonical in `head()`, and the rendered half is asserted by
 * `test/integration/index-boundary.test.ts`.
 */
export function canonicalOf(rawSource) {
	const source = stripComments(rawSource);
	const link = /rel:\s*['"]canonical['"]\s*,\s*href:\s*([^,}\]]+)/.exec(source);
	if (!link) return null;
	const expression = link[1].trim();
	const literal = /^['"]([^'"]+)['"]$/.exec(expression);
	if (literal) return literal[1];
	const binding = new RegExp(`\\b${expression}\\s*=\\s*['"]([^'"]+)['"]`).exec(source);
	return binding ? binding[1] : null;
}
