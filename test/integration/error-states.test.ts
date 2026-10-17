/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	ERROR_STATE_KINDS,
	alternativesFor,
	errorStateDefinition,
	withheldDetailNeedles,
} from '../../src/editorial/error-states';

/**
 * End-to-end SSR proof for the failure surfaces (Issue #501).
 *
 * Acceptance condition: 「SSR 失敗時も真っ白なページにせず読めるメッセージを
 * 返す」. `src/editorial/error-states/error-states.test.tsx` proves the
 * components render readable markup; this file proves the WORKER answers a
 * request it cannot serve with a readable document, through the same SSR
 * pipeline production uses (`SELF.fetch` → `src/server.ts` → TanStack
 * Start → `getRouter()` defaults).
 *
 * It is the only layer that can catch the WIRING being removed: the
 * components keep passing their own tests with `defaultNotFoundComponent` /
 * `defaultErrorComponent` deleted from `src/router.tsx`, and the framework
 * silently falls back to `<p>Not Found</p>` / a dev-only "Something went
 * wrong!" page.
 *
 * Nothing here touches production, a remote binding, or a secret value:
 * the requests are anonymous GETs against the in-process Worker.
 */

/** A portfolio slug that satisfies `SlugSchema` but matches no row. */
const UNKNOWN_PROJECT_SLUG = 'issue-501-nonexistent-slug';
const UNMATCHED_PATH = '/this-route-does-not-exist-501';

async function fetchHtml(path: string): Promise<{ status: number; html: string }> {
	const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual' });
	return { status: res.status, html: await res.text() };
}

/** The failure kind a served document actually rendered, if any. */
function servedState(html: string): string | null {
	return /data-error-state="([a-z_]+)"/.exec(html)?.[1] ?? null;
}

/**
 * The part of the document a visitor READS: every `<script>` body removed.
 *
 * TanStack Start serialises the router state into `$_TSR`, and its
 * `ShallowErrorPlugin` embeds a failed match's `error.message` there. That is a
 * framework behaviour this Issue cannot change from a component (there is no
 * serializer hook outside a custom `startInstance`, which AGENTS.md §2 forbids
 * without an ADR), so it is measured and recorded separately rather than
 * pretended away. What an error state owns — and what the acceptance
 * condition is about — is the rendered document.
 */
function visibleDocument(html: string): string {
	return html.replace(/<script\b[\s\S]*?<\/script>/g, '');
}

/** The hydration payload scripts, as served. */
function hydrationPayload(html: string): string {
	return [...html.matchAll(/<script\b[\s\S]*?<\/script>/g)].map((match) => match[0]).join('\n');
}

describe('failure surfaces over the real SSR pipeline (Issue #501)', () => {
	beforeAll(async () => {
		// The first SSR request in a Worker instance pays for building the
		// route tree, the manifest and the styles; under a saturated host
		// that alone can exceed the default 5 s per-test budget.
		await SELF.fetch('https://example.com/tools', { redirect: 'manual' });
	}, 60_000);

	it('answers an unmatched route with the readable 404 document, not a blank page', async () => {
		const { status, html } = await fetchHtml(UNMATCHED_PATH);
		expect(status).toBe(404);
		expect(html).toContain('<!DOCTYPE html>');
		expect(servedState(html)).toBe('not_found');
		const definition = errorStateDefinition('not_found');
		expect(html).toContain(definition.headline);
		expect(html).toContain(definition.description);
		expect(html).toContain(definition.statusLabel);
		// Recovery affordances survive the stream: the back link and every
		// offered surface are plain anchors in the served document.
		expect(html).toContain('data-error-action="back"');
		for (const alternative of alternativesFor('not_found')) {
			expect(html).toContain(`href="${alternative.href}"`);
		}
	});

	it('replaces the router default not-found string with the designed state', async () => {
		const { html } = await fetchHtml(UNMATCHED_PATH);
		// TanStack's default is a bare `<p>Not Found</p>`; the designed state
		// IS the acceptance condition, so its absence is the regression guard.
		expect(html).not.toContain('<p>Not Found</p>');
		expect(html).toContain('ページが見つかりません');
	});

	it('publishes no withheld runtime detail in the document the visitor reads', async () => {
		const { html } = await fetchHtml(UNMATCHED_PATH);
		const visible = visibleDocument(html);
		for (const needle of withheldDetailNeedles()) {
			expect(visible).not.toContain(needle);
		}
		// No invented visitor identity: a failure document carries no address,
		// account or session hint of any kind.
		expect(visible).not.toContain('mailto:');
		expect(visible).toContain('<h1');
	});

	it('answers a loader failure with the 503 surface instead of a blank page', async () => {
		// Why this request fails, exactly: the vitest pool applies only the
		// Better Auth + invitation schema (`vitest.config.ts#setupFiles`), so
		// `portfolio_project` does not exist in the local D1 and
		// `loadPortfolioProject` throws `D1_ERROR: no such table`. That is a
		// REAL loader failure on the REAL SSR pipeline — precisely the
		// condition the 503 surface exists for. If the test pool ever grows
		// the portfolio schema this request becomes a 404 and the assertion
		// below has to move to the not-found case, not be deleted.
		const { status, html } = await fetchHtml(`/portfolio/${UNKNOWN_PROJECT_SLUG}`);
		expect(status).toBeGreaterThanOrEqual(400);
		const state = servedState(html);
		expect(ERROR_STATE_KINDS).toContain(state);
		expect(html).not.toContain('Something went wrong!');
		expect(html).toContain(errorStateDefinition(state as 'not_found').headline);
		expect(html).toContain('<h1');
		// The retry affordance must exist in the SERVED document, so a visitor
		// without JavaScript still has a way back.
		expect(html).toContain('data-error-action="retry"');
		expect(html).toContain(`href="/portfolio/${UNKNOWN_PROJECT_SLUG}"`);
	});

	it('never renders the throwable that produced the failure', async () => {
		// Before this Issue the framework's own error page printed the message
		// in a `<pre>` block (`D1_ERROR: no such table: portfolio_project`).
		const { html } = await fetchHtml(`/portfolio/${UNKNOWN_PROJECT_SLUG}`);
		const visible = visibleDocument(html);
		expect(html).not.toContain('Something went wrong!');
		expect(visible).not.toContain('D1_ERROR');
		expect(visible).not.toContain('portfolio_project');
		expect(visible).not.toContain('SQLITE');
		expect(visible).not.toContain('<pre');
		for (const needle of withheldDetailNeedles()) {
			expect(visible).not.toContain(needle);
		}
	});

	it('pins the framework payload boundary: message only, never a stack', async () => {
		// Recorded limitation (see `docs/verification/ops/error-state-gallery.md`):
		// the SSR hydration payload `$_TSR` embeds the failed match's
		// `error.message` through TanStack's `ShallowErrorPlugin`. Nothing this
		// Issue owns renders it, and the stack / `cause` never serialise — but
		// the message IS in the page source. Pinning it here means a framework
		// upgrade that starts redacting it (or starts shipping more) fails a
		// test instead of silently changing the published-information surface.
		const { html } = await fetchHtml(`/portfolio/${UNKNOWN_PROJECT_SLUG}`);
		const payload = hydrationPayload(html);
		// `ShallowErrorPlugin` serialises exactly `{ message }`: the payload
		// carries one `new Error("…")` whose argument is the loader's message
		// and nothing else.
		const serialized = /new Error\((".*?")\)/.exec(payload)?.[1];
		expect(serialized).toBe('"D1_ERROR: no such table: portfolio_project: SQLITE_ERROR"');
		expect([...payload.matchAll(/new Error\(/g)]).toHaveLength(1);
		// No stack frames and no nested `cause` travel with it.
		expect(payload).not.toMatch(/\n\s+at /);
		expect(payload).not.toContain('cause');
	});

	it('lets a route-specific 404 win over the shared surface', async () => {
		// `/tools/$slug` declares its own `notFoundComponent` (Issue #183). The
		// router-wide default must not swallow the Tool-specific copy.
		const { status, html } = await fetchHtml('/tools/no-such-tool-slug-501');
		expect(status).toBe(404);
		expect(servedState(html)).toBeNull();
		expect(html).toContain('data-testid="tools-not-found"');
	});

	it('does not change the status of a route that still works', async () => {
		// A failure boundary must not turn healthy routes into failures.
		const { status, html } = await fetchHtml('/tools');
		expect(status).toBe(200);
		expect(servedState(html)).toBeNull();
	});

	it('keeps the failure document revalidating rather than storable', async () => {
		// `src/server.ts#applyHtmlCachePolicy` sets `no-cache` for HTML
		// responses outside `/admin`. The 404 document is HTML and must
		// inherit that policy, or a visitor could keep a stale failure.
		const res = await SELF.fetch(`https://example.com${UNMATCHED_PATH}`, { redirect: 'manual' });
		expect(res.headers.get('cache-control')).toBe('no-cache');
	});
});
