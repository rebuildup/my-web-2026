/**
 * seo-head-contract — the public-route `<head>` metadata policy
 * and the engine that evaluates it (Issue #418).
 *
 * One engine, two front-ends
 * --------------------------
 *   - `test/integration/seo-head.test.ts` drives the REAL Worker
 *     (`SELF.fetch`) and feeds the parsed SSR `<head>` here. That is
 *     the CI gate: it runs inside `pnpm run validate:fast`.
 *   - `scripts/check-seo-head.mjs --live <baseUrl>` drives a real
 *     server (dev server, `vite preview`, or any deployed origin)
 *     and feeds the same engine. That is the report / local
 *     verification surface, and it is what produces the screenshot
 *     in `docs/verification/seo/`.
 *
 * Both feed the SAME parser contract (`normalizeTags` accepts the
 * TanStack `head()` tag shape and the rendered-HTML shape), so a
 * rule can never pass in one front-end and fail in the other.
 *
 * Why a policy engine and not a page-by-page assertion list
 * --------------------------------------------------------
 * The failure this gate exists to prevent is silent, not loud:
 * a route that is added, or a `<head>` that is edited, keeps
 * rendering and keeps passing every other gate while losing its
 * title, its description, or its canonical. Therefore:
 *
 *   1. The route inventory is DISCOVERED from `src/routes/**`
 *      (every module that calls `createFileRoute`), never hand-listed.
 *      A new route file enters the gate on the next run whether or
 *      not anybody remembered it.
 *   2. A discovered route with no observation is a FAILURE
 *      (`inventory.unobserved`), not a skip. Silence is the bug.
 *   3. A dynamic route that cannot be enumerated from the
 *      filesystem must declare a sample in `DYNAMIC_ROUTE_SAMPLES`;
 *      an undeclared dynamic route fails with `inventory.dynamic-no-sample`.
 *   4. A request that ERRORED is a FAIL (`observation.request-failed`),
 *      on every surface, and the metadata rules are not evaluated
 *      against a document that does not exist. A 404 probe that never
 *      arrived is `not-found.not-404`, not a pass. Silence is the bug
 *      in both directions: an unchecked route AND an unfetched one.
 *
 * The three policies the Issue asks to define separately
 * -------------------------------------------------------
 *   - public / indexable  — title + description + canonical, unique
 *     title, canonical must be the query-free absolute URL.
 *   - non-public (`/admin*`) — MUST declare `robots: noindex` and
 *     MUST NOT declare a canonical (a canonical on an admin URL is
 *     an invitation to index the admin surface).
 *   - 404 (`notFound()`) — MUST NOT declare a canonical; must never
 *     be counted as a public route for title uniqueness.
 *   - search-query URLs — a `rel=canonical` MUST NOT carry a query
 *     string or fragment, so `/portfolio?facets=develop` canonicalizes
 *     to `/portfolio`. `QUERY_STRING_PROBES` re-checks this against a
 *     real request in live mode.
 *
 * Canonical origin
 * ----------------
 * Derived from `PRODUCTION_BETTER_AUTH_URL` in
 * `scripts/_cloudflare-contract.mjs` (ADR-0014: `rebuildup.dev` is the
 * canonical production origin). Imported, never restated, so the gate
 * cannot drift from the origin the Worker is configured with — and so
 * this file never becomes a second place a host name is written.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCTION_BETTER_AUTH_URL } from './_cloudflare-contract.mjs';

/** Canonical production origin (ADR-0014). Imported, not restated. */
export const CANONICAL_ORIGIN = PRODUCTION_BETTER_AUTH_URL;

/**
 * Path prefixes that are NOT part of the public, indexable surface.
 *
 * `/administrator` deliberately does not match: the rule is
 * "exact segment", so a lookalike public path cannot inherit the
 * admin policy (same reasoning as the `Cache-Control` admin rule in
 * `src/server.ts`).
 */
export const NON_PUBLIC_PREFIXES = Object.freeze(['/admin']);

/**
 * Title bounds. The maximum is the SERP truncation line (~60
 * characters for latin, fewer for CJK) rounded up generously so the
 * gate reports "this title will be truncated", not "this title is
 * wrong". Deliberately loose: a false positive on a real page costs
 * more trust in the gate than a slightly long title costs.
 */
export const TITLE_MAX_LENGTH = 100;

/**
 * Description bounds. Same reasoning as the title bound — presence,
 * non-emptiness, and "not a whole paragraph" are what this gate
 * enforces. Copy / length strategy is a content decision, not a
 * gate decision.
 */
export const DESCRIPTION_MIN_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 320;

/**
 * Dynamic public routes and the concrete sample segment each one is
 * verified with.
 *
 * A `$param` route cannot be enumerated from the filesystem, so a
 * hand-declared sample is the only way to keep it inside the gate
 * instead of quietly outside it. `source` documents where the sample
 * segment comes from so a future deletion is traceable:
 *
 *   - `/portfolio/my-web-2026` — a published row in
 *     `src/portfolio/seed.ts` (the same slug the Playwright specs use).
 *   - `/tools/prototype` — an entry in `src/tools/manifest.json`
 *     (`same_origin_static`, so `/tools/<slug>` renders 200).
 */
export const DYNAMIC_ROUTE_SAMPLES = Object.freeze({
	'/portfolio/$slug': Object.freeze({
		segment: 'my-web-2026',
		source: 'src/portfolio/seed.ts',
	}),
	'/tools/$slug': Object.freeze({
		segment: 'prototype',
		source: 'src/tools/manifest.json',
	}),
});

/**
 * The single anonymously-renderable admin route.
 *
 * Every other `/admin/*` route auth-gates to a 307 with no document,
 * so there is no `<head>` to evaluate; the policy is therefore
 * asserted on the layout route (which every admin child inherits the
 * head merge from) using the one admin URL an anonymous visitor can
 * actually receive.
 */
export const NON_PUBLIC_SAMPLE_PATH = '/admin/login';

/**
 * 404 probes. Both are well-formed slugs that cannot exist, so the
 * loader reaches `notFound()` and the response is a real 404 document
 * whose `<head>` is evaluated under the 404 policy.
 */
export const NOT_FOUND_PROBES = Object.freeze([
	Object.freeze({
		id: '404:portfolio-detail',
		path: '/portfolio/seo-probe-missing-slug',
		expectStatus: 404,
	}),
	Object.freeze({
		id: '404:tool-detail',
		path: '/tools/seo-probe-missing-slug',
		expectStatus: 404,
	}),
]);

/**
 * Search-query probes: a public route that accepts search params must
 * canonicalize to its query-free URL. Live mode fetches the query URL
 * and compares the observed canonical with the query-free one, so a
 * route that starts echoing the query into its canonical is caught on
 * a real response rather than only by the static rule.
 */
export const QUERY_STRING_PROBES = Object.freeze([
	Object.freeze({ routeId: '/portfolio', query: 'facets=develop' }),
]);

/**
 * Public routes that deliberately declare `robots: noindex`.
 *
 * A public URL is not automatically an indexable one: `/tools/<slug>`
 * is a sandboxed iframe shell whose Tool artifact is served under
 * `/tools/<slug>/<artifact_path>/`, so the shell itself must not
 * compete with the artifact in the index (the decision is recorded in
 * `src/routes/tools.$slug.tsx`). The gate would otherwise read that
 * as a regression, so the exclusion is DECLARED here with its reason
 * instead of being silently tolerated — a route added to this map is a
 * reviewable statement about indexing, not a way to mute the gate.
 *
 * Declaring an exclusion does not relax the rest of the policy: the
 * route still needs a unique title, a description, and a
 * query-free absolute canonical.
 */
export const INDEX_EXCLUSIONS = Object.freeze({
	'/tools/$slug': Object.freeze({
		robots: 'noindex',
		reason:
			'Tool iframe shell — the Tool artifact is served under /tools/<slug>/<artifact_path>/ (see src/routes/tools.$slug.tsx)',
	}),
	'/compare': Object.freeze({
		robots: 'noindex',
		reason:
			'Issue #764 comparison harness — a branch-local surface the owner opens directly; it is never linked from a product page and is deleted with the branch that serves it.',
	}),
});

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/**
 * One discovered route, as the gate checks it.
 *
 * @typedef {Object} RouteInventoryEntry
 * @property {string} routeId            route identity (framework route id / URL path)
 * @property {string} file               module or generated file the route came from
 * @property {'public' | 'non-public'} kind
 * @property {boolean} dynamic           true when the id carries a `$param`
 * @property {{ segment: string, source: string } | null} sample
 * @property {string} path               canonical path (params substituted, no trailing slash)
 * @property {string | null} expectedCanonical  null only when a dynamic sample is missing
 */

/**
 * One observed document. Produced either by parsing an SSR response
 * (`test/integration/seo-head.test.ts`, `scripts/check-seo-head.mjs`)
 * or, in the engine's own unit tests, by hand.
 *
 * `head` is the normalized form; `tags` is the raw tag list. Supplying
 * `head` explicitly lets a test describe a head without re-deriving it.
 *
 * @typedef {Object} HeadObservation
 * @property {string} routeId
 * @property {string} path
 * @property {'public' | 'non-public' | 'not-found'} [surface]
 * @property {number | null} [status]
 * @property {Array<Record<string, unknown>>} [tags]
 * @property {Record<string, string | null>} [head]
 * @property {string | null} [expectedCanonical]
 * @property {boolean} [skipped]
 * @property {string} [note]
 * @property {string} [query]
 * @property {boolean} [queryProbe]
 * @property {boolean} [requestFailed]  true when the request itself errored (no response was read)
 * @property {string} [requestError]    the fetch error message, when `requestFailed`
 */

/**
 * The normalized `<head>` fields the policy reads.
 *
 * @typedef {Object} HeadSummary
 * @property {string | null} title
 * @property {string | null} description
 * @property {string | null} robots
 * @property {string | null} canonical
 * @property {string | null} ogUrl
 * @property {string | null} ogTitle
 * @property {string | null} ogDescription
 */

/* ------------------------------------------------------------------ *
 * Route inventory
 * ------------------------------------------------------------------ */

/**
 * Recursively collect every route module under `routesDir`.
 *
 * The marker is `createFileRoute('…')`, which is what makes a file a
 * route in TanStack Start's file-based routing. Colocated components
 * (`src/routes/design-system/**`) never call it, so they are not
 * collected — the same distinction the generated `routeTree.gen.ts`
 * draws, without depending on a generated artifact.
 *
 * @param {string} routesDir  absolute path of `src/routes`
 * @returns {Array<{ file: string, routeId: string }>}
 */
export function discoverRouteModules(routesDir) {
	/** @type {Array<{ file: string, routeId: string }>} */
	const found = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		)) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.isFile()) continue;
			const source = readFileSync(full, 'utf8');
			const match = /createFileRoute\(\s*'([^']+)'/.exec(source);
			if (match) found.push({ file: full, routeId: match[1] });
		}
	};
	if (!statSync(routesDir).isDirectory()) {
		throw new Error(`routes directory not found: ${routesDir}`);
	}
	walk(routesDir);
	return found.sort((a, b) => (a.routeId < b.routeId ? -1 : 1));
}

/**
 * Route ids from the GENERATED route tree (`src/routeTree.gen.ts`),
 * i.e. from the framework's own answer to "which routes exist".
 *
 * Two front-ends need an inventory and only one of them can read the
 * filesystem: the workerd test pool's `node:fs` is a virtual shim
 * over the bundled module graph, so `discoverRouteModules` (a real
 * `readdirSync`) cannot run there. The route tree is regenerated by
 * the TanStack Start Vite plugin from `src/routes/**` on every run,
 * so walking it gives the same authority in both front-ends: the
 * framework's routing table, not a hand-written list.
 *
 * Route identity used here is the URL path, with a parent's path
 * prepended to a child's — that is what a crawler requests. The
 * nested `createFileRoute` ids the generator writes for a
 * non-nested segment (`invitations_.accept`) differ from the URL by
 * that underscore, which is why this function is the URL-shaped one
 * and `discoverRouteModules` is the file-shaped one.
 */
export function routeIdsFromRouteTree(tree) {
	const ids = [];
	const walk = (nodes, parentPath) => {
		for (const node of nodes ?? []) {
			const options = node?.options ?? {};
			const relative = String(options.path ?? options.id ?? '/');
			const fullPath =
				parentPath === ''
					? relative
					: `${parentPath.replace(/\/$/, '')}/${relative.replace(/^\//, '')}`;
			ids.push(fullPath);
			walk(node.children, fullPath);
		}
	};
	walk(tree?.children, '');
	return [...new Set(ids)].sort();
}

/** True when the path belongs to the non-public (admin) surface. */
export function isNonPublicPath(path) {
	return NON_PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** True when a route id contains a `$param` segment. */
export function isDynamicRouteId(routeId) {
	return /\$[A-Za-z_][A-Za-z0-9_]*/.test(routeId);
}

/**
 * Canonical path for a route id: dynamic params substituted with the
 * declared sample segment, and no trailing slash except for `/`.
 *
 * `/portfolio/` and `/portfolio` are the same canonical URL, and the
 * query-free form is what `rel=canonical` must carry.
 */
export function canonicalPathFor(routeId, sampleSegment = null) {
	const path = routeId.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, () => {
		if (sampleSegment === null) {
			throw new Error(`canonicalPathFor(${routeId}) needs a sample segment`);
		}
		return sampleSegment;
	});
	return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path;
}

/** Expected absolute canonical URL for a route id + sample segment. */
export function expectedCanonicalFor(routeId, sampleSegment = null) {
	return `${CANONICAL_ORIGIN}${canonicalPathFor(routeId, sampleSegment)}`;
}

/**
 * Build the checked inventory from discovered route modules.
 *
 * Shape: `{ routeId, file, kind, dynamic, sampleSegment, expectedCanonical }`.
 * `kind` is `non-public` for the admin surface and `public` for
 * everything else — including `/design-system`, which is a
 * deliberately public showcase page.
 *
 * Two route ids can normalize to ONE requestable URL (an index route
 * such as `/admin/` beside the layout route `/admin`), and a URL is
 * what a crawler requests, so the inventory keeps one entry per
 * normalized `path`. Reporting both would fetch the same document
 * twice and — once such a pair is public — raise a duplicate title
 * against the route with itself. The shorter id (the layout) wins,
 * because it is the one whose `path` is the canonical URL.
 *
 * @param {Array<{ routeId: string, file?: string }>} routeModules
 * @param {Record<string, { segment: string, source: string }>} [samples]
 * @returns {RouteInventoryEntry[]}
 */
export function buildInventory(routeModules, samples = DYNAMIC_ROUTE_SAMPLES) {
	const seenPaths = new Set();
	return routeModules
		.map(({ routeId, file = '' }) => {
			const dynamic = isDynamicRouteId(routeId);
			const sample = dynamic ? samples[routeId] : undefined;
			const path = canonicalPathFor(
				routeId,
				dynamic ? (sample ? sample.segment : 'UNSAMPLED') : null,
			);
			return {
				routeId,
				file,
				kind: isNonPublicPath(path) ? 'non-public' : 'public',
				dynamic,
				sample: sample ?? null,
				path,
				// `null` only for a dynamic route whose sample is missing:
				// the coverage rule reports `inventory.dynamic-no-sample`
				// for that route, and an invented expected canonical here
				// would let the missing sample masquerade as a verified
				// route. Every other route gets its expected canonical here.
				expectedCanonical:
					dynamic && !sample ? null : expectedCanonicalFor(routeId, sample ? sample.segment : null),
			};
		})
		.filter((entry) => {
			if (seenPaths.has(entry.path)) return false;
			seenPaths.add(entry.path);
			return true;
		});
}

/* ------------------------------------------------------------------ *
 * Head normalization
 * ------------------------------------------------------------------ */

/** Collapse whitespace so a pretty-printed SSR string and a single-line one compare equal. */
function collapse(value) {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a `<head>` tag list to the fields the policy reads.
 *
 * Accepts BOTH shapes:
 *   - TanStack `head()` output: `[{ title }, { name, content }, { rel, href }]`
 *   - parsed SSR HTML (see `parseHeadTags` in `check-seo-head.mjs`):
 *     the same three shapes, so both front-ends normalize identically.
 *
 * The first occurrence wins for every field — which is what the head
 * merge puts FIRST in the document for every field this reads:
 * `buildTagsFromMatches` (`@tanstack/react-router`) dedupes `meta`
 * deepest-matched-route-first, so the deepest title / description /
 * robots / og tag renders first, and it flat-maps `links`
 * root-first, so a `rel=canonical` also renders root-first. First-in-
 * document is therefore what a crawler resolves, for every field
 * alike; the unit tests pin both halves of that claim
 * (`keeps the deepest title` / `renders two canonicals root-first`).
 *
 * The one place that assumption bites: if a root route ever declares
 * its own canonical, EVERY route renders it (root-first) and every
 * route then reports `public.canonical-mismatch` against `/`. That is
 * the honest report of what the document contains — but the fix
 * belongs in `src/routes/__root.tsx`, not in this normalizer.
 *
 * @param {Array<Record<string, unknown>>} [tags]
 * @returns {HeadSummary}
 */
export function summarizeHead(tags) {
	const out = {
		title: null,
		description: null,
		robots: null,
		canonical: null,
		ogUrl: null,
		ogTitle: null,
		ogDescription: null,
	};
	for (const tag of tags ?? []) {
		if (typeof tag?.title === 'string' && out.title === null) {
			out.title = collapse(tag.title);
			continue;
		}
		if (tag?.name === 'description' && out.description === null) {
			out.description = collapse(String(tag.content ?? ''));
			continue;
		}
		if (tag?.name === 'robots' && out.robots === null) {
			out.robots = collapse(String(tag.content ?? ''));
			continue;
		}
		if (tag?.property === 'og:url' && out.ogUrl === null) {
			out.ogUrl = collapse(String(tag.content ?? ''));
			continue;
		}
		if (tag?.property === 'og:title' && out.ogTitle === null) {
			out.ogTitle = collapse(String(tag.content ?? ''));
			continue;
		}
		if (tag?.property === 'og:description' && out.ogDescription === null) {
			out.ogDescription = collapse(String(tag.content ?? ''));
			continue;
		}
		if (tag?.rel === 'canonical' && out.canonical === null) {
			out.canonical = collapse(String(tag.href ?? ''));
		}
	}
	return out;
}

/* ------------------------------------------------------------------ *
 * Rendered-HTML parsing
 * ------------------------------------------------------------------ */

const ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

/** Minimal HTML entity decode for attribute / title text. */
export function decodeEntities(value) {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
		if (entity[0] === '#') {
			const code =
				entity[1] === 'x' || entity[1] === 'X'
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[entity.toLowerCase()] ?? match;
	});
}

/** Parse `name="value"` pairs out of a raw attribute string. */
function parseAttributes(raw) {
	const attributes = {};
	const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
	for (let match = pattern.exec(raw); match !== null; match = pattern.exec(raw)) {
		attributes[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '');
	}
	return attributes;
}

/**
 * Extract the head tags the policy reads from a rendered HTML
 * document, in the same shape TanStack `head()` returns — so
 * `summarizeHead` normalizes a live response and a route module
 * identically, and a rule cannot pass on one and fail on the other.
 */
export function parseHeadTags(html) {
	const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
	const source = headMatch ? headMatch[1] : html;
	const tags = [];
	for (const match of source.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)) {
		tags.push({ title: decodeEntities(match[1]) });
	}
	for (const match of source.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
		const attributes = parseAttributes(match[1]);
		if (!attributes.name && !attributes.property) continue;
		tags.push({
			name: attributes.name,
			property: attributes.property,
			content: attributes.content ?? '',
		});
	}
	for (const match of source.matchAll(/<link\s+([^>]*?)\/?>/gi)) {
		const attributes = parseAttributes(match[1]);
		if ((attributes.rel ?? '').toLowerCase() !== 'canonical') continue;
		tags.push({ rel: 'canonical', href: attributes.href ?? '' });
	}
	return tags;
}

/**
 * The INLINE `<script>` bodies a rendered `<head>` ships, decoded.
 *
 * `<script src>` elements are skipped: the Issue #488 contract is about
 * the inline body, because that is the one the browser RE-EXECUTES on
 * every client-side navigation (TanStack Router merges the root head
 * into every route match). An external file is fetched once and cannot
 * accumulate per-route state.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function parseInlineScriptSources(html) {
	const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
	const source = headMatch ? headMatch[1] : html;
	const bodies = [];
	for (const match of source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
		if (/\bsrc\s*=/i.test(match[1] ?? '')) continue;
		bodies.push(decodeEntities(match[2]));
	}
	return bodies;
}

/**
 * The argument text of the `name( ... )` call whose `(` sits at
 * `openIndex`.
 *
 * Depth-aware and quote-aware on purpose: the inline flip script binds
 * `addEventListener('load', function () { ... }, { once: true })`, so
 * cutting at the first `)` would read the inner function's parameter
 * list and miss the option object entirely.
 *
 * @param {string} source
 * @param {number} openIndex
 * @returns {string}
 */
function callArguments(source, openIndex) {
	let depth = 0;
	let quote = null;
	for (let i = openIndex; i < source.length; i += 1) {
		const char = source[i];
		if (quote !== null) {
			if (char === '\\') i += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			quote = char;
			continue;
		}
		if (char === '(') depth += 1;
		else if (char === ')') {
			depth -= 1;
			if (depth === 0) return source.slice(openIndex + 1, i);
		}
	}
	return source.slice(openIndex + 1);
}

/**
 * The non-blocking webfont flip script contract (Issue #488).
 *
 * `src/routes/__root.tsx` emits one inline script that flips the
 * `media="print"` webfont stylesheet to `media="all"`. The previous
 * revision ended with
 *
 *     if (!f()) document.addEventListener('DOMContentLoaded', f)
 *
 * so every route change that found no *pending* print link left one
 * more listener on `document` — and `DOMContentLoaded` cannot fire
 * again after the first document load, so each one was permanently
 * dead: +1 leaked `document` listener per route change, unbounded.
 *
 * The measurement is a browser run and is deliberately NOT a gate
 * (`perf:interaction:memory` is wired into no `validate:*` chain), so
 * the shape of the fix is pinned here instead: a deterministic
 * assertion on the script the SSR document actually ships, which runs
 * in `validate:fast` through
 * `test/integration/seo-head.test.ts`.
 *
 * The rules are deliberately literal string shapes, not a JavaScript
 * parse: the script is minified-by-hand on purpose (it is an inline
 * body, so every byte ships on every page), and a rule that reads the
 * shipped text cannot be satisfied by a comment or by a refactor that
 * keeps the same accumulation.
 *
 * @param {string[]} sources inline script bodies, in document order
 * @param {{ path?: string }} [options]
 * @returns {Finding[]}
 */
export function evaluateFlipScriptContract(sources, { path = '' } = {}) {
	/** @type {Finding[]} */
	const findings = [];
	const observation = { path, routeId: path };
	const flipScripts = sources.filter((source) =>
		/\[media\s*=\s*\\?["']print\\?["']\]/.test(source),
	);

	if (flipScripts.length === 0) {
		findings.push(
			finding(
				'head.flip-script-missing',
				observation,
				'no inline script flips the media="print" stylesheet; the non-blocking webfont contract (Issue #291) is no longer implemented in <head>',
			),
		);
		return findings;
	}

	const READY_STATE_GUARD = /document\.readyState\s*={2,3}\s*["']loading["']/;
	const BOUNDED_POLL = /requestAnimationFrame/;
	const POLL_BOUND = /(?:[<>]=?|=)\s*\d+\s*[)\]}]/;

	for (const source of flipScripts) {
		for (const match of source.matchAll(/addEventListener\(\s*["']DOMContentLoaded["']/g)) {
			const before = source.slice(0, match.index);
			if (!READY_STATE_GUARD.test(before)) {
				findings.push(
					finding(
						'head.flip-script-unbounded-domcontentloaded',
						observation,
						'DOMContentLoaded is registered without a `document.readyState === "loading"` guard; after the first document load that event can never fire again, so every registration is a permanently dead `document` listener',
					),
				);
			}
			if (!/once\s*:\s*true/.test(callArguments(source, source.indexOf('(', match.index)))) {
				findings.push(
					finding(
						'head.flip-script-domcontentloaded-not-once',
						observation,
						'DOMContentLoaded is registered without `{once:true}`; re-running the inline body stacks another registration',
					),
				);
			}
		}

		if (BOUNDED_POLL.test(source) && !POLL_BOUND.test(source)) {
			findings.push(
				finding(
					'head.flip-script-unbounded-raf',
					observation,
					'the script schedules requestAnimationFrame without a finite frame bound; a self-rescheduling poll that never stops accumulates on every client-side navigation',
				),
			);
		}

		for (const match of source.matchAll(/addEventListener\(\s*["']load["']/g)) {
			if (!/once\s*:\s*true/.test(callArguments(source, source.indexOf('(', match.index)))) {
				findings.push(
					finding(
						'head.flip-script-load-listener-not-once',
						observation,
						'a `load` listener is bound without `{once:true}`; re-running the inline body against the same <link> stacks listeners on the element',
					),
				);
			}
		}
	}

	return findings;
}

/* ------------------------------------------------------------------ *
 * Policy evaluation
 * ------------------------------------------------------------------ */

/** @typedef {{ rule: string, severity: 'error', routeId: string, path: string, message: string }} Finding */

function finding(rule, observation, message) {
	return {
		rule,
		severity: 'error',
		routeId: observation.routeId ?? observation.id ?? '(unknown)',
		path: observation.path ?? '',
		message,
	};
}

/**
 * Evaluate ONE observation under the policy of its surface.
 *
 * Exported on its own so the unit tests can drive the exact rule set
 * with synthetic input (a duplicated title, a dropped canonical) and
 * prove the engine detects — a gate that cannot fail is not a gate.
 *
 * @param {HeadObservation} observation
 * @param {RouteInventoryEntry | null} [inventoryEntry]
 * @returns {Finding[]}
 */
export function evaluateObservation(observation, inventoryEntry = null) {
	/** @type {Finding[]} */
	const findings = [];
	// A SKIP is a declared gap, not a policy verdict: an auth-gated
	// admin child has no document to evaluate, and evaluating an empty
	// tag list against the non-public policy would report a violation
	// nobody could fix at that URL. The route stays in the inventory,
	// and the policy it would have failed is asserted on the route that
	// does render (`/admin/login`).
	if (observation.skipped) return findings;
	// A request that ERRORED has no document to evaluate. Every rule
	// below would then report metadata defects for a network failure,
	// and a not-found probe would read "no status" as "not a 404" —
	// a PASS nobody earned, which is the silent pass this gate exists
	// to prevent. So the request failure IS the finding, on every
	// surface, and the document rules are not evaluated against a
	// document that does not exist.
	if (observation.requestFailed) {
		findings.push(
			finding(
				'observation.request-failed',
				observation,
				`GET ${observation.path} failed: ${observation.requestError ?? 'unknown error'}`,
			),
		);
		return findings;
	}
	const head = observation.head ?? summarizeHead(observation.tags ?? []);
	const surface = observation.surface ?? inventoryEntry?.kind ?? 'public';

	if (surface === 'not-found') {
		// 404 policy: a canonical on a 404 tells a crawler the missing
		// URL is the canonical version of something. Never.
		if (head.canonical) {
			findings.push(
				finding(
					'not-found.canonical-present',
					observation,
					`404 document declares a canonical (${head.canonical})`,
				),
			);
		}
		if (head.robots && /index/i.test(head.robots) && !/noindex/i.test(head.robots)) {
			findings.push(
				finding(
					'not-found.indexable',
					observation,
					`404 document declares robots="${head.robots}"`,
				),
			);
		}
		// A probe is verified only by its answer. Anything other than
		// a 404 — including NO answer, i.e. an absent status — is a
		// finding, because "could not ask" is not "the 404 policy is
		// fine". (`requestFailed` observations already returned above;
		// this covers the case of an absent status reached without it,
		// which is exactly what a hand-built or future probe shape can
		// still produce.)
		if (observation.status !== 404) {
			findings.push(
				finding(
					'not-found.not-404',
					observation,
					`probe expected HTTP 404, received ${observation.status ?? 'no response'}`,
				),
			);
		}
		return findings;
	}

	if (surface === 'non-public') {
		// Non-public policy: keep the admin surface out of the index.
		if (!head.robots || !/noindex/i.test(head.robots)) {
			findings.push(
				finding(
					'non-public.missing-noindex',
					observation,
					'non-public route does not declare robots=noindex',
				),
			);
		}
		if (head.canonical) {
			findings.push(
				finding(
					'non-public.canonical-present',
					observation,
					`non-public route declares a canonical (${head.canonical})`,
				),
			);
		}
		return findings;
	}

	// Public / indexable policy.
	//
	// Reachability note: through SSR a public route always renders
	// SOME title — `src/routes/__root.tsx` contributes the fallback
	// `my-web-2026` — so a route that forgot its own title is normally
	// caught by `public.duplicate-title` (two routes falling back to
	// the same root title) rather than by the rule below. The rule
	// still fires for a front-end that reads `head()` output directly
	// and for any surface where no fallback exists, which is why it
	// stays; do not read it as "an SSR page with no title is caught
	// here".
	if (!head.title) {
		findings.push(finding('public.title-missing', observation, 'no <title> in the document head'));
	} else if (head.title.length > TITLE_MAX_LENGTH) {
		findings.push(
			finding(
				'public.title-too-long',
				observation,
				`title is ${head.title.length} chars (limit ${TITLE_MAX_LENGTH}); it will be truncated in the SERP`,
			),
		);
	}
	if (!head.description) {
		findings.push(
			finding('public.description-missing', observation, 'no <meta name="description">'),
		);
	} else if (
		head.description.length < DESCRIPTION_MIN_LENGTH ||
		head.description.length > DESCRIPTION_MAX_LENGTH
	) {
		findings.push(
			finding(
				'public.description-length',
				observation,
				`description is ${head.description.length} chars (expected ${DESCRIPTION_MIN_LENGTH}-${DESCRIPTION_MAX_LENGTH})`,
			),
		);
	}

	const expected = observation.expectedCanonical ?? inventoryEntry?.expectedCanonical ?? null;
	if (!head.canonical) {
		findings.push(finding('public.canonical-missing', observation, 'no <link rel="canonical">'));
	} else {
		if (!/^https?:\/\//.test(head.canonical)) {
			findings.push(
				finding(
					'public.canonical-not-absolute',
					observation,
					`canonical must be absolute, got "${head.canonical}"`,
				),
			);
		}
		if (head.canonical.includes('?') || head.canonical.includes('#')) {
			findings.push(
				finding(
					'public.canonical-has-query',
					observation,
					`canonical must be query-free and fragment-free, got "${head.canonical}"`,
				),
			);
		}
		if (expected && head.canonical !== expected) {
			findings.push(
				finding(
					'public.canonical-mismatch',
					observation,
					`canonical is "${head.canonical}", expected "${expected}"`,
				),
			);
		}
	}
	if (head.robots && /noindex/i.test(head.robots)) {
		const exclusion = INDEX_EXCLUSIONS[observation.routeId ?? ''] ?? null;
		if (!exclusion) {
			findings.push(
				finding(
					'public.unexpected-noindex',
					observation,
					`public route declares robots="${head.robots}" and is not declared in INDEX_EXCLUSIONS`,
				),
			);
		} else if (!head.robots.toLowerCase().includes(exclusion.robots)) {
			findings.push(
				finding(
					'public.index-exclusion-mismatch',
					observation,
					`route is declared index-excluded (${exclusion.robots}) but declares robots="${head.robots}"`,
				),
			);
		}
	} else if (INDEX_EXCLUSIONS[observation.routeId ?? '']) {
		findings.push(
			finding(
				'public.missing-index-exclusion',
				observation,
				'route is declared index-excluded in INDEX_EXCLUSIONS but declares no robots meta',
			),
		);
	}
	if (head.ogUrl && head.canonical && head.ogUrl !== head.canonical) {
		findings.push(
			finding(
				'public.ogurl-mismatch',
				observation,
				`og:url is "${head.ogUrl}", canonical is "${head.canonical}"`,
			),
		);
	}
	return findings;
}

/**
 * Evaluate a whole run: inventory coverage + every observation +
 * cross-observation rules (duplicate titles, query canonicalization).
 *
 * `observations` may carry `surface: 'not-found'` probes, which are
 * evaluated but excluded from the public title-uniqueness set — a 404
 * sharing a title with a live page is not a duplicate-title defect.
 */
export function evaluateHeadInventory({ inventory, observations }) {
	/** @type {Finding[]} */
	const findings = [];
	const rows = [];

	for (const observation of observations) {
		const entry = inventory.find((candidate) => candidate.routeId === observation.routeId) ?? null;
		const observationFindings = evaluateObservation(observation, entry);
		findings.push(...observationFindings);
		rows.push({ ...observation, findings: observationFindings });
	}

	// Coverage: every discovered route must have been observed. A route
	// nobody looked at is not a passing route.
	for (const entry of inventory) {
		if (entry.dynamic && !entry.sample) {
			findings.push({
				rule: 'inventory.dynamic-no-sample',
				severity: 'error',
				routeId: entry.routeId,
				path: entry.path,
				message:
					'dynamic route has no sample in DYNAMIC_ROUTE_SAMPLES; declare one in scripts/seo-head-contract.mjs so it can be verified',
			});
			continue;
		}
		const observed = observations.find(
			(o) => o.routeId === entry.routeId && o.surface !== 'not-found',
		);
		if (!observed) {
			findings.push({
				rule: 'inventory.unobserved',
				severity: 'error',
				routeId: entry.routeId,
				path: entry.path,
				message: 'discovered route produced no observation — it was not verified',
			});
		}
	}

	// Cross-observation: duplicate titles across the public surface.
	//
	// A search-query probe is the SAME document as its base URL, so it
	// is excluded here; counting it would report every faceted /
	// paginated view of a page as a duplicate-title defect.
	/** @type {Map<string, string[]>} */
	const byTitle = new Map();
	for (const observation of observations) {
		if (observation.surface === 'not-found') continue;
		if (observation.skipped) continue;
		if (observation.queryProbe) continue;
		const entry = inventory.find((candidate) => candidate.routeId === observation.routeId);
		const surface = observation.surface ?? entry?.kind ?? 'public';
		if (surface !== 'public') continue;
		const head = observation.head ?? summarizeHead(observation.tags ?? []);
		if (!head.title) continue;
		const key = head.title.toLowerCase();
		byTitle.set(key, [...(byTitle.get(key) ?? []), observation.path || observation.routeId]);
	}
	for (const [title, paths] of byTitle) {
		if (paths.length > 1) {
			findings.push({
				rule: 'public.duplicate-title',
				severity: 'error',
				routeId: paths.join(' + '),
				path: paths.join(' + '),
				message: `title "${title}" is used by ${paths.length} routes: ${paths.join(', ')}`,
			});
		}
	}

	// Cross-observation: a query URL must canonicalize to the
	// query-free canonical of the same route.
	for (const probe of observations.filter((o) => o.queryProbe)) {
		const base = observations.find(
			(o) => o.routeId === probe.routeId && !o.query && o.surface !== 'not-found',
		);
		const queryHead = probe.head ?? summarizeHead(probe.tags ?? []);
		if (!queryHead.canonical) continue; // already reported as missing-canonical
		if (!base) continue;
		const baseHead = base.head ?? summarizeHead(base.tags ?? []);
		if (!baseHead.canonical) continue;
		if (queryHead.canonical !== baseHead.canonical) {
			findings.push({
				rule: 'public.query-canonical-mismatch',
				severity: 'error',
				routeId: probe.routeId,
				path: probe.path,
				message: `query URL "${probe.path}" canonicalizes to "${queryHead.canonical}" but "${base.path}" canonicalizes to "${baseHead.canonical}"`,
			});
		}
	}

	rows.sort((a, b) => ((a.path || a.routeId) < (b.path || b.routeId) ? -1 : 1));
	return {
		findings,
		rows,
		stats: {
			observed: rows.length,
			inventory: inventory.length,
			errors: findings.length,
		},
	};
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

const FIELD_ORDER = ['title', 'description', 'canonical', 'robots', 'ogUrl'];

function reportFields(observation) {
	const head = observation.head ?? summarizeHead(observation.tags ?? []);
	return FIELD_ORDER.map((field) => [field, head[field]]);
}

function verdictFor(row) {
	if (row.skipped) return 'SKIP';
	return row.findings.length > 0 ? 'FAIL' : 'PASS';
}

/**
 * Plain-text report — the CLI default. Stable column order, no colour codes.
 *
 * @param {{ findings: Finding[], rows: HeadObservation[], stats: Record<string, number> }} result
 * @returns {string}
 */
export function renderTextReport(result) {
	const lines = [];
	lines.push('public-route <head> metadata gate (Issue #418)');
	lines.push(`canonical origin: ${CANONICAL_ORIGIN}`);
	lines.push(
		`routes: ${result.stats.inventory} discovered, ${result.rows.length} observed, ${result.findings.length} finding(s)`,
	);
	lines.push('');
	for (const row of result.rows) {
		lines.push(`${verdictFor(row).padEnd(4)} ${row.path || row.routeId}`);
		for (const [field, value] of reportFields(row)) {
			lines.push(`       ${field.padEnd(11)} ${value ?? '(absent)'}`);
		}
		if (row.status !== null && row.status !== undefined) {
			lines.push(`       ${'status'.padEnd(11)} ${row.status}`);
		} else {
			// "Not fetched" is stated, never implied by an absent line:
			// a reader must be able to tell a PASS from an unmeasured
			// row without counting lines (the HTML report says the same
			// thing in `<em>(not fetched)</em>`).
			lines.push(`       ${'status'.padEnd(11)} (not fetched)`);
		}
		for (const item of row.findings) {
			lines.push(`       !! [${item.rule}] ${item.message}`);
		}
		if (row.note) lines.push(`       -- ${row.note}`);
	}
	if (result.findings.length > 0) {
		lines.push('');
		lines.push('findings:');
		for (const item of result.findings) {
			lines.push(`  [${item.rule}] ${item.path || item.routeId}: ${item.message}`);
		}
	}
	return lines.join('\n');
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * Self-contained HTML report — no external stylesheet, no script, no
 * network reference. That is what makes it screenshot-able from a
 * `file://` URL by a headless browser without serving anything.
 *
 * @param {{ findings: Finding[], rows: HeadObservation[], stats: Record<string, number> }} result
 * @param {{ baseUrl?: string | null, capturedAt?: string | null }} [options]
 * @returns {string}
 */
export function renderHtmlReport(result, { baseUrl = null, capturedAt = null } = {}) {
	const verdictColors = { PASS: '#0f7b3f', FAIL: '#b3261e', SKIP: '#8a6d00' };
	const body = result.rows
		.map((row) => {
			const verdict = verdictFor(row);
			const cells = reportFields(row)
				.map(
					([field, value]) =>
						`<tr><th>${field}</th><td>${value === null ? '<em>(absent)</em>' : escapeHtml(value)}</td></tr>`,
				)
				.join('');
			const findings = row.findings
				.map((item) => `<li><code>${escapeHtml(item.rule)}</code> ${escapeHtml(item.message)}</li>`)
				.join('');
			return `<section class="row">
  <h2><span class="badge" style="background:${verdictColors[verdict]}">${verdict}</span> ${escapeHtml(row.path || row.routeId)}</h2>
  <table>${cells}<tr><th>http status</th><td>${row.status ?? '<em>(not fetched)</em>'}</td></tr></table>
  ${findings ? `<ul class="findings">${findings}</ul>` : ''}
  ${row.note ? `<p class="note">${escapeHtml(row.note)}</p>` : ''}
</section>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>public-route head metadata gate</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; margin: 32px; color: #14181f; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.meta { color: #5b6472; margin: 0 0 24px; }
  .summary { border: 1px solid #d7dce3; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; background: #f7f9fb; }
  .row { border: 1px solid #d7dce3; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  h2 { font-size: 15px; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
  .badge { color: #fff; border-radius: 4px; padding: 1px 8px; font-size: 12px; letter-spacing: .04em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 3px 8px 3px 0; border-top: 1px solid #eceff3; }
  th { width: 110px; color: #5b6472; font-weight: 500; }
  em { color: #98a1ae; }
  code { background: #f0f2f5; border-radius: 3px; padding: 0 4px; }
  ul.findings { margin: 8px 0 0; padding-left: 20px; color: #b3261e; }
  p.note { color: #5b6472; margin: 8px 0 0; }
</style>
</head>
<body>
<h1>public-route &lt;head&gt; metadata gate — Issue #418</h1>
<p class="meta">canonical origin <code>${escapeHtml(CANONICAL_ORIGIN)}</code>${
		baseUrl ? ` · captured from <code>${escapeHtml(baseUrl)}</code>` : ''
	}${capturedAt ? ` · ${escapeHtml(capturedAt)}` : ''}</p>
<div class="summary">${result.stats.inventory} routes discovered · ${result.rows.length} observed · ${
		result.findings.length
	} finding(s)</div>
${body}
</body>
</html>
`;
}
