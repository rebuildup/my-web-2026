/**
 * Route label map for the Breadcrumbs nav primitive (Issue #173).
 *
 * Breadcrumbs build a path from the matched route chain to the leaf
 * match. Each match that owns a label in `ROUTE_LABELS` contributes
 * a segment; matches without an entry are skipped silently.
 *
 * Leaf suppression — the leaf match's `routeId` is the gate. The
 * home surface `/` and auth pages (`/admin/login`,
 * `/admin/invitations/accept`) are explicitly suppressed because
 * they exist outside the navigation contract:
 *
 *   - `/` is the canonical landing surface; its only ancestor is
 *     `__root__` and the breadcrumb trail would be a single
 *     no-context link back to itself.
 *   - Auth pages are pre-authentication waypoints where showing a
 *     navigation chrome would mislead the visitor about where they
 *     are in the IA.
 *
 * Canonical origin — `https://rebuildup.dev` (ADR-0014). The
 * breadcrumbs' JSON-LD `item` URL is computed against this origin
 * so search engines see a stable absolute URL even when the request
 * is served from a local dev server.
 */

/** Canonical production origin for JSON-LD `item` URLs. */
export const BREADCRUMB_ORIGIN = 'https://rebuildup.dev' as const;

/**
 * Route IDs whose leaf presence suppresses breadcrumbs entirely.
 * See file header for the suppression rationale.
 */
export const SUPPRESS_BREADCRUMB_LEAF_IDS: ReadonlySet<string> = new Set([
	'/',
	'/admin/login',
	'/admin/invitations_/accept',
]);

/**
 * A single route's contribution to the breadcrumb chain.
 *
 * `label` is the static fallback shown when the match has no
 * loader data (or when no resolver is provided). `resolve` runs at
 * render time against the match's `params` and `loaderData` so
 * dynamic routes like `/portfolio/$slug` can surface the project
 * title instead of the raw slug.
 *
 * `dropOnMissingLoaderData` opts the entry into Issue #183
 * semantics: when the loader throws `notFound()` and `loaderData`
 * is undefined, the entry is dropped from the visible chain
 * instead of falling back to `label`. Use this for routes whose
 * loader-thrown 404 must NOT surface a stub leaf segment in the
 * breadcrumb (e.g. `/tools/$slug` — the slug is unknown, so
 * showing a placeholder "Tool" segment is misleading). Default
 * is `false` to preserve the existing fallback contract used by
 * `/portfolio/$slug` ("Project" static label when loader data is
 * missing).
 */
export interface RouteLabel {
	label: string;
	resolve?: (input: {
		params: Record<string, string | undefined>;
		loaderData: unknown;
	}) => string | undefined;
	dropOnMissingLoaderData?: boolean;
}

/**
 * Route label registry keyed by route ID.
 *
 * Routes omitted here are simply absent from the breadcrumb chain
 * (the leaf suppression set gates whether the chain renders at
 * all; an unlabeled intermediate match is silently dropped).
 */
export const ROUTE_LABELS: Readonly<Record<string, RouteLabel>> = {
	'/about': { label: 'About' },
	'/contact': { label: 'Contact' },
	'/portfolio': { label: 'Portfolio' },
	'/portfolio/$slug': {
		// Static fallback (used only when loaderData has no project
		// — e.g. the loader threw `notFound()` and the match was
		// already filtered out). The visible label is sourced from
		// the project title when available.
		label: 'Project',
		resolve: ({ loaderData }) => {
			const data = loaderData as { project?: { title?: string; slug?: string } } | undefined;
			return data?.project?.title ?? data?.project?.slug;
		},
	},
	'/tools': { label: 'Tools' },
	'/tools/$slug': {
		label: 'Tool',
		// Issue #183: when the loader throws `notFound()` (the slug
		// is unknown), drop this match from the visible chain —
		// otherwise the breadcrumb surfaces a misleading "Tools >
		// Tool" stub for a slug that does not exist. The empty-state
		// component (`src/routes/tools.$slug.tsx#ToolNotFound`) is the
		// canonical surface for the 404 path.
		dropOnMissingLoaderData: true,
		resolve: ({ loaderData }) => {
			// `getPublicTool(slug)` returns the tool record directly
			// (no wrapper), so the loaderData IS the tool — read its
			// `display_name` (registry contract, see
			// `src/tools/registry.ts`) and fall back to the slug.
			const data = loaderData as { display_name?: string; slug?: string } | undefined;
			return data?.display_name ?? data?.slug;
		},
	},
	'/admin': { label: 'Admin' },
	'/admin/emoji-catalog': { label: '絵文字カタログ' },
	'/admin/images': { label: 'リアクション画像' },
	'/admin/invitations': { label: '招待' },
	'/admin/keys': { label: 'API キー' },
};
