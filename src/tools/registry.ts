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

/**
 * iframe + Permissions-Policy contract for a Tool (Issue #449).
 *
 * Declared on both the served (`same_origin_static`) and the
 * not-yet-served (`host_disabled`) delivery variants on purpose: a
 * grant must be reviewable — and testable — before the Tool graduates
 * to a built artifact, which is the whole point of keeping the
 * requirement in the manifest rather than in the Tool's own docs.
 */
export interface ToolIframeContract {
	readonly sandbox: string;
	readonly referrer_policy: string;
	/**
	 * Permissions-Policy features this Tool needs from the host, as
	 * FEATURE NAMES only (`"microphone"`) — never an origin allowlist.
	 * The host owns the origin: it renders `<iframe allow={allow}>` on
	 * the shell route and grants the same features on the Tool's own
	 * responses (Issue #449). Empty unless the Tool genuinely requires
	 * it.
	 */
	readonly allow?: string;
}

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
				readonly iframe?: ToolIframeContract;
		  }
		| {
				readonly kind: 'external_exception';
				readonly external_url: string;
				readonly iframe?: ToolIframeContract;
		  }
		| {
				readonly kind: 'host_disabled';
				readonly disabled_reason: string;
				readonly iframe?: ToolIframeContract;
		  };
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
		/** Feature NAMES only; empty string when the Tool needs none. */
		readonly allow: string;
	};
}

/**
 * Per-path security policy a Tool URL asks the host for (Issue #449).
 *
 * The Tool Registry owns this data because the manifest is where a
 * Tool's delivery contract lives (`delivery.iframe.allow` and
 * `.referrer_policy`). `src/server.ts` resolves it per request and
 * hands the result to `src/http/security-headers.ts`, which owns the
 * header rendering. Nothing here imports the security-header module,
 * so the direction stays registry → (entry) → boundary.
 */
export interface ToolRouteSecurityPolicy {
	/** `Referrer-Policy` for the response; absent = keep the host default. */
	readonly referrerPolicy?: string;
	/** Feature NAMES to grant on this response. */
	readonly grantedPermissions?: readonly string[];
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
		isStatic && tool.delivery.iframe
			? { ...tool.delivery.iframe, allow: tool.delivery.iframe.allow ?? '' }
			: { sandbox: '', referrer_policy: '', allow: '' };
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

/**
 * Split a manifest `delivery.iframe.allow` string into feature names.
 *
 * The manifest convention is deliberately narrow (Issue #449): FEATURE
 * NAMES only, space separated. The origin part of a Permissions-Policy
 * allowlist is the HOST's decision — it is derived from the origin
 * that actually served the response, so the same manifest entry works
 * on `http://127.0.0.1` in local workerd and on the canonical
 * production origin. An entry that smuggles an origin in
 * (`microphone=(self)`) therefore parses to the single token
 * `microphone=(self)`, which matches no denied feature and is
 * rejected by `scripts/check-security-headers.mjs` rather than
 * silently granting nothing.
 */
export function parseGrantedPermissions(allow: string | undefined): readonly string[] {
	if (!allow) return [];
	return allow
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

/**
 * Resolve the security policy that applies to a URL path (Issue #449).
 *
 * Two shapes matter, and they are deliberately different:
 *
 *   - the Tool ARTIFACT path (`delivery.artifact_path`, i.e.
 *     `/tools/<slug>/app` and everything under it). This is Tool-owned
 *     content: it gets the manifest's `referrer_policy` (`no-referrer`
 *     today) plus whatever features the Tool declared. Those responses
 *     are Cloudflare Static Assets, so `public/_headers` has to carry
 *     the same grant — `scripts/check-security-headers.mjs` keeps the
 *     two in step.
 *   - the Tool SHELL path (`/tools/<slug>`, served by the SSR
 *     pipeline). It is a host document, so it keeps the host
 *     `Referrer-Policy`, but it must not deny the features it is
 *     about to delegate to its own iframe.
 *
 * Anything else — every host page, `/admin*`, `/api/v1/*` — returns
 * `undefined` and therefore gets the plain baseline.
 */
export function toolRouteSecurityPolicy(pathname: string): ToolRouteSecurityPolicy | undefined {
	const tool = manifest.tools.find((candidate) => matchesToolPath(candidate, pathname));
	if (!tool) return undefined;

	const grantedPermissions = parseGrantedPermissions(tool.delivery.iframe?.allow);
	const isArtifactPath = matchesPath(artifactPathFor(tool), pathname);
	if (!isArtifactPath) {
		return grantedPermissions.length > 0 ? { grantedPermissions } : undefined;
	}
	return {
		referrerPolicy: tool.delivery.iframe?.referrer_policy,
		grantedPermissions,
	};
}

/** Exact-prefix-or-/ match, the same guard the Worker entry uses. */
function matchesPath(prefix: string, pathname: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Where a Tool's artefact is served, or would be served.
 *
 * A served Tool records the real path in `delivery.artifact_path`. A
 * Tool that is not served yet has no artefact, but it still owns a
 * canonical namespace — the one `public/_headers` and
 * `scripts/build-tools.mjs` use — so a declared grant resolves to the
 * SAME answer before and after the Tool graduates. That stability is
 * what lets `mic-level`'s grant be reviewed and tested while the Tool
 * is still `host_disabled`.
 */
function artifactPathFor(tool: ManifestTool): string {
	return tool.delivery.kind === 'same_origin_static'
		? tool.delivery.artifact_path
		: `/tools/${tool.slug}/app`;
}

/**
 * Does this pathname belong to the Tool?
 *
 * `/tools/<slug>` is the whole namespace: the iframe shell for a served
 * Tool, the "Coming soon" placeholder for a `host_disabled` one, and
 * the parent of the artefact directory. Matching the namespace (rather
 * than only the artefact) is what lets a declared grant be verified
 * before the Tool has a build.
 */
function matchesToolPath(tool: ManifestTool, pathname: string): boolean {
	return matchesPath(`/tools/${tool.slug}`, pathname);
}
