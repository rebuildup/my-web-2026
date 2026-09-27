/**
 * Rewrite root-absolute asset paths in a Tool's emitted `index.html`
 * so they resolve against the artifact's URL namespace (e.g.
 * `/tools/<slug>/app/`) instead of the host origin.
 *
 * The Tool's Vite build emits paths like `/assets/index-XXX.js`
 * (Vite default `base: '/'`). When the artifact is served at
 * `/tools/<slug>/app/index.html`, the browser resolves `/assets/...`
 * against the host origin and 404s — the actual assets live at
 * `/tools/<slug>/app/assets/...`. This module is the single
 * implementation of the namespace-rewrite: the build orchestrator
 * (`scripts/build-tools.mjs`) calls it on the collected artifact, and
 * the test harness (`scripts/build-tools.test.mjs`) imports it
 * directly for fast, deterministic assertions.
 *
 * Behaviour:
 *   - `src="/..."` and `href="/..."` attributes on tags
 *     `script | link | img | source | track | audio | video |
 *      iframe | embed | object | area` are rewritten.
 *   - Paths already under the namespace are left untouched
 *     (idempotent — the orchestrator can run twice safely).
 *   - External absolute URLs (`https://...`, `http://...`, `data:`,
 *     `blob:`, `mailto:`, `javascript:`) are not touched.
 *   - The artifact_path's leading/trailing slashes are normalized
 *     before the prefix, so the output is always a clean
 *     `/<namespace>/<path>` with no `//` artifacts.
 *   - The `crossorigin` attribute is stripped from rewritten
 *     `script` and `link` tags. Vite emits `crossorigin` so the
 *     browser uses modulepreload for the entry script; but the Tool
 *     is hosted inside a sandboxed iframe (`allow-scripts` only) on
 *     the same origin, and the iframe's opaque origin makes any
 *     same-origin fetch with `crossorigin` a CORS request that the
 *     static-asset server (`vite preview`, Cloudflare Workers Static
 *     Assets) does NOT respond to with `Access-Control-Allow-Origin`.
 *     Stripping `crossorigin` falls back to the default same-origin
 *     module-script / stylesheet fetch, which has no CORS
 *     requirement. `crossorigin` on tags that we did not touch (no
 *     rewrite) is preserved.
 *
 * @param html - the original `index.html` content.
 * @param artifactPath - the manifest's `delivery.artifact_path`,
 *   e.g. `/tools/<slug>/app`. Leading/trailing slashes are
 *   normalized.
 * @returns the rewritten HTML, identical to `html` if nothing
 *   matched.
 */
export function rewriteAssetPaths(html, artifactPath) {
	// Compute the artifact's URL namespace. `artifact_path` starts
	// with `/` (e.g. `/tools/<slug>/app`) — strip the leading slash
	// before re-prefixing, otherwise paths become
	// `//tools/<slug>/app/...` which the browser interprets as
	// protocol-relative.
	const urlPrefix = artifactPath.replace(/^\/+/, '').replace(/\/+$/, '');
	return html.replace(
		/<(script|link|img|source|track|audio|video|iframe|embed|object|area)\b([^>]*?)\s(src|href)=("|\')(\/[^"'>]*)\4/gi,
		(match, tag, attrs, attr, quote, path) => {
			const trimmed = path.replace(/^\/+/, '');
			if (trimmed.startsWith(`${urlPrefix}/`)) return match;
			if (
				path.startsWith('http://') ||
				path.startsWith('https://') ||
				path.startsWith('data:') ||
				path.startsWith('blob:') ||
				path.startsWith('mailto:') ||
				path.startsWith('javascript:')
			) {
				return match;
			}
			// For `script` and `link` tags, drop the `crossorigin`
			// attribute from the rewritten tag so the sandboxed
			// iframe's opaque-origin fetch is treated as a normal
			// same-origin module / stylesheet request (no CORS
			// preflight, no Access-Control-Allow-Origin requirement).
			// See the doc-block above for the full rationale.
			const rewrittenAttrs =
				tag === 'script' || tag === 'link'
					? attrs.replace(/\s*crossorigin(\s*=("[^"]*"|'[^']*'|[\w-]+))?/gi, '')
					: attrs;
			return `<${tag}${rewrittenAttrs} ${attr}=${quote}/${urlPrefix}/${trimmed}${quote}`;
		},
	);
}
