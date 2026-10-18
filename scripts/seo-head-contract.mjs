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
 */
export function buildInventory(routeModules, samples = DYNAMIC_ROUTE_SAMPLES) {
	return routeModules.map(({ routeId, file }) => {
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
			// `null` when the sample is missing: the coverage rule
			// reports `inventory.dynamic-no-sample` for that route, and
			// an invented expected canonical here would let the missing
			// sample masquerade as a verified route.
			expectedCanonical: sample ? expectedCanonicalFor(routeId, sample.segment) : null,
		};
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
 * The first occurrence wins for every field, matching the head merge
 * (deepest matched route wins; the root's `my-web-2026` title is the
 * fallback a page without its own title inherits).
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
 */
export function evaluateObservation(observation, inventoryEntry = null) {
	/** @type {Finding[]} */
	const findings = [];
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
		if (observation.status !== null && observation.status !== 404) {
			findings.push(
				finding(
					'not-found.not-404',
					observation,
					`probe expected HTTP 404, received ${observation.status}`,
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
		findings.push(
			finding(
				'public.unexpected-noindex',
				observation,
				`public route declares robots="${head.robots}"`,
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

/** Plain-text report — the CLI default. Stable column order, no colour codes. */
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
