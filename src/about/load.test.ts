import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAbout } from './load';
import { ABOUT_DATA } from './data';

/**
 * About loader integration tests (Issue #102).
 *
 * Mirrors `src/portfolio/load.test.ts`: the workerd pool provides
 * a real D1 binding via `cloudflare:test#env`, and we exercise
 * `loadAbout` directly through the DI seam (`env` argument).
 * The repo-controlled copy is passed via the `data` override so
 * the test can drive a curated `experienceSlugs` list without
 * touching `ABOUT_DATA`.
 *
 * Coverage:
 *   1. Repo-controlled fields (identity / interests / current /
 *      future / externalHandles) round-trip unchanged.
 *   2. Experience subset resolves in narrative order — slugs that
 *      map to public+published rows come back, in the order they
 *      were listed.
 *   3. PUBLIC VISIBILITY BOUNDARY — slugs that resolve to
 *      draft / unlisted / archived rows are dropped, not surfaced
 *      as affordances.
 *   4. Unknown slugs are silently dropped.
 *   5. Empty / cleared `experienceSlugs` yields an empty `experience`
 *      list (no fabricated rows).
 *   6. Missing `DB` binding yields empty `experience` (no throw).
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

describe('about — repo-controlled data shape', () => {
	it('has a populated identity cluster with all required fields', () => {
		expect(ABOUT_DATA.identity.name.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.identity.handle.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.identity.role.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.identity.lead.length).toBeGreaterThan(0);
	});

	it('has at least one interest / current / future / handle entry', () => {
		expect(ABOUT_DATA.interests.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.current.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.future.active.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.future.parked.length).toBeGreaterThan(0);
		expect(ABOUT_DATA.externalHandles.length).toBeGreaterThan(0);
	});

	it('every external handle has a non-empty label and absolute https href', () => {
		for (const handle of ABOUT_DATA.externalHandles) {
			expect(handle.label.length).toBeGreaterThan(0);
			expect(handle.href).toMatch(/^https:\/\//);
		}
	});

	it('every interest has a non-empty title and description', () => {
		for (const interest of ABOUT_DATA.interests) {
			expect(interest.title.length).toBeGreaterThan(0);
			expect(interest.description.length).toBeGreaterThan(0);
		}
	});

	it('every experience slug is well-formed (matches portfolio slug grammar)', () => {
		for (const slug of ABOUT_DATA.experienceSlugs) {
			expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{0,127}$/);
		}
	});

	it('experience slug list contains no duplicates', () => {
		const slugs = ABOUT_DATA.experienceSlugs;
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});

describe('about — loader DI seam (workerd pool, D1 binding)', () => {
	beforeEach(async () => {
		await applySchema();
		await clearTables();
	});
	afterEach(async () => {
		await clearTables();
	});

	it('returns empty experience when DB is missing', async () => {
		const data = await loadAbout(
			{},
			{
				...ABOUT_DATA,
				experienceSlugs: ['aulymo', 'multi-slicer'],
			},
		);
		expect(data.experience).toEqual([]);
		// Repo-controlled fields are still returned.
		expect(data.identity).toEqual(ABOUT_DATA.identity);
		expect(data.interests).toEqual(ABOUT_DATA.interests);
		expect(data.current).toEqual(ABOUT_DATA.current);
		expect(data.future).toEqual(ABOUT_DATA.future);
		expect(data.externalHandles).toEqual(ABOUT_DATA.externalHandles);
	});

	it('resolves experience slugs in narrative order (NOT canonical sort)', async () => {
		await seedOne('first', { title: 'First', display_order: 999 });
		await seedOne('second', { title: 'Second', display_order: 1 });
		await seedOne('third', { title: 'Third', display_order: 500 });

		// Narrative order: third → first → second. The loader must
		// NOT re-sort by display_order; the order is determined by
		// the slug list passed in.
		const data = await loadAbout(env, {
			...ABOUT_DATA,
			experienceSlugs: ['third', 'first', 'second'],
		});
		expect(data.experience.map((p) => p.slug)).toEqual(['third', 'first', 'second']);
	});

	it('PUBLIC BOUNDARY — drops draft rows', async () => {
		await seedOne('draft-experience', { visibility: 'draft' });
		const data = await loadAbout(env, {
			...ABOUT_DATA,
			experienceSlugs: ['draft-experience'],
		});
		expect(data.experience).toEqual([]);
	});

	it('PUBLIC BOUNDARY — drops unlisted rows', async () => {
		await seedOne('unlisted-experience', { visibility: 'unlisted' });
		const data = await loadAbout(env, {
			...ABOUT_DATA,
			experienceSlugs: ['unlisted-experience'],
		});
		expect(data.experience).toEqual([]);
	});

	it('PUBLIC BOUNDARY — drops archived rows', async () => {
		await seedOne('archived-experience', { status: 'archived' });
		const data = await loadAbout(env, {
			...ABOUT_DATA,
			experienceSlugs: ['archived-experience'],
		});
		expect(data.experience).toEqual([]);
	});

	it('silently drops unknown slugs', async () => {
		await seedOne('known-slug');
		const data = await loadAbout(env, {
			...ABOUT_DATA,
			experienceSlugs: ['known-slug', 'totally-unknown-xyz'],
		});
		expect(data.experience).toHaveLength(1);
		expect(data.experience[0]?.slug).toBe('known-slug');
	});

	it('falls back to ABOUT_DATA when no override is passed', async () => {
		await seedOne('aulymo');
		await seedOne('multi-slicer');
		await seedOne('my-web-2026');
		const data = await loadAbout(env);
		// ABOUT_DATA.experienceSlugs is curated; the test seeds all three
		// so they all resolve.
		const slugs = data.experience.map((p) => p.slug);
		expect(slugs).toContain('aulymo');
		expect(slugs).toContain('multi-slicer');
		expect(slugs).toContain('my-web-2026');
	});

	it('empty experienceSlugs yields empty experience (no fabrication)', async () => {
		await seedOne('not-curated');
		const data = await loadAbout(env, {
			...ABOUT_DATA,
			experienceSlugs: [],
		});
		expect(data.experience).toEqual([]);
	});
});
