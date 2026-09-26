import { z } from 'zod';

/**
 * Portfolio schema — TypeScript types + Zod validators.
 *
 * Source of truth for the on-the-wire shape of portfolio
 * project entries. The D1 migration (`migrations/0007_portfolio.sql`)
 * owns the on-disk shape; this module owns the in-process shape
 * that the loader returns and the UI consumes.
 *
 * Cross-references:
 *   * `migrations/0007_portfolio.sql` — D1 schema
 *   * `docs/personal/domain.md` §11 narrative invariants
 *   * `docs/personal/knowledge-model.md` — Temporal State semantics
 *   * ADR-0008 obligation-oriented — `portfolio` is its own obligation
 *
 * Notes on choices:
 *   * `facets` is a closed enum today (`develop` | `video` |
 *     `design` | `other`). It is persisted as a JSON-encoded TEXT
 *     column because the foundation intentionally does not
 *     promote facets to a separate N:M table — the vocabulary is
 *     small and `docs/domain/capabilities.md` treats
 *     `work-dev` / `work-video` / `work-design` as facet
 *     candidates, not independent capabilities.
 *   * `technologies` is `string[]`, also JSON-encoded TEXT. Free-form.
 *   * Markdown fields are stored as plain TEXT — the loader does
 *     not render them. UI (#77) owns rendering.
 */

export const PORTFOLIO_FACETS = ['develop', 'video', 'design', 'other'] as const;
export type PortfolioFacet = (typeof PORTFOLIO_FACETS)[number];

export const PORTFOLIO_VISIBILITIES = ['public', 'unlisted', 'draft'] as const;
export type PortfolioVisibility = (typeof PORTFOLIO_VISIBILITIES)[number];

export const PORTFOLIO_STATUSES = ['published', 'archived'] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUSES)[number];

export const PORTFOLIO_LINK_KINDS = [
	'repo',
	'demo',
	'release',
	'article',
	'shop',
	'video',
	'other',
] as const;
export type PortfolioLinkKind = (typeof PORTFOLIO_LINK_KINDS)[number];

/**
 * Slug grammar: `[a-z0-9][a-z0-9-]{0,127}`. Same family as the
 * reactions slug, slightly relaxed to allow hyphens (project
 * names use them — e.g. `aulymo`, `multi-slicer`, `tastile`).
 */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

export const SlugSchema = z
	.string()
	.regex(SLUG_REGEX, 'slug must match /^[a-z0-9][a-z0-9-]{0,127}$/');
export const FacetSchema = z.enum(PORTFOLIO_FACETS);
export const VisibilitySchema = z.enum(PORTFOLIO_VISIBILITIES);
export const StatusSchema = z.enum(PORTFOLIO_STATUSES);
export const LinkKindSchema = z.enum(PORTFOLIO_LINK_KINDS);

/**
 * Raw row shape as D1 returns it. Snake_case to match the SQL
 * columns; the loader converts to the camelCase `Portfolio*`
 * interfaces below.
 */
export interface PortfolioProjectRow {
	id: string;
	slug: string;
	title: string;
	summary: string;
	role: string;
	period_start: number;
	period_end: number | null;
	period_label: string | null;
	motivation_md: string;
	architecture_md: string | null;
	constraints_md: string | null;
	implementation_md: string | null;
	evidence_md: string | null;
	retrospective_md: string | null;
	facets: string; // JSON array
	technologies: string; // JSON array
	visibility: string;
	status: string;
	pinned: number; // 0/1
	display_order: number;
	created_at: number;
	updated_at: number;
}

export interface PortfolioLinkRow {
	id: string;
	project_id: string;
	kind: string;
	label: string | null;
	url: string;
	display_order: number;
	created_at: number;
}

export interface PortfolioMediaRow {
	id: string;
	project_id: string;
	r2_key: string;
	content_type: string;
	width: number | null;
	height: number | null;
	alt: string;
	caption: string | null;
	is_cover: number; // 0/1
	display_order: number;
	created_at: number;
}

/** Public (camelCase) shape returned to the UI / consumers. */
export interface PortfolioLink {
	id: string;
	kind: PortfolioLinkKind;
	label: string | null;
	url: string;
	displayOrder: number;
}

export interface PortfolioMedia {
	id: string;
	r2Key: string;
	contentType: string;
	width: number | null;
	height: number | null;
	alt: string;
	caption: string | null;
	isCover: boolean;
	displayOrder: number;
	/** Composed absolute URL for `<img src>` / OGP. Null when env.MEDIA is unbound. */
	url: string | null;
}

export interface PortfolioProject {
	id: string;
	slug: string;
	title: string;
	summary: string;
	role: string;
	periodStart: number;
	periodEnd: number | null;
	periodLabel: string | null;
	motivationMd: string;
	architectureMd: string | null;
	constraintsMd: string | null;
	implementationMd: string | null;
	evidenceMd: string | null;
	retrospectiveMd: string | null;
	facets: readonly PortfolioFacet[];
	technologies: readonly string[];
	visibility: PortfolioVisibility;
	status: PortfolioStatus;
	pinned: boolean;
	displayOrder: number;
	createdAt: number;
	updatedAt: number;
	links: readonly PortfolioLink[];
	media: readonly PortfolioMedia[];
}

/** Options accepted by `listPortfolioProjects`. */
export interface ListPortfolioProjectsOptions {
	/** Filter by facets (any-of). Omit / empty array = all. */
	facets?: readonly PortfolioFacet[];
	/** Filter by visibility. Defaults to ['public'] when omitted. */
	visibility?: readonly PortfolioVisibility[];
	/** Hard cap on returned rows. Defaults to 100. */
	limit?: number;
}

/**
 * Parse the JSON-encoded `facets` / `technologies` columns into
 * typed arrays. Pure function — exercised directly by the test
 * suite. Defensive against malformed JSON: returns empty arrays
 * instead of throwing so a corrupt row doesn't take down the
 * entire list response.
 */
export function parseFacetArray(raw: string): readonly PortfolioFacet[] {
	const parsed = safeJsonArray(raw);
	const out: PortfolioFacet[] = [];
	for (const v of parsed) {
		const r = FacetSchema.safeParse(v);
		if (r.success) out.push(r.data);
	}
	return out;
}

export function parseTechnologyArray(raw: string): readonly string[] {
	const parsed = safeJsonArray(raw);
	return parsed.filter((v): v is string => typeof v === 'string');
}

function safeJsonArray(raw: string): readonly unknown[] {
	if (!raw) return [];
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

/** Convert snake_case row to camelCase `PortfolioLink`. */
export function rowToLink(row: PortfolioLinkRow): PortfolioLink {
	const kindParse = LinkKindSchema.safeParse(row.kind);
	return {
		id: row.id,
		kind: kindParse.success ? kindParse.data : 'other',
		label: row.label,
		url: row.url,
		displayOrder: row.display_order,
	};
}

/** Convert snake_case row to camelCase `PortfolioMedia`. `url` is null here; the loader fills it. */
export function rowToMedia(row: PortfolioMediaRow): PortfolioMedia {
	return {
		id: row.id,
		r2Key: row.r2_key,
		contentType: row.content_type,
		width: row.width,
		height: row.height,
		alt: row.alt,
		caption: row.caption,
		isCover: row.is_cover === 1,
		displayOrder: row.display_order,
		url: null,
	};
}

/** Convert snake_case row to camelCase `PortfolioProject` (links / media filled by loader). */
export function rowToProject(
	row: PortfolioProjectRow,
	links: readonly PortfolioLink[],
	media: readonly PortfolioMedia[],
): PortfolioProject {
	const visibilityParse = VisibilitySchema.safeParse(row.visibility);
	const statusParse = StatusSchema.safeParse(row.status);
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		role: row.role,
		periodStart: row.period_start,
		periodEnd: row.period_end,
		periodLabel: row.period_label,
		motivationMd: row.motivation_md,
		architectureMd: row.architecture_md,
		constraintsMd: row.constraints_md,
		implementationMd: row.implementation_md,
		evidenceMd: row.evidence_md,
		retrospectiveMd: row.retrospective_md,
		facets: parseFacetArray(row.facets),
		technologies: parseTechnologyArray(row.technologies),
		visibility: visibilityParse.success ? visibilityParse.data : 'draft',
		status: statusParse.success ? statusParse.data : 'archived',
		pinned: row.pinned === 1,
		displayOrder: row.display_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		links,
		media,
	};
}
