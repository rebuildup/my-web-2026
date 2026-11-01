import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	applyPortfolioSchema,
	clearPortfolioTables,
	seedPortfolioRow,
} from '../../test/integration/fixtures/portfolio-d1';
import { createD1PortfolioLoader, intersectsAny } from './load';
import type { PortfolioListPage, PortfolioProject } from './schema';
import { encodeCursor } from './schema';
import { PORTFOLIO_SEED } from './seed';

/**
 * Portfolio loader integration tests (Issue #76).
 *
 * These tests exercise `createD1PortfolioLoader` against a real
 * workerd D1 binding. The schema is applied per-test (mirroring
 * the pattern in `src/home/reactions/load.test.ts`) because
 * `vitest.config.ts` setupFiles already covers the Better Auth
 * schema; we add the portfolio migration on top.
 *
 * DI seam:
 *   We pass `env` (a hand-rolled `{ DB, MEDIA? }`) directly
 *   into `createD1PortfolioLoader`. We do NOT use `vi.mock` on
 *   the module — the workerd pool does not intercept vi.mock of
 *   regular TS modules (see [[workerd-vitest-mock-gap]]).
 *
 * Coverage:
 *   1. schema apply + clear
 *   2. seed integrity (every seed entry has required fields)
 *   3. `loadPortfolioProject` returns null on missing / draft /
 *      archived / unlisted (PUBLIC VISIBILITY BOUNDARY)
 *   4. `loadPortfolioProject` returns the project for a public slug
 *   5. `listPortfolioProjects` honours `facets` and returns
 *      `public + published` rows only
 *   6. cursor pagination: stable ordering, no skip/duplicate,
 *      `nextCursor=null` on the final page
 *   7. cover media is exposed at `media[0]` with `isCover=true`
 */

async function applySchema(): Promise<void> {
	await applyPortfolioSchema(env.DB);
}

async function clearTables(): Promise<void> {
	await clearPortfolioTables(env.DB);
}

async function seedOne(slug: string, overrides: Record<string, unknown> = {}): Promise<string> {
	return seedPortfolioRow(env.DB, slug, overrides);
}

describe('portfolio — intersectsAny', () => {
	it('matches when any requested facet is present', () => {
		expect(intersectsAny('["develop","video"]', ['video'])).toBe(true);
		expect(intersectsAny('["develop"]', ['video', 'design'])).toBe(false);
	});
	it('handles malformed JSON safely', () => {
		expect(intersectsAny('not-json', ['develop'])).toBe(false);
		expect(intersectsAny('', ['develop'])).toBe(false);
	});
});

describe('portfolio — seed integrity', () => {
	it('every entry has the minimum shape required for a published project', () => {
		expect(PORTFOLIO_SEED.length).toBeGreaterThanOrEqual(3);
		for (const entry of PORTFOLIO_SEED) {
			expect(entry.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,127}$/);
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.summary.length).toBeGreaterThan(0);
			expect(entry.role.length).toBeGreaterThan(0);
			expect(entry.periodStart).toBeGreaterThan(0);
			expect(entry.facets.length).toBeGreaterThan(0);
			expect(entry.technologies.length).toBeGreaterThan(0);
		}
	});

	it('every slug is unique', () => {
		const slugs = PORTFOLIO_SEED.map((e) => e.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('every entry has at most one isCover media', () => {
		for (const entry of PORTFOLIO_SEED) {
			const covers = entry.media.filter((m) => m.isCover);
			expect(covers.length).toBeLessThanOrEqual(1);
		}
	});
});

describe('portfolio — D1 loader (workerd pool, DI seam)', () => {
	beforeEach(async () => {
		await applySchema();
		await clearTables();
	});
	afterEach(async () => {
		await clearTables();
	});

	it('returns null when the binding is missing', async () => {
		const loader = createD1PortfolioLoader({});
		expect(await loader.loadPortfolioProject('aulymo')).toBeNull();
		expect(await loader.loadPortfolioAdjacent('aulymo')).toEqual({ prev: null, next: null });
		const page = await loader.listPortfolioProjects();
		expect(page).toEqual({ projects: [], nextCursor: null });
	});

	it('returns null for an unknown slug', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('aulymo');
		expect(await loader.loadPortfolioProject('nope')).toBeNull();
	});

	// PUBLIC VISIBILITY BOUNDARY — see Issue #76 / PR #83 review.
	// `loadPortfolioProject` MUST return null for any row that is
	// not `visibility='public' AND status='published'`. The
	// public surface cannot reach unlisted, draft, or archived
	// rows even by slug.
	it('PUBLIC BOUNDARY — hides draft rows', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('draft1', { visibility: 'draft' });
		expect(await loader.loadPortfolioProject('draft1')).toBeNull();
	});

	it('PUBLIC BOUNDARY — hides archived rows', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('archived1', { status: 'archived' });
		expect(await loader.loadPortfolioProject('archived1')).toBeNull();
	});

	it('PUBLIC BOUNDARY — hides unlisted rows (public surface cannot reach by slug)', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('unlisted1', { visibility: 'unlisted' });
		expect(await loader.loadPortfolioProject('unlisted1')).toBeNull();
	});

	it('PUBLIC BOUNDARY — hides draft rows even when other fields look fine', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('draft2', {
			visibility: 'draft',
			status: 'published',
			facets: '["develop"]',
		});
		expect(await loader.loadPortfolioProject('draft2')).toBeNull();
	});

	it('PUBLIC BOUNDARY — hides unlisted rows even when other fields look fine', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('unlisted2', {
			visibility: 'unlisted',
			status: 'published',
			pinned: 1,
		});
		expect(await loader.loadPortfolioProject('unlisted2')).toBeNull();
	});

	// Adjacent lookup — prev / next in canonical sort order (Issue #77).
	it('loadPortfolioAdjacent — returns prev/next in canonical sort order', async () => {
		const loader = createD1PortfolioLoader(env);
		// canonical order: pinned DESC, display_order ASC, updated_at DESC, id ASC
		await seedOne('p1', { pinned: 0, display_order: 0 });
		await seedOne('p2', { pinned: 0, display_order: 1 });
		await seedOne('p3', { pinned: 0, display_order: 2 });

		// p2 sits between p1 (earlier in list) and p3 (later in list).
		// "prev" = row that ranks ABOVE the target (earlier in list).
		// "next" = row that ranks BELOW the target (later in list).
		const adjacent = await loader.loadPortfolioAdjacent('p2');
		expect(adjacent.prev?.slug).toBe('p1');
		expect(adjacent.next?.slug).toBe('p3');
	});

	it('loadPortfolioAdjacent — first row has prev=null', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('p1', { display_order: 0 });
		await seedOne('p2', { display_order: 1 });
		const adjacent = await loader.loadPortfolioAdjacent('p1');
		expect(adjacent.prev).toBeNull();
		expect(adjacent.next?.slug).toBe('p2');
	});

	it('loadPortfolioAdjacent — last row has next=null', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('p1', { display_order: 0 });
		await seedOne('p2', { display_order: 1 });
		const adjacent = await loader.loadPortfolioAdjacent('p2');
		expect(adjacent.prev?.slug).toBe('p1');
		expect(adjacent.next).toBeNull();
	});

	it('loadPortfolioAdjacent — pinned-first ordering is honoured', async () => {
		const loader = createD1PortfolioLoader(env);
		// p_top is pinned (display_order high) — comes FIRST in sort
		await seedOne('p_top', { pinned: 1, display_order: 999 });
		await seedOne('p_a', { pinned: 0, display_order: 0 });
		await seedOne('p_b', { pinned: 0, display_order: 1 });
		await seedOne('p_c', { pinned: 0, display_order: 2 });

		// From p_top: prev=null, next=p_a (first non-pinned)
		const topAdj = await loader.loadPortfolioAdjacent('p_top');
		expect(topAdj.prev).toBeNull();
		expect(topAdj.next?.slug).toBe('p_a');

		// From p_b: prev=p_a, next=p_c
		const midAdj = await loader.loadPortfolioAdjacent('p_b');
		expect(midAdj.prev?.slug).toBe('p_a');
		expect(midAdj.next?.slug).toBe('p_c');
	});

	it('loadPortfolioAdjacent — display_order tiebreaker with same pinned', async () => {
		const loader = createD1PortfolioLoader(env);
		// all pinned=1, display_order increasing
		await seedOne('p_a', { pinned: 1, display_order: 0 });
		await seedOne('p_b', { pinned: 1, display_order: 1 });
		await seedOne('p_c', { pinned: 1, display_order: 2 });

		const adj = await loader.loadPortfolioAdjacent('p_b');
		expect(adj.prev?.slug).toBe('p_a');
		expect(adj.next?.slug).toBe('p_c');
	});

	it('loadPortfolioAdjacent — unknown slug returns {prev:null, next:null}', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('p1', { display_order: 0 });
		expect(await loader.loadPortfolioAdjacent('nope')).toEqual({ prev: null, next: null });
	});

	// PUBLIC BOUNDARY for adjacent — unlisted / draft rows can never
	// become prev/next of a public target, even when they outrank it
	// in the sort key.
	it('PUBLIC BOUNDARY — loadPortfolioAdjacent ignores unlisted neighbours', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('public_a', { display_order: 0 });
		await seedOne('unlisted_x', {
			visibility: 'unlisted',
			display_order: 5, // would outrank public_b by sort
		});
		await seedOne('public_b', { display_order: 1 });
		await seedOne('public_c', { display_order: 2 });

		const adj = await loader.loadPortfolioAdjacent('public_b');
		// prev = public_a (the unlisted row is invisible to the public surface).
		expect(adj.prev?.slug).toBe('public_a');
		expect(adj.next?.slug).toBe('public_c');
	});

	it('returns the project for a public slug with parsed facets and techs', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('aulymo', { facets: '["develop","design"]', technologies: '["AE","Rust"]' });

		const project = await loader.loadPortfolioProject('aulymo');
		expect(project).not.toBeNull();
		expect(project?.slug).toBe('aulymo');
		expect(project?.facets).toEqual(['develop', 'design']);
		expect(project?.technologies).toEqual(['AE', 'Rust']);
		expect(project?.visibility).toBe('public');
		expect(project?.pinned).toBe(false);
		expect(project?.media).toEqual([]); // no media inserted
	});

	// List must also be public-only; the loader accepts no
	// visibility selector at all.
	it('list honours facet filter', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('dev1', { facets: '["develop"]' });
		await seedOne('video1', { facets: '["video"]' });
		await seedOne('design1', { facets: '["design"]' });

		const page = await loader.listPortfolioProjects({ facets: ['develop'] });
		expect(page.projects.map((p) => p.slug)).toEqual(['dev1']);
		expect(page.nextCursor).toBeNull();
	});

	it('list with multiple facet options (any-of)', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('dev1', { facets: '["develop"]' });
		await seedOne('video1', { facets: '["video"]' });
		await seedOne('design1', { facets: '["design"]' });

		const page = await loader.listPortfolioProjects({ facets: ['develop', 'video'] });
		expect(page.projects.map((p) => p.slug).sort()).toEqual(['dev1', 'video1']);
	});

	it('PUBLIC BOUNDARY — list never returns draft / archived / unlisted', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('public1', { visibility: 'public', status: 'published' });
		await seedOne('draft1', { visibility: 'draft', status: 'published' });
		await seedOne('archived1', { visibility: 'public', status: 'archived' });
		await seedOne('unlisted1', { visibility: 'unlisted', status: 'published' });

		const page = await loader.listPortfolioProjects();
		expect(page.projects.map((p) => p.slug)).toEqual(['public1']);
	});

	it('list respects limit', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('a', { display_order: 0 });
		await seedOne('b', { display_order: 1 });
		await seedOne('c', { display_order: 2 });

		const fullPage = await loader.listPortfolioProjects();
		expect(fullPage.projects.map((p) => p.slug)).toEqual(['a', 'b', 'c']);
		expect(fullPage.nextCursor).toBeNull();

		const limited = await loader.listPortfolioProjects({ limit: 2 });
		expect(limited.projects.map((p) => p.slug)).toEqual(['a', 'b']);
		expect(limited.nextCursor).not.toBeNull();
	});

	// Cursor pagination — the contract Issue #77 UI will rely on.
	it('cursor pagination: stable order with no skip / no duplicate', async () => {
		const loader = createD1PortfolioLoader(env);
		const total = 7;
		for (let i = 0; i < total; i++) {
			// varying updated_at + id to exercise the tiebreaker
			await seedOne(`p${i}`, {
				display_order: i,
				updated_at: 1_700_000_000_000 + i,
			});
		}

		const seen: string[] = [];
		let cursor: string | null = null;
		let safety = 0;
		while (safety++ < 10) {
			const page = await loader.listPortfolioProjects({ limit: 3, cursor });
			seen.push(...page.projects.map((p) => p.slug));
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
		}
		expect(safety).toBeLessThan(10); // terminated
		expect(seen).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
		expect(new Set(seen).size).toBe(seen.length); // no dup
	});

	it('cursor pagination: respects pinned-first ordering across pages', async () => {
		const loader = createD1PortfolioLoader(env);
		// p1 is pinned (display_order high) — should still come first
		await seedOne('p1', { pinned: 1, display_order: 999 });
		await seedOne('p2', { pinned: 0, display_order: 0 });
		await seedOne('p3', { pinned: 0, display_order: 1 });
		await seedOne('p4', { pinned: 0, display_order: 2 });

		const seen: string[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 5; i++) {
			const page = await loader.listPortfolioProjects({ limit: 2, cursor });
			seen.push(...page.projects.map((p) => p.slug));
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
		}
		expect(seen).toEqual(['p1', 'p2', 'p3', 'p4']);
	});

	it('cursor pagination: display_order ASC tiebreaker on updated_at', async () => {
		const loader = createD1PortfolioLoader(env);
		// 4 rows sharing pinned=0 + updated_at — display_order is
		// the only differentiator. Without `id` we'd risk drift.
		const now = 1_700_000_000_000;
		await seedOne('p1', { display_order: 0, updated_at: now });
		await seedOne('p2', { display_order: 1, updated_at: now });
		await seedOne('p3', { display_order: 2, updated_at: now });
		await seedOne('p4', { display_order: 3, updated_at: now });

		const seen: string[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 5; i++) {
			const page = await loader.listPortfolioProjects({ limit: 2, cursor });
			seen.push(...page.projects.map((p) => p.slug));
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
		}
		expect(seen).toEqual(['p1', 'p2', 'p3', 'p4']);
	});

	it('cursor pagination: empty page returns nextCursor=null', async () => {
		const loader = createD1PortfolioLoader(env);
		const page = await loader.listPortfolioProjects({ limit: 10 });
		expect(page.projects).toEqual([]);
		expect(page.nextCursor).toBeNull();
	});

	it('cursor pagination: malformed cursor falls back to first page', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('a', { display_order: 0 });
		await seedOne('b', { display_order: 1 });

		const page = await loader.listPortfolioProjects({ cursor: 'totally-bogus' });
		// Falls back to first page — both rows returned.
		expect(page.projects.map((p) => p.slug)).toEqual(['a', 'b']);
	});

	it('cursor pagination: cursor encoding is opaque but valid', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('a', { display_order: 0 });
		await seedOne('b', { display_order: 1 });
		await seedOne('c', { display_order: 2 });

		const first = await loader.listPortfolioProjects({ limit: 1 });
		expect(first.projects.map((p) => p.slug)).toEqual(['a']);
		const cursor = first.nextCursor;
		expect(cursor).toBeTruthy();
		if (!cursor) throw new Error('cursor missing');

		// The cursor encodes {p, d, u, i} of the last seen row.
		const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		expect(decoded).toMatchObject({ p: 0, d: 0 });
		expect(typeof (decoded as { i: unknown }).i).toBe('string');
	});

	it('encodeCursor round-trip works (re-exported from schema)', () => {
		const c = { p: 1, d: 5, u: 1234, i: 'p_xyz' };
		const enc = encodeCursor(c);
		expect(typeof enc).toBe('string');
		expect(enc.length).toBeGreaterThan(0);
	});

	it('exposes cover media first with isCover=true', async () => {
		const id = await seedOne('aulymo');
		const now = Date.now();
		await env.DB.prepare(
			'INSERT INTO portfolio_media (id, project_id, r2_key, content_type, alt, is_cover, display_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
		)
			.bind('m1', id, 'portfolio/aulymo/cover.webp', 'image/webp', 'Aulymo cover', 1, 0, now)
			.run();
		await env.DB.prepare(
			'INSERT INTO portfolio_media (id, project_id, r2_key, content_type, alt, is_cover, display_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
		)
			.bind('m2', id, 'portfolio/aulymo/extra.webp', 'image/webp', 'extra', 0, 1, now)
			.run();

		const loader = createD1PortfolioLoader(env);
		const project = await loader.loadPortfolioProject('aulymo');
		expect(project?.media).toHaveLength(2);
		expect(project?.media[0]?.isCover).toBe(true);
		expect(project?.media[0]?.r2Key).toBe('portfolio/aulymo/cover.webp');
		// url is composed by the loader from `env.MEDIA`; without an
		// R2 binding in the test pool we expect null.
		expect(project?.media[0]?.url).toBeNull();
	});

	// Public project index (Issue #420) — the input of `/sitemap.xml`.
	// Same public boundary as the list surface, reduced to URL identity.
	it('listPublishedProjectIndex — returns only public + published rows', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('public1', { visibility: 'public', status: 'published' });
		await seedOne('draft1', { visibility: 'draft', status: 'published' });
		await seedOne('archived1', { visibility: 'public', status: 'archived' });
		await seedOne('unlisted1', { visibility: 'unlisted', status: 'published' });

		const index = await loader.listPublishedProjectIndex();
		expect(index.map((e) => e.slug)).toEqual(['public1']);
	});

	it('listPublishedProjectIndex — carries updated_at for lastmod', async () => {
		const loader = createD1PortfolioLoader(env);
		const updatedAt = 1_767_322_945_000;
		await seedOne('tastile', { updated_at: updatedAt });

		const index = await loader.listPublishedProjectIndex();
		expect(index).toEqual([{ slug: 'tastile', updatedAt }]);
	});

	it('listPublishedProjectIndex — follows canonical sort order', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('pinned', { pinned: 1, display_order: 99 });
		await seedOne('second', { display_order: 1 });
		await seedOne('first', { display_order: 0 });

		const index = await loader.listPublishedProjectIndex();
		expect(index.map((e) => e.slug)).toEqual(['pinned', 'first', 'second']);
	});

	it('listPublishedProjectIndex — empty array when the binding is missing', async () => {
		const loader = createD1PortfolioLoader({});
		expect(await loader.listPublishedProjectIndex()).toEqual([]);
	});
});

/**
 * CMS merge (Issue #765).
 *
 * The bundled snapshot is empty until a Notion database is connected, so
 * these tests inject the rows the deployment would read. Without this
 * block the whole merge path — page slicing, cursor advance, adjacency
 * across two sources — would be exercised for the first time by whoever
 * pastes the first token in, which is exactly the wrong moment to find
 * out that two sources do not interleave.
 */
describe('portfolio — CMS merge (Issue #765)', () => {
	beforeEach(async () => {
		await applySchema();
		await clearTables();
	});
	afterEach(async () => {
		await clearTables();
	});

	function cmsProject(overrides: Partial<PortfolioProject> = {}): PortfolioProject {
		return {
			id: 'notion:page-1',
			slug: 'cms-one',
			title: 'CMS One',
			summary: '',
			role: '',
			periodStart: 2024,
			periodEnd: null,
			periodLabel: null,
			motivationMd: 'Why.',
			architectureMd: null,
			constraintsMd: null,
			implementationMd: null,
			evidenceMd: null,
			retrospectiveMd: null,
			facets: ['develop'],
			technologies: [],
			visibility: 'public',
			status: 'published',
			pinned: false,
			displayOrder: 0,
			createdAt: 1_767_000_000_000,
			updatedAt: 1_767_000_000_000,
			links: [],
			media: [],
			...overrides,
		};
	}

	it('resolves a CMS slug that D1 does not hold', async () => {
		const loader = createD1PortfolioLoader(env, { cmsProjects: [cmsProject()] });
		const project = await loader.loadPortfolioProject('cms-one');
		expect(project?.id).toBe('notion:page-1');
		expect(project?.motivationMd).toBe('Why.');
	});

	it('prefers the D1 row when both sources carry the same slug', async () => {
		await seedOne('cms-one', { display_order: 5 });
		const loader = createD1PortfolioLoader(env, { cmsProjects: [cmsProject()] });
		const project = await loader.loadPortfolioProject('cms-one');
		expect(project?.id).not.toBe('notion:page-1');
	});

	it('interleaves the two sources by the canonical order', async () => {
		await seedOne('d1-second', { display_order: 20 });
		await seedOne('d1-first', { display_order: 10 });
		const loader = createD1PortfolioLoader(env, {
			cmsProjects: [cmsProject({ displayOrder: 15, slug: 'cms-middle' })],
		});
		const page = await loader.listPortfolioProjects();
		expect(page.projects.map((project) => project.slug)).toEqual([
			'd1-first',
			'cms-middle',
			'd1-second',
		]);
	});

	it('pages across the merged ordering without duplicating a row', async () => {
		await seedOne('d1-a', { display_order: 10 });
		await seedOne('d1-b', { display_order: 30 });
		const loader = createD1PortfolioLoader(env, {
			cmsProjects: [
				cmsProject({ slug: 'cms-a', displayOrder: 20, id: 'notion:a' }),
				cmsProject({ slug: 'cms-b', displayOrder: 40, id: 'notion:b' }),
			],
		});

		const seen: string[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < 5; page += 1) {
			const result: PortfolioListPage = await loader.listPortfolioProjects({ limit: 2, cursor });
			seen.push(...result.projects.map((project) => project.slug));
			cursor = result.nextCursor;
			if (cursor === null) break;
		}

		expect(seen).toEqual(['d1-a', 'cms-a', 'd1-b', 'cms-b']);
	});

	it('computes adjacency across both sources', async () => {
		await seedOne('d1-a', { display_order: 10 });
		const loader = createD1PortfolioLoader(env, {
			cmsProjects: [cmsProject({ slug: 'cms-z', displayOrder: 20, id: 'notion:z' })],
		});
		expect(await loader.loadPortfolioAdjacent('d1-a')).toEqual({
			prev: null,
			next: { slug: 'cms-z', title: 'CMS One' },
		});
	});

	it('includes CMS slugs in the public project index', async () => {
		await seedOne('d1-a');
		const loader = createD1PortfolioLoader(env, { cmsProjects: [cmsProject()] });
		const index = await loader.listPublishedProjectIndex();
		expect(index.map((entry) => entry.slug).sort()).toEqual(['cms-one', 'd1-a']);
	});

	it('serves the CMS alone when D1 is unbound', async () => {
		const loader = createD1PortfolioLoader({}, { cmsProjects: [cmsProject()] });
		const page = await loader.listPortfolioProjects();
		expect(page.projects.map((project) => project.slug)).toEqual(['cms-one']);
		expect(await loader.loadPortfolioAdjacent('cms-one')).toEqual({ prev: null, next: null });
	});

	// The collision rule has to hold in every method, not only in
	// `loadPortfolioProject`: one slug, one card, one URL. A list that
	// ignored it would render two cards for `/portfolio/cms-one` where the
	// detail route answers with the D1 row for both of them.
	describe('when both sources carry the same slug', () => {
		it('lists the D1 row only', async () => {
			await seedOne('cms-one', { display_order: 5 });
			const loader = createD1PortfolioLoader(env, { cmsProjects: [cmsProject()] });
			const page = await loader.listPortfolioProjects();
			expect(page.projects.map((project) => project.slug)).toEqual(['cms-one']);
			expect(page.projects[0]?.id).not.toBe('notion:page-1');
			expect(page.nextCursor).toBeNull();
		});

		it('does not place the CMS row beside the D1 row as a neighbour', async () => {
			await seedOne('d1-a', { display_order: 10 });
			await seedOne('cms-one', { display_order: 20 });
			await seedOne('d1-z', { display_order: 30 });
			const loader = createD1PortfolioLoader(env, {
				cmsProjects: [cmsProject({ displayOrder: 15 })],
			});
			expect(await loader.loadPortfolioAdjacent('d1-a')).toEqual({
				prev: null,
				next: { slug: 'cms-one', title: expect.any(String) },
			});
			expect(await loader.loadPortfolioAdjacent('cms-one')).toEqual({
				prev: { slug: 'd1-a', title: expect.any(String) },
				next: { slug: 'd1-z', title: expect.any(String) },
			});
		});

		it('publishes the URL once in the index', async () => {
			await seedOne('cms-one');
			const loader = createD1PortfolioLoader(env, { cmsProjects: [cmsProject()] });
			const index = await loader.listPublishedProjectIndex();
			expect(index.map((entry) => entry.slug)).toEqual(['cms-one']);
			expect(index[0]?.updatedAt).not.toBe(cmsProject().updatedAt);
		});
	});
});
