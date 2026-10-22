/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	__resetCapturedMeasurementIdForTests,
	captureMeasurementId,
	createPageViewRouteState,
	trackRoutePageView,
} from '../../src/editorial/analytics/GoogleAnalytics';
import {
	__resetDocumentAnalyticsConsentForTests,
	setDocumentAnalyticsConsent,
} from '../../src/editorial/analytics/consent';
import {
	PRIVATE_OWNER_RECORD,
	PUBLIC_FALLBACK_PROJECTION,
	findJsonLeaks,
	findTextLeaks,
	formatLeaks,
	isPrivateFieldName,
} from '../helpers/privacy-surface';
import {
	applyPortfolioSchema,
	clearPortfolioTables,
	seedPortfolioRow,
} from './fixtures/portfolio-d1';
import { applyReactionsSchema } from './fixtures/reactions-d1';

/**
 * Owner-unapproved location / schedule data must not reach a public
 * surface (Issue #511).
 *
 * Scope of this suite — and, just as importantly, its limit:
 *
 *   - It is a **regression guard plus a detector contract**. The
 *     location / activity / calendar surface does not exist yet, so
 *     what is asserted here is that the surfaces that DO exist carry
 *     no owner-unapproved data, and that the detector which decides
 *     that is proven to fire on a real leak (`describe('fixtures')`
 *     below). When the feature lands, `PRIVATE_OWNER_RECORD` becomes
 *     the shape it must never forward.
 *   - The "private state" half of the Issue's conditional IS
 *     exercised, on the one publication boundary this repository
 *     actually ships: the portfolio public projection
 *     (`status = 'published' AND visibility = 'public'`,
 *     `src/portfolio/load.ts`). A row holding the very values of
 *     `PRIVATE_OWNER_RECORD` is seeded as `visibility = 'draft'`
 *     and asserted to be absent from `/portfolio` and from
 *     `/portfolio/<slug>`, while the public row keeps rendering.
 *     That is a request-level suppression observation against a real
 *     production projection and a real storage boundary, not a
 *     hand-built fixture — see the `describe('a private publication
 *     record …')` block below.
 *   - It still does NOT assert a publication policy for the
 *     location / activity / calendar slice itself, because none
 *     exists in `src/**` (no `visibility` switch for that slice, no
 *     admin toggle, no private schedule storage). Those need an owner
 *     decision and an implementation; inventing them here would
 *     fabricate a feature the Issue explicitly does not ask for. So
 *     the Issue's criterion is exercised for every publication
 *     boundary that exists, and stays open for the slice that does
 *     not exist yet.
 *
 * The three public surfaces the rule covers are SSR HTML, `/api/v1/*`
 * JSON, and the GA4 analytics payload.
 *
 * D1 bootstrap: `GET /` reads the reactions tables through the home
 * loader. Workerd cannot read `migrations/*.sql`, so the schema comes
 * from the shared workerd fixture
 * (`test/integration/fixtures/reactions-d1.ts`) rather than a third
 * inline copy. The catalog seed rows are omitted there on purpose:
 * this suite asserts what the public surfaces carry, not what the
 * emoji catalog contains, and an empty catalog still renders the home
 * page.
 *
 * The portfolio tables come from the shared workerd fixture
 * (`test/integration/fixtures/portfolio-d1.ts`, Issue #422) instead
 * of a second inline copy of `migrations/0007_portfolio.sql`, so
 * `/about` and `/portfolio` are scanned rather than excluded.
 *
 * Full list of what this bootstrap does NOT create, so nobody reads
 * the scanned `/` HTML as byte-identical to production:
 *
 *   - `reaction_images` (same migration, `0003_reactions.sql`) —
 *     no image reaction can be stored here.
 *   - the access-counter migrations `0002` / `0005` / `0006` — and,
 *     independently of the DDL, `src/home/access/load.ts` reaches the
 *     counter through a self-call to `/api/v1/access/*`, which leaves
 *     the pool (workerd answers it with the outbound stub, hence the
 *     `[home.access.*] upstream failed` stderr). Either way the home
 *     access-counter tile renders its empty / degraded state instead
 *     of a live count.
 *
 * Both deltas are about which *rows* exist, not about what the
 * surfaces may carry, so they cannot hide an owner-unapproved
 * location / schedule record. Closing them would mean duplicating
 * more DDL here; the production-equality of these tables is owned by
 * the D1 integration suites, not by this one.
 */

/**
 * Fixtures for the one publication boundary that ships today.
 *
 * `PUBLIC_FIXTURE_SLUG` is a normal published row. `PRIVATE_FIXTURE_SLUG`
 * carries the failing fixture verbatim — the owner-unapproved
 * coordinates, venue and event title — and is stored with
 * `visibility = 'draft'`, which is exactly the state the Issue's
 * conditional is about. Both are synthetic (see
 * `test/helpers/privacy-surface.ts`), so seeding the private row is not
 * itself a disclosure.
 */
const PUBLIC_FIXTURE_SLUG = 'privacy-fixture-public';
const PRIVATE_FIXTURE_SLUG = 'privacy-fixture-private';
const PUBLIC_FIXTURE_TITLE = 'Fixture Public Project';
const PRIVATE_EVENT = PRIVATE_OWNER_RECORD.events[0];

/**
 * Public HTML surfaces that render in this pool.
 *
 * One sample per public route file under `src/routes/**`:
 * `index.tsx` `/`, `about.tsx` `/about`, `contact.tsx` `/contact`,
 * `portfolio/index.tsx` `/portfolio`, `portfolio/$slug.tsx`
 * `/portfolio/$slug`, `tools.index.tsx` `/tools`, `tools.$slug.tsx`
 * `/tools/$slug`, `design-system.tsx` `/design-system`. `/admin/**`
 * is deliberately absent: it is behind the auth boundary, not a public
 * surface, and its content is owner-approved by definition.
 *
 * `/tools/text-counter` and `/tools/prototype` are two samples of the
 * same `$slug` loader (build-time Tool registry, not D1) because both
 * are public nav entries. `/design-system` has no loader and is in the
 * public nav. `/about` and `/portfolio` render here because the
 * portfolio schema is bootstrapped below.
 *
 * Nothing is excluded: a public surface this list does not name is a
 * coverage hole, so adding a public route means adding its path here.
 */
const PUBLIC_SSR_PATHS = [
	'/',
	'/about',
	'/contact',
	'/portfolio',
	`/portfolio/${PUBLIC_FIXTURE_SLUG}`,
	'/tools',
	'/tools/text-counter',
	'/tools/prototype',
	'/design-system',
] as const;

/**
 * Public JSON surfaces that answer without an API key.
 *
 * `/api/v1/media/ping` answers 404 in this pool: it probes for a
 * literal `probe` object in R2 and the local bucket is empty. 404
 * is that endpoint's documented "bucket reachable" signal, so both
 * 200 and 404 are a rendering Worker.
 */
const PUBLIC_JSON_PATHS = ['/api/v1/health', '/api/v1/db/ping', '/api/v1/media/ping'] as const;

beforeAll(async () => {
	await applyReactionsSchema(env.DB);
	await applyPortfolioSchema(env.DB);
	await clearPortfolioTables(env.DB);
	await seedPortfolioRow(env.DB, PUBLIC_FIXTURE_SLUG, {
		title: PUBLIC_FIXTURE_TITLE,
		summary: '公開可能な 1 行サマリー。位置も予定も持たない。',
	});
	await seedPortfolioRow(env.DB, PRIVATE_FIXTURE_SLUG, {
		// The failing fixture, stored in the real table.
		title: PRIVATE_EVENT.eventTitle,
		summary: `${PRIVATE_EVENT.venue} / ${PRIVATE_OWNER_RECORD.location.coordinates} / ${PRIVATE_EVENT.startsAt}`,
		visibility: 'draft',
	});
});

describe('privacy fixtures — the detector fires, and the private surface still reads', () => {
	it('flags the owner-unapproved record (failing fixture)', () => {
		// The non-vacuity half. Without this, every assertion below
		// ("the page has no coordinates") would also hold for a
		// detector that cannot see a coordinate at all.
		const leaks = findJsonLeaks(PRIVATE_OWNER_RECORD);
		const rules = new Set(leaks.map((leak) => leak.detail));
		expect(rules).toContain('latitude');
		expect(rules).toContain('longitude');
		expect(rules).toContain('eventTitle');
		expect(rules).toContain('venue');
		expect(rules).toContain('startsAt');
		expect(rules).toContain('endsAt');
		expect(formatLeaks(leaks)).toContain('coordinate-pair');
	});

	it('flags the same record after it is serialised into markup', () => {
		// The SSR shape: TanStack Start serialises loader payloads
		// into the document, so a leaked record would arrive as JSON
		// inside a <script>, not as a top-level response body.
		const html = `<html><body><script>window.__DATA__ = ${JSON.stringify(
			PRIVATE_OWNER_RECORD,
		)};</script></body></html>`;
		const leaks = findTextLeaks(html);
		expect(leaks.some((leak) => leak.rule === 'field-key')).toBe(true);
		expect(leaks.some((leak) => leak.rule === 'coordinate-pair')).toBe(true);
	});

	it('flags a geo: URI even when no field name says "location"', () => {
		const leaks = findTextLeaks('<a href="geo:12.3456,-98.7654">current place</a>');
		expect(leaks.map((leak) => leak.rule)).toContain('geo-uri');
	});

	it('leaves the public fallback projection clean and non-empty', () => {
		// The passing fixture: "private" must never degrade into
		// "blank". The surface keeps its statement, and the statement
		// carries no position.
		expect(findJsonLeaks(PUBLIC_FALLBACK_PROJECTION)).toEqual([]);
		expect(PUBLIC_FALLBACK_PROJECTION.statementJa.length).toBeGreaterThan(0);
		expect(PUBLIC_FALLBACK_PROJECTION.statementEn.length).toBeGreaterThan(0);
		expect(PUBLIC_FALLBACK_PROJECTION.href).toBeNull();
	});

	it('does not mistake ordinary field names for owner-unapproved ones', () => {
		// Precision check: a detector that flags everything is as
		// useless as one that flags nothing.
		for (const name of ['flat', 'alongitude', 'placeholder', 'plate']) {
			expect(isPrivateFieldName(name)).toBe(false);
		}
		for (const name of ['latitude', 'data-longitude', 'userLatitude', 'event_title']) {
			expect(isPrivateFieldName(name)).toBe(true);
		}
	});
});

describe('public SSR surfaces carry no owner-unapproved data', () => {
	it.each(PUBLIC_SSR_PATHS)(
		'GET %s renders without a private record',
		async (path) => {
			const res = await SELF.fetch(`https://example.com${path}`);
			expect(res.status).toBe(200);
			const html = await res.text();
			const leaks = findTextLeaks(html);
			expect(formatLeaks(leaks)).toBe('no owner-unapproved data found');
		},
		// The first `/` render in a file compiles every route module
		// and runs the home loader's upstream probes; the pool's
		// default 5s budget is not enough for that cold path.
		30_000,
	);

	it('GET / still offers the activity surface as a public fallback', async () => {
		// The positive half of the location contract: the home page
		// keeps telling a visitor what the Activity surface is, and
		// marks it `planned` — the public alternative display. The
		// capability carries no deep link, because there is no
		// published surface behind it yet.
		const html = await (await SELF.fetch('https://example.com/')).text();
		expect(html).toContain('アクティビティ');
		expect(html).toContain(PUBLIC_FALLBACK_PROJECTION.statementJa);
		expect(html).toContain('planned');
		expect(html).not.toContain('href="/activity"');
	}, 30_000);
});

describe('a private publication record is suppressed on the projection that ships', () => {
	it('the private row is stored, with the values a response must not carry', async () => {
		// Non-vacuity at the storage boundary. If this write silently
		// did not happen, every "the response does not carry it"
		// assertion below would pass for the wrong reason.
		const row = await env.DB.prepare(
			'SELECT title, summary, visibility, status FROM portfolio_project WHERE slug = ?1',
		)
			.bind(PRIVATE_FIXTURE_SLUG)
			.first<{ title: string; summary: string; visibility: string; status: string }>();
		expect(row).not.toBeNull();
		expect(row?.visibility).toBe('draft');
		// `status` stays `published`: the row is not unpublished, it is
		// merely not public — the distinction the publication boundary
		// exists to make.
		expect(row?.status).toBe('published');
		expect(row?.title).toBe(PRIVATE_EVENT.eventTitle);
		// The stored record is the failing fixture, verbatim: if the
		// detector stops seeing it here, the suppression assertions
		// below stop meaning anything.
		expect(formatLeaks(findJsonLeaks(row))).toContain('coordinate-pair');
	});

	it('GET /portfolio keeps the public projection and drops the private record', async () => {
		// The Issue's conditional, observed end to end: a private record
		// does not reach the response, and the public alternative
		// display survives instead of the page going blank.
		const res = await SELF.fetch('https://example.com/portfolio');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain(PUBLIC_FIXTURE_TITLE);
		expect(html).not.toContain(PRIVATE_EVENT.eventTitle);
		expect(html).not.toContain(PRIVATE_EVENT.venue);
		expect(formatLeaks(findTextLeaks(html))).toBe('no owner-unapproved data found');
	}, 30_000);

	it('GET /portfolio/<public> renders the public projection', async () => {
		const res = await SELF.fetch(`https://example.com/portfolio/${PUBLIC_FIXTURE_SLUG}`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain(PUBLIC_FIXTURE_TITLE);
		expect(formatLeaks(findTextLeaks(html))).toBe('no owner-unapproved data found');
	}, 30_000);

	it('GET /portfolio/<private> answers 404 and carries no part of the record', async () => {
		// Even by direct slug the public projection cannot reach a
		// non-public row — `src/portfolio/load.ts` filters in SQL and
		// re-checks with `isVisible`.
		const res = await SELF.fetch(`https://example.com/portfolio/${PRIVATE_FIXTURE_SLUG}`);
		expect(res.status).toBe(404);
		const html = await res.text();
		expect(html).not.toContain(PRIVATE_EVENT.eventTitle);
		expect(html).not.toContain(PRIVATE_EVENT.venue);
		expect(formatLeaks(findTextLeaks(html))).toBe('no owner-unapproved data found');
	}, 30_000);
});

describe('public JSON surfaces carry no owner-unapproved data', () => {
	it.each(PUBLIC_JSON_PATHS)('GET %s answers without a private field', async (path) => {
		const res = await SELF.fetch(`https://example.com${path}`);
		const body = await res.text();
		expect([200, 404]).toContain(res.status);
		expect(formatLeaks(findJsonLeaks(JSON.parse(body) as unknown))).toBe(
			'no owner-unapproved data found',
		);
	});

	it('a refused API-key request answers without a private field', async () => {
		// The error path is a public surface too: an auth refusal
		// must not turn into a data channel.
		const res = await SELF.fetch('https://example.com/api/v1/reactions');
		const body = await res.text();
		expect(res.status).toBe(401);
		expect(formatLeaks(findJsonLeaks(JSON.parse(body) as unknown))).toBe(
			'no owner-unapproved data found',
		);
	});
});

/**
 * Records every `gtag(...)` call for one test and restores the two
 * globals the tracker writes through.
 *
 * `gtag('event', 'page_view', params)` — the params object is the
 * last argument, so the fake records every argument rather than
 * assuming a position.
 */
function captureGtagCalls(): { calls: unknown[][]; restore(): void } {
	const calls: unknown[][] = [];
	const globals = globalThis as unknown as {
		gtag?: (command: string, ...params: unknown[]) => void;
		dataLayer?: unknown[];
	};
	globals.dataLayer = [];
	globals.gtag = (command: string, ...params: unknown[]) => {
		calls.push([command, ...params]);
	};
	return {
		calls,
		restore() {
			globals.gtag = undefined;
			globals.dataLayer = undefined;
		},
	};
}

describe('the analytics payload carries no owner-unapproved data', () => {
	it('the default SSR document carries no analytics bootstrap at all', async () => {
		// Issue #495 moved the measurement decision into the browser:
		// a first visit (no stored decision, which is what this request
		// is) renders no loader and no inline `config`. That is
		// strictly stronger than the pre-#495 claim that the bootstrap
		// "carries only the property id" — there is no bootstrap to
		// carry anything, so the privacy surface starts empty.
		const html = await (await SELF.fetch('https://example.com/')).text();
		expect(html).not.toContain('googletagmanager');
		expect(html).not.toContain('gtag(');
		expect(formatLeaks(findTextLeaks(html))).toBe('no owner-unapproved data found');
	}, 30_000);

	it('a route-change page_view sends nothing while the decision is unset or denied', () => {
		// The gate fails toward silence: `unset` is a first-class state
		// meaning "no measurement", not an error to be defaulted to a
		// grant. A fresh route state per iteration proves the silence
		// comes from the decision and not from the tracker thinking the
		// path never changed.
		const cap = captureGtagCalls();
		try {
			for (const state of ['unset', 'denied'] as const) {
				__resetCapturedMeasurementIdForTests();
				__resetDocumentAnalyticsConsentForTests();
				captureMeasurementId('G-DUMMYTEST00');
				setDocumentAnalyticsConsent(state);
				trackRoutePageView(createPageViewRouteState('/'), '/portfolio');
			}
			expect(cap.calls).toHaveLength(0);
		} finally {
			cap.restore();
			__resetCapturedMeasurementIdForTests();
			__resetDocumentAnalyticsConsentForTests();
		}
	});

	it('a granted route-change page_view reports the route and nothing else', () => {
		// Deliberately overlaps GoogleAnalytics.client.test.tsx, which
		// owns the analytics contract. This case re-asserts the same
		// payload through the privacy vocabulary so the allowlist
		// cannot drift into a field name this contract would reject;
		// it is the one test here that does not read a public surface,
		// and it stays for that reason.
		const cap = captureGtagCalls();
		try {
			__resetCapturedMeasurementIdForTests();
			__resetDocumentAnalyticsConsentForTests();
			captureMeasurementId('G-DUMMYTEST00');
			setDocumentAnalyticsConsent('granted');

			trackRoutePageView(createPageViewRouteState('/'), '/portfolio');
			expect(cap.calls).toHaveLength(1);
			expect(cap.calls[0][0]).toBe('event');
			expect(cap.calls[0][1]).toBe('page_view');
			const params = cap.calls[0][2] as Record<string, unknown>;
			// page_path / page_location / page_title are the whole
			// GA4 contract this project publishes. `page_location`
			// and `page_title` exist only where the host exposes
			// `location` / `document`, so the assertion is a subset
			// rather than an exact list.
			expect(Object.keys(params).length).toBeGreaterThan(0);
			for (const key of Object.keys(params)) {
				expect(['page_path', 'page_location', 'page_title']).toContain(key);
			}
			expect(formatLeaks(findJsonLeaks(params))).toBe('no owner-unapproved data found');
		} finally {
			cap.restore();
			__resetCapturedMeasurementIdForTests();
			__resetDocumentAnalyticsConsentForTests();
		}
	});
});
