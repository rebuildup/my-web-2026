/**
 * SEO HTTP status contract — pure logic, no filesystem access (Issue #419).
 *
 * What this contract owns
 * -----------------------
 * For every class of request this platform answers, the HTTP status it
 * must answer with, the `<meta name="robots">` state the served document
 * must (or must not) carry, and the surface a visitor must land on.
 *
 * The three existing SEO contracts each answer a DIFFERENT question,
 * and none of them answers this one:
 *
 *   - `scripts/_index-boundary.mjs` (Issue #423): which URLs may be
 *     crawled and which may be indexed. It reads `head()` SOURCE and
 *     the crawler documents; it never issues a request, so it cannot
 *     know what the Worker actually answered.
 *   - `src/editorial/error-states/contract.ts` (Issue #501): what a
 *     failure surface PUBLISHES (copy, affordances, withheld detail).
 *     It deliberately records the `503` label as a CONDITION label, not
 *     a response status (see `openDecision` below).
 *   - this module: the response STATUS itself. `404` for a URL that
 *     does not resolve, `500`/`503` for a request that could not be
 *     answered, `307 → /admin/login` for an unauthenticated admin
 *     request, and — the failure this Issue exists for — never `200`
 *     for content that is not published.
 *
 * Why a written contract instead of more assertions per suite
 * -----------------------------------------------------------
 * The 404 / 500 / publication assertions already existed, but they were
 * scattered across `test/integration/error-states.test.ts`,
 * `test/integration/index-boundary.test.ts`, `e2e/portfolio.spec.ts`
 * and `e2e/about.spec.ts`, each restating its own expectation. That
 * shape has two failure modes this contract removes:
 *
 *   1. An UNREVIEWED request class is nobody's job. A new route, a new
 *      publication state or a new failure path is added, no suite
 *      mentions it, and the suite stays green — which is
 *      indistinguishable from "verified".
 *   2. A case that is written down but never EXERCISED looks exactly
 *      like a case that is exercised. Writing `expect 404` in a
 *      fixture nobody reads is not a test.
 *
 * So the contract is exhaustive over the route tree, and every case
 * names the file that PROVES it. `scripts/check-seo-status-contract.mjs`
 * fails when a route has no case (`unclassified-route`), when a case
 * names a route the router no longer serves (`stale-case`), and when a
 * proof file does not exist or never mentions the case id
 * (`unproven-case`). The claim and its evidence are checked against
 * each other, in both directions.
 *
 * Who consumes it
 * ---------------
 *   - `scripts/check-seo-status-contract.mjs` — the offline gate
 *     (route coverage + proof wiring + `--report` table).
 *   - `scripts/check-seo-status-contract.test.mjs` — node:test unit
 *     tests for the evaluator below.
 *   - `test/integration/seo-status-contract.test.ts` — the workerd
 *     proof: it fetches each case through the real Worker and feeds the
 *     observation back into `evaluateObservation`, so the suite cannot
 *     assert less than the contract says.
 *   - `e2e/seo-status.spec.ts` — the browser proof over a real
 *     `vite preview` origin.
 *   - `scripts/capture-seo-status-report.mjs` — the committed
 *     verification screenshot, rendered from the same table.
 *
 * Honest boundaries of the contract
 * ---------------------------------
 *   - A failure document carries NO `robots` meta. De-indexing there is
 *     carried by the STATUS (`404` / `5xx` are not indexable results),
 *     not by a `noindex` the failure surface would have to invent. The
 *     two places that DO carry `noindex` are the routes that answer
 *     `200` to a crawler but must stay out of the index: the Tool shell
 *     (`/tools/$slug`) and the admin subtree (via the admin layout
 *     head).
 *   - `openDecision` records a case whose served status is currently
 *     IMPERFECT. They are written into the table rather than hidden:
 *     `docs/verification/ops/error-state-gallery.md` §7 #2 / #8 own
 *     them, and a reader of this file must be able to see which rows
 *     are known-imperfect instead of discovering it from a search
 *     result.
 */

/**
 * `<meta name="robots">` states the contract distinguishes.
 * `not-applicable` is used by rows whose response is a redirect or a
 * non-HTML document, where no robots meta can exist.
 */
export const ROBOTS_STATES = Object.freeze(['absent', 'noindex', 'declared', 'not-applicable']);

/**
 * Surfaces an observation can land on. `page` is "a real rendered
 * document"; `machine` is a non-HTML crawler document (`/sitemap.xml`).
 */
export const SURFACES = Object.freeze([
	'page',
	'document',
	'machine',
	'not_found',
	'service_unavailable',
	'tools_not_found',
	'redirect',
]);

/** Route-tree paths that are NOT routes of the SSR tree. */
export const NON_ROUTE_MARKERS = Object.freeze(['(unmatched)', '(external-boundary)', '(sitemap)']);

const WORKERD_PROOF = Object.freeze({
	layer: 'workerd',
	file: 'test/integration/seo-status-contract.test.ts',
});
const BROWSER_PROOF = Object.freeze({ layer: 'browser', file: 'e2e/seo-status.spec.ts' });

/**
 * The exhaustive status matrix.
 *
 * Read the `expect` block as: "when this request is made against a
 * correctly bootstrapped environment, this is what comes back". The
 * `why` column is the reason the row exists — it is what a reviewer
 * reads to decide whether the row should be changed, so it names the
 * failure it prevents rather than restating the status.
 */
export const HTTP_STATUS_EXPECTATIONS = Object.freeze([
	// ── Public documents: 200, indexable, listed ──────────────────────
	{
		id: 'public-home',
		route: '/',
		request: 'GET / (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'The canonical URL. A non-200 here is a site-wide outage, and a stray noindex would silently de-index the whole home surface.',
		openDecision: null,
	},
	{
		id: 'public-about',
		route: '/about',
		request: 'GET /about (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'Public profile page; a failure read must degrade, not 500 (Issue #457 established the non-throwing boundary).',
		openDecision: null,
	},
	{
		id: 'public-contact',
		route: '/contact',
		request: 'GET /contact (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'Public contact page. Carries no robots meta — the "unintended whole-site noindex" failure is silent by nature.',
		openDecision: null,
	},
	{
		id: 'public-portfolio-index',
		route: '/portfolio',
		request: 'GET /portfolio (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'The list surface crawlers reach published project URLs through; it must be the only door to a published detail page.',
		openDecision: null,
	},
	{
		id: 'public-tools-index',
		route: '/tools',
		request: 'GET /tools (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'Public Tool index. It links to `/tools/$slug`, whose own noindex must not leak onto the index that lists them.',
		openDecision: null,
	},
	{
		id: 'public-design-system',
		route: '/design-system',
		request: 'GET /design-system (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF],
		why: 'A second public page with no robots meta: one sample is a coincidence, two is a pattern.',
		openDecision: null,
	},
	{
		id: 'public-projects-dotfiles',
		route: '/projects/dotfiles',
		request: 'GET /projects/dotfiles (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'excluded',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'Public project introduction rendered from a committed snapshot. A 200 with no robots meta is the contract; an unavailable upstream is represented INSIDE the document, never by turning the page into a 404/5xx or a noindex.',
		openDecision: null,
	},
	// ── 200 but not indexable ─────────────────────────────────────────
	{
		id: 'tool-detail-noindex',
		route: '/tools/$slug',
		request: 'GET /tools/prototype (anonymous, registry slug)',
		expect: { status: 200, robots: 'noindex', surface: 'page' },
		sitemap: 'excluded',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'The Tool shell answers 200 to a crawler but must stay out of the index; the noindex is the only mechanism that can do that, which is also why robots.txt carries no Disallow (Issue #423).',
		openDecision: null,
	},
	{
		id: 'admin-login-anonymous',
		route: '/admin/login',
		request: 'GET /admin/login (anonymous)',
		expect: { status: 200, robots: 'noindex', surface: 'page' },
		sitemap: 'excluded',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'The only admin URL an anonymous client can render, therefore the observable proof that the admin layout noindex reaches the matched route chain.',
		openDecision: null,
	},
	// ── Publication boundary (the 誤200 failure this Issue exists for) ─
	{
		id: 'portfolio-published',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<published + public row> (anonymous)',
		expect: { status: 200, robots: 'absent', surface: 'page' },
		sitemap: 'listed',
		proves: [WORKERD_PROOF],
		why: 'The positive control: if this row 404s, the visibility filter has become "de-index everything", which no other assertion would notice.',
		openDecision: null,
	},
	{
		id: 'portfolio-draft-not-found',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<visibility=draft row>',
		expect: { status: 404, robots: 'absent', surface: 'not_found' },
		sitemap: 'excluded',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'An unpublished project must be indistinguishable from one that does not exist. A 200 here would publish unreleased work to every crawler that guesses the slug.',
		openDecision: null,
	},
	{
		id: 'portfolio-unlisted-not-found',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<visibility=unlisted row>',
		expect: { status: 404, robots: 'absent', surface: 'not_found' },
		sitemap: 'excluded',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: '`unlisted` means reachable by direct link but never advertised — not by the sitemap and not by the loader the detail route reads.',
		openDecision: null,
	},
	{
		id: 'portfolio-archived-not-found',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<status=archived row>',
		expect: { status: 404, robots: 'absent', surface: 'not_found' },
		sitemap: 'excluded',
		proves: [WORKERD_PROOF],
		why: 'Archived work is withdrawn: a stale 200 would keep serving a page the owner has taken down.',
		openDecision: null,
	},
	{
		id: 'portfolio-unknown-slug-not-found',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<slug with no row>',
		expect: { status: 404, robots: 'absent', surface: 'not_found' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'A slug that was never published is the same answer as a withdrawn one — the boundary must not leak which is which.',
		openDecision: null,
	},
	{
		id: 'sitemap-excludes-unpublished',
		route: '(sitemap)',
		request: 'GET /sitemap.xml with draft / unlisted / archived rows present',
		expect: { status: 200, robots: 'not-applicable', surface: 'document' },
		sitemap: 'proves-itself',
		proves: [WORKERD_PROOF],
		why: 'The sitemap is the only surface that could publish an unpublished project to every crawler at once; it must list the published + public row and nothing else.',
		openDecision: null,
	},
	// ── Failure surfaces ─────────────────────────────────────────────
	{
		id: 'unmatched-route-not-found',
		route: '(unmatched)',
		request: 'GET /this-route-does-not-exist',
		expect: { status: 404, robots: 'absent', surface: 'not_found' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'A URL the router does not know must answer 404 with a readable document, never a 200 shell (Issue #501).',
		openDecision: null,
	},
	{
		id: 'tools-unknown-slug-not-found',
		route: '/tools/$slug',
		request: 'GET /tools/<slug absent from the registry>',
		expect: { status: 404, robots: 'noindex', surface: 'tools_not_found' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'The route owns a Tool-specific 404 (Issue #183). It must still be a 404 and still carry noindex, or a removed Tool keeps a crawlable empty shell.',
		openDecision: null,
	},
	{
		id: 'portfolio-loader-failure',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<slug> while the portfolio read fails (D1 unavailable)',
		expect: { status: 500, robots: 'absent', surface: 'service_unavailable' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'A transient dependency failure is reported as a fault (never a 200 page) and offers retry. The status is 500 while the surface label is 503 — see openDecision.',
		openDecision:
			"error-state-gallery.md §7 #2 — the served status for a loader failure stays the framework 500; changing it to 503 is an external contract decision (monitoring / cache / retry), not this Issue's.",
	},
	{
		id: 'portfolio-invalid-slug-loader-failure',
		route: '/portfolio/$slug',
		request: 'GET /portfolio/<slug outside the slug grammar>',
		expect: { status: 500, robots: 'absent', surface: 'service_unavailable' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'A mistyped slug is answered with a retry affordance the platform cannot honour, because the route validates inside its loader instead of in validateParams. Recorded, not hidden.',
		openDecision:
			'error-state-gallery.md §7 #8 (b) — move the slug grammar to validateParams so a permanent input failure reaches the not_found surface.',
	},
	{
		id: 'portfolio-invalid-query-input-failure',
		route: '/portfolio',
		request: 'GET /portfolio?facets=a&facets=b (repeated param the search schema rejects)',
		expect: { status: 500, robots: 'absent', surface: 'not_found' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'The surface is already the correct 404 one (Issue #501); the response status is still the framework error status, so this row pins the gap rather than hiding it.',
		openDecision:
			'error-state-gallery.md §7 #8 (a) — whether a permanent client-input failure should answer 400/404 instead of 500 is an open contract decision.',
	},
	{
		id: 'admin-invitations-accept-invalid-token',
		route: '/admin/invitations/accept',
		request: 'GET /admin/invitations/accept (missing or short token)',
		expect: { status: 500, robots: 'noindex', surface: 'not_found' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'The one admin URL reachable without a session answers the failure surface (never a redirect, never a 200 view) and still carries the admin noindex through the matched layout.',
		openDecision:
			'error-state-gallery.md §7 #8 (a) — same response-status gap as the repeated-param case above.',
	},
	// ── Admin gate: never 200, never an indexable document ────────────
	{
		id: 'admin-anonymous-redirect',
		route: '/admin',
		request: 'GET /admin (anonymous)',
		expect: {
			status: [301, 302, 303, 307, 308],
			robots: 'not-applicable',
			surface: 'redirect',
			locationContains: '/admin/login',
		},
		sitemap: 'excluded',
		proves: [WORKERD_PROOF, BROWSER_PROOF],
		why: 'The gate must refuse with a redirect that names the login page; a 200 here would render the admin surface to a crawler (Issue #423).',
		openDecision: null,
	},
	{
		id: 'admin-keys-anonymous-redirect',
		route: '/admin/keys',
		request: 'GET /admin/keys (anonymous)',
		expect: {
			status: [301, 302, 303, 307, 308],
			robots: 'not-applicable',
			surface: 'redirect',
			locationContains: '/admin/login',
		},
		sitemap: 'excluded',
		proves: [WORKERD_PROOF],
		why: 'The gate is per-loader, not only on the layout; one child proves it, the rest are proved by the matrix coverage rule.',
		openDecision: null,
	},
	{
		id: 'admin-images-anonymous-redirect',
		route: '/admin/images',
		request: 'GET /admin/images (anonymous)',
		expect: {
			status: [301, 302, 303, 307, 308],
			robots: 'not-applicable',
			surface: 'redirect',
			locationContains: '/admin/login',
		},
		sitemap: 'excluded',
		proves: [WORKERD_PROOF],
		why: 'Admin child coverage: an unauthenticated image surface would otherwise be reachable with no status row of its own.',
		openDecision: null,
	},
	{
		id: 'admin-invitations-anonymous-redirect',
		route: '/admin/invitations',
		request: 'GET /admin/invitations (anonymous)',
		expect: {
			status: [301, 302, 303, 307, 308],
			robots: 'not-applicable',
			surface: 'redirect',
			locationContains: '/admin/login',
		},
		sitemap: 'excluded',
		proves: [WORKERD_PROOF],
		why: 'Admin child coverage: the invitation roster is the most sensitive anonymous-reachable surface if the gate regresses.',
		openDecision: null,
	},
	{
		id: 'admin-emoji-catalog-anonymous-redirect',
		route: '/admin/emoji-catalog',
		request: 'GET /admin/emoji-catalog (anonymous)',
		expect: {
			status: [301, 302, 303, 307, 308],
			robots: 'not-applicable',
			surface: 'redirect',
			locationContains: '/admin/login',
		},
		sitemap: 'excluded',
		proves: [WORKERD_PROOF],
		why: 'Admin child coverage: same gate, same proof obligation, no exceptions.',
		openDecision: null,
	},
	{
		id: 'admin-signin-rejected',
		route: '(external-boundary)',
		request: 'POST /api/v1/auth/sign-in/email with an unknown account / wrong password',
		expect: { status: 401, robots: 'not-applicable', surface: 'machine' },
		sitemap: 'not-applicable',
		proves: [WORKERD_PROOF],
		why: 'The auth failure that matters to a person: a refused sign-in must be a 401 with no information about which half was wrong (Issue #456), never a 200 login shell.',
		openDecision: null,
	},
]);

/** Look a case up by id. */
export const HTTP_STATUS_EXPECTATION_BY_ID = Object.freeze(
	Object.fromEntries(HTTP_STATUS_EXPECTATIONS.map((entry) => [entry.id, entry])),
);

/**
 * Robots state of a served document.
 *
 * `absent` — no `<meta name="robots">` at all (the default for a public
 * document AND for every failure surface, which is de-indexed by its
 * status instead).
 * `noindex` — a robots meta carrying `noindex`.
 * `declared` — a robots meta that says something else; kept as its own
 * state so an unexpected directive is reported instead of folded into
 * "not noindex".
 */
export function robotsStateFromHtml(html) {
	const match = /<meta[^>]*\bname="robots"[^>]*>/.exec(html ?? '');
	if (!match) return 'absent';
	const content = /\bcontent="([^"]*)"/.exec(match[0])?.[1] ?? '';
	return /\bnoindex\b/i.test(content) ? 'noindex' : 'declared';
}

/**
 * The failure surface a served document rendered.
 *
 * Reads the shipped `data-error-state` marker (`src/editorial/error-states/`)
 * and the Tool route's own `data-testid` (Issue #183). A document with
 * neither is a real page — which is exactly the assertion the 誤200
 * acceptance condition needs.
 */
export function surfaceFromHtml(html) {
	const errorState = /data-error-state="([a-z_]+)"/.exec(html ?? '')?.[1];
	if (errorState) return errorState;
	if (/data-testid="tools-not-found"/.test(html ?? '')) return 'tools_not_found';
	return 'page';
}

/**
 * Build an observation from a real response.
 *
 * `html` is optional so a redirect (which carries no body) can be
 * observed without inventing a surface for it.
 */
export function observeResponse(response, html) {
	if (response.status >= 300 && response.status < 400) {
		return {
			status: response.status,
			location: response.headers.get('location'),
			robots: 'not-applicable',
			surface: 'redirect',
		};
	}
	// A non-HTML response (`/sitemap.xml`) is still a document, just not
	// one that can render a failure surface.
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('text/html')) {
		return {
			status: response.status,
			location: response.headers.get('location'),
			robots: 'not-applicable',
			surface: 'document',
		};
	}
	return {
		status: response.status,
		location: response.headers.get('location'),
		robots: robotsStateFromHtml(html),
		surface: surfaceFromHtml(html),
	};
}

/** True when `status` is one of the accepted values (number or list). */
function statusMatches(expected, status) {
	const accepted = Array.isArray(expected) ? expected : [expected];
	return accepted.includes(status);
}

/** A 3xx response carries no document, so it has no surface to read. */
function isRedirect(status) {
	return typeof status === 'number' && status >= 300 && status < 400;
}

/**
 * Compare one observation against one contract row.
 *
 * `observed` accepts either the shape `observeResponse` returns or a
 * full one: a caller that reads the HTML itself (Playwright, a browser
 * DOM) may pass `{ status, html }` and let the same helpers derive the
 * robots state and surface.
 *
 * @returns {Array<{code: string, message: string}>} empty when the
 * observation satisfies the contract.
 */
export function evaluateObservation(expectation, observed) {
	const violations = [];
	const where = `${expectation.id} (${expectation.request})`;
	if (typeof observed?.status !== 'number') {
		return [{ code: 'observation-missing', message: `${where}: no status was observed` }];
	}
	if (!statusMatches(expectation.expect.status, observed.status)) {
		const wanted = Array.isArray(expectation.expect.status)
			? expectation.expect.status.join('|')
			: String(expectation.expect.status);
		violations.push({
			code: 'status-mismatch',
			message: `${where}: expected status ${wanted}, observed ${observed.status}`,
		});
	}

	const expectedRobots = expectation.expect.robots;
	if (expectedRobots !== 'not-applicable') {
		const robots = observed.robots ?? robotsStateFromHtml(observed.html);
		if (robots !== expectedRobots) {
			violations.push({
				code: 'robots-mismatch',
				message: `${where}: expected robots "${expectedRobots}", observed "${robots}"`,
			});
		}
	}

	const expectedSurface = expectation.expect.surface;
	if (expectedSurface !== 'machine') {
		// A redirect has no body; deriving its surface from the status keeps
		// a caller that only recorded status + Location honest.
		const surface =
			observed.surface ??
			(isRedirect(observed.status) ? 'redirect' : surfaceFromHtml(observed.html));
		if (surface !== expectedSurface) {
			violations.push({
				code: 'surface-mismatch',
				message: `${where}: expected surface "${expectedSurface}", observed "${surface}"`,
			});
		}
	}

	if (expectation.expect.locationContains) {
		const location = observed.location ?? '';
		if (!location.includes(expectation.expect.locationContains)) {
			violations.push({
				code: 'location-mismatch',
				message: `${where}: expected Location to contain "${expectation.expect.locationContains}", observed "${location}"`,
			});
		}
	}

	return violations;
}

/**
 * Every route of the generated tree must own at least one case.
 *
 * @param {string[]} routePaths normalised route-tree paths.
 * @returns {Array<{code: string, message: string}>}
 */
export function checkRouteCoverage(routePaths, expectations = HTTP_STATUS_EXPECTATIONS) {
	const violations = [];
	const covered = new Set(
		expectations.map((entry) => entry.route).filter((route) => !NON_ROUTE_MARKERS.includes(route)),
	);
	for (const path of routePaths) {
		if (!covered.has(path)) {
			violations.push({
				code: 'unclassified-route',
				message: `route "${path}" has no row in the SEO HTTP status contract`,
			});
		}
	}
	const known = new Set(routePaths);
	for (const entry of expectations) {
		if (NON_ROUTE_MARKERS.includes(entry.route)) continue;
		if (!known.has(entry.route)) {
			violations.push({
				code: 'stale-case',
				message: `case "${entry.id}" targets route "${entry.route}", which the router no longer serves`,
			});
		}
	}
	return violations;
}

/**
 * Every row must name a proof that actually exists and cites it.
 *
 * The check is textual on purpose: the proof suites are TypeScript and
 * are executed by their own runners, but a case id that appears nowhere
 * in the file it names is a claim with no evidence, which is the exact
 * failure mode this Issue names.
 *
 * @param {Record<string, string>} fileSources absolute path -> file text.
 */
export function checkProofWiring(expectations = HTTP_STATUS_EXPECTATIONS, fileSources = {}) {
	const violations = [];
	for (const entry of expectations) {
		for (const proof of entry.proves) {
			const source = fileSources[proof.file];
			if (source === undefined) {
				violations.push({
					code: 'unproven-case',
					message: `case "${entry.id}" claims a ${proof.layer} proof in ${proof.file}, which does not exist`,
				});
				continue;
			}
			if (!source.includes(entry.id)) {
				violations.push({
					code: 'unproven-case',
					message: `case "${entry.id}" is never referenced in its ${proof.layer} proof ${proof.file}`,
				});
			}
		}
	}
	return violations;
}

/** Rows carrying a known-imperfect status, for the report and the gate. */
export function openDecisions(expectations = HTTP_STATUS_EXPECTATIONS) {
	return expectations.filter((entry) => entry.openDecision);
}

/** Summary counts for the gate's one-line verdict. */
export function summarize(expectations = HTTP_STATUS_EXPECTATIONS) {
	const bySurface = {};
	for (const entry of expectations) {
		const key = Array.isArray(entry.expect.status) ? 'redirect' : String(entry.expect.status);
		bySurface[key] = (bySurface[key] ?? 0) + 1;
	}
	return {
		cases: expectations.length,
		byStatus: bySurface,
		open: openDecisions(expectations).length,
	};
}
