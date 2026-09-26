import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1PortfolioLoader, intersectsAny } from './load';
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
 *   3. `loadPortfolioProject` returns null on missing / draft / archived
 *   4. `loadPortfolioProject` returns the project for a valid slug
 *   5. `listPortfolioProjects` honours `facets`, `visibility`, `limit`
 *   6. cover media is exposed at `media[0]` with `isCover=true`
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS portfolio_project (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    summary TEXT NOT NULL, role TEXT NOT NULL,
    period_start INTEGER NOT NULL, period_end INTEGER, period_label TEXT,
    motivation_md TEXT NOT NULL DEFAULT '', architecture_md TEXT, constraints_md TEXT,
    implementation_md TEXT, evidence_md TEXT, retrospective_md TEXT,
    facets TEXT NOT NULL DEFAULT '[]', technologies TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'unlisted', 'draft')),
    status TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'archived')),
    pinned INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio_link (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    kind TEXT NOT NULL
        CHECK (kind IN ('repo', 'demo', 'release', 'article', 'shop', 'video', 'other')),
    label TEXT, url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio_media (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL, content_type TEXT NOT NULL,
    width INTEGER, height INTEGER,
    alt TEXT NOT NULL, caption TEXT,
    is_cover INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
`;

async function applySchema(): Promise<void> {
	for (const stmt of SCHEMA_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
}

async function clearTables(): Promise<void> {
	for (const table of ['portfolio_link', 'portfolio_media', 'portfolio_project']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

async function seedOne(slug: string, overrides: Record<string, unknown> = {}): Promise<string> {
	const id = `t_${slug}`;
	const now = Date.now();
	const base = {
		slug,
		title: `Test ${slug}`,
		summary: 'summary',
		role: 'Solo developer',
		period_start: now,
		period_end: null,
		period_label: null,
		motivation_md: '',
		architecture_md: null,
		constraints_md: null,
		implementation_md: null,
		evidence_md: null,
		retrospective_md: null,
		facets: '["develop"]',
		technologies: '["TypeScript"]',
		visibility: 'public',
		status: 'published',
		pinned: 0,
		display_order: 100,
		created_at: now,
		updated_at: now,
	};
	const row = { ...base, ...overrides, id };
	await env.DB.prepare(
		`INSERT INTO portfolio_project (id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, architecture_md, constraints_md, implementation_md, evidence_md, retrospective_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`,
	)
		.bind(
			row.id,
			row.slug,
			row.title,
			row.summary,
			row.role,
			row.period_start,
			row.period_end,
			row.period_label,
			row.motivation_md,
			row.architecture_md,
			row.constraints_md,
			row.implementation_md,
			row.evidence_md,
			row.retrospective_md,
			row.facets,
			row.technologies,
			row.visibility,
			row.status,
			row.pinned,
			row.display_order,
			row.created_at,
			row.updated_at,
		)
		.run();
	return id;
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
		expect(await loader.listPortfolioProjects()).toEqual([]);
	});

	it('returns null for an unknown slug', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('aulymo');
		expect(await loader.loadPortfolioProject('nope')).toBeNull();
	});

	it('hides draft and archived rows', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('draft', { visibility: 'draft' });
		await seedOne('archived', { status: 'archived' });
		expect(await loader.loadPortfolioProject('draft')).toBeNull();
		expect(await loader.loadPortfolioProject('archived')).toBeNull();
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

	it('list honours facet filter', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('dev1', { facets: '["develop"]' });
		await seedOne('video1', { facets: '["video"]' });
		await seedOne('design1', { facets: '["design"]' });

		const developOnly = await loader.listPortfolioProjects({ facets: ['develop'] });
		expect(developOnly.map((p) => p.slug)).toEqual(['dev1']);

		const multiple = await loader.listPortfolioProjects({ facets: ['develop', 'video'] });
		expect(multiple.map((p) => p.slug).sort()).toEqual(['dev1', 'video1']);
	});

	it('list respects limit and visibility', async () => {
		const loader = createD1PortfolioLoader(env);
		await seedOne('a', { display_order: 0 });
		await seedOne('b', { display_order: 1 });
		await seedOne('c', { display_order: 2 });

		const all = await loader.listPortfolioProjects();
		expect(all.map((p) => p.slug)).toEqual(['a', 'b', 'c']);

		const limited = await loader.listPortfolioProjects({ limit: 2 });
		expect(limited.map((p) => p.slug)).toEqual(['a', 'b']);

		const draftOnly = await loader.listPortfolioProjects({ visibility: ['draft'] });
		expect(draftOnly).toEqual([]);
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
});
