/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	CANONICAL_ORIGIN,
	DYNAMIC_ROUTE_SAMPLES,
	NON_PUBLIC_SAMPLE_PATH,
	NOT_FOUND_PROBES,
	QUERY_STRING_PROBES,
	buildInventory,
	evaluateFlipScriptContract,
	evaluateHeadInventory,
	parseHeadTags,
	parseInlineScriptSources,
	routeIdsFromRouteTree,
	summarizeHead,
} from '../../scripts/seo-head-contract.mjs';
import type { HeadObservation, HeadSummary } from '../../scripts/seo-head-contract.mjs';

/**
 * An observation that has already been normalized. The engine accepts a
 * raw `tags` list too, but every observation this suite builds parses a
 * response first, so it always has a `head`.
 */
type Observed = HeadObservation & { head: HeadSummary };
import { routeTree } from '../../src/routeTree.gen';

/**
 * Public-route `<head>` metadata gate (Issue #418).
 *
 * This is the CI half of the gate. It drives the REAL Worker through
 * `SELF.fetch`, parses the SSR `<head>` each route actually renders,
 * and hands the result to the same policy engine
 * (`scripts/seo-head-contract.mjs`) that
 * `scripts/check-seo-head.mjs --live <baseUrl>` uses against a real
 * origin. One engine, two front-ends: a rule cannot pass here and
 * fail there.
 *
 * Why `SELF.fetch` and not a route-module unit test
 * -------------------------------------------------
 * A unit test calling `Route.options.head()` would assert the
 * function's return value, not the document a crawler receives. The
 * head MERGE (root fallback title, per-route meta dedupe) and the
 * SSR rendering of those tags are the parts that break silently, and
 * both only exist on this side of the boundary. Same reasoning as
 * `test/integration/html-cache-policy.test.ts`, which is the only
 * layer that sees the headers the runtime actually emits.
 *
 * No silent passes
 * ----------------
 *   - The inventory is the framework's own routing table
 *     (`src/routeTree.gen.ts`, regenerated from `src/routes/**` by
 *     the TanStack Start plugin on every run), so a route added
 *     without head metadata fails on the next run and nobody has to
 *     remember to extend a list here. The filesystem-side discovery
 *     (`discoverRouteModules`) is asserted against the same tree by
 *     `scripts/check-seo-head.test.mjs`, which runs in plain Node.
 *   - A discovered route that produced no observation is a failure
 *     (`inventory.unobserved`), not a skip.
 *   - The negative controls at the bottom of this file feed the
 *     engine a duplicated title and a dropped canonical and assert
 *     it reports both — a gate that cannot fail is not a gate.
 */

/**
 * Split a migration file into statements.
 *
 * Deliberately the same simple rule as `sqlToBatchStatements` in
 * `scripts/_d1.mjs` (strip comments, split on `;`, drop empties) —
 * the bundles this repository generates are machine written, and
 * `scripts/_d1.mjs` itself imports `node:child_process`, which does
 * not exist in workerd. The SQL is inlined because workerd cannot
 * read `migrations/*.sql` (see `test/integration/d1.test.ts`).
 */
const MIGRATIONS = [
	{
		// 0002 + 0005 net state. 0005 drops and recreates
		// `access_counters` with the per-principal primary key from
		// ADR-0012 §3, so the post-migration shape is what the home
		// loader reads.
		name: '0002+0005_access_counter',
		queries: [
			`CREATE TABLE IF NOT EXISTS access_counters (
    key        TEXT    NOT NULL,
    principal  TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL,
    PRIMARY KEY (key, principal)
)`,
			`CREATE TABLE IF NOT EXISTS access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
)`,
			'CREATE INDEX IF NOT EXISTS idx_access_dedup_expires ON access_dedup(expires_at)',
		],
	},
	{
		name: '0003_reactions',
		queries: [
			`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (target_key, principal, actor_id, kind, value)
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_key)',
			'CREATE INDEX IF NOT EXISTS idx_reactions_target_kind ON reactions(target_key, kind)',
		],
	},
	{
		name: '0004_emoji_catalog',
		queries: [
			`CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
    slug         TEXT    PRIMARY KEY,
    codepoint    TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
)`,
			'CREATE INDEX IF NOT EXISTS idx_reaction_emoji_catalog_enabled ON reaction_emoji_catalog(enabled)',
		],
	},
	{
		name: '0007_portfolio',
		queries: [
			`CREATE TABLE IF NOT EXISTS portfolio_project (
    id                  TEXT    PRIMARY KEY,
    slug                TEXT    NOT NULL UNIQUE,
    title               TEXT    NOT NULL,
    summary             TEXT    NOT NULL,
    role                TEXT    NOT NULL,
    period_start        INTEGER NOT NULL,
    period_end          INTEGER,
    period_label        TEXT,
    motivation_md       TEXT    NOT NULL DEFAULT '',
    architecture_md     TEXT,
    constraints_md      TEXT,
    implementation_md   TEXT,
    evidence_md         TEXT,
    retrospective_md    TEXT,
    facets              TEXT    NOT NULL DEFAULT '[]',
    technologies        TEXT    NOT NULL DEFAULT '[]',
    visibility          TEXT    NOT NULL DEFAULT 'public',
    status              TEXT    NOT NULL DEFAULT 'published',
    pinned              INTEGER NOT NULL DEFAULT 0,
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
)`,
			'CREATE INDEX IF NOT EXISTS idx_portfolio_project_slug ON portfolio_project(slug)',
			`CREATE TABLE IF NOT EXISTS portfolio_link (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL,
    label           TEXT,
    url             TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
)`,
			`CREATE TABLE IF NOT EXISTS portfolio_media (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    r2_key          TEXT    NOT NULL,
    content_type    TEXT    NOT NULL,
    width           INTEGER,
    height          INTEGER,
    alt             TEXT    NOT NULL,
    caption         TEXT,
    is_cover        INTEGER NOT NULL DEFAULT 0,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
)`,
		],
	},
];

/**
 * Fixture row for the dynamic `/portfolio/$slug` route.
 *
 * The sample slug is the one the Playwright specs and
 * `DYNAMIC_ROUTE_SAMPLES` already use (`my-web-2026`), and the row
 * is the minimum the portfolio loader reads: `public` + `published`,
 * so it passes the public-visibility filter of ADR-0011 / Issue #76.
 * `/about` reads the same table for its experience subset, so this
 * row is what lets `/about` render a real `og:image`-less head
 * rather than an empty one.
 */
const FIXTURE_PROJECT = {
	id: 'seo_head_probe',
	slug: 'my-web-2026',
	title: 'my-web-2026',
	summary: 'SEO head gate fixture project. Not real portfolio copy.',
	role: 'Solo developer',
	facets: ['develop'],
};

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);

	// `scripts/seed-portfolio.mjs` is the production seed; this is the
	// minimal equivalent for the gate (one public, published row) so
	// the dynamic detail route renders instead of 404-ing.
	await env.DB.prepare(
		`INSERT OR IGNORE INTO portfolio_project
       (id, slug, title, summary, role, period_start, period_label, motivation_md,
        facets, technologies, visibility, status, pinned, display_order, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, '', ?6, '[]', 'public', 'published', 0, 100, 0, 0)`,
	)
		.bind(
			FIXTURE_PROJECT.id,
			FIXTURE_PROJECT.slug,
			FIXTURE_PROJECT.title,
			FIXTURE_PROJECT.summary,
			FIXTURE_PROJECT.role,
			JSON.stringify(FIXTURE_PROJECT.facets),
		)
		.run();
});

/**
 * Fetch a path through the real SSR pipeline and read its `<head>`.
 *
 * Memoized: the per-route cases below and the whole-inventory case
 * read the same documents, and re-running the SSR pipeline for each
 * would make the suite pay N times for one page.
 */
const observed = new Map<string, Promise<Awaited<ReturnType<typeof observeOnce>>>>();

async function observeOnce(path: string) {
	const response = await SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' });
	const html = await response.text();
	const tags = parseHeadTags(html);
	return {
		status: response.status,
		tags,
		head: summarizeHead(tags),
	};
}

function observe(path: string) {
	const cached = observed.get(path);
	if (cached) return cached;
	const pending = observeOnce(path);
	observed.set(path, pending);
	return pending;
}

/**
 * The inventory, from the framework's routing table.
 *
 * `src/routeTree.gen.ts` is regenerated from `src/routes/**` by the
 * TanStack Start Vite plugin on every run, so this list cannot drift
 * away from the routes the Worker actually serves. Only a DYNAMIC
 * route needs a hand-declared sample (in `DYNAMIC_ROUTE_SAMPLES`);
 * a static route's fetch path IS its route path.
 */
const inventory = buildInventory(
	routeIdsFromRouteTree(routeTree as unknown as { children?: unknown[] }).map((routeId) => ({
		routeId,
		file: 'src/routeTree.gen.ts',
	})),
);

/**
 * Every discovered route, observed.
 *
 * The admin children other than `/admin/login` render no document for
 * an anonymous request — the auth gate answers 307, and
 * `/admin/invitations/accept` rejects a token-less request before
 * rendering — so they are observed as explicitly SKIPPED rows. They
 * are still in the inventory, so a route disappearing from the admin
 * surface is still a discovery event, and their noindex policy is
 * asserted through the layout head every admin child inherits. The
 * assumption that earns each SKIP is asserted by the case "renders no
 * anonymous document for an auth-gated admin route".
 */
async function observeInventory(): Promise<Observed[]> {
	const observations: Observed[] = [];

	for (const entry of inventory) {
		if (entry.kind === 'non-public' && entry.path !== NON_PUBLIC_SAMPLE_PATH) {
			observations.push({
				routeId: entry.routeId,
				path: entry.path,
				surface: entry.kind,
				status: null,
				tags: [],
				head: summarizeHead([]),
				skipped: true,
				note: `anonymous request renders no admin document (auth-gated, or rejected before rendering); the noindex policy is asserted on ${NON_PUBLIC_SAMPLE_PATH}`,
			});
			continue;
		}

		const { status, tags, head } = await observe(entry.path);
		const isRedirect = status >= 300 && status < 400;
		observations.push({
			routeId: entry.routeId,
			path: entry.path,
			surface: entry.kind,
			status,
			tags,
			head,
			...(isRedirect
				? {
						skipped: true,
						note: `anonymous request answers ${status} (auth gate); no document to evaluate`,
					}
				: {}),
		});
	}

	for (const probe of NOT_FOUND_PROBES) {
		const { status, tags, head } = await observe(probe.path);
		expect(status, `${probe.path} must answer ${probe.expectStatus}`).toBe(probe.expectStatus);
		observations.push({
			routeId: probe.id,
			path: probe.path,
			surface: 'not-found',
			status,
			tags,
			head,
		});
	}

	for (const probe of QUERY_STRING_PROBES) {
		const path = `${probe.routeId}?${probe.query}`;
		const { status, tags, head } = await observe(path);
		observations.push({
			routeId: probe.routeId,
			path,
			surface: 'public',
			status,
			tags,
			head,
			query: probe.query,
			queryProbe: true,
		});
	}

	return observations;
}

const PUBLIC_ROUTES = inventory.filter((entry) => entry.kind === 'public');

describe('public-route <head> metadata (Issue #418)', () => {
	// One case per discovered public route. A route-level failure then
	// names the route instead of dumping every finding of the run, and
	// the verification report (scripts/make-seo-head-verification-report.mjs)
	// gets one row per route out of these case names.
	for (const entry of PUBLIC_ROUTES) {
		it(`${entry.path} declares a title, a description and its canonical`, async () => {
			const { status, head } = await observe(entry.path);
			expect(status, `${entry.path} status`).toBe(200);
			expect(head.title, `${entry.path} title`).toBeTruthy();
			expect(head.description, `${entry.path} description`).toBeTruthy();
			expect(head.canonical, `${entry.path} canonical`).toBe(entry.expectedCanonical);
			// Uniqueness across the public surface is asserted in
			// aggregate by the case below ("declares a distinct title
			// on every public route"), which reports a duplicate
			// against BOTH routes instead of only the later one.
		});
	}

	it('renders every discovered public route and satisfies the policy', async () => {
		const observations = await observeInventory();
		const result = evaluateHeadInventory({ inventory, observations });

		expect(
			result.findings,
			`head metadata findings:\n${result.findings
				.map((finding) => `  [${finding.rule}] ${finding.path}: ${finding.message}`)
				.join('\n')}`,
		).toEqual([]);
	});

	it('renders a real document for every public route (no silent skip)', async () => {
		const observations = await observeInventory();
		for (const entry of inventory.filter((candidate) => candidate.kind === 'public')) {
			const observation = observations.find((candidate) => candidate.routeId === entry.routeId);
			expect(observation, `${entry.routeId} produced no observation`).toBeDefined();
			expect(observation?.skipped, `${entry.routeId} was skipped`).toBeFalsy();
			expect(observation?.status, `${entry.routeId} status`).toBe(200);
			expect(observation?.head.title, `${entry.routeId} has no <title>`).toBeTruthy();
		}
	});

	it('declares a distinct title on every public route', async () => {
		const observations = await observeInventory();
		const titles = observations
			.filter((observation) => observation.surface === 'public' && !observation.queryProbe)
			.map((observation) => ({
				path: observation.path,
				title: observation.head.title,
			}));
		const seen = new Map<string, string[]>();
		for (const entry of titles) {
			if (!entry.title) continue;
			seen.set(entry.title, [...(seen.get(entry.title) ?? []), entry.path]);
		}
		const duplicates = [...seen.entries()].filter(([, paths]) => paths.length > 1);
		expect(duplicates, `duplicate titles: ${JSON.stringify(duplicates)}`).toEqual([]);
	});

	it('declares a query-free absolute canonical on every public route', async () => {
		const observations = await observeInventory();
		for (const observation of observations) {
			if (observation.surface !== 'public') continue;
			expect(observation.head.canonical, `${observation.path} has no canonical`).not.toBeNull();
			expect(observation.head.canonical).toMatch(new RegExp(`^${CANONICAL_ORIGIN}/[^?#]*$`));
		}
	});

	it('keeps the non-public admin surface out of the index', async () => {
		const { head } = await observe(NON_PUBLIC_SAMPLE_PATH);
		expect(head.robots ?? '').toContain('noindex');
		expect(head.canonical).toBeNull();
	});

	it('renders no anonymous document for an auth-gated admin route (the SKIP is earned)', async () => {
		// A SKIP row is only justified while the route has no document
		// to evaluate. If an admin route ever answered an anonymous
		// request with a 200 document it would be indexable and would
		// leave the gate without anybody noticing, so the assumption
		// behind every admin SKIP is asserted here: no 200 document.
		//
		// Two shapes satisfy it today: the auth gate answers 307, and
		// `/admin/invitations/accept` — an intentionally anonymous
		// landing page — rejects a request without its required
		// `token` search param before rendering anything (500). The
		// gate holds no token, and the document it renders with one
		// inherits the layout's `noindex`, which is what `/admin/login`
		// asserts.
		const gated = inventory.filter(
			(entry) => entry.kind === 'non-public' && entry.path !== NON_PUBLIC_SAMPLE_PATH,
		);
		expect(gated.length).toBeGreaterThan(0);
		for (const entry of gated) {
			const { status } = await observe(entry.path);
			expect(status, `${entry.path} answered a document to an anonymous request`).not.toBe(200);
		}
	});

	it('canonicalizes a search-query URL to its query-free form', async () => {
		const probe = QUERY_STRING_PROBES[0];
		const base = await observe(probe.routeId);
		const queried = await observe(`${probe.routeId}?${probe.query}`);
		expect(queried.status).toBe(200);
		expect(queried.head.canonical).toBe(base.head.canonical);
	});

	it('keeps the dynamic sample routes inside the gate', () => {
		const dynamic = inventory.filter((entry) => entry.dynamic);
		expect(dynamic.length).toBeGreaterThan(0);
		for (const entry of dynamic) {
			expect(entry.sample, `${entry.routeId} has no declared sample`).not.toBeNull();
			expect(entry.sample?.segment.length ?? 0).toBeGreaterThan(0);
			expect(Object.keys(DYNAMIC_ROUTE_SAMPLES)).toContain(entry.routeId);
		}
	});

	it('discovers routes from the framework route tree, not a hand-written list', () => {
		const ids = inventory.map((entry) => entry.routeId);
		expect(ids).toContain('/');
		expect(ids).toContain('/about');
		expect(ids).toContain('/portfolio/$slug');
		for (const entry of inventory) {
			expect(entry.path.startsWith('/'), `${entry.routeId} has no request path`).toBe(true);
			// A missing expected canonical means the route could not be
			// checked against one — that is `inventory.dynamic-no-sample`,
			// and it must never be silently tolerated.
			expect(entry.expectedCanonical, `${entry.routeId} has no expected canonical`).not.toBeNull();
			expect(entry.expectedCanonical).toContain(CANONICAL_ORIGIN);
		}
	});
});

describe('root <head> inline flip script: no unbounded document listener (Issue #488)', () => {
	// TanStack Router merges the root head into EVERY route match, so
	// this inline script is re-created — and re-executed by the
	// browser — on every client-side navigation. The pre-#488 revision
	// ended with
	//
	//     if (!f()) document.addEventListener('DOMContentLoaded', f)
	//
	// which left one permanently dead `document` listener per route
	// change (`DOMContentLoaded` cannot fire again after the first
	// document load), i.e. +1 leaked listener per navigation,
	// unbounded. `docs/verification/perf/interaction-memory-profile.md`
	// records the measurement.
	//
	// That measurement is a browser run and is deliberately NOT wired
	// into any `validate:*` chain, so the SHAPE of the fix is pinned
	// here instead, on the document the Worker actually renders. This
	// is the same split #487 used for lazy media: a deterministic
	// contract in `validate:fast`, the browser measurement beside it.
	//
	// Two routes, because the failure is a MERGE behaviour: `/` (the
	// root head alone) and a child route (`/about`), where the root
	// script has to survive the merge with the route's own head tags.

	const FLIP_PROBE_ROUTES = ['/', '/about'];

	const rawDocuments = new Map<string, Promise<string>>();

	async function documentHtml(path: string) {
		const cached = rawDocuments.get(path);
		if (cached) return cached;
		const pending = SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' }).then(
			(response) => response.text(),
		);
		rawDocuments.set(path, pending);
		return pending;
	}

	it('ships an inline flip script that satisfies the Issue #488 contract', async () => {
		for (const path of FLIP_PROBE_ROUTES) {
			const sources = parseInlineScriptSources(await documentHtml(path));
			expect(sources.length, `${path} ships no inline <head> script`).toBeGreaterThan(0);
			const findings = evaluateFlipScriptContract(sources, { path });
			expect(
				findings.map((finding) => `${finding.rule}: ${finding.message}`),
				`${path} inline flip script contract`,
			).toEqual([]);
		}
	});

	it('rejects the pre-#488 body (the gate can actually fail)', () => {
		// Verbatim from `src/routes/__root.tsx` before this ticket.
		const leaky =
			'(function(){var f=function(){var l=document.querySelector(\'link[rel="stylesheet"][media="print"]\');if(!l)return false;if(l.sheet){l.media="all";return true}l.addEventListener("load",function(){l.media="all"});return true};if(!f())document.addEventListener("DOMContentLoaded",f)})();';
		const rules = evaluateFlipScriptContract([leaky], { path: '/' }).map((finding) => finding.rule);
		expect(rules).toContain('head.flip-script-unbounded-domcontentloaded');
	});
});

describe('public-route <head> metadata: the gate can actually fail', () => {
	// Negative controls. They are the reason the rest of the file can
	// be trusted: an engine that returned `[]` for everything would
	// make every assertion above pass vacuously.

	const cleanObservation = (path: string): Observed => ({
		routeId: path,
		path,
		surface: 'public',
		status: 200,
		tags: [
			{ title: `Control ${path}` },
			{ name: 'description', content: 'A control description that clears the lower bound.' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}${path}` },
		],
		head: summarizeHead([
			{ title: `Control ${path}` },
			{ name: 'description', content: 'A control description that clears the lower bound.' },
			{ rel: 'canonical', href: `${CANONICAL_ORIGIN}${path}` },
		]),
	});

	it('reports a duplicated title', () => {
		const first = cleanObservation('/about');
		const second = cleanObservation('/contact');
		first.head.title = 'Shared title';
		second.head.title = 'Shared title';
		const result = evaluateHeadInventory({
			inventory: buildInventory([
				{ routeId: '/about', file: 'a' },
				{ routeId: '/contact', file: 'b' },
			]),
			observations: [first, second],
		});
		expect(result.findings.map((finding) => finding.rule)).toContain('public.duplicate-title');
	});

	it('reports a missing canonical', () => {
		const observation = cleanObservation('/about');
		observation.head.canonical = null;
		const result = evaluateHeadInventory({
			inventory: buildInventory([{ routeId: '/about', file: 'a' }]),
			observations: [observation],
		});
		expect(result.findings.map((finding) => finding.rule)).toContain('public.canonical-missing');
	});

	it('reports a discovered route nobody observed', () => {
		const result = evaluateHeadInventory({
			inventory: buildInventory([
				{ routeId: '/about', file: 'a' },
				{ routeId: '/contact', file: 'b' },
			]),
			observations: [cleanObservation('/about')],
		});
		expect(result.findings.map((finding) => finding.rule)).toContain('inventory.unobserved');
	});
});
