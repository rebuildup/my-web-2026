import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDITED_ROUTES, AXE_TAGS, SKIPPED_ROUTES } from './axe-manifest';

/**
 * Public-route axe-core scan (Issue #393).
 *
 * What this spec pins
 * -------------------
 * The static gates (#396 / #397 / #398 / #399) read the SOURCE. This
 * spec reads the RENDERED document: it opens every route listed in
 * `e2e/a11y/axe-manifest.ts` in a real browser and asks axe-core
 * whether the page a visitor actually receives violates WCAG 2.2
 * A / AA.
 *
 * Three things are asserted, per route:
 *
 *   1. the route RESOLVES (HTTP 200) and publishes the document title
 *      the manifest declares — a 404 page or an error boundary must
 *      never be measured and reported as "the route is accessible";
 *   2. the verdict the manifest DECLARES equals the verdict the scan
 *      MEASURED — so the manifest cannot drift away from reality
 *      without the gate going red;
 *   3. the known-violation ledger (`e2e/a11y/axe-baseline.json`) is
 *      neither incomplete nor stale:
 *        - a violation that is NOT in the ledger → FAIL (a new
 *          violation must drop the release candidate);
 *        - a ledger record that matches no observed violation → FAIL
 *          (a stale ledger would let somebody delete every record and
 *          turn the gate permanently green).
 *
 * The audit target set (the manifest is the authority; this list is
 * the ledger's evidence path, and `quality/route-coverage.json`
 * cross-checks that the two agree):
 *
 *   "/"  "/about"  "/keyboard"  "/contact"  "/portfolio"
 *   "/portfolio/my-web-2026"  "/projects/dotfiles"  "/tools"
 *   "/design-system"  "/admin/login"
 *
 * Where the scan runs
 * -------------------
 * Against the LOCAL preview server only (`playwright.config.ts`
 * `webServer` → `scripts/e2e-local-bootstrap.mjs`). The canonical
 * production origin is never called from this spec: a release gate
 * that reads production would measure a deployment, not the release
 * candidate, and a violation must fail the build before it ships.
 * The guard below makes that a hard rule instead of a convention.
 *
 * Machine-checked vs human-evaluated
 * ---------------------------------
 * Machine-checked here: whether a rule fires, which rule id it is,
 * and which element fired it. Human-evaluated (NOT decided here):
 * whether the visual result is acceptable, whether the alternative
 * text is good, and whether a recorded violation may stay recorded.
 * See `docs/verification/a11y/axe-route-report.md`.
 */

interface AxeNode {
	/** The element selector axe produced for the failing node. */
	target: string;
	/** The element's outer HTML (truncated by the browser). */
	html?: string;
	/** axe's own explanation for the node. */
	summary?: string;
}

interface AxeViolation {
	/** The rule id (`id` in axe-core 4.x, `ruleId` in older builds). */
	ruleId: string;
	impact?: string;
	help?: string;
	tags: string[];
	nodes: AxeNode[];
}

interface BaselineRecord {
	route: string;
	ruleId: string;
	nodes: string[];
	reason: string;
	recordedAt: string;
}

interface BaselineLedger {
	version: number;
	records: BaselineRecord[];
}

const require = createRequire(import.meta.url);
const AXE_SOURCE: string = require('axe-core').source;

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'axe-baseline.json');

const baseline: BaselineLedger = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

/**
 * Normalise a selector so a React-generated id cannot break the match.
 *
 * React's `useId` produces ids like `_R_4b6_-platform-macos`, which
 * differ between builds. The ledger has to survive a rebuild, so the
 * generated part is replaced by a placeholder before the selector is
 * compared. Everything else — tag, class, structure — is kept, so a
 * new element of the same shape is still a new violation.
 */
function normalizeSelector(selector: string): string {
	return selector
		.replace(/_R_[A-Za-z0-9]+_/g, '«id»')
		.replace(/«[^»]*»/g, '«id»')
		.replace(/:r[0-9a-z]+:/g, '«id»:');
}

/** The nodes of one observed violation, normalised for ledger matching. */
function observedNodes(violation: AxeViolation): string[] {
	return violation.nodes.map((node) => normalizeSelector(node.target));
}

/**
 * Which observed violations the ledger already records.
 *
 * A violation node is "known" when a ledger record for the same
 * route and the same rule lists the same normalised selector.
 */
function matchBaseline(
	violation: AxeViolation,
	route: string,
	records: BaselineRecord[],
): { known: string[]; unknown: string[] } {
	const known: string[] = [];
	const unknown: string[] = [];
	for (const node of observedNodes(violation)) {
		const matched = records.some(
			(record) =>
				record.route === route && record.ruleId === violation.ruleId && record.nodes.includes(node),
		);
		if (matched) known.push(node);
		else unknown.push(node);
	}
	return { known, unknown };
}

/** The ledger records that belong to one route. */
function recordsForRoute(route: string, records: BaselineRecord[]): BaselineRecord[] {
	return records.filter((record) => record.route === route);
}

/**
 * The verdict a route's measurement produces.
 *
 * `fail` when at least one observed node is not in the ledger, else
 * `baseline` when the route has violations at all, else `pass`.
 */
function verdictFor(violations: AxeViolation[], route: string, records: BaselineRecord[]): string {
	const unknown = violations.flatMap(
		(violation) => matchBaseline(violation, route, records).unknown,
	);
	if (unknown.length > 0) return 'fail';
	return violations.length > 0 ? 'baseline' : 'pass';
}

/** Ledger records that no observed violation supports any more. */
function staleRecords(
	violations: AxeViolation[],
	route: string,
	records: BaselineRecord[],
): BaselineRecord[] {
	const observed = new Set<string>();
	for (const violation of violations) {
		for (const node of observedNodes(violation)) {
			observed.add(`${violation.ruleId}::${node}`);
		}
	}
	return recordsForRoute(route, records).filter(
		(record) =>
			!record.nodes.some((node) => observed.has(`${record.ruleId}::${normalizeSelector(node)}`)),
	);
}

/**
 * Run axe-core over the rendered document.
 *
 * The axe bundle is injected as an init script, so the scan runs
 * against the same document a visitor receives. Only violations are
 * collected (`resultTypes: ['violations']`) — the passes are not
 * evidence the gate needs, and they make the report unreadable.
 */
async function scan(page: import('@playwright/test').Page): Promise<AxeViolation[]> {
	return page.evaluate(
		async (tags) => {
			interface RawNode {
				target: string[] | string;
				html?: string;
				failureSummary?: string;
			}
			interface RawViolation {
				id?: string;
				ruleId?: string;
				impact?: string;
				help?: string;
				tags: string[];
				nodes: RawNode[];
			}
			interface AxeApi {
				run: (
					context: Document,
					options: { runOnly: { type: string; values: string[] }; resultTypes: string[] },
				) => Promise<{ violations: RawViolation[] }>;
			}
			const api = (globalThis as unknown as { axe: AxeApi }).axe;
			const result = await api.run(document, {
				runOnly: { type: 'tag', values: tags },
				resultTypes: ['violations'],
			});
			return result.violations.map((violation) => ({
				ruleId: violation.id ?? violation.ruleId ?? 'unknown',
				impact: violation.impact,
				help: violation.help,
				tags: violation.tags,
				nodes: violation.nodes.map((node) => ({
					target: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
					html: node.html,
					summary: node.failureSummary,
				})),
			}));
		},
		[...AXE_TAGS],
	);
}

test.describe('public route axe-core scan (#393)', () => {
	test.beforeEach(async ({ page, baseURL }) => {
		// The scan measures the release candidate, never a deployment.
		test.skip(
			!baseURL || !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(baseURL),
			`the axe scan runs against the local preview only (baseURL is "${baseURL ?? 'unset'}")`,
		);
		// The axe bundle is injected before the document is parsed, so the
		// scan sees the page exactly as a visitor receives it.
		await page.addInitScript({ content: AXE_SOURCE });
	});

	for (const route of AUDITED_ROUTES) {
		test(`${route.path} — ${route.expect}`, async ({ page }, testInfo) => {
			const response = await page.goto(route.path, { waitUntil: 'networkidle' });
			expect(response?.status(), `${route.path} must resolve, not 404`).toBe(200);
			await expect(page).toHaveTitle(route.title);

			const violations = await scan(page);
			const records = recordsForRoute(route.path, baseline.records);
			const verdict = verdictFor(violations, route.path, baseline.records);
			const stale = staleRecords(violations, route.path, baseline.records);

			// The manifest's declaration and the measurement must agree.
			expect(
				verdict,
				`${route.path}: the manifest declares "${route.expect}" but the scan measured "${verdict}" (${violations.length} violation(s), ${records.length} baseline record(s)). A changed verdict means either a new violation or a fixed one — update e2e/a11y/axe-manifest.ts and e2e/a11y/axe-baseline.json in the same commit.`,
			).toBe(route.expect);

			// A stale ledger record means the ledger is no longer the
			// record of what is known: it would let somebody empty the
			// ledger and turn the gate permanently green.
			expect(
				stale.map((record) => `${record.ruleId} @ ${record.nodes.join(', ')}`),
				`${route.path}: the baseline ledger records violations the scan no longer observes. Remove the record (the violation was fixed) — do not leave it behind.`,
			).toEqual([]);

			// The counts are part of the report: "no violation" must
			// never be printed in place of "N known violations".
			const summary = {
				route: route.path,
				verdict,
				declared: route.expect,
				violationsObserved: violations.length,
				baselineRecords: records.length,
				knownViolations: violations.reduce(
					(total, violation) =>
						total + matchBaseline(violation, route.path, baseline.records).known.length,
					0,
				),
				newViolations: violations.reduce(
					(total, violation) =>
						total + matchBaseline(violation, route.path, baseline.records).unknown.length,
					0,
				),
				rules: violations.map((violation) => ({
					ruleId: violation.ruleId,
					impact: violation.impact,
					tags: violation.tags.filter((tag) => tag.startsWith('wcag')),
					nodes: observedNodes(violation),
				})),
			};
			await testInfo.attach(`axe-summary-${route.path.replace(/\W+/g, '_')}`, {
				body: JSON.stringify(summary, null, 2),
				contentType: 'application/json',
			});
		});
	}

	test('the ledger has no record for a route the manifest does not audit', () => {
		const audited = new Set(AUDITED_ROUTES.map((route) => route.path));
		const orphans = baseline.records
			.filter((record) => !audited.has(record.route))
			.map((record) => `${record.route} · ${record.ruleId}`);
		expect(
			orphans,
			'the baseline ledger records a route the manifest does not audit — delete the record or audit the route',
		).toEqual([]);
	});

	test('every skipped route states a reason', () => {
		const withoutReason = SKIPPED_ROUTES.filter(
			(route) => typeof route.reason !== 'string' || route.reason.trim().length === 0,
		);
		expect(
			withoutReason.map((route) => route.path),
			'a skipped route must say why it is not measured',
		).toEqual([]);
	});
});
