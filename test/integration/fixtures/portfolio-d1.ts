import { PORTFOLIO_SEED, type PortfolioSeedEntry } from '../../../src/portfolio/seed';

/**
 * Portfolio D1 fixture shared by the workerd suites (Issue #422).
 *
 * `src/portfolio/load.test.ts` owned this schema inline. The
 * structured-data suite needs the same tables — `/about` and
 * `/portfolio/<slug>` both read through the D1 loader — and a second
 * copy of `migrations/0007_portfolio.sql` would be exactly the kind
 * of drift this repository warns about ("the inlined queries MUST
 * stay byte-identical to the migration"). One fixture, two suites.
 *
 * The seed writes `PORTFOLIO_SEED` rows with FIXED timestamps, so a
 * suite that projects a row into structured data gets a
 * deterministic `dateModified` and can snapshot the emitted node.
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

/** Deterministic fixture timestamp: `2026-01-02T00:00:00.000Z`. */
export const FIXTURE_TIMESTAMP = Date.UTC(2026, 0, 2);

export async function applyPortfolioSchema(db: D1Database): Promise<void> {
	for (const stmt of SCHEMA_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await db.prepare(stmt).run();
	}
}

export async function clearPortfolioTables(db: D1Database): Promise<void> {
	for (const table of ['portfolio_link', 'portfolio_media', 'portfolio_project']) {
		await db.prepare(`DELETE FROM ${table}`).run();
	}
}

/** Look a seed entry up by slug — fails loudly rather than seeding nothing. */
export function seedEntry(slug: string): PortfolioSeedEntry {
	const entry = PORTFOLIO_SEED.find((candidate) => candidate.slug === slug);
	if (!entry) throw new Error(`no PORTFOLIO_SEED entry for slug "${slug}"`);
	return entry;
}

/**
 * Insert one seed entry verbatim. `overrides` replaces individual
 * columns (`visibility`, `status`, timestamps) without retyping the
 * whole row.
 */
export async function seedPortfolioEntry(
	db: D1Database,
	entry: PortfolioSeedEntry,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const row = {
		id: `t_${entry.slug}`,
		slug: entry.slug,
		title: entry.title,
		summary: entry.summary,
		role: entry.role,
		period_start: entry.periodStart,
		period_end: entry.periodEnd,
		period_label: entry.periodLabel,
		motivation_md: entry.motivationMd,
		architecture_md: entry.architectureMd ?? null,
		constraints_md: entry.constraintsMd ?? null,
		implementation_md: entry.implementationMd ?? null,
		evidence_md: entry.evidenceMd ?? null,
		retrospective_md: entry.retrospectiveMd ?? null,
		facets: JSON.stringify(entry.facets),
		technologies: JSON.stringify(entry.technologies),
		visibility: 'public',
		status: 'published',
		pinned: entry.pinned ? 1 : 0,
		display_order: entry.displayOrder,
		created_at: FIXTURE_TIMESTAMP,
		updated_at: FIXTURE_TIMESTAMP,
		...overrides,
	};

	await insertProjectRow(db, row);
	return String(row.id);
}

/**
 * Insert a synthetic row for loader tests: every column has a benign
 * default and `overrides` replaces any of them. Column defaults match
 * what a healthy published project looks like, so a test only has to
 * state the column it is actually asserting on.
 */
export async function seedPortfolioRow(
	db: D1Database,
	slug: string,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const now = FIXTURE_TIMESTAMP;
	const row = {
		id: `t_${slug}`,
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
		...overrides,
	};

	await insertProjectRow(db, row);
	return String(row.id);
}

async function insertProjectRow(db: D1Database, row: Record<string, unknown>): Promise<void> {
	await db
		.prepare(
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
}
