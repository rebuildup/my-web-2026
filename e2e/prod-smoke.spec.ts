import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
	CANONICAL_PRODUCTION_ORIGIN,
	CHROME_NAV_ROUTES,
	EXPECTED_SECTION_COUNTS,
	LINKED_TOOL_DELIVERY_KINDS,
	ONE_CLICK_ENTRIES,
	PAGE_CONTENT_SECTIONS,
	REPRESENTATIVE_API_ROUTES,
	REPRESENTATIVE_PAGE_ROUTES,
	REPRESENTATIVE_ROUTES,
	auditRoute,
	formatAuditReport,
} from '../scripts/prod-smoke-routes.mjs';
import type { RepresentativeRoute, RouteObservation } from '../scripts/prod-smoke-routes.mjs';

/**
 * Production smoke (Issue #43 / ADR-0014, representative routes added by
 * Issue #500).
 *
 * Runs against the canonical production origin (ADR-0014) via
 * `pnpm run e2e:prod`. Triggered manually:
 *   - locally: `pnpm run e2e:prod`
 *   - CI: GH Actions `production smoke` workflow on `workflow_dispatch`.
 *
 * The representative-route contract lives in
 * `scripts/prod-smoke-routes.mjs`; this file is the browser adapter that
 * fetches each route read-only and hands the observation to
 * `auditRoute()`. The classifier itself is unit-tested offline in
 * `scripts/prod-smoke-routes.test.mjs`, so the pass/fail logic cannot
 * silently degrade into "always green".
 *
 * Phase scoping (Issue #500): the representative routes run in Smoke #2
 * (`versioned`, POST-deploy) only. Smoke #1 (`transition`) runs PRE
 * merge/deploy, while production still serves the previous `main` build
 * — but this file's expectations are RELEASE-BRANCH facts (the Tool
 * Registry row set, the home / about section counts, the declared `<h1>`
 * text). Asserting them against a deployment that predates the release
 * would make the mandatory pre-merge smoke red for a difference that has
 * not been shipped yet, and the runbook's Smoke #1 failure branch is a
 * release blocker. So the whole representative-route describe is skipped
 * in `transition`, exactly like `/admin/login` above.
 *
 * Origin scoping: the Issue #43 describe below asserts the canonical
 * PRODUCTION origin (HTTPS, `BETTER_AUTH_URL`, the `#106` login gate), so
 * it only runs when Playwright is EXPLICITLY pointed at production. The
 * representative-route adapter instead navigates to whatever origin the
 * `baseURL` fixture resolves, so `pnpm run e2e:prod:local` can exercise
 * the same contract against a local build without ever resolving
 * `https://rebuildup.dev`.
 *
 * The smoke verifies the documented Issue #43 acceptance criteria
 * against the live deployment:
 *
 *   - `GET /` and `GET /admin/login` return 200 HTML.
 *   - `/api/v1/*` endpoints (health / db / media) are reachable and
 *     return the documented status codes + JSON shapes.
 *   - Better Auth's sign-in form posts to its canonical sign-in
 *     endpoint and that endpoint exists on the canonical origin.
 *   - Response cookies carry `Secure` (production origin is HTTPS).
 *
 * Sign-in itself is NOT exercised here (no seeded credentials in
 * production); that flow is covered locally by
 * `src/cloudflare/auth/better-auth.test.ts` in the workerd pool.
 */
/**
 * Single declaration of the canonical production origin. It comes from
 * `scripts/_cloudflare-contract.mjs` (ADR-0014) rather than being
 * restated here, so this spec cannot drift onto the debug-only
 * `*.workers.dev` host. Issue #500 folded the previously inline literal
 * into the shared constant.
 */
const CANONICAL_ORIGIN = CANONICAL_PRODUCTION_ORIGIN;

/**
 * Whether this run was EXPLICITLY pointed at the canonical production
 * origin.
 *
 * `pnpm run e2e:prod` / `pnpm run e2e:prod:transition` set
 * `PLAYWRIGHT_BASE_URL=https://rebuildup.dev`, and that is the only thing
 * that arms the Issue #43 production group below. Deliberately
 * fail-safe: an UNSET `PLAYWRIGHT_BASE_URL` does not mean "production",
 * it means `playwright.config.ts` fell back to `http://127.0.0.1:3000`.
 * Treating unset as production would let a local rehearsal keep hitting
 * production — including the one deliberate write in this file.
 */
const CONFIGURED_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/+$/, '');
const E2E_LOCAL_PROD_SMOKE = process.env.E2E_LOCAL_PROD_SMOKE === '1';
const IS_CANONICAL_RUN = !E2E_LOCAL_PROD_SMOKE && CONFIGURED_BASE_URL === CANONICAL_ORIGIN;

/**
 * Origin the representative-route adapter talks to.
 *
 * Resolved from the `baseURL` fixture — i.e. from Playwright's own
 * configuration, the single place where `PLAYWRIGHT_BASE_URL` and the
 * localhost default are defined. Production runs (`pnpm run e2e:prod`,
 * `pnpm run e2e:prod:transition`) therefore keep hitting
 * `https://rebuildup.dev`, and `pnpm run e2e:prod:local` keeps everything
 * on `http://127.0.0.1:3000`.
 */
function smokeOrigin(baseURL: string | undefined): string {
	return (baseURL ?? CANONICAL_ORIGIN).replace(/\/+$/, '');
}

/**
 * Abort every request that leaves the origin Playwright was pointed at.
 *
 * The representative-route contract promises that the smoke exercises the
 * canonical origin only. Checking the final top-level URL is not enough:
 * pages also load subresources (Google Fonts, GA4, third-party images), and
 * those requests would both violate the boundary and pollute production
 * analytics. Installing this before the first navigation makes the boundary
 * executable instead of prose.
 *
 * `data:` / `blob:` / `about:` are browser-internal and never reach the
 * network, so they are allowed through.
 */
async function guardOutboundTraffic(page: Page, origin: string): Promise<void> {
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (
			url.origin === origin ||
			url.protocol === 'data:' ||
			url.protocol === 'blob:' ||
			url.protocol === 'about:'
		) {
			return route.continue();
		}
		return route.abort();
	});
}

const PROD_SMOKE_PHASE = process.env.PROD_SMOKE_PHASE ?? 'versioned';
if (PROD_SMOKE_PHASE !== 'transition' && PROD_SMOKE_PHASE !== 'versioned') {
	throw new Error(
		`Unsupported PROD_SMOKE_PHASE=${JSON.stringify(PROD_SMOKE_PHASE)}; expected "transition" or "versioned".`,
	);
}

test.describe('production smoke (Issue #43 / ADR-0014)', () => {
	test.skip(
		!IS_CANONICAL_RUN,
		'this group asserts the canonical PRODUCTION origin (HTTPS, BETTER_AUTH_URL wiring, the #106 login gate). A local replica run (`pnpm run e2e:prod:local`) covers the Issue #500 representative routes only, and must never touch production.',
	);
	test('canonical origin is HTTPS and reaches the Worker', async ({ request }) => {
		// Force the request fixture to use the canonical origin even
		// when PLAYWRIGHT_BASE_URL is unset (defensive — the script
		// sets it, but `gh workflow run` and local runs should agree).
		const res = await request.get(`${CANONICAL_ORIGIN}/`);
		expect(res.status()).toBe(200);
		expect(res.url()).toBe(`${CANONICAL_ORIGIN}/`);
		// Cloudflare issues TLS via the canonical zone; the URL is
		// never downgraded to plain http.
		expect(res.url().startsWith('https://')).toBe(true);
	});

	test('GET / returns the home HTML and the canonical h1', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/`);
		expect(res.status()).toBe(200);
		const body = await res.text();
		expect(body).toContain('my-web-2026');
	});

	test('GET /admin/login returns 200 HTML with the Better Auth sign-in form', async ({
		request,
	}) => {
		test.skip(
			PROD_SMOKE_PHASE === 'transition',
			'pre-deploy transition smoke verifies legacy auth separately; /admin/login 200 is a post-deploy #106 gate',
		);
		const res = await request.get(`${CANONICAL_ORIGIN}/admin/login`);
		expect(res.status()).toBe(200);
		const body = await res.text();
		// The form submits to Better Auth's canonical sign-in
		// endpoint; if the canonical origin wiring is wrong (e.g.
		// `BETTER_AUTH_URL` still pointing at workers.dev) the
		// cross-origin POST would 4xx.
		expect(body).toContain('action="/api/v1/auth/sign-in/email"');
		expect(body).toMatch(/<input[^>]+type="email"/);
		expect(body).toMatch(/<input[^>]+type="password"/);
	});

	test('GET /api/v1/health responds 200 JSON ping', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/api/v1/health`);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	test('GET /api/v1/db/ping responds 200 with one=1', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/api/v1/db/ping`);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.one).toBe(1);
	});

	test('GET /api/v1/media/ping responds 404 key_not_found', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/api/v1/media/ping`);
		// R2 bucket is reachable but the probe key is intentionally absent.
		expect(res.status()).toBe(404);
		const body = await res.json();
		expect(body.status).toBe('key_not_found');
	});

	test('anonymous reaction mutation issues `mw_actor_id` cookie with `Secure`', async ({
		page,
	}) => {
		// P2 #11 (review 5256764289 → 5257235568): the previous
		// `/admin/login` GET path asserted `setCookieHeaders.length > 0`,
		// which flaked on healthy production (Better Auth only issues
		// the session cookie at the actual sign-in step, not on the
		// sign-in form render). The "relaxed" follow-up
		// (`5929843`) was vacuously green — `GET /` may legitimately
		// return zero `Set-Cookie` headers, in which case the test
		// asserted nothing. We now drive a real production path that
		// deterministically issues `mw_actor_id` — an anonymous
		// reaction mutation through the home widget — and read the
		// `Set-Cookie` header off the mutation response itself.
		//
		// Why a `page` fixture, not `request`: TanStack Start server-fn
		// URLs include a build-time hash and the request body uses
		// the framework's RPC envelope, both of which are brittle to
		// reproduce from a raw HTTP client. Driving the actual widget
		// UI exercises the same code path a visitor would, including
		// any cookie-issuance wiring that may be wrapped in a future
		// layer (CSRF middleware, edge transforms, etc.).
		//
		// Failure modes:
		// - `data-testid="home-reactions-open-picker"` missing →
		//   home is not rendering the widget (regression on branch 43
		//   picker shape, or SSR error).
		// - "reactions disabled" placeholder visible → the home API key
		//   is not configured in production (the smoke should fail
		//   loudly — operator forgot `pnpm run bootstrap:home-api-key`
		//   or `wrangler secret put MY_WEB_2026_CONSUMER_API_KEY`).
		// - mutation response has no `mw_actor_id` cookie → server-fn
		//   handler regressed to cookie-less mode (P1 #2 finding
		//   repeated).
		// - cookie issued without `Secure` → production HTTPS wiring
		//   regression (e.g. `Secure`-stripping edge transform, or
		//   `proto` header dropped from `Set-Cookie`).

		await page.context().clearCookies();
		await page.goto(`${CANONICAL_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
		const trigger = page.getByTestId('home-reactions-open-picker');
		await trigger.waitFor({ state: 'visible', timeout: 15_000 });
		// Pre-flight: the disabled placeholder is rendered when the
		// home API key is missing. Fail loudly — silently no-op'ing
		// here would mask an unconfigured production deployment.
		const disabledMarker = await page
			.getByText(/reactions disabled/i)
			.first()
			.isVisible()
			.catch(() => false);
		expect(
			disabledMarker,
			'home widget shows the disabled placeholder — API key not configured in production',
		).toBe(false);

		// Open the picker dialog. The picker is lazy-loaded inside the
		// <dialog> on first open — wait for the dialog to actually
		// contain the picker library's DOM (it uses `data-unified` on
		// each emoji button).
		//
		// Issue #238: this navigates with `domcontentloaded`, so a single
		// click can land BEFORE React hydration attaches the handler and
		// is silently swallowed — the dialog then never opens. The whole
		// production flow is correct (verified: the picker renders 198
		// emoji and no 4xx occurs); the race only widens under the
		// parallel full-suite run, which is why this failed in `e2e:prod`
		// while passing 3/3 in isolation. Re-click until the picker
		// appears, bounded so a genuine regression still fails.
		const pickerEmoji = 'dialog[aria-label="Add a reaction"] [data-unified]';
		let pickerOpen = false;
		for (let attempt = 0; attempt < 5 && !pickerOpen; attempt++) {
			await trigger.click();
			pickerOpen = await page
				.waitForSelector(pickerEmoji, { timeout: 5_000 })
				.then(() => true)
				.catch(() => false);
		}
		expect(
			pickerOpen,
			'reaction picker never rendered after repeated clicks — hydration or the lazy chunk is broken',
		).toBe(true);

		// Race the mutation response against the first emoji click.
		// The server fn URL is `/_serverFn/<hash>` and the response
		// carries `Set-Cookie: mw_actor_id=<X>; Secure` on a first
		// visit.
		const mutationUrl = /\/_\w+/;
		const mutationResponsePromise = page.waitForResponse(
			(res) => res.request().method() === 'POST' && mutationUrl.test(new URL(res.url()).pathname),
			{ timeout: 15_000 },
		);
		await page.locator('dialog[aria-label="Add a reaction"] [data-unified]').first().click();
		const mutationResponse = await mutationResponsePromise;

		expect(mutationResponse.status(), 'reaction mutation failed').toBeLessThan(400);

		const setCookieHeaders = await mutationResponse.headerValues('set-cookie');
		const actorCookie = setCookieHeaders.find((value) =>
			value.toLowerCase().startsWith('mw_actor_id='),
		);
		expect(
			actorCookie,
			'expected `Set-Cookie: mw_actor_id=…` on the first anonymous reaction mutation',
		).toBeDefined();
		// P2 #6 regression guard: every issued cookie MUST carry
		// `Secure`. Production origin is HTTPS; a missing `Secure`
		// flag is an actual production wiring bug (cookie would
		// leak over HTTP if the user ever follows an http:// link).
		// `headerValues('set-cookie')` preserves multiple Set-Cookie
		// values, so this remains exact even when another cookie is
		// emitted by the same mutation response.
		expect(actorCookie?.toLowerCase()).toContain('secure');
	});

	test('canonical origin matches the documented production URL', async ({ request }) => {
		// Defensive: the deployed Worker must serve the canonical
		// origin and the configured `BETTER_AUTH_URL`. The header
		// returned by the Worker is the same-origin we expect.
		const res = await request.get(`${CANONICAL_ORIGIN}/`, {
			maxRedirects: 0,
		});
		expect(res.status()).toBe(200);
		expect(new URL(res.url()).origin).toBe(CANONICAL_ORIGIN);
	});
});

/* ---------------------------------------------------------------------------
 * Issue #500 — representative routes in the production synthetic smoke.
 *
 * The routes, their expected responses, their documented default states,
 * and their short navigation paths all live in
 * `scripts/prod-smoke-routes.mjs`. Everything below is the read-only
 * browser adapter that produces the observation `auditRoute()` classifies.
 *
 * Read-only boundary (restated here because this is the file an operator
 * reads before running the smoke against production): the only HTTP verb
 * used here is GET, no cookie is cleared, no storage is reset, and no
 * D1 / R2 write is issued. The anonymous reaction mutation further up in
 * this file is the one deliberate mutation, it predates Issue #500, and it
 * is deliberately NOT part of the representative-route registry — it
 * also lives in the Issue #43 describe above, which only runs against the
 * canonical production origin.
 *
 * Outbound traffic: every navigation below goes through the `baseURL`
 * Playwright was configured with, i.e. the canonical production origin for
 * `pnpm run e2e:prod` / `pnpm run e2e:prod:transition` and
 * `http://127.0.0.1:3000` for `pnpm run e2e:prod:local`. No navigation in
 * this describe is hardcoded to production, which is what keeps an
 * offline verification run from ever resolving the production hostname.
 * That boundary is ASSERTED rather than prose: each observation carries
 * the final (post-redirect) origin and `auditRoute()` rejects any route
 * that answered from anywhere else, so a redirect to a look-alike host
 * serving the same pathname cannot pass as a healthy canonical origin.
 * Subresource requests (fonts, analytics, third-party images) are aborted
 * by `guardOutboundTraffic()` before each navigation, so the boundary also
 * holds for everything the page loads on its own.
 * ------------------------------------------------------------------------ */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What the `/tools` index is contracted to render, read from the Tool
 * Registry manifest: slug → delivery kind, plus the sorted slug list.
 *
 * Read from the manifest rather than restated, so the default state is
 * "the index agrees with the manifest" instead of "the index agrees with
 * a list someone copied out of it once". The manifest is repo-controlled
 * data, so this stays a verifiable fact rather than an expectation about
 * production content.
 */
function readToolManifest(): { slugs: string[]; deliveryKinds: Record<string, string> } {
	const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/tools/manifest.json'), 'utf8')) as {
		tools: Array<{ slug: string; delivery: { kind: string } }>;
	};
	const deliveryKinds: Record<string, string> = {};
	for (const tool of raw.tools) deliveryKinds[tool.slug] = tool.delivery.kind;
	return { slugs: Object.keys(deliveryKinds).sort(), deliveryKinds };
}

/** Well-formed semantic version. Deliberately not the repo's version. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Boolean observations for a page route's documented default states.
 *
 * Throwing for an un-implemented path is intentional: if a route is ever
 * added to the registry without a probe here, the smoke must fail loudly
 * at authoring time rather than silently observing `undefined` probes and
 * reporting a confusing "no documented default state matched".
 */
async function computePageProbes(
	path: string,
	page: Page,
	manifest: { slugs: string[]; deliveryKinds: Record<string, string> },
): Promise<Record<string, boolean>> {
	switch (path) {
		case '/':
			return {
				// The home composition count is registry data
				// (`EXPECTED_SECTION_COUNTS`), the same fact
				// `e2e/smoke.spec.ts` pins locally — not a literal that
				// exists only in this adapter.
				//
				// The selector is scoped to the page subtree
				// (`PAGE_CONTENT_SECTIONS`, Issue #664) so root-layout
				// chrome — the GA4 consent panel is a named `<section>`
				// — is not counted as a section of the page.
				sixSections:
					(await page.locator(PAGE_CONTENT_SECTIONS).count()) ===
					EXPECTED_SECTION_COUNTS['/'].labelled,
				// The disabled placeholder is the home surface's
				// "consumer API key missing in production" failure mode.
				// A deployed Worker without it would still return 200 on
				// every other assertion, so this probe is what stops the
				// smoke from reporting a healthy deployment that a visitor
				// would call broken.
				reactionsDisabled: await page
					.getByText(/reactions disabled/i)
					.first()
					.isVisible()
					.catch(() => false),
			};
		case '/about':
			return {
				identityHeading: await page.locator('h1#about-hero-title').first().isVisible(),
				narrativeSections:
					(await page.locator('section[aria-labelledby^="about-section-"]').count()) ===
					EXPECTED_SECTION_COUNTS['/about'].narrative,
			};
		case '/portfolio':
			return {
				emptyState: await page
					.getByText('ポートフォリオ準備中')
					.first()
					.isVisible()
					.catch(() => false),
				projectCard: (await page.locator('section#portfolio-list ol > li').count()) > 0,
			};
		case '/tools': {
			const rows = page.locator('[data-tool-slug]');
			const listed = (
				await rows.evaluateAll((elements) =>
					elements.map((row) => row.getAttribute('data-tool-slug') ?? ''),
				)
			).sort();
			const expected = [...manifest.slugs].sort();
			// Every row must be classified the way ITS OWN manifest entry
			// demands, which is stronger than "the slug set matches" — a
			// fully regressed index can render every public Tool as a
			// disabled row and still list exactly the right slugs:
			//   - a public delivery kind links to its OWN `/tools/<slug>`
			//     and carries no disabled state;
			//   - a `host_disabled` Tool renders NO anchor at all, carries
			//     `data-tool-state="host_disabled"`, and shows the Coming
			//     soon badge.
			const everyRowClassified = await rows.evaluateAll(
				(elements, contract: { linked: string[]; kinds: Record<string, string> }) => {
					const linked = new Set(contract.linked);
					return elements.every((row) => {
						const slug = row.getAttribute('data-tool-slug') ?? '';
						const kind = contract.kinds[slug];
						if (kind === undefined) return false;
						const href = row.querySelector('a[href^="/tools/"]')?.getAttribute('href') ?? null;
						const state = row.getAttribute('data-tool-state');
						if (linked.has(kind)) return href === `/tools/${slug}` && state === null;
						// "Coming soon" must not be clickable at all — a stray
						// `/`, external, or `mailto:` anchor would keep this row
						// looking classified while a visitor could still enter a
						// Tool that has no embeddable surface.
						return (
							state === 'host_disabled' &&
							row.querySelector('a') === null &&
							row.querySelector('[data-tool-badge="coming-soon"]') !== null
						);
					});
				},
				{ linked: [...LINKED_TOOL_DELIVERY_KINDS], kinds: manifest.deliveryKinds },
			);
			return {
				allManifestSlugsListed:
					listed.length === expected.length &&
					listed.every((slug, index) => slug === expected[index]),
				// An empty page matches "nothing is misclassified" vacuously,
				// so a rendered row is part of the condition.
				everyRowClassified: listed.length > 0 && everyRowClassified,
			};
		}
		default:
			throw new Error(
				`No default-state probe is implemented for representative route ${path}. Add it to computePageProbes() in the same change that registers the route.`,
			);
	}
}

/**
 * Fetch one page route read-only and build the observation
 * `auditRoute()` expects.
 */
async function observePageRoute(
	route: RepresentativeRoute,
	origin: string,
	page: Page,
	manifest: { slugs: string[]; deliveryKinds: Record<string, string> },
): Promise<RouteObservation> {
	await guardOutboundTraffic(page, origin);
	const response = await page.goto(`${origin}${route.path}`, {
		waitUntil: 'domcontentloaded',
	});
	const canonical = page.locator('link[rel="canonical"]').first();
	// The registry's own `h1` selector, not a bare `h1`: a route whose
	// declared heading disappeared (renamed id, wrapper element) must be
	// reported as "not visible / no text", which is exactly the defect
	// `auditRoute()` is there to report.
	const h1 = page.locator(route.h1 ?? 'h1').first();
	return {
		status: response?.status() ?? 0,
		contentType: response?.headers()['content-type'] ?? '',
		// Origin AND path. The path alone cannot distinguish "the origin
		// the smoke was pointed at answered" from "a look-alike origin
		// with the same pathname answered", so both are observed here and
		// `auditRoute()` rejects either kind of drift.
		finalOrigin: new URL(page.url()).origin,
		finalPath: new URL(page.url()).pathname,
		title: await page.title(),
		canonicalHref: (await canonical.count()) > 0 ? await canonical.getAttribute('href') : null,
		h1Count: await page.locator('h1').count(),
		h1Visible: await h1.isVisible(),
		h1Text: await h1.count().then((count) => (count > 0 ? h1.textContent() : null)),
		json: null,
		defaultProbes: await computePageProbes(route.path, page, manifest),
	};
}

/**
 * Fetch one API route read-only and build its observation.
 *
 * A non-JSON body is reported through `json: null` rather than thrown, so
 * `auditRoute()` owns the whole failure surface and the report has one
 * shape.
 */
async function observeApiRoute(
	route: RepresentativeRoute,
	origin: string,
	request: APIRequestContext,
): Promise<RouteObservation> {
	const response = await request.get(`${origin}${route.path}`);
	const body = await response.text();
	let json: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			json = parsed as Record<string, unknown>;
		}
	} catch {
		json = null;
	}
	return {
		status: response.status(),
		contentType: response.headers()['content-type'] ?? '',
		finalOrigin: new URL(response.url()).origin,
		finalPath: new URL(response.url()).pathname,
		title: null,
		canonicalHref: null,
		h1Count: 0,
		h1Visible: false,
		h1Text: null,
		json,
		defaultProbes: {
			statusOk: json?.status === 'ok',
			serviceIdentity: json?.service === 'my-web-2026',
			boundaryLayer: json?.layer === 'external-boundary',
			// Shape check only, never an equality check. See
			// "NO RELEASE VERSION LITERAL" in
			// scripts/prod-smoke-routes.mjs: the release branch stays
			// open after it is cut and `main` receives fixes
			// independently, so a release-branch working tree is never a
			// reliable stand-in for the deployed artifact.
			semverVersion: typeof json?.version === 'string' && SEMVER.test(json.version),
		},
	};
}

test.describe('production representative routes (Issue #500)', () => {
	test.skip(
		PROD_SMOKE_PHASE === 'transition',
		'Smoke #1 runs PRE merge/deploy, so production still serves the previous `main` build. This registry is release-branch data (Tool Registry row set, home/about section counts, declared <h1> text), and the runbook defers every non-`main`-compatible assertion to Smoke #2. See docs/runbook/cloudflare-workers-builds.md "Representative route coverage (Issue #500)".',
	);
	test('reads the origin Playwright was pointed at, never a hardcoded production URL', async ({
		baseURL,
	}) => {
		test.skip(IS_CANONICAL_RUN, 'this run IS pointed at the canonical production origin');
		expect(
			smokeOrigin(baseURL),
			'a run that is not pointed at production must not resolve the canonical production origin — that would turn an offline rehearsal into a production read, and would make the Issue #500 verification artefact claim something this code path cannot do',
		).not.toBe(CANONICAL_ORIGIN);
	});

	for (const route of REPRESENTATIVE_PAGE_ROUTES) {
		test(`${route.label} — ${route.path} serves its documented default state`, async ({
			baseURL,
			page,
		}) => {
			const origin = smokeOrigin(baseURL);
			const observation = await observePageRoute(route, origin, page, readToolManifest());
			// Assert the problem LIST, not the first problem: a broken
			// deployment should report everything that is wrong in one go.
			const problems = auditRoute(route, observation, origin);
			expect(problems, formatAuditReport(route, problems, origin)).toEqual([]);
		});
	}

	for (const route of REPRESENTATIVE_API_ROUTES) {
		test(`${route.label} — ${route.path} serves its documented default state`, async ({
			baseURL,
			request,
		}) => {
			const origin = smokeOrigin(baseURL);
			const observation = await observeApiRoute(route, origin, request);
			const problems = auditRoute(route, observation, origin);
			expect(problems, formatAuditReport(route, problems, origin)).toEqual([]);
		});
	}

	test('short navigation path — every representative page route is one click from /', async ({
		baseURL,
		page,
	}) => {
		const origin = smokeOrigin(baseURL);
		await guardOutboundTraffic(page, origin);
		for (const entry of ONE_CLICK_ENTRIES) {
			// Re-enter the source surface each round: the previous round
			// followed its link, so the page is no longer on `entry.from`.
			await page.goto(`${origin}${entry.from}`, { waitUntil: 'domcontentloaded' });
			const link = page.locator(entry.selector).first();
			await expect(
				link,
				`${entry.from} no longer offers a one-click path to ${entry.to}. The representative route is registered but unreachable from the entry surface, which makes the smoke report a route nobody can get to.`,
			).toBeVisible();

			const href = await link.getAttribute('href');
			expect(
				href,
				`the ${entry.from} → ${entry.to} entry must stay an in-site path, not an absolute or protocol-relative URL`,
			).toBe(entry.to);

			// Follow it. A link that 200s into the 404 surface, that
			// dead-ends, or that leaves the origin entirely must not pass
			// as "reachable".
			await link.click();
			const landed = new URL(page.url());
			expect(
				`${landed.origin}${landed.pathname}`,
				`clicking the ${entry.from} → ${entry.to} entry left the origin it was pointed at or landed somewhere else`,
			).toBe(`${origin}${entry.to}`);
			const destination = REPRESENTATIVE_ROUTES.find((candidate) => candidate.path === entry.to);
			await expect(
				page.locator(destination?.h1 ?? 'h1').first(),
				`${entry.to} rendered without its page heading after the one-click path`,
			).toBeVisible();
		}
	});

	test('short navigation path — the PublicNav pages link to every sibling representative route', async ({
		baseURL,
		page,
	}) => {
		const origin = smokeOrigin(baseURL);
		await guardOutboundTraffic(page, origin);
		for (const from of CHROME_NAV_ROUTES) {
			for (const sibling of REPRESENTATIVE_PAGE_ROUTES) {
				if (sibling.path === from) continue;
				// Re-enter the source page for every link: the previous
				// iteration navigated away, and this loop is also the proof
				// that the chrome keeps working after a navigation.
				await page.goto(`${origin}${from}`, { waitUntil: 'domcontentloaded' });
				const nav = page.locator('nav[aria-label="Public"]');
				await expect(
					nav,
					`${from} is registered as a chrome-nav route but does not render the PublicNav landmark`,
				).toBeVisible();

				const link = nav.locator(`[data-testid="public-nav-desktop"] a[href="${sibling.path}"]`);
				await expect(
					link,
					`${from} offers no one-click path to ${sibling.path}; the representative set is no longer navigable from the chrome`,
				).toHaveCount(1);
				// A link that is in the DOM but hidden (CSS regression) or
				// blocked by an overlay is not a navigation path. Follow it
				// like a visitor and check where that lands.
				await expect(
					link,
					`${from} renders the ${sibling.path} link but it is not visible`,
				).toBeVisible();
				await link.click();
				const landed = new URL(page.url());
				expect(
					`${landed.origin}${landed.pathname}`,
					`clicking ${from} → ${sibling.path} in the PublicNav left the origin it was pointed at or landed somewhere else`,
				).toBe(`${origin}${sibling.path}`);
				await expect(
					page.locator(sibling.h1 ?? 'h1').first(),
					`${sibling.path} rendered without its page heading after the PublicNav path`,
				).toBeVisible();
			}
		}
	});
});

/**
 * Transport security read-only check (Issue #446).
 *
 * The Worker's HSTS policy (`src/server.ts` → `applyTransportSecurityPolicy`)
 * is proven against the local workerd pool in
 * `test/integration/hsts-transport-security.test.ts`; this block observes the
 * real canonical origin, because only the deployed edge can prove that HTTPS
 * is actually reachable for visitors.
 *
 * Read-only by construction: two `GET`s of the home page and the health
 * endpoint, no mutation, no credential, no configuration change. It asserts
 * the shape of the directive, never a value the repository cannot know, and
 * it deliberately requires the policy to stay HOST-SCOPED — `includeSubDomains`
 * and `preload` need the per-subdomain HTTPS audit recorded in
 * `docs/security.md`, which does not exist yet.
 *
 * Skipped during the `transition` phase, which runs BEFORE the deploy that
 * introduces the header (see `pnpm run e2e:prod:transition`).
 */
test.describe('transport security (Issue #446)', () => {
	test.skip(
		!IS_CANONICAL_RUN,
		'HSTS is only observable on the canonical HTTPS origin. A local rehearsal runs over http://127.0.0.1, where the Worker correctly does not attach the header.',
	);
	test('the canonical origin serves a host-scoped HSTS directive', async ({ request }) => {
		test.skip(
			PROD_SMOKE_PHASE === 'transition',
			'pre-deploy transition smoke runs before the Worker that carries the HSTS policy is live',
		);

		const observed: string[] = [];
		for (const path of ['/', '/api/v1/health']) {
			const res = await request.get(`${CANONICAL_ORIGIN}${path}`, { maxRedirects: 0 });
			expect(res.status()).toBe(200);
			// Cloudflare can add its own zone-level HSTS on top of the
			// Worker's, so every value is inspected rather than the first.
			const values = await res.headerValues('strict-transport-security');
			// Asserted PER SURFACE, not on the pooled count: a policy present
			// on `/` and missing on `/api/v1/health` is exactly the dispatch
			// inconsistency this smoke exists to catch, and a pooled `> 0`
			// assertion would let it pass.
			expect(
				values.length,
				`${path} has no Strict-Transport-Security header — the Worker policy is not live on this surface`,
			).toBeGreaterThan(0);
			observed.push(...values);
		}

		for (const value of observed) {
			// Two layers of policy may arrive as comma-separated directives.
			const directives = value
				.split(',')
				.flatMap((part) => part.split(';'))
				.map((directive) => directive.trim())
				.filter((directive) => directive !== '');
			const names = directives.map((directive) => directive.split('=')[0].trim().toLowerCase());

			expect(names, `unexpected HSTS directive in "${value}"`).toContain('max-age');
			expect(
				names,
				`${value} widens the policy beyond this host; the subdomain HTTPS audit is still missing`,
			).not.toContain('includesubdomains');
			expect(names, `${value} commits the zone to the browser preload list`).not.toContain(
				'preload',
			);

			const maxAge = Number(
				directives.find((directive) => directive.split('=')[0].trim() === 'max-age')?.split('=')[1],
			);
			expect(
				Number.isInteger(maxAge) && maxAge >= 86_400,
				`implausible max-age in "${value}"`,
			).toBe(true);
		}
	});
});
