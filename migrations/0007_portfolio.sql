-- Migration 0007 — Portfolio project entries (Issue #76).
--
-- Foundation for the employment-facing Portfolio surface. The
-- schema is derived from `docs/personal/domain.md` §11 narrative
-- invariants + §12 surface implications, and from the 151-entry
-- inventory of my-web-2025 (`/home/basic/work/my-web-2026/.reference/my-web-2025/data/contents/content-*.db`).
--
-- Design intent (cross-references):
--   * `docs/domain/capabilities.md` — `portfolio = planned`,
--     promoted to `live (0.5.0)` once Issue #76 lands.
--   * `docs/personal/knowledge-model.md` — `period_start` /
--     `period_end` carry **Temporal State** semantics. `NULL`
--     `period_end` means "ongoing at the time of writing".
--   * ADR-0008 (obligation-oriented) — `portfolio` is its own
--     obligation, owning its own data model. `home` must not
--     read portfolio internals (covered by the architecture
--     check, see `scripts/check-architecture.mjs`).
--   * ADR-0011 (consumer pattern) — D1 is read by the loader,
--     never by routes directly.
--
-- Tables:
--
--   portfolio_project     one row per published / draft project.
--                         `slug` is the public URL key
--                         (`/portfolio/<slug>`); `facets` and
--                         `technologies` are JSON-encoded arrays
--                         because the schema is intentionally small
--                         for the 0.5.0 foundation; promotion to a
--                         dedicated `portfolio_facet` N:M table is
--                         deferred until the facet vocabulary
--                         stabilises.
--
--   portfolio_link        one row per external link attached to a
--                         project. `kind` constrains the URL
--                         category so the renderer can pick an
--                         icon / label without parsing the URL.
--
--   portfolio_media       one row per media asset (image / video
--                         poster) attached to a project. Stored
--                         in R2 (`MEDIA` binding) and keyed by
--                         `r2_key`. The partial UNIQUE index
--                         `idx_portfolio_media_one_cover` enforces
--                         "at most one cover per project" — the
--                         detail UI relies on this.
--
-- `Markdown` fields are plain TEXT — they are rendered by the
-- portfolio UI (#77), not by the loader.
--
-- `INSERT OR IGNORE` in seed is intentionally NOT included here;
-- seeding is owned by `scripts/seed-portfolio.mjs`, which uses
-- explicit `INSERT OR IGNORE` keyed on `slug`. The migration is
-- schema-only.

CREATE TABLE IF NOT EXISTS portfolio_project (
    id                  TEXT    PRIMARY KEY,
    slug                TEXT    NOT NULL UNIQUE,
    title               TEXT    NOT NULL,
    summary             TEXT    NOT NULL,            -- 1-line summary (ja + en separated by newline)
    role                TEXT    NOT NULL,            -- free-form, e.g. "Solo developer", "Lead engineer"
    period_start        INTEGER NOT NULL,            -- UNIX ms
    period_end          INTEGER,                     -- UNIX ms; NULL = ongoing
    period_label        TEXT,                        -- human label, e.g. "2022 - present"
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
);

CREATE INDEX IF NOT EXISTS idx_portfolio_project_status
    ON portfolio_project(status, visibility, display_order, updated_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_project_slug
    ON portfolio_project(slug);
CREATE INDEX IF NOT EXISTS idx_portfolio_project_pinned
    ON portfolio_project(pinned);

CREATE TABLE IF NOT EXISTS portfolio_link (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL
        CHECK (kind IN ('repo', 'demo', 'release', 'article', 'shop', 'video', 'other')),
    label           TEXT,                            -- optional override
    url             TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_link_project
    ON portfolio_link(project_id, display_order);

CREATE TABLE IF NOT EXISTS portfolio_media (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    r2_key          TEXT    NOT NULL,                -- e.g. "portfolio/<slug>/cover.webp"
    content_type    TEXT    NOT NULL,                -- e.g. "image/webp"
    width           INTEGER,
    height          INTEGER,
    alt             TEXT    NOT NULL,                -- required for accessibility
    caption         TEXT,
    is_cover        INTEGER NOT NULL DEFAULT 0,      -- 0/1
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_media_project
    ON portfolio_media(project_id, display_order);
-- Partial UNIQUE index: at most one `is_cover = 1` row per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_media_one_cover
    ON portfolio_media(project_id) WHERE is_cover = 1;
