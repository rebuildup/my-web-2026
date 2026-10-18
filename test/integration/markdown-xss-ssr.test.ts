/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOCKED_LINK_CLASS } from '../../src/portfolio/markdown.lexer';
import {
	MARKDOWN_XSS_FIXTURES,
	MARKDOWN_XSS_FIXTURE_SLUG,
	articleRegion,
	executableMarkupFindings,
	markdownXssFixtureRowValues,
} from '../../src/portfolio/markdown.xss-fixtures';

/**
 * Worker-level XSS boundary for the article renderer (Issue #451).
 *
 * `src/portfolio/markdown.security.test.tsx` proves the renderer in
 * isolation. This file proves the same thing through the only surface
 * a visitor can actually reach: `GET /portfolio/<slug>` served by the
 * real Worker, from a D1 row whose body IS the attack corpus.
 *
 * Why the HTTP layer is its own test
 * ---------------------------------
 * A renderer-level assertion cannot catch a boundary that re-introduces
 * markup on the way out — a future `dangerouslySetInnerHTML`, a meta
 * description built from `project.summary`, or a helper that
 * un-escapes the body. Those live between `parseMarkdown` and the
 * response, and only a real response sees them.
 *
 * Assertions are scoped to `<article id="portfolio-detail">` on
 * purpose: the SSR shell legitimately ships hydration `<script>` tags,
 * so a whole-page "no <script>" assertion would be both false and
 * useless.
 */

/**
 * The portfolio migration, inlined byte-for-byte.
 *
 * workerd cannot `fs.readFile`, so every suite that needs a table
 * carries its own copy of the SQL — and the copy MUST stay identical
 * to `migrations/0007_portfolio.sql`, or this test would validate a
 * schema production never runs.
 */
const MIGRATIONS = [
	{
		name: '0007_portfolio',
		queries: [
			`CREATE TABLE IF NOT EXISTS portfolio_project (
    id                  TEXT    PRIMARY KEY,
    slug                TEXT    NOT NULL UNIQUE,
    title               TEXT    NOT NULL,
    summary             TEXT    NOT NULL,            -- 1-line summary (ja + en separated by newline)
    role                TEXT    NOT NULL,            -- free-form, e.g. 'Solo developer', 'Lead engineer'
    period_start        INTEGER NOT NULL,            -- UNIX ms
    period_end          INTEGER,                     -- UNIX ms; NULL = ongoing
    period_label        TEXT,                        -- human label, e.g. '2022 - present'
    motivation_md       TEXT    NOT NULL DEFAULT '',
    architecture_md     TEXT,
    constraints_md      TEXT,
    implementation_md   TEXT,
    evidence_md         TEXT,
    retrospective_md    TEXT,
    facets              TEXT    NOT NULL DEFAULT '[]',  -- JSON array of PortfolioFacet
    technologies        TEXT    NOT NULL DEFAULT '[]',  -- JSON array of free-form strings
    visibility          TEXT    NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'unlisted', 'draft')),
    status              TEXT    NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'archived')),
    pinned              INTEGER NOT NULL DEFAULT 0,  -- 0/1
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);`,
			`CREATE INDEX IF NOT EXISTS idx_portfolio_project_status
    ON portfolio_project(status, visibility, display_order, updated_at);`,
			`CREATE INDEX IF NOT EXISTS idx_portfolio_project_slug
    ON portfolio_project(slug);`,
			`CREATE INDEX IF NOT EXISTS idx_portfolio_project_pinned
    ON portfolio_project(pinned);`,
			`CREATE TABLE IF NOT EXISTS portfolio_link (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL
        CHECK (kind IN ('repo', 'demo', 'release', 'article', 'shop', 'video', 'other')),
    label           TEXT,                            -- optional override
    url             TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);`,
			`CREATE INDEX IF NOT EXISTS idx_portfolio_link_project
    ON portfolio_link(project_id, display_order);`,
			`CREATE TABLE IF NOT EXISTS portfolio_media (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    r2_key          TEXT    NOT NULL,                -- e.g. 'portfolio/<slug>/cover.webp'
    content_type    TEXT    NOT NULL,                -- e.g. 'image/webp'
    width           INTEGER,
    height          INTEGER,
    alt             TEXT    NOT NULL,                -- required for accessibility
    caption         TEXT,
    is_cover        INTEGER NOT NULL DEFAULT 0,      -- 0/1
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);`,
			`CREATE INDEX IF NOT EXISTS idx_portfolio_media_project
    ON portfolio_media(project_id, display_order);`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_media_one_cover
    ON portfolio_media(project_id) WHERE is_cover = 1;`,
		],
	},
];

const FIXTURE_SLUG = MARKDOWN_XSS_FIXTURE_SLUG;
const D1 = () => env.DB;

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
	const values = markdownXssFixtureRowValues();
	await D1()
		.prepare(
			`INSERT OR REPLACE INTO portfolio_project (
			id, slug, title, summary, role, period_start, period_end, period_label,
			motivation_md, facets, technologies, visibility, status, pinned,
			display_order, created_at, updated_at
		) VALUES (${values.map((_, index) => `?${index + 1}`).join(', ')})`,
		)
		.bind(...values)
		.run();
});

afterAll(async () => {
	await D1().prepare('DELETE FROM portfolio_project WHERE slug = ?1').bind(FIXTURE_SLUG).run();
});

async function fetchFixtureArticle(): Promise<string> {
	const res = await SELF.fetch(`https://example.com/portfolio/${FIXTURE_SLUG}`);
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toContain('text/html');
	return articleRegion(await res.text());
}

describe('Worker SSR: portfolio article XSS boundary (Issue #451)', () => {
	it('serves the fixture article over HTTP', async () => {
		const article = await fetchFixtureArticle();
		expect(article.length).toBeGreaterThan(0);
		// The corpus reached the renderer: both an accepted and a
		// refused case are present.
		expect(article).toContain('External link');
		expect(article).toContain(BLOCKED_LINK_CLASS);
	});

	it('renders no executable markup inside the article', async () => {
		const article = await fetchFixtureArticle();
		expect(executableMarkupFindings(article), article.slice(0, 2000)).toEqual([]);
	});

	it('never emits a script-bearing or handler-bearing element', async () => {
		const article = await fetchFixtureArticle();
		for (const [, pattern] of [
			['script', /<script\b/i],
			['iframe', /<iframe\b/i],
			['object', /<object\b/i],
			['svg', /<svg\b/i],
			['img', /<img\b/i],
			['event handler', /<[a-z][^>]*\son[a-z]+\s*=/i],
		] as const) {
			expect(pattern.test(article), `<${pattern.source}> matched inside the article`).toBe(false);
		}
	});

	it('keeps every refused link visible and inert', async () => {
		const article = await fetchFixtureArticle();
		const markers = article.split(BLOCKED_LINK_CLASS).length - 1;
		const linkVectors = MARKDOWN_XSS_FIXTURES.filter(
			(fixture) => fixture.expectation === 'blocked' && fixture.vector === 'markdown-link',
		);
		expect(markers).toBe(linkVectors.length);
		expect(article).not.toMatch(/(?:^|[\s<])href="\s*(?:javascript|data|vbscript):/i);
		expect(article).toContain('data-blocked-reason="scheme-not-allowed"');
		expect(article).toContain('data-blocked-reason="encoded-scheme"');
		expect(article).toContain('data-blocked-reason="control-character"');
	});

	it('shows raw-HTML payloads as escaped text, not as markup', async () => {
		const article = await fetchFixtureArticle();
		// The payloads are visible to a reviewer (that is the point of
		// escaping rather than deleting) but inert.
		expect(article).toContain('&lt;script&gt;');
		expect(article).toContain('&lt;img src=x onerror=');
		expect(article).toContain('&lt;svg onload=');
		expect(article).not.toContain('__xssFired=1</script>');
	});

	it('keeps accepted links working', async () => {
		const article = await fetchFixtureArticle();
		expect(article).toMatch(/<a [^>]*href="\/portfolio"/);
		expect(article).toMatch(/<a [^>]*href="https:\/\/example\.com\/docs"/);
		expect(article).toContain('rel="noopener noreferrer"');
	});

	it('does not leak the fixture row into the public list in a broken state', async () => {
		// The fixture is a real published row while it exists; the list
		// route must still render it as an ordinary project, which is
		// what makes this an article-renderer fixture and not a
		// visibility bypass.
		const res = await SELF.fetch('https://example.com/portfolio');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain(FIXTURE_SLUG);
		expect(executableMarkupFindings(articleRegion(html))).toEqual([]);
	});
});
