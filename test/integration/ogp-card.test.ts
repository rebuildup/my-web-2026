/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	evaluateSocialCard,
	evaluateSocialCards,
	summarizeSocialCard,
} from '../../scripts/ogp-card-contract.mjs';
import { parseHeadTags, routeIdsFromRouteTree } from '../../scripts/seo-head-contract.mjs';
import {
	DEFERRED_SURFACES,
	FALLBACK_CARD,
	FALLBACK_CARD_URL,
	ROUTE_COVERAGE,
	SITE_LOCALE,
	SITE_NAME,
	socialCardUrl,
} from '../../src/editorial/social-card';
import { routeTree } from '../../src/routeTree.gen';
import SNAPSHOT from './fixtures/ogp-card-snapshot.json';

/**
 * Open Graph / Twitter card gate (Issue #421).
 *
 * This is the CI half. It drives the REAL Worker through `SELF.fetch`,
 * parses the SSR `<head>` each public surface actually renders, and
 * hands the result to the same policy engine
 * (`scripts/ogp-card-contract.mjs`) that
 * `scripts/check-ogp-card.mjs --live <baseUrl>` uses against a real
 * origin. One engine, two front-ends: a rule cannot pass here and fail
 * there.
 *
 * Why `SELF.fetch` and not a route-module unit test
 * -------------------------------------------------
 * `Route.options.head()` returning an array is not what a crawler
 * receives. The head MERGE (the root route's meta, per-route dedupe by
 * `property`/`name` with the deepest route winning) and the SSR render
 * of those tags are the parts that break silently, and both exist only
 * on this side of the boundary. `src/editorial/social-card/card.test.ts`
 * covers the composer's decisions; this file covers the document.
 *
 * What the workerd pool can and cannot show
 * -----------------------------------------
 * `vitest.config.ts` deliberately leaves `MEDIA_PUBLIC_BASE_URL` and
 * `BETTER_AUTH_URL` UNBOUND, because binding them made
 * `composeMediaUrl` return a real URL where the loader tests assert the
 * unbound branch. So the pool renders the **missing-media** branch on
 * purpose: `/portfolio/$slug` and `/portfolio` have no composable image
 * here and must publish the site fallback card. That is the branch the
 * Issue is about, and it is the one CI can assert end to end.
 *
 * The `content` branch is asserted where it can be, without lying about
 * the environment: at the composer (`card.test.ts`, both branches, with
 * negative controls) and against the production-shaped media URL the
 * E2E spec already pins (`e2e/prod-portfolio.spec.ts`).
 *
 * No silent passes
 * ----------------
 *   - The surface list is the repository's own contract
 *     (`ROUTE_COVERAGE`), whose completeness against the framework route
 *     tree is proven by `scripts/check-ogp-card.mjs` (also in
 *     `validate:fast`).
 *   - A declared surface that produced no observation is a finding
 *     (`inventory.unobserved`), not a skip.
 *   - Every surface declared `cardPolicy: 'none'` must actually publish
 *     no image tag; a tag appearing there is `card.undeclared-image`.
 *   - The negative controls at the bottom feed the engine documents
 *     that violate the contract in one specific way each and assert it
 *     reports them — a gate that cannot fail is not a gate.
 */

/**
 * Migrations inlined because workerd cannot read `migrations/*.sql`
 * (see `test/integration/seo-head.test.ts`, which inlines the same
 * shape). Only `portfolio_*` is needed here: the card contract reads no
 * other table, and the home / reactions tables stay unclaimed so a
 * missing migration fails loudly rather than rendering a half-empty
 * page.
 */
const MIGRATIONS = [
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
 * Fixture rows.
 *
 * Two projects, on purpose: `my-web-2026` (the slug
 * `contract.json#routes[/portfolio/$slug].samplePath` names, and the one
 * the other suites use) and `ogp-card-fixture-second` so the LIST route
 * has more than one candidate to pick a cover from. Neither has a media
 * row: with `MEDIA_PUBLIC_BASE_URL` unbound a media row would compose a
 * null URL anyway, and asserting the no-media path keeps the fixture
 * identical to the production shape this branch describes.
 */
const FIXTURE_PROJECTS = [
	{
		id: 'ogp_card_probe_a',
		slug: 'my-web-2026',
		title: 'my-web-2026',
		summary: 'OGP card gate fixture project. Not real portfolio copy.',
	},
	{
		id: 'ogp_card_probe_b',
		slug: 'ogp-card-fixture-second',
		title: 'OGP card gate fixture (second)',
		summary: 'A second row so the list route has more than one candidate cover.',
	},
];

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
	for (const project of FIXTURE_PROJECTS) {
		await env.DB.prepare(
			`INSERT OR IGNORE INTO portfolio_project
         (id, slug, title, summary, role, period_start, motivation_md,
          facets, technologies, visibility, status, pinned, display_order, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'Solo developer', 0, '', '["develop"]', '[]', 'public', 'published', 0, 0, 0, 0)`,
		)
			.bind(project.id, project.slug, project.title, project.summary)
			.run();
	}
});

/** Policy view of the repository contract, for the shared engine. */
const POLICY = {
	canonicalOrigin: socialCardUrl('').replace(/\/$/, ''),
	siteName: SITE_NAME,
	siteLocale: SITE_LOCALE,
	fallbackCardUrl: FALLBACK_CARD_URL,
	fallbackCardAlt: FALLBACK_CARD.alt,
	fallbackCardWidth: FALLBACK_CARD.width,
	fallbackCardHeight: FALLBACK_CARD.height,
};

/** Surfaces this suite evaluates: every declared visitor-facing route. */
const SURFACES = ROUTE_COVERAGE.filter((entry) => entry.public !== false);

const observed = new Map<string, Promise<Awaited<ReturnType<typeof observeOnce>>>>();

async function observeOnce(path: string) {
	const response = await SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' });
	const html = await response.text();
	return { status: response.status, tags: parseHeadTags(html) };
}

function observe(path: string) {
	const cached = observed.get(path);
	if (cached) return cached;
	const pending = observeOnce(path);
	observed.set(path, pending);
	return pending;
}

async function observeAll() {
	const observations = [];
	for (const surface of SURFACES) {
		const { status, tags } = await observe(surface.samplePath);
		observations.push({ path: surface.samplePath, status, tags });
	}
	return observations;
}

/**
 * The card metadata each representative URL published, keyed by request
 * path, with absent keys dropped.
 *
 * This is the data `docs/verification/seo/ogp-preview.webp` renders. It
 * is committed and compared with `toEqual` against the live SSR output
 * so the screenshot cannot describe a document CI does not verify —
 * the same arrangement as `fixtures/structured-data-snapshot.json`
 * (Issue #422).
 */
function cardSnapshot(observations: Awaited<ReturnType<typeof observeAll>>) {
	return Object.fromEntries(
		observations.map((observation) => [
			observation.path,
			Object.fromEntries(
				Object.entries(summarizeSocialCard(observation.tags)).filter(
					([, value]) => value !== null && value !== '',
				),
			),
		]),
	);
}

describe('Open Graph / Twitter card (Issue #421)', () => {
	it('publishes a card the contract can evaluate on every declared surface', async () => {
		const observations = await observeAll();
		const result = evaluateSocialCards({ surfaces: SURFACES, observations, policy: POLICY });

		expect(
			result.findings,
			`social card findings:\n${result.findings
				.map((item) => `  [${item.rule}] ${item.path}: ${item.message}`)
				.join('\n')}`,
		).toEqual([]);
		expect(result.rows.length).toBe(SURFACES.length);
	});

	// The Issue in one row: a project with no composable media still has
	// to unfurl with an image, and the report has to be able to say the
	// card came from the fallback rather than from the project.
	it('matches the committed snapshot the verification report renders', async () => {
		const observations = await observeAll();
		// Regenerating the fixture: workerd cannot write the repo's
		// filesystem, so the bootstrap is done by hand — replace this
		// assertion with
		//   expect(JSON.stringify(cardSnapshot(observations), null, '\t')).toBe('BOOTSTRAP')
		// run the case, and copy the printed `+ Received` block over
		// `fixtures/ogp-card-snapshot.json`. Read that diff in the PR
		// body: it is the document the report screenshot claims.
		expect(cardSnapshot(observations)).toEqual(SNAPSHOT);
	});

	it('falls back to the site card for a project with no composable media', async () => {
		const surface = ROUTE_COVERAGE.find((entry) => entry.path === '/portfolio/$slug');
		const { status, tags } = await observe(surface.samplePath);
		expect(status).toBe(200);

		const { image, findings } = evaluateSocialCard({ surface, tags, policy: POLICY });
		expect(findings).toEqual([]);
		expect(image?.source).toBe('fallback');
		expect(image?.url).toBe(FALLBACK_CARD_URL);

		// The same facts, read straight out of the document: an
		// unfurler sees exactly this.
		const ogImage = tags.find((tag) => tag.property === 'og:image');
		expect(ogImage?.content).toBe(FALLBACK_CARD_URL);
		const alt = tags.find((tag) => tag.property === 'og:image:alt');
		expect(alt?.content).toBe(FALLBACK_CARD.alt);
	});

	it('falls back on the list route too, not only on the detail route', async () => {
		const surface = ROUTE_COVERAGE.find((entry) => entry.path === '/portfolio/');
		const { status, tags } = await observe(surface.samplePath);
		expect(status).toBe(200);
		const { image, findings } = evaluateSocialCard({ surface, tags, policy: POLICY });
		expect(findings).toEqual([]);
		expect(image?.source).toBe('fallback');
	});

	it('declares the card as an article on a project detail page', async () => {
		const { tags } = await observe('/portfolio/my-web-2026');
		const ogType = tags.find((tag) => tag.property === 'og:type');
		expect(ogType?.content).toBe('article');
		const ogUrl = tags.find((tag) => tag.property === 'og:url');
		expect(ogUrl?.content).toBe('https://rebuildup.dev/portfolio/my-web-2026');
	});

	it('mirrors every og property into its twitter counterpart', async () => {
		for (const samplePath of ['/portfolio/my-web-2026', '/about']) {
			const { tags } = await observe(samplePath);
			const read = (key) =>
				tags.find((tag) => tag.property === key || tag.name === key)?.content ?? null;
			expect(read('twitter:card'), samplePath).toBe('summary_large_image');
			expect(read('twitter:image'), samplePath).toBe(read('og:image'));
			expect(read('twitter:title'), samplePath).toBe(read('og:title'));
			expect(read('twitter:description'), samplePath).toBe(read('og:description'));
		}
	});

	it('publishes no image on a surface whose contract declares none', async () => {
		for (const surface of SURFACES.filter((entry) => entry.cardPolicy === 'none')) {
			const { status, tags } = await observe(surface.samplePath);
			expect(status, `${surface.samplePath} status`).toBe(200);
			for (const tag of tags) {
				const key = tag.property ?? tag.name;
				expect(key, `${surface.samplePath} publishes ${key}`).not.toBe('og:image');
				expect(key, `${surface.samplePath} publishes ${key}`).not.toBe('twitter:image');
			}
			const { findings } = evaluateSocialCard({ surface, tags, policy: POLICY });
			expect(findings, surface.samplePath).toEqual([]);
		}
	});

	it('renders a real document for every declared surface (no silent skip)', async () => {
		expect(SURFACES.length).toBeGreaterThan(0);
		for (const surface of SURFACES) {
			const { status, tags } = await observe(surface.samplePath);
			expect(status, `${surface.path} status`).toBe(200);
			// Every declared surface must render a head. A surface whose
			// contract declares no card is allowed a title, a description
			// and `og:url` only — what it may NOT do is answer a request
			// with no document at all, which is what a skip would hide.
			expect(
				tags.some((tag) => typeof tag.title === 'string' && tag.title.length > 0),
				`${surface.path} rendered no <title>`,
			).toBe(true);
			if (surface.status === 'implemented') {
				expect(
					tags.some((tag) => tag.property === 'og:title'),
					`${surface.path} claims a card but publishes no og:title`,
				).toBe(true);
			}
		}
	});

	it('keeps the contract aligned with the router it describes', () => {
		const ids = routeIdsFromRouteTree(routeTree as unknown as { children?: unknown[] }).map(
			(routeId) => routeId.replace(/\/$/, '') || '/',
		);
		const declared = ROUTE_COVERAGE.map((entry) => entry.path.replace(/\/$/, '') || '/');
		for (const id of ids) {
			if (id.startsWith('/admin')) continue;
			expect(declared, `${id} is served but undeclared`).toContain(id);
		}
		// Issue #421 names 記事. No article route exists at this
		// release, and the contract must say so out loud rather than
		// leave a gap that reads as a pass.
		expect(DEFERRED_SURFACES.map((entry) => entry.id)).toContain('articles');
		for (const deferred of DEFERRED_SURFACES) {
			expect(deferred.reason.length).toBeGreaterThan(40);
			expect(ids.some((id) => id.includes(deferred.id))).toBe(false);
		}
	});
});

describe('Open Graph / Twitter card: the gate can actually fail', () => {
	// Negative controls. They are why the assertions above can be
	// trusted: an engine that returned `[]` for everything would make
	// them all pass vacuously.
	const surface = ROUTE_COVERAGE.find((entry) => entry.path === '/portfolio/$slug');

	function head(image) {
		return [
			{ property: 'og:type', content: 'article' },
			{ property: 'og:site_name', content: SITE_NAME },
			{ property: 'og:locale', content: SITE_LOCALE },
			{ property: 'og:title', content: 'my-web-2026' },
			{ property: 'og:description', content: 'A description long enough for the policy.' },
			{ property: 'og:url', content: 'https://rebuildup.dev/portfolio/my-web-2026' },
			{ property: 'og:image', content: image },
			{ property: 'og:image:alt', content: 'fallback card' },
			{ property: 'og:image:width', content: String(FALLBACK_CARD.width) },
			{ property: 'og:image:height', content: String(FALLBACK_CARD.height) },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:title', content: 'my-web-2026' },
			{ name: 'twitter:description', content: 'A description long enough for the policy.' },
			{ name: 'twitter:image', content: image },
		];
	}

	it('reports a document with no og:image at all', () => {
		const { findings } = evaluateSocialCard({ surface, tags: [], policy: POLICY });
		expect(findings.map((item) => item.rule)).toContain('card.image-missing');
	});

	it('reports a document whose card is smaller than it claims', () => {
		const tags = head(FALLBACK_CARD_URL).map((tag) =>
			tag.property === 'og:image:width' ? { ...tag, content: '800' } : tag,
		);
		const { findings } = evaluateSocialCard({ surface, tags, policy: POLICY });
		expect(findings.map((item) => item.rule)).toContain('card.image-width');
	});

	it('reports a declared surface nobody observed', () => {
		const result = evaluateSocialCards({
			surfaces: SURFACES,
			observations: [],
			policy: POLICY,
		});
		expect(result.findings.map((item) => item.rule)).toContain('inventory.unobserved');
		expect(result.findings.length).toBe(SURFACES.length);
	});

	it('reports a request that failed instead of reading it as an absent card', () => {
		const result = evaluateSocialCards({
			surfaces: [surface],
			observations: [
				{
					path: surface.samplePath,
					status: null,
					tags: [],
					requestFailed: true,
					requestError: 'connection reset',
				},
			],
			policy: POLICY,
		});
		expect(result.findings.map((item) => item.rule)).toEqual(['observation.request-failed']);
	});
});
