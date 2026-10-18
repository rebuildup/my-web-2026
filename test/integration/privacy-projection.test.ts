/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	__resetCapturedMeasurementIdForTests,
	captureMeasurementId,
	createPageViewRouteState,
	trackRoutePageView,
} from '../../src/editorial/analytics/GoogleAnalytics';
import {
	PRIVATE_OWNER_RECORD,
	PUBLIC_FALLBACK_PROJECTION,
	findJsonLeaks,
	findTextLeaks,
	formatLeaks,
	isPrivateFieldName,
} from '../helpers/privacy-surface';

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
 *   - It does NOT assert publication policy behaviour that does not
 *     exist (no `visibility` switch, no admin toggle, no private
 *     schedule storage). Those need an owner decision and an
 *     implementation; inventing them here would fabricate a feature
 *     the Issue explicitly does not ask for.
 *
 * The three public surfaces the rule covers are SSR HTML, `/api/v1/*`
 * JSON, and the GA4 analytics payload.
 *
 * D1 bootstrap: `GET /` reads the reactions tables through the home
 * loader. Workerd cannot read `migrations/*.sql`, so the schema is
 * inlined below, byte-identical to `test/integration/d1.test.ts` and
 * to `migrations/0003_reactions.sql` / `0004_emoji_catalog.sql`.
 */
const MIGRATIONS = [
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
];

/**
 * Public HTML surfaces that render in this pool.
 *
 * `/about` and `/portfolio` are deliberately absent: their loaders
 * read the portfolio D1 schema, which this file does not bootstrap
 * (it only needs the reactions tables for `/`), so both answer 500
 * here and there is no HTML to scan.
 */
const PUBLIC_SSR_PATHS = ['/', '/contact', '/tools'] as const;

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
	await applyD1Migrations(env.DB, MIGRATIONS);
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
		const leaks = findTextLeaks('<a href="geo:33.9846,131.4216">current place</a>');
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

describe('the analytics payload carries no owner-unapproved data', () => {
	it('the SSR analytics bootstrap sends the measurement ID and nothing else', async () => {
		const html = await (await SELF.fetch('https://example.com/')).text();
		const scripts = html.match(/<script[^>]*>[^<]*gtag\([^<]*<\/script>/g) ?? [];
		expect(scripts.length).toBeGreaterThan(0);
		for (const script of scripts) {
			expect(findTextLeaks(script)).toEqual([]);
		}
		// The only value the inline init carries is the GA4
		// property id; a visitor property, a position or an event
		// name would all have to appear in this script.
		expect(html).toMatch(/gtag\('config', 'G-[A-Z0-9]+'\)/);
	}, 30_000);

	it('a route-change page_view reports the route and nothing else', () => {
		__resetCapturedMeasurementIdForTests();
		captureMeasurementId('G-DUMMYTEST00');

		// `gtag('event', 'page_view', params)` — the params object is
		// the last argument, so the fake records every argument
		// rather than assuming a position.
		const calls: unknown[][] = [];
		const globals = globalThis as unknown as {
			gtag?: (command: string, ...params: unknown[]) => void;
			dataLayer?: unknown[];
		};
		globals.dataLayer = [];
		globals.gtag = (command: string, ...params: unknown[]) => {
			calls.push([command, ...params]);
		};

		try {
			trackRoutePageView(createPageViewRouteState('/'), '/portfolio');
			expect(calls).toHaveLength(1);
			expect(calls[0][0]).toBe('event');
			expect(calls[0][1]).toBe('page_view');
			const params = calls[0][2] as Record<string, unknown>;
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
			globals.gtag = undefined;
			globals.dataLayer = undefined;
			__resetCapturedMeasurementIdForTests();
		}
	});
});
