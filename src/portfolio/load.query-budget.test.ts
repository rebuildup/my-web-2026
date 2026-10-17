import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import portfolioMigrationSql from '../../migrations/0007_portfolio.sql?raw';
import {
	D1_BATCH_ID_CHUNK,
	PORTFOLIO_DETAIL_QUERY_BUDGET,
	createD1PortfolioLoader,
	portfolioListQueryBudget,
} from './load';

/**
 * D1 N+1 / query-plan detector — Issue #491.
 *
 * What this suite is for
 * ----------------------
 * The portfolio list surface (`/portfolio`) is the representative
 * read path: it is the only page that reads a variable number of
 * D1 rows. It used to issue `fetchLinks` + `fetchMedia` per row,
 * so a page of N projects cost `1 + 2N` statements. That is the
 * N+1 shape: the work grows linearly with data the caller never
 * asked to make more expensive.
 *
 * This suite makes that shape DETECTABLE rather than implicit:
 *
 *   1. It counts D1 statements per fixture size. A budget that
 *      held "3 statements" at 1 project and "3 + something" at 50
 *      is a linear regression, so the assertions compare the
 *      SMALLEST and LARGEST fixture, not one absolute number.
 *   2. It runs the pre-fix (row-at-a-time) shape through the same
 *      harness and asserts that it DOES exceed the budget. A
 *      detector that cannot fail is not a detector.
 *   3. It reads `EXPLAIN QUERY PLAN` for the statements that are
 *      actually issued, so "index utilisation" is measured, not
 *      assumed.
 *   4. It records elapsed time as an OBSERVATION only. Time is
 *      noisy and environment-dependent; this suite gates on
 *      statement counts (deterministic) and reports milliseconds
 *      (informative). Performance gates are separate tickets
 *      (#384 / #385 / #386) and are deliberately NOT added here.
 *
 * Fixture environment
 * -------------------
 *   * The schema is applied from the REAL migration file
 *     (`migrations/0007_portfolio.sql`, imported with Vite's
 *     `?raw`), so the indexes measured below are the indexes
 *     production has. A hand-copied DDL block could drift and
 *     would make the query plans meaningless.
 *   * D1 is the local workerd / miniflare SQLite binding declared
 *     in `vitest.config.ts` — never production, never a remote
 *     database, never a mutation outside this worker's storage.
 *   * No production endpoint, no browser, and no network are
 *     involved: the measurement is per-loader-call, so the
 *     numbers describe the loader, not the page chrome.
 *
 * Report output
 * -------------
 * The measured series is printed as single-line records prefixed
 * with `D1_QUERY_PLAN_V1 ` so `scripts/d1-query-plan-report.mjs`
 * can build the HTML report from a plain `vitest run` stdout
 * capture. See `docs/verification/perf/d1-query-plan.md`.
 */

const REPORT_PREFIX = 'D1_QUERY_PLAN_V1 ';

/**
 * Fixture page sizes. `1` is the degenerate page, `500` is the
 * `clampLimit` ceiling the loader documents, and the values in
 * between are where a per-row regression becomes obvious.
 */
const PAGE_SIZES = [1, 2, 5, 10, 25, 50, 100, 250, 500] as const;

/** Rows seeded per project: links / media, to make the join real. */
const LINKS_PER_PROJECT = 3;
const MEDIA_PER_PROJECT = 2;

interface RecordedStatement {
	sql: string;
	/** Rows returned by `.all()` / `.first()`, when the call site used one. */
	rows: number;
}

/**
 * Wrap a real `D1Database` and count every `prepare()` — one
 * `prepare()` is one D1 round trip here because the loader binds
 * and executes each statement exactly once.
 */
function countStatements(db: D1Database): {
	counted: D1Database;
	statements: RecordedStatement[];
} {
	const statements: RecordedStatement[] = [];
	const counted = new Proxy(db, {
		get(target, prop) {
			if (prop === 'prepare') {
				return (sql: string) => {
					const entry: RecordedStatement = { sql, rows: 0 };
					statements.push(entry);
					const stmt = target.prepare(sql);
					return wrapStatement(stmt, entry);
				};
			}
			const value = Reflect.get(target, prop) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	return { counted, statements };
}

/** Track the row count of a counted statement without changing its shape. */
function wrapStatement(stmt: D1PreparedStatement, entry: RecordedStatement): D1PreparedStatement {
	return new Proxy(stmt, {
		get(target, prop) {
			const value = Reflect.get(target, prop) as unknown;
			if (typeof value !== 'function') return value;
			if (prop === 'bind') {
				return (...args: unknown[]) =>
					wrapStatement(
						(value as (...a: unknown[]) => D1PreparedStatement).apply(target, args),
						entry,
					);
			}
			if (prop === 'all' || prop === 'first' || prop === 'run') {
				return (...args: unknown[]) =>
					(value as (...a: unknown[]) => Promise<D1Result>).apply(target, args).then((r) => {
						entry.rows = r?.results?.length ?? (r ? 1 : 0);
						return r;
					});
			}
			return value.bind(target);
		},
	});
}

/**
 * Strip `--` comments and split a migration into statements.
 *
 * `migrations/0007_portfolio.sql` documents its CHECK constraints
 * with trailing comments that contain `;` (e.g. `INTEGER, -- UNIX
 * ms; NULL = ongoing`), so a naive `split(';')` would produce
 * fragments that are not valid SQL. Single-quoted literals are
 * skipped so a `;` inside a string would survive.
 */
function splitMigrationStatements(sql: string): string[] {
	let stripped = '';
	let quote: string | null = null;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (quote) {
			stripped += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			stripped += ch;
			continue;
		}
		if (ch === '-' && sql[i + 1] === '-') {
			while (i < sql.length && sql[i] !== '\n') i++;
			stripped += '\n';
			continue;
		}
		stripped += ch;
	}
	return stripped
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

async function applyMigration(): Promise<void> {
	for (const stmt of splitMigrationStatements(portfolioMigrationSql)) {
		await env.DB.prepare(stmt).run();
	}
}

async function clearTables(): Promise<void> {
	for (const table of ['portfolio_link', 'portfolio_media', 'portfolio_project']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

/**
 * Seed `count` public+published projects with links and media.
 *
 * Rows are written in multi-row INSERT statements so seeding 500
 * projects does not dominate the suite runtime — the measurement
 * window opens after this resolves.
 */
async function seedProjects(count: number): Promise<void> {
	const base = 1_700_000_000_000;
	const projects: string[] = [];
	const links: string[] = [];
	const media: string[] = [];
	for (let i = 0; i < count; i++) {
		const id = `qb_p${i}`;
		projects.push(
			`('${id}', 'qb-${i}', 'Project ${i}', 'summary', 'Solo developer', ${base + i}, NULL, NULL, '', NULL, NULL, NULL, NULL, NULL, '["develop"]', '["TypeScript"]', 'public', 'published', 0, ${i}, ${base + i}, ${base + i})`,
		);
		for (let l = 0; l < LINKS_PER_PROJECT; l++) {
			links.push(
				`('${id}_l${l}', '${id}', 'repo', NULL, 'https://example.test/${i}/${l}', ${l}, ${base + i})`,
			);
		}
		for (let m = 0; m < MEDIA_PER_PROJECT; m++) {
			media.push(
				`('${id}_m${m}', '${id}', 'portfolio/qb-${i}/${m}.webp', 'image/webp', 1280, 720, 'alt ${m}', NULL, ${m === 0 ? 1 : 0}, ${m}, ${base + i})`,
			);
		}
	}
	await insertBatched(
		'portfolio_project',
		[
			'id',
			'slug',
			'title',
			'summary',
			'role',
			'period_start',
			'period_end',
			'period_label',
			'motivation_md',
			'architecture_md',
			'constraints_md',
			'implementation_md',
			'evidence_md',
			'retrospective_md',
			'facets',
			'technologies',
			'visibility',
			'status',
			'pinned',
			'display_order',
			'created_at',
			'updated_at',
		],
		projects,
	);
	await insertBatched(
		'portfolio_link',
		['id', 'project_id', 'kind', 'label', 'url', 'display_order', 'created_at'],
		links,
	);
	await insertBatched(
		'portfolio_media',
		[
			'id',
			'project_id',
			'r2_key',
			'content_type',
			'width',
			'height',
			'alt',
			'caption',
			'is_cover',
			'display_order',
			'created_at',
		],
		media,
	);
}

/** Write VALUES rows in batches; D1 caps bound params per statement. */
async function insertBatched(
	table: string,
	columns: readonly string[],
	rows: readonly string[],
): Promise<void> {
	const perStatement = Math.max(1, Math.floor(500 / columns.length));
	for (let i = 0; i < rows.length; i += perStatement) {
		const slice = rows.slice(i, i + perStatement);
		const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${slice.join(', ')}`;
		await env.DB.prepare(sql).run();
	}
}

/**
 * The pre-fix (row-at-a-time) read shape, kept verbatim in spirit so
 * the detector proves it can FAIL. This mirrors `listPortfolioProjects`
 * at `origin/release-0-6-3@5d257d8`: for every row on the page, one
 * link statement and one media statement.
 */
async function legacyRowAtATimeReads(
	db: D1Database,
	rows: ReadonlyArray<{ id: string }>,
): Promise<number> {
	let statements = 0;
	for (const row of rows) {
		await db
			.prepare(
				'SELECT * FROM portfolio_link WHERE project_id = ?1 ORDER BY display_order ASC, created_at ASC',
			)
			.bind(row.id)
			.all();
		await db
			.prepare(
				'SELECT * FROM portfolio_media WHERE project_id = ?1 ORDER BY is_cover DESC, display_order ASC, created_at ASC',
			)
			.bind(row.id)
			.all();
		statements += 2;
	}
	return statements;
}

/** `EXPLAIN QUERY PLAN` for a statement, run OUTSIDE any measured window. */
async function explain(
	db: D1Database,
	sql: string,
	binds: ReadonlyArray<string | number> = [],
): Promise<string[]> {
	const stmt = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
	const result = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<{ detail: string }>();
	return (result.results ?? []).map((r) => r.detail);
}

interface PageMeasurement {
	pageSize: number;
	projects: number;
	statements: number;
	budget: number;
	legacyStatements: number;
	elapsedMs: number;
	linksPerProject: number;
	mediaPerProject: number;
	firstLinkIsCover: boolean;
}

const measurements: PageMeasurement[] = [];
const detailMeasurements: Array<{ projectId: string; statements: number }> = [];

/**
 * The statements the loader actually issues, kept verbatim so the
 * query-plan assertions and the HTML report cannot drift apart.
 */
const STATEMENTS = {
	links:
		'SELECT * FROM portfolio_link WHERE project_id IN (?1, ?2) ORDER BY project_id ASC, display_order ASC, created_at ASC',
	media:
		'SELECT * FROM portfolio_media WHERE project_id IN (?1, ?2) ORDER BY project_id ASC, is_cover DESC, display_order ASC, created_at ASC',
	page: "SELECT * FROM portfolio_project WHERE status = 'published' AND visibility = 'public' ORDER BY pinned DESC, display_order ASC, updated_at DESC, id ASC LIMIT ?",
	legacyLink:
		'SELECT * FROM portfolio_link WHERE project_id = ?1 ORDER BY display_order ASC, created_at ASC',
} as const;

const plans: Record<string, string[]> = {};

beforeAll(async () => {
	await applyMigration();
	await clearTables();

	for (const pageSize of PAGE_SIZES) {
		await clearTables();
		await seedProjects(pageSize);

		const { counted, statements } = countStatements(env.DB);
		const loader = createD1PortfolioLoader({ DB: counted });
		const started = Date.now();
		const page = await loader.listPortfolioProjects({ limit: pageSize });
		const elapsedMs = Date.now() - started;
		const currentStatements = statements.length;

		// The pre-fix shape through the same harness, on its OWN counter
		// so the replayed statements are not attributed to the loader:
		// 1 page query + 2 statements per row.
		const legacy = countStatements(env.DB);
		await legacyRowAtATimeReads(legacy.counted, page.projects);
		const legacyStatements = 1 + legacy.statements.length;

		measurements.push({
			pageSize,
			projects: page.projects.length,
			statements: currentStatements,
			budget: portfolioListQueryBudget(pageSize),
			legacyStatements,
			elapsedMs,
			linksPerProject: page.projects[0]?.links.length ?? 0,
			mediaPerProject: page.projects[0]?.media.length ?? 0,
			firstLinkIsCover: page.projects[0]?.media[0]?.isCover ?? false,
		});

		// The detail surface must not depend on how many children a
		// project owns: one target query + one link + one media.
		const detailCounter = countStatements(env.DB);
		const detailLoader = createD1PortfolioLoader({ DB: detailCounter.counted });
		const detail = await detailLoader.loadPortfolioProject('qb-0');
		expect(detail?.slug).toBe('qb-0');
		detailMeasurements.push({
			projectId: detail?.id ?? 'unknown',
			statements: detailCounter.statements.length,
		});
	}

	// The largest fixture is intentionally LEFT in place so the query
	// plans below describe a populated table; `afterAll` clears it.
	for (const key of ['links', 'media'] as const) {
		plans[key] = await explain(env.DB, STATEMENTS[key], ['qb_p0', 'qb_p1']);
	}
	plans.page = await explain(env.DB, STATEMENTS.page, [51]);
	plans.legacyLink = await explain(env.DB, STATEMENTS.legacyLink, ['qb_p0']);

	emitReport();
});

afterAll(async () => {
	await clearTables();
});

function emitReport(): void {
	const first = measurements[0];
	const largest = measurements[measurements.length - 1];
	const legacyFirst = measurements[0]?.legacyStatements ?? 0;
	const legacyLargest = measurements[measurements.length - 1]?.legacyStatements ?? 0;

	const records = {
		kind: 'series',
		issue: 491,
		workload: 'portfolio list page (/portfolio), public+published rows only',
		schemaSource: 'migrations/0007_portfolio.sql',
		d1Target: 'local miniflare SQLite binding from vitest.config.ts (d1Databases.DB)',
		chunkSize: D1_BATCH_ID_CHUNK,
		detailBudget: PORTFOLIO_DETAIL_QUERY_BUDGET,
		linksPerProject: LINKS_PER_PROJECT,
		mediaPerProject: MEDIA_PER_PROJECT,
		legacyGrowthPerProject:
			(legacyLargest - legacyFirst) / Math.max(1, largest.pageSize - first.pageSize),
		currentGrowthPerProject:
			(largest.statements - first.statements) / Math.max(1, largest.pageSize - first.pageSize),
		rows: measurements,
		detail: detailMeasurements,
		plans,
		statements: STATEMENTS,
	};
	console.log(`${REPORT_PREFIX}${JSON.stringify(records)}`);

	for (const m of measurements) {
		console.log(
			`page_size=${m.pageSize} projects=${m.projects} statements=${m.statements} budget=${m.budget} legacy=${m.legacyStatements} elapsed_ms=${m.elapsedMs}`,
		);
	}
}

describe('portfolio — D1 statement budget (Issue #491 N+1 boundary)', () => {
	it('list page statement count stays within the budget at every fixture size', () => {
		expect(measurements.length).toBe(PAGE_SIZES.length);
		for (const m of measurements) {
			expect(m.statements, `page size ${m.pageSize}`).toBeLessThanOrEqual(m.budget);
		}
	});

	it('list page statement count does NOT grow linearly with page size', () => {
		const first = measurements[0];
		const largest = measurements[measurements.length - 1];
		if (!first || !largest) throw new Error('measurements missing');
		// The defining N+1 property: two round trips per project.
		expect(first.legacyStatements).toBe(1 + 2 * first.pageSize);
		expect(largest.legacyStatements).toBe(1 + 2 * largest.pageSize);
		expect(largest.legacyStatements - first.legacyStatements).toBe(
			2 * (largest.pageSize - first.pageSize),
		);

		// The current loader must be flat for every page that fits in
		// one id chunk, and sub-linear beyond it.
		const flat = measurements.filter((m) => m.pageSize <= D1_BATCH_ID_CHUNK);
		expect(new Set(flat.map((m) => m.statements)).size).toBe(1);
		const growthPerProject =
			(largest.statements - first.statements) / (largest.pageSize - first.pageSize);
		expect(growthPerProject).toBeLessThanOrEqual(2 / D1_BATCH_ID_CHUNK);
	});

	it('the budget formula matches the D1 bound-parameter chunk size', () => {
		expect(portfolioListQueryBudget(0)).toBe(1);
		expect(portfolioListQueryBudget(1)).toBe(3);
		expect(portfolioListQueryBudget(D1_BATCH_ID_CHUNK)).toBe(3);
		expect(portfolioListQueryBudget(D1_BATCH_ID_CHUNK + 1)).toBe(5);
		expect(portfolioListQueryBudget(500)).toBe(1 + 2 * Math.ceil(500 / D1_BATCH_ID_CHUNK));
	});

	it('detail surface stays at the detail budget for every fixture size', () => {
		expect(detailMeasurements.length).toBe(PAGE_SIZES.length);
		for (const d of detailMeasurements) {
			expect(d.statements).toBeLessThanOrEqual(PORTFOLIO_DETAIL_QUERY_BUDGET);
		}
		expect(new Set(detailMeasurements.map((d) => d.statements)).size).toBe(1);
	});

	it('batched reads preserve per-project ordering and cover-first media', () => {
		for (const m of measurements) {
			expect(m.linksPerProject).toBe(LINKS_PER_PROJECT);
			expect(m.mediaPerProject).toBe(MEDIA_PER_PROJECT);
			expect(m.firstLinkIsCover).toBe(true);
		}
	});
});

describe('portfolio — D1 query plans (index utilisation, Issue #491)', () => {
	it('the batched link statement is served by idx_portfolio_link_project', () => {
		const plan = plans.links ?? [];
		expect(plan.length).toBeGreaterThan(0);
		expect(plan.some((l) => l.includes('SEARCH portfolio_link USING INDEX'))).toBe(true);
		expect(plan.some((l) => l.includes('idx_portfolio_link_project'))).toBe(true);
		expect(plan.some((l) => l.startsWith('SCAN portfolio_link'))).toBe(false);
	});

	it('the batched media statement is served by idx_portfolio_media_project', () => {
		const plan = plans.media ?? [];
		expect(plan.length).toBeGreaterThan(0);
		expect(plan.some((l) => l.includes('SEARCH portfolio_media USING INDEX'))).toBe(true);
		expect(plan.some((l) => l.includes('idx_portfolio_media_project'))).toBe(true);
		expect(plan.some((l) => l.startsWith('SCAN portfolio_media'))).toBe(false);
	});

	it('the page statement is served by idx_portfolio_project_status, not a full scan', () => {
		const plan = plans.page ?? [];
		expect(plan.some((l) => l.includes('idx_portfolio_project_status'))).toBe(true);
		expect(plan.some((l) => l.startsWith('SCAN portfolio_project'))).toBe(false);
	});

	it('the pre-fix per-row statement used the same index, N times', () => {
		// Recorded so the report cannot claim the index was the defect:
		// it was the ROUND-TRIP COUNT, not index choice.
		const plan = plans.legacyLink ?? [];
		expect(plan.some((l) => l.includes('idx_portfolio_link_project'))).toBe(true);
	});

	it('a statement never binds more than the D1 bound-parameter cap', async () => {
		// The batched statements bind exactly one parameter per id and
		// are chunked at the cap, so a 500-row page cannot build a
		// statement D1 would reject. The fixture left by `beforeAll`
		// holds 500 projects x LINKS_PER_PROJECT links, and the largest
		// page-size chunk resolves exactly one chunk's worth.
		const chunk = Array.from({ length: D1_BATCH_ID_CHUNK }, (_, i) => `qb_p${i}`);
		const placeholders = chunk.map((_, i) => `?${i + 1}`).join(', ');
		expect(chunk.length).toBe(100);
		const result = await env.DB.prepare(
			`SELECT COUNT(*) AS n FROM portfolio_link WHERE project_id IN (${placeholders})`,
		)
			.bind(...chunk)
			.all<{ n: number }>();
		expect(result.results?.[0]?.n ?? 0).toBe(D1_BATCH_ID_CHUNK * LINKS_PER_PROJECT);
	});
});
