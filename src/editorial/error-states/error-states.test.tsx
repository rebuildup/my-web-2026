import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DependencyFailureState } from './DependencyFailureState';
import { NotFoundState } from './NotFoundState';
import { ServiceUnavailableState } from './ServiceUnavailableState';
import {
	DEPENDENCY_FREE_SURFACES,
	ERROR_STATE_KINDS,
	PUBLIC_SURFACE_DEPENDENCIES,
	alternativesFor,
	errorStateDefinition,
	withheldDetailNeedles,
} from './contract';

/**
 * SSR markup contract for the failure surfaces (Issue #501).
 *
 * Acceptance condition under test: 「SSR 失敗時も真っ白なページにせず読める
 * メッセージを返す」. The renderer here is `react-dom/server` — the same
 * renderer the Worker uses — so a state that renders readable markup in
 * this suite renders readable markup in a streamed document.
 *
 * Each state is rendered WITH a realistic throwable in scope and then
 * asserted to publish none of it: the components accept no `error` prop,
 * which is the structural reason a surface cannot leak, and these
 * assertions are the behavioural guard on that reason.
 */

const RUNTIME_ERROR = Object.assign(
	new Error('D1_ERROR: SELECT count FROM access_counter failed — near "SELECCT"'),
	{
		stack: 'Error: D1_ERROR\n    at getHomeCounter (src/home/access/load.ts:42:9)',
		cause: new Error('SQLITE_ERROR: no such table: access_counter'),
	},
);

const FAILURE_KINDS = ['service_unavailable', 'dependency_failure'] as const;

/** The URL a failed request is retried against (search string included). */
const FAILED_URL = '/portfolio/issue-501-nonexistent-slug?ref=newsletter';

function renderFor(kind: (typeof ERROR_STATE_KINDS)[number]): string {
	// Props wired the way `src/router.tsx` wires them.
	const props = { retryHref: '/portfolio', backHref: '/' };
	if (kind === 'not_found') return renderToStaticMarkup(<NotFoundState {...props} />);
	if (kind === 'service_unavailable') {
		return renderToStaticMarkup(<ServiceUnavailableState {...props} />);
	}
	return renderToStaticMarkup(<DependencyFailureState {...props} />);
}

function elementFor(
	kind: (typeof ERROR_STATE_KINDS)[number],
	props: { retryHref?: string; backHref?: string },
): ReactElement {
	if (kind === 'not_found') return <NotFoundState {...props} />;
	if (kind === 'service_unavailable') return <ServiceUnavailableState {...props} />;
	return <DependencyFailureState {...props} />;
}

interface HostElement {
	type: string;
	props: Record<string, unknown>;
}

/**
 * Flatten a rendered surface to its host elements.
 *
 * `renderToStaticMarkup` proves what a visitor READS, but React never
 * serialises an event handler, so markup cannot show whether a control
 * would swallow its own click — which is exactly the defect the review
 * found (a wired retry called `preventDefault()` and then did nothing).
 *
 * Nothing under `src/editorial/error-states/` uses a hook, so calling the
 * function components directly is safe and yields the props React hands
 * to the DOM. If a hook is ever added here, this walk fails loudly and
 * the assertion moves to a DOM test.
 */
function hostElements(node: ReactNode): HostElement[] {
	if (Array.isArray(node)) return node.flatMap(hostElements);
	if (!isValidElement(node)) return [];
	const element = node as ReactElement<Record<string, unknown>>;
	const children = hostElements(element.props.children as ReactNode);
	if (typeof element.type === 'string')
		return [{ type: element.type, props: element.props }, ...children];
	// A fragment (`<>…</>`) owns nothing; its children carry the markup.
	if (typeof element.type === 'symbol') return children;
	const Component = element.type as (props: Record<string, unknown>) => ReactNode;
	return hostElements(Component(element.props));
}

/** Every anchor that is a recovery control, not an alternative link. */
function recoveryAnchors(kind: (typeof ERROR_STATE_KINDS)[number], props: object): HostElement[] {
	const anchors = hostElements(elementFor(kind, props)).filter((element) => element.type === 'a');
	return anchors.filter((anchor) => 'data-error-action' in anchor.props);
}

/** Hrefs of the anchors that carry `data-error-action="<action>"`. */
function hrefsForAction(html: string, action: string): string[] {
	return [...html.matchAll(/<a\b[^>]*>/g)]
		.map((match) => match[0])
		.filter((tag) => tag.includes(`data-error-action="${action}"`))
		.map((tag) => /href="([^"]*)"/.exec(tag)?.[1] ?? '');
}

/** Recovery actions in the order the document renders them. */
function recoveryOrder(html: string): string[] {
	return [...html.matchAll(/data-error-action="(back|retry)"/g)].map((match) => match[1]);
}

describe('error-state SSR markup (Issue #501)', () => {
	it.each(ERROR_STATE_KINDS)('%s renders a readable document, not a blank page', (kind) => {
		const html = renderFor(kind);
		const definition = errorStateDefinition(kind);
		expect(html).toContain(`data-error-state="${kind}"`);
		expect(html).toContain(`data-testid="error-state-${kind}"`);
		// The headline is the document's own <h1> plus body text, so the
		// message survives with styling, webfonts and JavaScript all absent.
		expect(html).toContain('<h1');
		expect(html).toContain(definition.headline);
		expect(html).toContain(definition.description);
		expect(html).toContain(definition.statusLabel);
		// Length floor: a state that collapsed to a bare status code would
		// still satisfy the assertions above.
		expect(html.length).toBeGreaterThan(1_000);
	});

	it.each(ERROR_STATE_KINDS)('%s publishes none of the withheld runtime detail', (kind) => {
		const html = renderFor(kind);
		for (const needle of withheldDetailNeedles(RUNTIME_ERROR)) {
			expect(html).not.toContain(needle);
		}
		// Identity / traffic: a failure surface publishes no visitor state.
		expect(html).not.toContain('mailto:');
		expect(html).not.toContain('@');
	});

	it.each(ERROR_STATE_KINDS)('%s renders exactly the recovery actions it declares', (kind) => {
		const html = renderFor(kind);
		const declared = errorStateDefinition(kind).recovery.filter(
			(action) => action !== 'alternative',
		);
		expect(recoveryOrder(html)).toEqual(declared);
		expect(hrefsForAction(html, 'alternative').length).toBe(alternativesFor(kind).length);
	});

	it('the 404 surface offers back + alternatives and no retry control', () => {
		const html = renderFor('not_found');
		expect(hrefsForAction(html, 'back')).toEqual(['/']);
		expect(hrefsForAction(html, 'retry')).toEqual([]);
		expect(html).toContain('aria-label="復旧 / Recovery"');
		expect(html).toContain('ホームへ戻る / Back to home');
	});

	it.each(ERROR_STATE_KINDS)('%s names its region with the headline it renders', (kind) => {
		// The heading id is only meaningful if something references it.
		const html = renderFor(kind);
		expect(html).toContain(`aria-labelledby="error-state-${kind}-heading"`);
		expect(html).toContain(`aria-describedby="error-state-${kind}-description"`);
		expect(html).toContain(`id="error-state-${kind}-heading"`);
		expect(html).toContain(`id="error-state-${kind}-description"`);
	});

	it.each(FAILURE_KINDS)('%s wires no click handler on any recovery control', (kind) => {
		// Post-hydration behaviour, pinned. A retry that calls
		// `event.preventDefault()` has to re-run the failed request itself;
		// the framework's `CatchBoundary#reset` cannot, so the click became a
		// no-op that also suppressed the one navigation that worked. The
		// contract is now that no control carries a handler, so every control
		// is a real navigation before hydration, after it, and without JS.
		const anchors = recoveryAnchors(kind, { retryHref: FAILED_URL, backHref: '/' });
		expect(anchors.length).toBeGreaterThan(0);
		for (const anchor of anchors) {
			expect(anchor.props.onClick).toBeUndefined();
			expect(typeof anchor.props.href).toBe('string');
		}
	});

	it('the retry anchor re-requests the failed URL, query string included', () => {
		// `src/router.tsx` passes `${pathname}${searchStr}`: retrying
		// `/portfolio/x?ref=newsletter` must not drop `?ref=newsletter`,
		// which some loaders read (and an admin link needs).
		const retry = recoveryAnchors('service_unavailable', {
			retryHref: FAILED_URL,
			backHref: '/',
		}).find((anchor) => anchor.props['data-error-action'] === 'retry');
		expect(retry?.props.href).toBe(FAILED_URL);
	});

	it.each(FAILURE_KINDS)('%s offers its retry as a plain document navigation', (kind) => {
		const html = renderFor(kind);
		// The retry anchor carries no handler, so the browser performs the
		// navigation — with scripting disabled as well as enabled.
		expect(hrefsForAction(html, 'retry')).toEqual(['/portfolio']);
		expect(html).toContain('再試行する / Try again');
		expect(hrefsForAction(html, 'back')).toEqual(['/']);
	});

	it.each(ERROR_STATE_KINDS)('%s links every offered surface and no other one', (kind) => {
		const offered = alternativesFor(kind).map((link) => link.href);
		expect(hrefsForAction(renderFor(kind), 'alternative')).toEqual(offered);
	});

	it.each(FAILURE_KINDS)('%s offers only dependency-free surfaces, and says why', (kind) => {
		const html = renderFor(kind);
		expect(html).toContain(errorStateDefinition(kind).alternativesNote ?? ' ');
		expect(hrefsForAction(html, 'alternative')).toEqual([...DEPENDENCY_FREE_SURFACES]);
		// Home, Portfolio and About read a binding at render time
		// (contract#PUBLIC_SURFACE_DEPENDENCIES), so offering them during an
		// outage would be a promise the platform cannot keep.
		for (const href of ['/portfolio', '/about']) {
			expect(hrefsForAction(html, 'alternative')).not.toContain(href);
		}
	});

	it('only the failure states describe an unavailable system', () => {
		// The 404 copy must not borrow the outage wording, and vice versa.
		expect(renderFor('not_found')).not.toContain('システムの一部');
		expect(renderFor('service_unavailable')).toContain('システムの一部');
		expect(renderFor('dependency_failure')).toContain('データの取得に失敗');
	});

	it('every state is reachable through a per-kind component', () => {
		expect(typeof NotFoundState).toBe('function');
		expect(typeof ServiceUnavailableState).toBe('function');
		expect(typeof DependencyFailureState).toBe('function');
	});
});
