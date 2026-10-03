import manifestJson from './manifest.json' with { type: 'json' };

/**
 * Tool Registry — host-side obligation for Issue #80.
 *
 * The registry reads the canonical manifest at build time. It is the
 * single source of truth for:
 *
 *   - which Tools are integrated
 *   - which delivery mode each Tool uses (same_origin_static,
 *     external_exception, host_disabled)
 *   - the iframe sandbox / referrer policy for the iframe route
 *   - the entry HTML URL for the iframe src
 *
 * Routes under `src/routes/tools.*` consume this module. The Tool
 * source under `external/<slug>/src/**` is NEVER imported here —
 * the only Tool data this module reads is the static JSON manifest.
 *
 * ADR-0006 §3 (revised 2026-09-27) names this module's obligation
 * as `host-side registry ownership`:
 *
 *   in-scope:
 *     - manifest parse
 *     - getTool / listTools
 *     - delivery metadata
 *     - host/embed policy
 *
 *   out-of-scope:
 *     - Tool UI implementation
 *     - Tool source code
 *     - Tool-specific framework adapter
 *     - Tool business logic
 *
 * Public surface — show-all policy (Issue #195, 2026-09-29):
 *
 *   The brief used to forbid showing Tools that are not actually
 *   integrated (host_disabled entries were kept out of the public
 *   list). Issue #195 flipped this so users can see the full my-web
 *   tool roadmap, with `host_disabled` Tools rendered with a
 *   "Coming soon" placeholder instead of being silently omitted.
 *
 *   Two parallel APIs reflect the flip:
 *
 *     - `listAllTools()` — every manifest entry, including
 *       `host_disabled` Tools, with `classification` and `delivery`
 *       exposed. The `/tools` index page uses this. Replaces the
 *       prior `listTools()` "all" + `listPublicTools()` "embeddable"
 *       split for index consumption.
 *     - `listPublicTools()` — ONLY Tools whose `delivery.kind` is
 *       `same_origin_static` or `external_exception`. The iframe
 *       shell route (`/tools/<slug>`) still uses this because the
 *       iframe can only mount an embeddable Tool.
 *
 *   `listTools()` is retained as an alias for `listAllTools()` so
 *   existing callers keep working.
 *
 * `verbatimModuleSyntax: true` lets `import type { Tool }` from this
 * file erase to zero runtime cost at build time, so consumers that
 * only need the type do not bundle the manifest.
 */

/** Manifest version. Bumped on breaking schema changes. */
export const MANIFEST_VERSION = 1 as const;

/** A Tool entry as recorded in the manifest. */
export interface ManifestTool {
	readonly slug: string;
	readonly display_name: string;
	readonly description?: string;
	readonly source: {
		readonly canonical_repo: string;
		readonly submodule_path: string;
		readonly pinned_sha: string;
		readonly branch: string;
	};
	readonly build: {
		readonly command: string;
		readonly output_dir: string;
		readonly package_manager: 'pnpm' | 'bun' | 'npm' | 'yarn';
		readonly security?: { readonly ignore_scripts?: string };
	};
	readonly delivery:
		| {
				readonly kind: 'same_origin_static';
				readonly artifact_path: string;
				readonly entry_html?: string;
				readonly iframe?: {
					readonly sandbox: string;
					readonly referrer_policy: string;
				};
		  }
		| { readonly kind: 'external_exception'; readonly external_url: string }
		| { readonly kind: 'host_disabled'; readonly disabled_reason: string };
	readonly classification:
		| 'same_origin_static'
		| 'needs_tool_side_fix'
		| 'external_exception'
		| 'not_integrable_yet';
	readonly license: string | null;
	readonly notes?: string;
}

/** Top-level manifest shape. */
export interface Manifest {
	readonly version: typeof MANIFEST_VERSION;
	readonly tools: readonly ManifestTool[];
}

/**
 * The iframe-ready view of a Tool. This is what the route layer
 * consumes — it strips source/build/notes/private fields and
 * collapses the discriminated `delivery` union into a flat shape.
 */
export interface PublicToolSummary {
	readonly slug: string;
	readonly display_name: string;
	readonly description: string;
	readonly classification: ManifestTool['classification'];
	readonly license: string | null;
	readonly entry_html: string;
	readonly iframe: {
		readonly sandbox: string;
		readonly referrer_policy: string;
	};
}

const manifest = manifestJson as Manifest;

/**
 * All Tools known to the registry, including `host_disabled` ones.
 *
 * Issue #195 (2026-09-29) flipped the `/tools` index to show every
 * manifest entry, so this is now the canonical "show-all" surface
 * for index consumers. Routes that need the embeddable-only subset
 * must call `listPublicTools()` instead.
 */
export function listAllTools(): readonly ManifestTool[] {
	return manifest.tools;
}

/**
 * @deprecated Prefer `listAllTools()` for show-all consumers
 * (e.g. the `/tools` index after #195) and `listPublicTools()` for
 * embeddable-only consumers (e.g. the iframe shell route). This
 * alias is retained so existing callers keep compiling.
 */
export function listTools(): readonly ManifestTool[] {
	return listAllTools();
}

/** Look up a single Tool by slug. Returns `undefined` if absent. */
export function getTool(slug: string): ManifestTool | undefined {
	return manifest.tools.find((t) => t.slug === slug);
}

/**
 * Kinds that are reachable from a public URL on the host. `host_disabled`
 * and `not_integrable_yet` are intentionally excluded from the
 * embeddable surface — the iframe shell can only mount a Tool that
 * has an actual `entry_html` / `external_url` to render.
 *
 * Note: this filter is only used by the iframe shell route now.
 * The `/tools` index page switched to `listAllTools()` per #195.
 */
const PUBLIC_DELIVERY_KINDS = new Set<ManifestTool['delivery']['kind']>([
	'same_origin_static',
	'external_exception',
]);

/**
 * Embeddable Tools (the iframe shell route renders exactly these).
 * The `/tools` index page lists more than this — see
 * `listAllTools()` and Issue #195.
 */
export function listPublicTools(): readonly PublicToolSummary[] {
	return manifest.tools.filter((t) => PUBLIC_DELIVERY_KINDS.has(t.delivery.kind)).map(toSummary);
}

/** Look up a single public Tool by slug. */
export function getPublicTool(slug: string): PublicToolSummary | undefined {
	return listPublicTools().find((t) => t.slug === slug);
}

/**
 * Internal: flatten a ManifestTool into the iframe-ready summary.
 * `same_origin_static` is the only kind that exposes entry_html +
 * iframe; other kinds produce an empty entry_html so the route layer
 * can render an explicit "this Tool is not embeddable" placeholder
 * if it ever lists an `external_exception` Tool.
 */
function toSummary(tool: ManifestTool): PublicToolSummary {
	const isStatic = tool.delivery.kind === 'same_origin_static';
	const entryHtml = isStatic
		? (tool.delivery.entry_html ?? `${tool.delivery.artifact_path}/index.html`)
		: '';
	const iframe =
		isStatic && tool.delivery.iframe ? tool.delivery.iframe : { sandbox: '', referrer_policy: '' };
	return {
		slug: tool.slug,
		display_name: tool.display_name,
		description: tool.description ?? tool.notes ?? '',
		classification: tool.classification,
		license: tool.license,
		entry_html: entryHtml,
		iframe,
	};
}
