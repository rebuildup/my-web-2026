/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import accessCounterSql from '../../migrations/0002_access_counter.sql?raw';
import reactionsSql from '../../migrations/0003_reactions.sql?raw';
import emojiCatalogSql from '../../migrations/0004_emoji_catalog.sql?raw';
import accessCounterPrincipalSql from '../../migrations/0005_access_counter_principal.sql?raw';
import portfolioSql from '../../migrations/0007_portfolio.sql?raw';
import manifestJson from '../../quality/html-standards.json';
import {
	evaluateRoutes as evaluateRoutesUntyped,
	severitiesFrom as severitiesFromUntyped,
	validateHtml as validateHtmlUntyped,
} from '../../scripts/html-standards-contract.mjs';
import { seedPortfolioRow } from './fixtures/portfolio-d1';

/**
 * SSR HTML conformance gate (Issue #412).
 *
 * This is the CI half of the gate. It drives the REAL Worker through
 * `SELF.fetch`, hands the SSR document every representative route
 * renders to the same engine
 * (`scripts/html-standards-contract.mjs`) that
 * `scripts/check-html-standards.mjs` runs offline and that
 * `--live <baseUrl>` runs against a server, and fails when any
 * error-level finding survives the manifest's severity policy.
 * One engine, three front-ends: a rule cannot pass here and fail there.
 *
 * Why `SELF.fetch` and not a route-module unit test
 * -------------------------------------------------
 * A component test asserts what a component returns; the DEFECTS this
 * gate looks for (a `div` inside a `<p>`, a duplicated `id` across two
 * islands of the page, an `aria-labelledby` that points at nothing) only
 * exist once the document is assembled and streamed. That assembly is the
 * part that breaks silently: the page still renders, the screenshot still
 * looks right, and only the accessibility tree is wrong.
 *
 * Why the manifest owns the roster
 * --------------------------------
 * Routes are not hand-listed here: the roster, the per-rule severity and
 * the waiver ledger come from `quality/html-standards.json`, and the same
 * file is checked against `src/routes/**` by the offline half
 * (`pnpm run html:standards:check`). A route that appears without a
 * manifest entry fails offline, so "nobody validated this page" cannot be
 * a state the repository can sit in.
 *
 * No silent passes
 * ----------------
 *   - A declared renderable route with no observation is
 *     `route.unobserved` — a FAILURE, not a skip.
 *   - A request that errored, a non-2xx, or a non-`text/html` response
 *     are failures: the metadata rules are never evaluated against a
 *     document that does not exist, and a document that does not exist is
 *     not a passing document.
 *   - The negative controls at the bottom feed the engine the committed
 *     invalid fixture and a real SSR document with a defect injected into
 *     it, and assert both are reported. A gate that cannot fail is not a
 *     gate, and an engine that only recognises its own fixtures is not
 *     checking anything.
 *
 * Data: the routes read D1 (home counter + reactions, `/about` and
 * `/portfolio` read the portfolio tables), so the suite applies the real
 * migration files through `?raw` imports and seeds one public portfolio
 * row. Nothing is fetched from production and no secret is read.
 *
 * Which SSR state this covers — and which it does not
 * ----------------------------------------------------
 * The Worker runs here without `HOME_API_KEY`, so `/api/v1/access/count`
 * and the reactions endpoints answer 401 and the home document renders
 * their FAILURE fallbacks rather than the live numbers and the live emoji
 * list. What is validated is therefore the failure-state document: the
 * shell, the nav, the editorial primitives, the picker's SSR markup (the
 * three shipped waivers match it, or this suite would fail with
 * `waiver.unused`), the portfolio documents and the design-system route.
 * The success-state markup of the counter and the reaction list is NOT
 * covered here; it is what `--live <baseUrl>` against a running server
 * covers. Seeding a valid API key into workerd is not done here on
 * purpose: a test that depends on a credential is a test that silently
 * stops covering the document.
 */

type Severity = 'error' | 'warning';

/** One engine message, in the shape `validateHtml` returns. */
type HtmlMessage = {
	rule: string;
	message: string;
	line: number;
	col: number;
	severity: Severity;
	nuType: string;
};

type HtmlStats = {
	elements: number;
	attributes: number;
	ids: number;
	doctype: string | null;
	errors: number;
	warnings: number;
};

/** One route-level finding, in the shape `evaluateRoutes` returns. */
type Finding = {
	rule: string;
	severity: Severity;
	route_id: string | null;
	path: string | null;
	line?: number;
	message: string;
	waived?: boolean;
	waiver_reason?: string;
};

type Observation = {
	routeId: string;
	path: string;
	status: number | null;
	html: string;
	contentType: string | null;
	requestFailed: boolean;
	note?: string;
};

/**
 * The engine is plain `.mjs` with JSDoc types, and TypeScript resolves
 * those composite returns to `object`. The shapes are declared here
 * instead of imported, so a change to the engine's return value is a type
 * error in this suite rather than a silent `any` at every call site.
 */
const validateHtml = validateHtmlUntyped as unknown as (
	html: string,
	options?: { severities?: Record<string, Severity>; routeId?: string },
) => { messages: HtmlMessage[]; stats: HtmlStats };

const evaluateRoutes = evaluateRoutesUntyped as unknown as (input: {
	manifest: { routes: unknown[]; waivers?: unknown[] };
	observations: Observation[];
	severities?: Record<string, Severity>;
}) => {
	rows: Array<Record<string, unknown>>;
	findings: Finding[];
	stats: { routes: number; rendered: number; excluded: number; errors: number; warnings: number };
};

const severitiesFrom = severitiesFromUntyped as unknown as (manifest: {
	rules: Record<string, { severity: Severity }>;
}) => Record<string, Severity>;

type Manifest = {
	profile: string;
	routes: Array<{
		route_id: string;
		path: string;
		mode: 'render' | 'excluded';
		why?: string;
		reason?: string;
	}>;
	fixtures: { valid: string; invalid: string };
	waivers: Array<{ route_id?: string; rule: string; reason: string; message_pattern?: string }>;
	rules: Record<string, { severity: Severity; nu_type: string; reason: string }>;
};

const manifest = manifestJson as unknown as Manifest;
const severities = severitiesFrom(manifest);

/** The route this suite asserts renders an anonymously reachable document. */
const RENDERABLE = manifest.routes.filter((route) => route.mode === 'render');

/**
 * Split a migration file into statements.
 *
 * The migrations are plain `CREATE TABLE` / `CREATE INDEX` files with no
 * trigger bodies, so stripping `--` comments and splitting on `;` is
 * enough — and reading the real files (instead of an inline copy that
 * must "stay byte-identical") is why this suite needs no schema fixture
 * at all.
 */
function statements(sql: string): string[] {
	return sql
		.replace(/--[^\n]*/g, '')
		.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean);
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, [
		{
			name: 'issue-412-fixture',
			queries: [
				...statements(accessCounterSql),
				...statements(accessCounterPrincipalSql),
				...statements(reactionsSql),
				...statements(emojiCatalogSql),
				...statements(portfolioSql),
			],
		},
	]);

	// One public, published row, so `/about` and `/portfolio/<slug>`
	// render a real document instead of an empty state. The slug is the
	// one `DYNAMIC_ROUTE_SAMPLES` / the Playwright specs already use.
	await seedPortfolioRow(env.DB, 'my-web-2026');
});

/** Fetch one route through the real SSR pipeline. */
async function observe(path: string) {
	try {
		const response = await SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' });
		return {
			status: response.status,
			contentType: response.headers.get('content-type'),
			html: await response.text(),
			requestFailed: false,
		};
	} catch (error) {
		return {
			status: null,
			contentType: null,
			html: '',
			requestFailed: true,
			note: error instanceof Error ? error.message : String(error),
		};
	}
}

describe('SSR HTML conformance (Issue #412)', () => {
	it('declares at least one renderable route, or the gate would prove nothing', () => {
		expect(RENDERABLE.length).toBeGreaterThan(0);
		expect(
			manifest.routes.every((route) =>
				route.mode === 'excluded' ? Boolean(route.reason) : Boolean(route.why),
			),
		).toBe(true);
	});

	it('every renderable route returns a valid HTML document', async () => {
		const observations: Observation[] = [];
		for (const route of RENDERABLE) {
			const observation = await observe(route.path);
			observations.push({ routeId: route.route_id, path: route.path, ...observation });
		}

		const result = evaluateRoutes({ manifest, observations, severities });

		// The failure message has to be readable in CI output: a rule id
		// plus the route and the line is what a reader needs to fix it.
		// Waived findings are still printed — a waiver is a reviewable
		// statement, not a hidden one.
		const summary = result.findings
			.map(
				(finding) =>
					`${finding.waived ? 'WAIVED' : finding.severity} ${finding.rule} ${
						finding.path ?? ''
					}${finding.line ? `:${finding.line}` : ''} — ${finding.message}${
						finding.waived ? ` [waiver: ${finding.waiver_reason}]` : ''
					}`,
			)
			.join('\n');
		const blocking = result.findings.filter(
			(finding) => !finding.waived && finding.severity === 'error',
		);
		const warned = result.findings.filter(
			(finding) => !finding.waived && finding.severity === 'warning',
		);
		// The gate fails on error-level findings only; warnings and waived
		// findings are asserted separately below, so this assertion stays the
		// one thing a reader scans in CI output. `summary` is the failure
		// message, so a red run prints the waived findings too — a waiver is
		// a reviewable statement, not a hidden one.
		expect(
			blocking
				.map((finding) => `${finding.rule} ${finding.path ?? ''}: ${finding.message}`)
				.join('\n'),
			summary,
		).toBe('');
		expect(result.stats.errors).toBe(0);
		// The count of warnings is deliberately NOT pinned: `heading-level-skip`
		// is a warning by policy, so a future route that skips a level must
		// not redden `validate`. WHICH rules may appear as a non-blocking
		// finding is pinned instead, so a new non-blocking rule fails here.
		expect([...new Set(warned.map((finding) => finding.rule))]).toEqual([
			'html.heading-level-skip',
		]);
	}, 60_000);

	it('reports every non-waived finding a reader has to look at', async () => {
		// Severity is policy, not folklore: `quality/html-standards.json`
		// decides which rules block. The current policy leaves exactly one
		// non-blocking finding on the live documents (the `<h3>` project
		// card under the `<h1>` page heading on /portfolio), and this
		// assertion pins that list so a NEW warning cannot appear silently.
		const { html } = await observe('/portfolio');
		const parsed = validateHtml(html, { severities });
		const nonBlocking = parsed.messages
			.filter((message) => message.severity !== 'error')
			.map((message) => `${message.rule}: ${message.message}`);
		expect(nonBlocking).toEqual(['heading-level-skip: Heading level should be h2 before h3.']);
	}, 60_000);

	it('a rendered document is a real document, not an error fallback', async () => {
		for (const route of RENDERABLE) {
			const { html } = await observe(route.path);
			const parsed = validateHtml(html, { severities });
			expect(parsed.stats.elements, `${route.path} rendered an empty document`).toBeGreaterThan(20);
			expect(html, `${route.path} rendered an SSR error fallback`).toContain('<!DOCTYPE html>');
		}
	}, 60_000);
});

describe('negative controls — the gate has to be able to fail', () => {
	it('the committed invalid fixture is reported by this engine', async () => {
		const { default: fixture } = await import(
			'../../test/fixtures/html-standards/invalid-page.html?raw'
		);
		const parsed = validateHtml(fixture, { severities });
		const rules = new Set(parsed.messages.map((message) => message.rule));
		expect(parsed.stats.errors).toBeGreaterThan(0);
		expect(rules.has('duplicate-id')).toBe(true);
		expect(rules.has('invalid-nesting')).toBe(true);
		expect(rules.has('unknown-attribute')).toBe(true);
	});

	it('a defect injected into a real SSR document is detected', async () => {
		const { html } = await observe('/');
		expect(html.length).toBeGreaterThan(1000);

		// Duplicating the first id in the document is the smallest possible
		// injection, and it must produce a duplicate-id finding on markup
		// this Worker actually emits.
		const match = html.match(/ id="([^"]+)"/);
		expect(match, 'the home document carries no id at all').not.toBeNull();
		const id = match?.[1] as string;
		const injected = html
			.replace(`id="${id}"`, `id="${id}"`)
			.replace('</body>', `<span id="${id}">duplicate</span></body>`);
		expect(injected).not.toBe(html);

		const parsed = validateHtml(injected, { severities });
		const duplicates = parsed.messages.filter((message) => message.rule === 'duplicate-id');
		expect(duplicates.length).toBeGreaterThan(0);
		expect(duplicates[0]?.message).toContain(id);
	}, 60_000);

	it('a route nobody observed is an error, not a skip', () => {
		const result = evaluateRoutes({
			manifest: { ...manifest, routes: RENDERABLE },
			observations: [],
			severities,
		});
		const routeFindings = result.findings.filter((finding) => finding.route_id !== null);
		expect(routeFindings.length).toBe(RENDERABLE.length);
		expect(routeFindings.every((finding) => finding.rule === 'route.unobserved')).toBe(true);
		// The shipped waivers cannot match anything here, which is itself a
		// failure: `waiver.unused` is what keeps the ledger from collecting
		// entries that quietly do nothing.
		expect(result.findings.some((finding) => finding.rule === 'waiver.unused')).toBe(true);
		expect(result.stats.errors).toBeGreaterThan(0);
	});

	it('a non-HTML response is an error, not a silent pass', () => {
		const result = evaluateRoutes({
			manifest: { ...manifest, routes: RENDERABLE.slice(0, 1) },
			observations: [
				{
					routeId: RENDERABLE[0]?.route_id as string,
					path: RENDERABLE[0]?.path as string,
					status: 200,
					html: '{"ok":true}',
					contentType: 'application/json',
					requestFailed: false,
				},
			],
			severities,
		});
		expect(result.findings.some((finding) => finding.rule === 'route.not-html')).toBe(true);
	});
});
