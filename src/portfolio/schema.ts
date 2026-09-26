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
	/** Cursor returned from a previous page; null / undefined = first page. */
	cursor?: string | null;
	/** Hard cap on returned rows. Defaults to 100. */
	limit?: number;
}

/**
 * Opaque position cursor for cursor-based pagination.
 *
 * Encodes the last row of the previous page in the canonical sort
 * order (`pinned DESC, display_order ASC, updated_at DESC, id ASC`)
 * so the next-page query can resume deterministically.
 *
 * `id` is the final tiebreaker — required for stable ordering
 * because two rows may share every other key.
 */
export interface PortfolioCursor {
	/** pinned (0 or 1). */
	p: number;
	/** display_order. */
	d: number;
	/** updated_at (epoch ms). */
	u: number;
	/** project id. */
	i: string;
}

/**
 * Page returned by `listPortfolioProjects`. `nextCursor` is `null`
 * when the caller has reached the end of the result set.
 */
export interface PortfolioListPage {
	readonly projects: readonly PortfolioProject[];
	readonly nextCursor: string | null;
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

/**
 * Encode a cursor position as a base64url string. Round-trips
 * with `decodeCursor`. Pure function — safe to call from any
 * environment (no Node-specific Buffer polyfill required;
 * `btoa` / `atob` are available in the V8 isolate that runs
 * Cloudflare Workers).
 */
export function encodeCursor(c: PortfolioCursor): string {
	const json = JSON.stringify({ p: c.p, d: c.d, u: c.u, i: c.i });
	// btoa is available in the Cloudflare Workers V8 isolate;
	// fall back to Buffer in Node (tests, scripts) when needed.
	if (typeof btoa === 'function') return base64UrlEncode(json);
	return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a cursor string back to a `PortfolioCursor`, or `null`
 * if the input is malformed / signed by a different schema.
 * Pure function. Defensive against tampered input — `list`
 * treats `null` as "start from the first page".
 */
export function decodeCursor(s: string): PortfolioCursor | null {
	let json: string;
	try {
		json =
			typeof atob === 'function'
				? base64UrlDecode(s)
				: Buffer.from(s, 'base64url').toString('utf8');
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const obj = parsed as Record<string, unknown>;
	if (
		typeof obj.p !== 'number' ||
		typeof obj.d !== 'number' ||
		typeof obj.u !== 'number' ||
		typeof obj.i !== 'string'
	) {
		return null;
	}
	return { p: obj.p, d: obj.d, u: obj.u, i: obj.i };
}

function base64UrlEncode(s: string): string {
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
	const padded = s.replace(/-/g, '+').replace(/_/g, '/');
	const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
	return atob(padded + pad);
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
