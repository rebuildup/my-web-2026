/**
 * Representative-route registry for the production synthetic smoke
 * (Issue #500).
 *
 * Why this module exists
 * ----------------------
 * Issue #500 asks the production smoke to register the representative
 * routes — `/`, `/about`, `/portfolio`, `/tools`, `/api/v1/health` — and
 * to verify three things per route: the HTTP response, the short
 * navigation path, and the default state. Before this module those
 * expectations lived as prose and scattered assertions, so the smoke
 * could only grow route-by-route and a reviewer could not see, in one
 * place, exactly what the smoke does and does not claim about
 * production.
 *
 * So the expectations live HERE as data, and `auditRoute()` turns one
 * route plus one observation into a list of human-readable problems.
 * That inversion is the whole point:
 *
 *   - `auditRoute()` is a pure function. `scripts/prod-smoke-routes.test.mjs`
 *     feeds it fabricated observations and asserts the classifier still
 *     catches every defect, WITHOUT a network, without workerd, and
 *     without production. A classifier that silently degraded into
 *     "always returns []" would be a false-success gate, and this test
 *     is what makes that impossible to ship.
 *   - `e2e/prod-smoke.spec.ts` is then a thin adapter: fetch the route
 *     read-only, observe it, assert the problem list is empty.
 *
 * Read-only by construction
 * -------------------------
 * Every entry declares `method: 'GET'` and the contract test rejects any
 * other value. The smoke issues no D1 write, no R2 write, no auth
 * mutation, and no cookie reset against production. The one place that
 * deliberately does mutate (the anonymous reaction mutation that proves
 * the `mw_actor_id` cookie) stays where it already lives, outside this
 * registry, because it is not a read-only representative-route check.
 *
 * Published information / outbound traffic / dependencies
 * -------------------------------------------------------
 * Stated once here so the audit surface is explicit rather than implied:
 *
 *   - Information this smoke reads: HTTP status, `Content-Type`, the
 *     final (post-redirect) path, `<title>`, `link[rel=canonical]`, the
 *     single `<h1>` plus its text, and the booleans named in each
 *     route's `defaultStates[].probes`. For `/tools` it also reads
 *     `data-tool-slug` off each rendered row so the set can be compared
 *     against `src/tools/manifest.json`.
 *   - Information this smoke NEVER reads: response bodies beyond the
 *     fields above, D1 rows, R2 objects, session cookies, headers that
 *     carry credentials, and any authenticated surface.
 *   - Outbound network traffic originates ONLY at the origin the spec is
 *     pointed at: the `baseURL` Playwright resolved, which is the
 *     canonical production origin declared in
 *     `CANONICAL_PRODUCTION_ORIGIN` for `pnpm run e2e:prod` /
 *     `pnpm run e2e:prod:transition`, and `http://127.0.0.1:3000` for
 *     `pnpm run e2e:prod:local` (an offline rehearsal of the same
 *     contract against the local build). No navigation is hardcoded to
 *     production, so an offline run cannot resolve the production
 *     hostname.
 *     The pages themselves reference Google Fonts, GA4, and
 *     `media.rebuildup.dev`; the smoke does not exercise those and does
 *     not assert on them, so this registry never becomes a third-party
 *     availability contract.
 *   - Dependencies the expectations rest on: the TanStack Router route
 *     tree (`src/routeTree.gen.ts`), the Tool Registry manifest
 *     (`src/tools/manifest.json`) and its delivery rules
 *     (`src/tools/registry.ts`), the Hono external boundary
 *     (`src/http/hono.ts`), and `src/editorial/nav/PublicNav.tsx`. The
 *     contract test re-derives each of these from disk so a registry
 *     entry cannot outlive the route it names.
 *
 * PHASE SCOPING — WHY THIS IS A POST-DEPLOY SMOKE
 * ----------------------------------------------
 * Every expectation below is a RELEASE-BRANCH fact: the Tool Registry
 * row set, the home / about section counts, the declared `<title>` and
 * `<h1>` text, the canonical hrefs. Smoke #1 (`transition`) runs before
 * the release PR merges, so production still serves the previous `main`
 * build and legitimately differs from this branch. Asserting release
 * expectations against a pre-deploy deployment would fail the mandatory
 * pre-merge smoke for a difference nobody shipped, and the runbook's
 * Smoke #1 failure branch is a release blocker. So the representative
 * routes are registered in Smoke #2 (`versioned`, POST-deploy) only,
 * which is also exactly what Issue #500 asks for ("deploy 後に … 検証").
 *
 * That is also why the `/tools` default state may compare production
 * against the manifest in THIS working tree while `/api/v1/health#version`
 * is only shape-checked: in the `versioned` phase the deployed artifact
 * is the merge of this branch, so a manifest difference is an actionable
 * drift, whereas a version literal is a moving number with no failure
 * mode attached to it.
 *
 * NO RELEASE VERSION LITERAL
 * --------------------------
 * `/api/v1/health` returns a `version` field, and this module
 * deliberately does NOT pin it to `package.json#version`. Production is
 * deployed by Cloudflare Workers Builds on `main`; the repository sits on
 * the open release branch, so the two legitimately differ for the whole
 * sprint. Asserting equality would produce a guaranteed-false red on
 * every pre-release smoke. The field is checked for being a well-formed
 * semantic version instead — a real property of the response, not a
 * restatement of a moving number.
 */

import { PRODUCTION_CUSTOM_DOMAIN } from './_cloudflare-contract.mjs';

/**
 * Canonical production origin (ADR-0014 / Issue #43). Derived from the
 * shared Cloudflare contract rather than restated, so the smoke cannot
 * drift onto a debug `*.workers.dev` host.
 */
export const CANONICAL_PRODUCTION_ORIGIN = `https://${PRODUCTION_CUSTOM_DOMAIN}`;

/**
 * A boolean observation the classifier needs but the audit description
 * alone would not pin down. Every key in a `defaultStates[].probes`
 * object must be produced by the Playwright adapter.
 *
 * @typedef {Record<string, boolean>} DefaultProbes
 */

/**
 * @typedef {object} DefaultState
 * @property {string} name Stable identifier, printed in the failure report.
 * @property {string} description What this branch means operationally.
 * @property {DefaultProbes} probes All probes must hold for the branch to match.
 */

/**
 * @typedef {object} RepresentativeRoute
 * @property {string} path Absolute path on the canonical origin.
 * @property {'page'|'api'} kind `page` renders HTML; `api` returns JSON.
 * @property {'GET'} method Read-only by construction — see the module header.
 * @property {string} label Short English label used in test titles.
 * @property {number} status The only acceptable HTTP status.
 * @property {string} contentType Expected `Content-Type` prefix.
 * @property {RegExp|null} titlePattern Expected `<title>` shape, or null when the route declares no title.
 * @property {string|null} canonical Expected `link[rel=canonical]` href, or null when the route declares none today.
 * @property {string|null} h1 Selector for the route's single `<h1>`, or null for `api` routes.
 * @property {RegExp|null} h1TextPattern Expected `<h1>` text shape, or null when the text is personal data.
 * @property {ReadonlyArray<DefaultState>} defaultStates Every documented default; exactly one must match.
 */

/**
 * The five representative routes Issue #500 names, in navigation order
 * from the home page.
 *
 * `canonical` is `null` for `/` and `/tools` because neither route
 * declares `link[rel=canonical]` today — a fact recorded here rather
 * than asserted as a defect, because adding a canonical later is an
 * improvement, not a regression. The two routes that DO declare one are
 * pinned to their exact value so a canonical pointing at the debug host
 * (or at another origin) is still a red.
 */
export const REPRESENTATIVE_ROUTES = Object.freeze([
	Object.freeze({
		path: '/',
		kind: 'page',
		method: 'GET',
		label: 'Home',
		status: 200,
		contentType: 'text/html',
		titlePattern: /^my-web-2026$/,
		canonical: null,
		h1: 'h1',
		h1TextPattern: /^my-web-2026$/,
		defaultStates: Object.freeze([
			Object.freeze({
				name: 'home-default',
				description:
					'all six default sections render and the reactions widget is configured (no disabled placeholder)',
				probes: Object.freeze({ sixSections: true, reactionsDisabled: false }),
			}),
		]),
	}),
	Object.freeze({
		path: '/about',
		kind: 'page',
		method: 'GET',
		label: 'About',
		status: 200,
		contentType: 'text/html',
		titlePattern: / — About$/,
		canonical: `${CANONICAL_PRODUCTION_ORIGIN}/about`,
		h1: 'h1#about-hero-title',
		h1TextPattern: null,
		defaultStates: Object.freeze([
			Object.freeze({
				name: 'about-identity',
				description:
					'the repo-controlled identity snapshot renders (identity heading + five narrative sections)',
				probes: Object.freeze({ identityHeading: true, narrativeSections: true }),
			}),
		]),
	}),
	Object.freeze({
		path: '/portfolio',
		kind: 'page',
		method: 'GET',
		label: 'Portfolio',
		status: 200,
		contentType: 'text/html',
		titlePattern: /^Portfolio — /,
		canonical: `${CANONICAL_PRODUCTION_ORIGIN}/portfolio`,
		h1: 'h1#portfolio-heading',
		h1TextPattern: /^主要な制作物/,
		defaultStates: Object.freeze([
			Object.freeze({
				name: 'catalogue-empty',
				description:
					'no published entry yet (pre-publication default) — the empty state renders and no project card does',
				probes: Object.freeze({ emptyState: true, projectCard: false }),
			}),
			Object.freeze({
				name: 'catalogue-published',
				description:
					'at least one published entry — the project card list renders and the empty state does not',
				probes: Object.freeze({ emptyState: false, projectCard: true }),
			}),
		]),
	}),
	Object.freeze({
		path: '/tools',
		kind: 'page',
		method: 'GET',
		label: 'Tools',
		status: 200,
		contentType: 'text/html',
		titlePattern: /^Tools — my-web-2026$/,
		canonical: null,
		h1: 'h1',
		h1TextPattern: /\/ Tools$/,
		defaultStates: Object.freeze([
			Object.freeze({
				name: 'tools-registry',
				description:
					'every manifest Tool renders as one row classified the way its manifest delivery kind demands: a public Tool links to its own /tools/<slug>, a host_disabled Tool shows the Coming soon badge and links nowhere',
				probes: Object.freeze({ allManifestSlugsListed: true, everyRowClassified: true }),
			}),
		]),
	}),
	Object.freeze({
		path: '/api/v1/health',
		kind: 'api',
		method: 'GET',
		label: 'Health API',
		status: 200,
		contentType: 'application/json',
		titlePattern: null,
		canonical: null,
		h1: null,
		h1TextPattern: null,
		defaultStates: Object.freeze([
			Object.freeze({
				name: 'healthy',
				description:
					'the external boundary answers with its documented healthy payload and a well-formed semantic version',
				probes: Object.freeze({
					statusOk: true,
					serviceIdentity: true,
					boundaryLayer: true,
					semverVersion: true,
				}),
			}),
		]),
	}),
]);

/**
 * Delivery kinds the `/tools` index renders as a LINKED row.
 *
 * Mirrors `PUBLIC_DELIVERY_KINDS` in `src/tools/registry.ts` (which
 * drives `listPublicTools()`). The registry contract test re-derives the
 * set from that source, so this copy cannot drift.
 *
 * Why the classification is checked against the manifest rather than
 * against the rendered attribute: a Tool that is public in the manifest
 * but renders as `data-tool-state="host_disabled"` (or a disabled row
 * that renders a link) still renders a correct `data-tool-slug` set, so
 * a set comparison alone would call a fully regressed index healthy.
 *
 * @type {ReadonlyArray<string>}
 */
export const LINKED_TOOL_DELIVERY_KINDS = Object.freeze([
	'same_origin_static',
	'external_exception',
]);

/**
 * Section counts the page routes' documented default states depend on.
 *
 * These are composition facts, so they live next to the route contract
 * instead of as literals inside the Playwright adapter: one place to
 * edit when `/` or `/about` changes shape, and the same prose the
 * failure report names. The local Playwright suites pin the same facts
 * against a real render (`e2e/smoke.spec.ts` for the six home sections,
 * `e2e/about.spec.ts` for the five narrative sections), so a composition
 * change is caught locally long before a production smoke can see it.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, number>>>>}
 */
export const EXPECTED_SECTION_COUNTS = Object.freeze({
	'/': Object.freeze({ labelled: 6 }),
	'/about': Object.freeze({ narrative: 5 }),
});

/** @returns {ReadonlyArray<RepresentativeRoute>} */
export const REPRESENTATIVE_PAGE_ROUTES = Object.freeze(
	REPRESENTATIVE_ROUTES.filter((route) => route.kind === 'page'),
);

/** @returns {ReadonlyArray<RepresentativeRoute>} */
export const REPRESENTATIVE_API_ROUTES = Object.freeze(
	REPRESENTATIVE_ROUTES.filter((route) => route.kind === 'api'),
);

/**
 * One-click paths from the home page to every representative page route
 * except `/` itself. These are the "short navigation path" the Issue
 * asks the smoke to check.
 *
 * `/` carries no `PublicNav` (Issue #199), so the entry points live in
 * its content: the hero CTA cluster for `/about` and `/portfolio`, and
 * the capabilities card for `/tools` (Issue #168). `e2e/nav.spec.ts` and
 * `e2e/about.spec.ts` already pin these locally; registering them here
 * is what makes production carry the same contract.
 *
 * @type {ReadonlyArray<{from: string, to: string, selector: string}>}
 */
export const ONE_CLICK_ENTRIES = Object.freeze([
	Object.freeze({
		from: '/',
		to: '/about',
		selector: 'section[aria-labelledby="hero-title"] a[href="/about"]',
	}),
	Object.freeze({
		from: '/',
		to: '/portfolio',
		selector: 'section[aria-labelledby="hero-title"] a[href="/portfolio"]',
	}),
	Object.freeze({
		from: '/',
		to: '/tools',
		selector: 'section[aria-labelledby="capabilities-heading"] a[href="/tools"]',
	}),
]);

/**
 * Representative page routes that mount `PublicNav` and therefore offer
 * a one-click link to every other representative page route.
 *
 * `/` and `/tools` are deliberately absent, not accidentally unchecked:
 * Issue #199 keeps site chrome off the home surface, and Issue #288
 * removed it from all three Tools surfaces because the iframe shell
 * wants the full viewport. Consequence, recorded so nobody reads the
 * absence as a gap: `/tools` currently has no in-site link back to `/`.
 * That is an information-architecture fact owned by the routes, and
 * changing it here would be whole-page composition work, which Issue
 * #500 explicitly defers.
 *
 * @type {ReadonlyArray<string>}
 */
export const CHROME_NAV_ROUTES = Object.freeze(['/about', '/portfolio']);

/**
 * @param {string} path
 * @returns {RepresentativeRoute|undefined}
 */
export function findRepresentativeRoute(path) {
	return REPRESENTATIVE_ROUTES.find((route) => route.path === path);
}

/**
 * @typedef {object} RouteObservation
 * @property {number} status HTTP status of the response.
 * @property {string} contentType `Content-Type` response header.
 * @property {string} finalPath Pathname the response was actually served from (redirects followed).
 * @property {string|null} title `<title>` text, or null when the document declares none.
 * @property {string|null} canonicalHref `link[rel=canonical]` href, or null when absent.
 * @property {number} h1Count How many `<h1>` elements the document contains.
 * @property {boolean} h1Visible Whether the declared `<h1>` selector matched a visible element.
 * @property {string|null} h1Text Text content of the declared `<h1>`, or null when absent.
 * @property {object|null} json Parsed JSON body, or null when the body is not JSON.
 * @property {DefaultProbes} defaultProbes Booleans named by the route's `defaultStates[].probes`.
 */

/**
 * Which documented default state (if any) the observation falls into.
 *
 * Returns the FIRST fully-matching state, or null when none matches.
 * null is a failure signal, never a pass: a route that renders some
 * undocumented state (both portfolio branches at once, a `/tools` page
 * with an unclassifiable row) must be red rather than waved through as
 * "close enough".
 *
 * @param {RepresentativeRoute} route
 * @param {DefaultProbes} probes
 * @returns {string|null} The matching state's `name`.
 */
export function resolveDefaultState(route, probes) {
	for (const state of route.defaultStates) {
		const matches = Object.entries(state.probes).every(
			([key, expected]) => probes[key] === expected,
		);
		if (matches) return state.name;
	}
	return null;
}

/**
 * Classify one observation against one route contract.
 *
 * Returns a problem list rather than throwing on the first defect, so a
 * broken deployment reports everything that is wrong at once. An empty
 * array is the only value that means "this route is healthy".
 *
 * @param {RepresentativeRoute} route
 * @param {RouteObservation} observation
 * @returns {ReadonlyArray<string>}
 */
export function auditRoute(route, observation) {
	/** @type {string[]} */
	const problems = [];

	if (observation.status !== route.status) {
		problems.push(`HTTP ${route.path}: expected status ${route.status}, got ${observation.status}`);
	}

	// Anti-false-success guard. Playwright's request fixture follows
	// redirects, so a route that 302s to a working page would otherwise
	// satisfy every remaining assertion. A representative route must
	// serve ITSELF.
	if (observation.finalPath !== route.path) {
		problems.push(
			`HTTP ${route.path}: served from "${observation.finalPath}" after redirects — this route is not answering for itself`,
		);
	}

	if (!observation.contentType.toLowerCase().startsWith(route.contentType)) {
		problems.push(
			`HTTP ${route.path}: expected Content-Type starting with "${route.contentType}", got "${observation.contentType}"`,
		);
	}

	if (route.titlePattern !== null) {
		if (observation.title === null) {
			problems.push(`HTTP ${route.path}: the document declares no <title>`);
		} else if (!route.titlePattern.test(observation.title)) {
			problems.push(
				`HTTP ${route.path}: <title> "${observation.title}" does not match ${route.titlePattern}`,
			);
		}
	}

	if (route.canonical !== null && observation.canonicalHref !== route.canonical) {
		problems.push(
			`HTTP ${route.path}: expected link[rel=canonical] href "${route.canonical}", got ${
				observation.canonicalHref === null ? 'no canonical link' : `"${observation.canonicalHref}"`
			}`,
		);
	}

	if (route.h1 !== null) {
		if (observation.h1Count !== 1) {
			problems.push(`HTTP ${route.path}: expected exactly one <h1>, got ${observation.h1Count}`);
		} else if (!observation.h1Visible) {
			problems.push(`HTTP ${route.path}: the <h1> (${route.h1}) is present but not visible`);
		}
		if (route.h1TextPattern !== null) {
			if (observation.h1Text === null) {
				problems.push(`HTTP ${route.path}: no readable <h1> text to match ${route.h1TextPattern}`);
			} else if (!route.h1TextPattern.test(observation.h1Text.trim())) {
				problems.push(
					`HTTP ${route.path}: <h1> text "${observation.h1Text.trim()}" does not match ${route.h1TextPattern}`,
				);
			}
		}
	}

	if (route.kind === 'api' && observation.json === null) {
		problems.push(`HTTP ${route.path}: the response body is not parseable JSON`);
	}

	const resolved = resolveDefaultState(route, observation.defaultProbes);
	if (resolved === null) {
		const observed = Object.entries(observation.defaultProbes)
			.map(([key, value]) => `${key}=${value}`)
			.join(', ');
		const documented = route.defaultStates
			.map(
				(state) =>
					`${state.name} (${Object.entries(state.probes)
						.map(([key, value]) => `${key}=${value}`)
						.join(', ')})`,
			)
			.join(' | ');
		problems.push(
			`HTTP ${route.path}: no documented default state matched — observed [${observed}]; documented ${documented}`,
		);
	}

	return problems;
}

/**
 * Render a problem list as one assertion message.
 *
 * The message names the origin that was actually observed (default: the
 * canonical production origin) plus the route and every individual
 * problem, because a production smoke is often read from a CI log weeks
 * later by someone who was not in the room when it went red — and a
 * rehearsal run must not print a production URL it never touched.
 *
 * @param {RepresentativeRoute} route
 * @param {ReadonlyArray<string>} problems
 * @param {string} [origin]
 * @returns {string}
 */
export function formatAuditReport(route, problems, origin = CANONICAL_PRODUCTION_ORIGIN) {
	if (problems.length === 0) return `${origin}${route.path} — healthy`;
	const lines = problems.map((problem) => `  - ${problem}`);
	return [
		`${origin}${route.path} failed the Issue #500 synthetic smoke contract:`,
		...lines,
		'',
		'This is a read-only check. Nothing in this smoke writes to D1 / R2,',
		`mutates auth, or resets cookies against ${origin}.`,
	].join('\n');
}
