import { resolveToolFrameSrc } from './embed-policy';
import type { ToolHostMessageDeclaration } from './embed-policy';
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
 *
 * Embed policy (Issue #465): this module does NOT decide whether a
 * Tool may be framed. `src/tools/embed-policy.ts` owns that decision
 * (sandbox tokens, referrer policy, frame origin, message origin) and
 * both `scripts/check-tools-manifest.mjs` and the `/tools/<slug>`
 * route consume it. What this module contributes is the resolved
 * frame `src` (`resolveToolEntryHtml`), so the route never has to
 * re-derive it from raw manifest strings.
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
					readonly allow?: string;
					readonly sandbox_rationale?: string;
				};
				readonly host_message?: ToolHostMessageDeclaration;
		  }
		| {
				readonly kind: 'external_exception';
				readonly external_url: string;
				// An external frame needs the same declared iframe policy
				// as a same-origin one (Issue #465): the host does not
				// invent a sandbox for a foreign origin either.
				readonly iframe?: {
					readonly sandbox: string;
					readonly referrer_policy: string;
					readonly allow?: string;
					readonly sandbox_rationale?: string;
				};
				readonly host_message?: ToolHostMessageDeclaration;
		  }
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
		// Issue #465: the declared capability grant. Rendered on the
		// <iframe> as `allow` so the manifest declaration is not inert —
		// see `docs/tools/embed-policy.md` §2.
		readonly allow?: string;
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
 * The frame `src` for a Tool entry (Issue #465).
 *
 * `same_origin_static` → the root-relative artefact entry HTML
 * (ADR-0006 §1). `external_exception` → the declared external URL.
 * Anything else → `''` (no frame is rendered).
 *
 * Single source of truth: `src/tools/embed-policy.ts#resolveToolFrameSrc`
 * owns the rule, because the same rule decides which src the
 * embed-policy verifier and the route are allowed to use.
 */
export function resolveToolEntryHtml(tool: ManifestTool): string {
	return resolveToolFrameSrc(tool.delivery);
}

/**
 * Internal: flatten a ManifestTool into the iframe-ready summary.
 *
 * Issue #465: `entry_html` is whatever `resolveToolFrameSrc` decides
 * for the delivery kind — the root-relative artefact path for
 * `same_origin_static`, the declared external URL for
 * `external_exception`, `''` for anything else. The declared `iframe`
 * policy (sandbox / referrer policy) is carried for every embeddable
 * kind so the route never has to re-read the manifest; a Tool that
 * declares no `iframe` block surfaces as empty strings, and
 * `evaluateToolEmbedPolicy` refuses to frame it at all.
 */
function toSummary(tool: ManifestTool): PublicToolSummary {
	const declared = tool.delivery.kind === 'host_disabled' ? undefined : tool.delivery.iframe;
	return {
		slug: tool.slug,
		display_name: tool.display_name,
		description: tool.description ?? tool.notes ?? '',
		classification: tool.classification,
		license: tool.license,
		entry_html: resolveToolEntryHtml(tool),
		iframe: declared ?? { sandbox: '', referrer_policy: '' },
	};
}
