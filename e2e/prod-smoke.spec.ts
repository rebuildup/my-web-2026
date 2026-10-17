import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
	CANONICAL_PRODUCTION_ORIGIN,
	CHROME_NAV_ROUTES,
	EXPECTED_SECTION_COUNTS,
	ONE_CLICK_ENTRIES,
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
 * it only runs when Playwright is pointed at production. The
 * representative-route adapter instead follows `PLAYWRIGHT_BASE_URL`, so
 * `pnpm run e2e:prod:local` can exercise the same contract against a
 * local build without resolving `https://rebuildup.dev` at all.
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
 * Origin the representative-route adapter talks to.
 *
 * `pnpm run e2e:prod` / `pnpm run e2e:prod:transition` set
 * `PLAYWRIGHT_BASE_URL=https://rebuildup.dev`, so every production run
 * is unchanged. When Playwright is explicitly pointed at a local build
 * (`pnpm run e2e:prod:local`, i.e. base URL `http://127.0.0.1:3000`), the
 * adapter follows THAT origin instead — which is what makes the Issue
 * #500 contract reproducible offline, and what lets the verification
 * screenshot be captured without reading production at all. With
 * `PLAYWRIGHT_BASE_URL` unset the adapter falls back to the canonical
 * production origin, so an ad-hoc `playwright test e2e/prod-smoke.spec.ts`
 * keeps its previous meaning.
 */
const SMOKE_ORIGIN = (process.env.PLAYWRIGHT_BASE_URL ?? CANONICAL_ORIGIN).replace(/\/+$/, '');

/** True when this run really is pointed at the canonical production origin. */
const IS_CANONICAL_RUN = SMOKE_ORIGIN === CANONICAL_ORIGIN;

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
 * Outbound traffic: every navigation below goes through `SMOKE_ORIGIN`,
 * i.e. the canonical production origin for `pnpm run e2e:prod` /
 * `pnpm run e2e:prod:transition`, or whatever `PLAYWRIGHT_BASE_URL` says
 * for `pnpm run e2e:prod:local`. No navigation in this describe is
 * hardcoded to production, which is what keeps an offline verification
 * run from ever resolving the production hostname.
 * ------------------------------------------------------------------------ */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tool slugs the `/tools` index is contracted to list.
 *
 * Read from the registry manifest rather than restated, so the default
 * state is "the index agrees with the manifest" instead of "the index
 * agrees with a list someone copied out of it once". The manifest is
 * repo-controlled data, so this stays a verifiable fact rather than an
 * expectation about production content.
 */
function readToolManifestSlugs(): string[] {
	const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/tools/manifest.json'), 'utf8')) as {
		tools: Array<{ slug: string }>;
	};
	return raw.tools.map((tool) => tool.slug).sort();
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
	toolSlugs: ReadonlyArray<string>,
): Promise<Record<string, boolean>> {
	switch (path) {
		case '/':
			return {
				// The home composition count is registry data
				// (`EXPECTED_SECTION_COUNTS`), the same fact
				// `e2e/smoke.spec.ts` pins locally — not a literal that
				// exists only in this adapter.
				sixSections:
					(await page.locator('section[aria-labelledby]').count()) ===
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
			const listed = (
				await page
					.locator('[data-tool-slug]')
					.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-tool-slug') ?? ''))
			).sort();
			const expected = [...toolSlugs].sort();
			// A row is classified only when it either links to ITS OWN
			// `/tools/<data-tool-slug>` or carries the documented
			// `host_disabled` state. Comparing the anchor href against
			// the row's own slug is what stops a regression where every
			// row links to the same (or a typo'd) `/tools/...` path from
			// reading as "integrated".
			const everyRowClassified = await page.locator('[data-tool-slug]').evaluateAll((rows) =>
				rows.every((row) => {
					const slug = row.getAttribute('data-tool-slug') ?? '';
					const anchor = row.querySelector('a[href^="/tools/"]');
					return (
						(anchor !== null && anchor.getAttribute('href') === `/tools/${slug}`) ||
						row.getAttribute('data-tool-state') === 'host_disabled'
					);
				}),
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
	page: Page,
	toolSlugs: ReadonlyArray<string>,
): Promise<RouteObservation> {
	const response = await page.goto(`${SMOKE_ORIGIN}${route.path}`, {
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
		finalPath: new URL(page.url()).pathname,
		title: await page.title(),
		canonicalHref: (await canonical.count()) > 0 ? await canonical.getAttribute('href') : null,
		h1Count: await page.locator('h1').count(),
		h1Visible: await h1.isVisible(),
		h1Text: await h1.count().then((count) => (count > 0 ? h1.textContent() : null)),
		json: null,
		defaultProbes: await computePageProbes(route.path, page, toolSlugs),
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
	request: APIRequestContext,
): Promise<RouteObservation> {
	const response = await request.get(`${SMOKE_ORIGIN}${route.path}`);
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
	for (const route of REPRESENTATIVE_PAGE_ROUTES) {
		test(`${route.label} — ${route.path} serves its documented default state`, async ({ page }) => {
			const observation = await observePageRoute(route, page, readToolManifestSlugs());
			// Assert the problem LIST, not the first problem: a broken
			// deployment should report everything that is wrong in one go.
			const problems = auditRoute(route, observation);
			expect(problems, formatAuditReport(route, problems)).toEqual([]);
		});
	}

	for (const route of REPRESENTATIVE_API_ROUTES) {
		test(`${route.label} — ${route.path} serves its documented default state`, async ({
			request,
		}) => {
			const observation = await observeApiRoute(route, request);
			const problems = auditRoute(route, observation);
			expect(problems, formatAuditReport(route, problems)).toEqual([]);
		});
	}

	test('short navigation path — every representative page route is one click from /', async ({
		page,
	}) => {
		for (const entry of ONE_CLICK_ENTRIES) {
			// Re-enter the source surface each round: the previous round
			// followed its link, so the page is no longer on `entry.from`.
			await page.goto(`${SMOKE_ORIGIN}${entry.from}`, { waitUntil: 'domcontentloaded' });
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

			// Follow it. A link that 200s into the 404 surface, or that
			// dead-ends, must not pass as "reachable".
			await link.click();
			expect(
				new URL(page.url()).pathname,
				`clicking the ${entry.from} → ${entry.to} entry landed somewhere else`,
			).toBe(entry.to);
			const destination = REPRESENTATIVE_ROUTES.find((candidate) => candidate.path === entry.to);
			await expect(
				page.locator(destination?.h1 ?? 'h1').first(),
				`${entry.to} rendered without its page heading after the one-click path`,
			).toBeVisible();
		}
	});

	test('short navigation path — the PublicNav pages link to every sibling representative route', async ({
		page,
	}) => {
		for (const from of CHROME_NAV_ROUTES) {
			await page.goto(`${SMOKE_ORIGIN}${from}`, { waitUntil: 'domcontentloaded' });
			const nav = page.locator('nav[aria-label="Public"]');
			await expect(
				nav,
				`${from} is registered as a chrome-nav route but does not render the PublicNav landmark`,
			).toBeVisible();

			const strip = nav.locator('[data-testid="public-nav-desktop"]');
			for (const sibling of REPRESENTATIVE_PAGE_ROUTES) {
				if (sibling.path === from) continue;
				await expect(
					strip.locator(`a[href="${sibling.path}"]`),
					`${from} offers no one-click path to ${sibling.path}; the representative set is no longer navigable from the chrome`,
				).toHaveCount(1);
			}
		}
	});
});
