import { describe, expect, it } from 'vitest';
import {
	SSR_FALLBACK_ALTERNATIVES_NOTE,
	alternativesFor,
	errorStateDefinition,
	withheldDetailNeedles,
} from './contract';
import {
	containsServerRenderFailure,
	createSsrFailureResponse,
	renderSsrFailureDocument,
	settleSsrDocumentResponse,
} from './ssr-fallback';

/**
 * The server-entry half of Issue #501.
 *
 * React error boundaries do not catch a route component that throws
 * during SSR; React emits a client-rendered boundary marker and
 * TanStack Start still answers 200. `settleSsrDocumentResponse` is the
 * only layer outside React, so it is pinned here with the exact shape
 * React produces (both the development `data-msg` / `data-stck`
 * variant and the production digest-only variant).
 */

const DEV_FAILED_DOCUMENT = `<!DOCTYPE html><html lang="ja"><body><div id="app-root"><!--$!--><template data-msg="Switched to client rendering because the server rendering errored:

boom" data-stck="Error: boom
    at Throwing (/src/routes/x.tsx:8:8)"></template><div hidden id="S:0"></div><!--/$--></div></body></html>`;

const PROD_FAILED_DOCUMENT =
	'<!DOCTYPE html><html lang="ja"><body><!--$!--><template data-dgst=""></template><!--/$--></body></html>';

const HEALTHY_DOCUMENT =
	'<!DOCTYPE html><html lang="ja"><body><h1>ポートフォリオ</h1></body></html>';

function htmlResponse(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	});
}

describe('containsServerRenderFailure', () => {
	it('recognises the development and production client-rendered boundary markers', () => {
		expect(containsServerRenderFailure(DEV_FAILED_DOCUMENT)).toBe(true);
		expect(containsServerRenderFailure(PROD_FAILED_DOCUMENT)).toBe(true);
	});

	it('does not treat a healthy document or a pending boundary as a failure', () => {
		expect(containsServerRenderFailure(HEALTHY_DOCUMENT)).toBe(false);
		// `<!--$?-->` is a pending Suspense boundary that will resolve, not
		// an errored one (`<!--$!-->`).
		expect(
			containsServerRenderFailure(
				'<!DOCTYPE html><html><body><!--$?--><template id="S:0"></template>…<!--/$--></body></html>',
			),
		).toBe(false);
	});

	it('ignores the marker text inside raw-text element bodies', () => {
		// A repo-controlled JSON-LD block is serialised into a script element
		// verbatim (`CreativeWorkJsonLd` renders a D1 title / summary), so a
		// description that quotes the marker must not turn a healthy 200
		// document into a 500 fallback.
		expect(
			containsServerRenderFailure(
				'<!DOCTYPE html><html><body><script type="application/ld+json">{"description":"<!--$!--><template id=\\"B:0\\"></template>"}</script><h1>作品</h1></body></html>',
			),
		).toBe(false);
		expect(
			containsServerRenderFailure(
				'<!DOCTYPE html><html><head><style>/* <!--$!--><template> */</style></head><body><h1>作品</h1></body></html>',
			),
		).toBe(false);
	});

	it('still detects a real boundary next to raw-text content', () => {
		expect(
			containsServerRenderFailure(
				'<!DOCTYPE html><html><body><script>const a = 1;</script><!--$!--><template data-dgst=""></template></body></html>',
			),
		).toBe(true);
	});
});

describe('renderSsrFailureDocument', () => {
	it('renders the published service_unavailable contract as a standalone document', () => {
		const html = renderSsrFailureDocument({ retryHref: '/portfolio/x?ref=newsletter' });
		const definition = errorStateDefinition('service_unavailable');

		expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
		expect(html).toContain('<html lang="ja">');
		expect(html).toContain('data-error-state="service_unavailable"');
		expect(html).toContain('data-error-fallback="ssr-render"');
		expect(html).toContain(definition.headline);
		expect(html).toContain(definition.description);
		expect(html).toContain(definition.condition);
		expect(html).toContain('data-error-action="retry"');
		expect(html).toContain('href="/portfolio/x?ref=newsletter"');
		expect(html).toContain('data-error-action="back"');
		for (const alternative of alternativesFor('service_unavailable')) {
			expect(html).toContain(`href="${alternative.href}"`);
		}
	});

	it('is script-free and makes no outbound request', () => {
		const html = renderSsrFailureDocument();
		expect(html).not.toContain('<script');
		expect(html).not.toContain('http://');
		expect(html).not.toContain('https://');
	});

	it('does not promise the alternatives survive a generic render throw', () => {
		const html = renderSsrFailureDocument();
		const hydratedNote = errorStateDefinition('service_unavailable').alternativesNote;
		// The hydrated 503 note is a promise ("この状態の影響を受けずに開けます")
		// that only holds for a loader failure; a render throw can come from
		// shared render code, so the fallback states the weaker fact.
		expect(hydratedNote).not.toBeNull();
		expect(html).not.toContain(hydratedNote ?? '');
		expect(html).toContain(SSR_FALLBACK_ALTERNATIVES_NOTE);
		expect(html).toContain('data-error-state-alternatives-note');
	});

	it('escapes visitor-controlled hrefs and never renders a throwable', () => {
		const html = renderSsrFailureDocument({
			retryHref: '/x?next="><script>alert(1)</script>&q=%22',
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
		const visible = html.replace(/<style\b[\s\S]*?<\/style>/g, '');
		for (const needle of withheldDetailNeedles(new Error('boom'))) {
			expect(visible).not.toContain(needle);
		}
	});
});

describe('settleSsrDocumentResponse', () => {
	it('leaves a non-HTML response untouched', async () => {
		const response = new Response('{"ok":true}', {
			headers: { 'content-type': 'application/json' },
		});
		await expect(
			settleSsrDocumentResponse(new Request('https://example.com/api'), response),
		).resolves.toBe(response);
	});

	it('keeps a healthy document and its status', async () => {
		const settled = await settleSsrDocumentResponse(
			new Request('https://example.com/portfolio'),
			htmlResponse(HEALTHY_DOCUMENT, 200),
		);
		expect(settled.status).toBe(200);
		expect(await settled.text()).toBe(HEALTHY_DOCUMENT);
	});

	it('replaces a document that lost a render boundary with the readable 500 surface', async () => {
		const settled = await settleSsrDocumentResponse(
			new Request('https://example.com/portfolio/x?ref=newsletter'),
			htmlResponse(DEV_FAILED_DOCUMENT),
		);
		const html = await settled.text();

		expect(settled.status).toBe(500);
		expect(settled.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(html).toContain('data-error-state="service_unavailable"');
		expect(html).toContain('href="/portfolio/x?ref=newsletter"');
		expect(html).not.toContain('Switched to client rendering');
		expect(html).not.toContain('boom');
		expect(html).not.toContain('<template');
	});

	it('also replaces the production digest-only variant (a 200 response)', async () => {
		const settled = await settleSsrDocumentResponse(
			new Request('https://example.com/'),
			htmlResponse(PROD_FAILED_DOCUMENT, 200),
		);
		expect(settled.status).toBe(500);
		expect(await settled.text()).toContain('data-error-fallback="ssr-render"');
	});

	it('replaces a stream that rejects before a document exists', async () => {
		const failing = new Response(
			new ReadableStream({
				start(controller) {
					controller.error(new Error('stream exploded'));
				},
			}),
			{ headers: { 'content-type': 'text/html; charset=utf-8' } },
		);
		const settled = await settleSsrDocumentResponse(
			new Request('https://example.com/portfolio'),
			failing,
		);
		expect(settled.status).toBe(500);
		expect(await settled.text()).toContain('data-error-state="service_unavailable"');
	});

	it('builds the fallback response from the contract (shared with the hydrated surface)', async () => {
		const response = createSsrFailureResponse(new Request('https://example.com/about?tab=work'));
		const html = await response.text();
		expect(response.status).toBe(500);
		expect(html).toContain(errorStateDefinition('service_unavailable').headline);
		expect(html).toContain('href="/about?tab=work"');
	});
});
