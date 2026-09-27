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

/** All Tools known to the registry, including `host_disabled` ones. */
export function listTools(): readonly ManifestTool[] {
	return manifest.tools;
}

/** Look up a single Tool by slug. Returns `undefined` if absent. */
export function getTool(slug: string): ManifestTool | undefined {
	return manifest.tools.find((t) => t.slug === slug);
}

/**
 * Kinds that are reachable from a public URL on the host. `host_disabled`
 * and `not_integrable_yet` are intentionally excluded — the brief
 * forbids showing Tools that are not actually integrated.
 */
const PUBLIC_DELIVERY_KINDS = new Set<ManifestTool['delivery']['kind']>([
	'same_origin_static',
	'external_exception',
]);

/** Public Tools (the `/tools` index page lists exactly these). */
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
