/**
 * SSR render-failure fallback (Issue #501).
 *
 * Why this module exists
 * ----------------------
 * `src/router.tsx` binds the failure surfaces to the router's
 * `defaultNotFoundComponent` / `defaultErrorComponent`. That covers a
 * loader failure, because the framework itself renders the failed
 * match's error component on the server.
 *
 * It does NOT cover a route COMPONENT that throws while React is
 * rendering the first document. React's error boundaries — including
 * `@tanstack/react-router`'s `CatchBoundary` — do not catch errors
 * during server rendering. React instead emits a client-rendered
 * boundary marker plus an error template, and TanStack Start's
 * streaming handler still returns HTTP 200 with that partial
 * document. The visitor (and any crawler) gets no readable failure
 * surface; the error message and stack can appear in the served HTML.
 *
 * No React component can fix this: by the time a component runs, the
 * decision to abort the subtree has already been made. The only place
 * outside React is the Worker entrypoint, which is why `src/server.ts`
 * buffers the SSR document, looks for React's client-rendered boundary
 * marker with `containsServerRenderFailure`, and replaces the whole
 * response with `renderSsrFailureDocument` when it finds one.
 *
 * What this document is (and is not)
 * ----------------------------------
 * It renders the SAME published contract as the hydrated
 * `ServiceUnavailableState` — copy and alternatives both come from
 * `./contract` — in a standalone, script-free HTML document. It does
 * not use Panda CSS or the app shell, because neither is available when
 * the app failed to render; the inline styles below only make the
 * message readable and the links focusable. It initiates no network
 * request at all (no fonts, no analytics).
 *
 * The fallback is deliberately `service_unavailable`: a render throw is
 * a failure of the system preparing the page, not a permanent client
 * input error (those are classified by
 * `src/router.tsx#isPermanentInputFailure` before rendering).
 *
 * Keep the copy in `./contract` — do not duplicate it here.
 */

import { alternativesFor, errorStateDefinition } from './contract';

/**
 * React's marker for a Suspense boundary whose server render errored
 * and was deferred to the client. React writes
 * `<!--$!--><template …></template>` (production keeps the digest, the
 * development build also writes `data-msg` / `data-stck`). The marker
 * is emitted only for a boundary that could not be rendered on the
 * server, so its presence in a served document means part of the page
 * was lost.
 */
const CLIENT_RENDERED_BOUNDARY = /<!--\$!-->\s*<template\b/;

/** Does this SSR document contain a React client-rendered error boundary? */
export function containsServerRenderFailure(html: string): boolean {
	return CLIENT_RENDERED_BOUNDARY.test(html);
}

/**
 * Turn a response from the SSR handler into the response the visitor gets.
 *
 * Non-HTML responses (server-function payloads, Hono responses, static
 * assets) pass through untouched. For a document, the body is read so a
 * failed render boundary can be detected; a complete document is then
 * re-wrapped with the same status and headers (the body is byte-identical,
 * so the response is unchanged), and a failed one is replaced by the
 * standalone fallback with the same URL's retry anchor.
 *
 * Buffering is deliberate. TanStack Start sets
 * `progressiveChunkSize: Number.POSITIVE_INFINITY`, so the document is
 * assembled before it is flushed anyway; the only way to know whether a
 * boundary failed is to see the complete document. A stream that rejects
 * before a document exists is treated as the same failure.
 */
export async function settleSsrDocumentResponse(
	request: Request,
	response: Response,
): Promise<Response> {
	if (!response.headers.get('content-type')?.includes('text/html')) return response;

	let html: string;
	try {
		html = await response.text();
	} catch {
		return createSsrFailureResponse(request);
	}

	if (!containsServerRenderFailure(html)) {
		return new Response(html, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}

	// The framework already logged the throwable; this line records only the
	// request path, which the failure surface would publish anyway.
	console.error(
		'[ssr] render failure; serving the fallback document',
		new URL(request.url).pathname,
	);
	return createSsrFailureResponse(request);
}

/**
 * The fallback response. `retryHref` keeps the query string so the retry
 * re-requests the URL that actually failed. Status stays 500 (the
 * framework's error status) rather than the 503 the label names — mapping
 * loader/render failures to 503 is the open decision recorded in
 * `docs/verification/ops/error-state-gallery.md`.
 */
export function createSsrFailureResponse(request: Request): Response {
	const url = new URL(request.url);
	return new Response(renderSsrFailureDocument({ retryHref: `${url.pathname}${url.search}` }), {
		status: 500,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	});
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export interface SsrFailureDocumentOptions {
	/** The URL that failed. Used for the retry anchor; defaults to `/`. */
	retryHref?: string;
	/** The way out for a visitor with no in-app history. Defaults to `/`. */
	backHref?: string;
}

/**
 * Render the standalone failure document.
 *
 * Every interpolation goes through `escapeHtml`. In particular
 * `retryHref` is the request's own pathname + query string, so it is
 * visitor-controlled input and must never be written raw into an
 * attribute.
 */
export function renderSsrFailureDocument(options: SsrFailureDocumentOptions = {}): string {
	const definition = errorStateDefinition('service_unavailable');
	const alternatives = alternativesFor('service_unavailable');
	const retryHref = options.retryHref ?? '/';
	const backHref = options.backHref ?? '/';
	const headingId = 'error-state-service_unavailable-heading';
	const descriptionId = 'error-state-service_unavailable-description';

	const alternativeItems = alternatives
		.map(
			(alternative) =>
				`<li><a href="${escapeHtml(alternative.href)}" data-error-action="alternative">${escapeHtml(alternative.label)}</a></li>`,
		)
		.join('');

	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(definition.headline)}</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #f7f5f0; color: #1d1c1a; font-family: "Noto Sans JP", system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
.eyebrow { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: #6b675f; }
h1 { margin: 0.5rem 0 0; font-size: clamp(1.6rem, 4vw, 2.1rem); line-height: 1.15; letter-spacing: -0.025em; }
.description { margin: 1rem 0 0; line-height: 1.6; color: #4b4740; }
.meta { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #d8d3c8; }
.status-line { margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.875rem; color: #4b4740; }
.status { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; color: #8a5a00; }
nav ul, .alternatives { margin: 0.5rem 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.5rem; }
a { display: inline-flex; align-items: center; min-height: 2.5rem; padding: 0 0.75rem; border: 1px solid #c9c3b6; border-radius: 0.375rem; color: #1d1c1a; text-decoration: none; font-size: 0.875rem; font-weight: 600; background: #fffdf8; }
a:hover { border-color: #8a8478; text-decoration: underline; }
a:focus-visible { outline: 2px solid #2b6cb0; outline-offset: 2px; }
.alternatives a { font-weight: 400; }
h2 { margin: 1.5rem 0 0; font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: #6b675f; }
.note { margin: 1.5rem 0 0; font-size: 0.875rem; line-height: 1.6; color: #6b675f; }
@media (prefers-color-scheme: dark) {
  body { background: #171614; color: #f4f1ea; }
  .description, .status-line { color: #c9c4b9; }
  .eyebrow, h2, .note { color: #a39d90; }
  .meta { border-top-color: #3a3733; }
  a { background: #23211e; color: #f4f1ea; border-color: #4a463f; }
}
</style>
</head>
<body>
<main>
<section aria-labelledby="${headingId}" aria-describedby="${descriptionId}" data-testid="error-state-service_unavailable" data-error-state="service_unavailable" data-error-fallback="ssr-render">
<p class="eyebrow">${escapeHtml(definition.eyebrow)} / ${escapeHtml(definition.statusLabel)}</p>
<h1 id="${headingId}">${escapeHtml(definition.headline)}</h1>
<p id="${descriptionId}" class="description" data-error-state-description>${escapeHtml(definition.description)}</p>
<div class="meta">
<p class="status-line" data-error-state-status><span class="status">${escapeHtml(definition.statusLabel)}</span><span>${escapeHtml(definition.condition)}</span></p>
<nav aria-label="復旧 / Recovery" data-error-state-recovery>
<ul>
<li><a href="${escapeHtml(retryHref)}" data-error-action="retry">再試行する / Try again</a></li>
<li><a href="${escapeHtml(backHref)}" data-error-action="back">ホームへ戻る / Back to home</a></li>
</ul>
</nav>
${definition.alternativesNote ? `<p class="note" data-error-state-alternatives-note>${escapeHtml(definition.alternativesNote)}</p>` : ''}
<h2>開けるページ / Surfaces you can open</h2>
<ul class="alternatives" data-error-state-alternatives>
${alternativeItems}
</ul>
</div>
</section>
</main>
</body>
</html>
`;
}
