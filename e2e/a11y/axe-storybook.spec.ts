import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { AUDITED_STORIES, AXE_TAGS } from './axe-storybook-manifest.ts';
import {
	type AxeViolation,
	type BaselineLedger,
	type BaselineRecord,
	newViolationLines,
	reportedRuleIds,
	resolveStoryEntry,
	staleRecords,
	type StoryIndex,
	storyKey,
	verdictFor,
} from './axe-storybook-verdict.ts';

/**
 * Storybook axe-core scan (Issue #392).
 *
 * What this spec pins
 * -------------------
 * Issue #393 audits the rendered public ROUTES. This spec audits the
 * **independent component** a designer iterates on: it opens every
 * story the manifest registers in a real browser and asks axe-core
 * whether the component a designer is looking at violates WCAG 2.2
 * A / AA.
 *
 * Four things are asserted, per story:
 *
 *   1. the story RESOLVES to the entry the manifest names — the file
 *      and the exported story name are resolved against Storybook's
 *      own `index.json`, and the component title has to match. A story
 *      that failed to render must never be measured and reported as
 *      "the component is accessible";
 *   2. NO observed violation is outside the known-violation ledger —
 *      this assertion does not read the manifest at all, so it cannot
 *      be switched off by editing a declaration. A new violation fails
 *      the audit, whatever the manifest says;
 *   3. the ledger is neither incomplete nor stale:
 *        - a violation that is NOT in the ledger → FAIL (a new
 *          violation must fail the audit);
 *        - a ledger record that matches no observed violation → FAIL
 *          (a stale ledger would let somebody delete every record and
 *          turn the audit permanently green);
 *        - a ledger record without a reason → FAIL (a tolerance with
 *          no stated reason is not a decision, it is an omission);
 *   4. a file the manifest declares `pass` measures `pass`. A file may
 *      only declare `baseline` when the ledger records a tolerated
 *      violation for one of its stories, and the ledger's reason is
 *      what makes that tolerance reviewable. The manifest may NOT
 *      declare that a story is allowed to fail — that would let a
 *      one-word edit hide a new violation, which is exactly what this
 *      audit exists to prevent.
 *
 * What the scan measures, and what it does not
 * ---------------------------------------------
 * The scan runs over the STORY's own subtree (`#storybook-root`), not
 * over the whole preview document. Two reasons, both measured:
 *
 *   - the preview TOOL is not the audited subject. The Vite error
 *     overlay Storybook's dev server injects is chrome, and scanning
 *     the whole document reported `scrollable-region-focusable` on
 *     that overlay for every single story (101 of 101) — a fact about
 *     the tool, not about the component;
 *   - a component story is a FRAGMENT. Page-level rules (document
 *     title, landmarks, `html-has-lang`) do not apply to a fragment;
 *     they are the route audit's subject (Issue #393).
 *
 * A non-loopback base URL is a FAILURE, not a skip
 * -------------------------------------------------
 * The scan measures the release candidate, never a deployment, so it
 * only runs against the local Storybook. When the resolved base URL
 * is not loopback, the spec fails instead of skipping: a skipped spec
 * would report "0 stories scanned, exit 0" — a silent green that
 * reads like a pass. Failing loudly is the only honest outcome for a
 * misconfigured origin.
 *
 * Machine-checked vs. human-evaluated
 * ---------------------------------
 * Machine-checked here: whether a rule fires, which rule id it is,
 * and which element fired it. Human-evaluated (NOT decided here):
 * whether the visual result is acceptable, whether the alternative
 * text is good, and whether a recorded violation may stay recorded.
 * See `docs/verification/a11y/axe-storybook.md`.
 */

const require = createRequire(import.meta.url);
const AXE_SOURCE: string = require('axe-core').source;

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(SPEC_DIR, 'axe-storybook-baseline.json');

const baseline: BaselineLedger = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

/** The Storybook origin the scan measures. */
const BASE_URL = (process.env.STORYBOOK_BASE_URL ?? 'http://localhost:6006').replace(/\/$/, '');

/**
 * The element the story renders into.
 *
 * Storybook mounts the story into `#storybook-root`; the scan is
 * scoped to it, so the preview chrome is not measured.
 */
const STORY_ROOT_SELECTOR = '#storybook-root';

/**
 * Run axe-core over the story's own subtree.
 *
 * The axe bundle is injected as an init script, so the scan runs
 * against the same document a designer sees. Only violations are
 * collected (`resultTypes: ['violations']`) — the passes are not
 * evidence the audit needs, and they make the report unreadable.
 */
async function scan(page: import('@playwright/test').Page): Promise<AxeViolation[]> {
	return page.evaluate(
		async ({ tags, rootSelector }) => {
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
					context: Element,
					options: { runOnly: { type: string; values: string[] }; resultTypes: string[] },
				) => Promise<{ violations: RawViolation[] }>;
			}
			const root = document.querySelector(rootSelector);
			if (!root) throw new Error(`the story did not render into "${rootSelector}"`);
			const api = (globalThis as unknown as { axe: AxeApi }).axe;
			const result = await api.run(root, {
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
		{ tags: [...AXE_TAGS], rootSelector: STORY_ROOT_SELECTOR },
	);
}

/** The ledger records that belong to one story. */
function recordsForStory(story: string, records: BaselineRecord[]): BaselineRecord[] {
	return records.filter((record) => record.story === story);
}

test.describe('Storybook story axe-core scan (#392)', () => {
	test.beforeEach(async ({ page }) => {
		// The scan measures the release candidate, never a deployment.
		if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(BASE_URL)) {
			throw new Error(
				`the axe scan runs against the local Storybook only, but the base URL is "${BASE_URL}". Point STORYBOOK_BASE_URL at the loopback preview — a skipped scan would report "0 stories measured" and exit 0.`,
			);
		}
		// The axe bundle is injected before the document is parsed, so
		// the scan sees the page exactly as a designer receives it.
		await page.addInitScript({ content: AXE_SOURCE });
	});

	test('the Storybook index is reachable', async ({ request }) => {
		const response = await request.get(`${BASE_URL}/index.json`);
		expect(response.status(), 'the Storybook index must answer').toBe(200);
	});

	for (const story of AUDITED_STORIES) {
		test(`${story.file}#${story.export} — ${story.expect}`, async ({ page }, testInfo) => {
			const indexResponse = await page.request.get(`${BASE_URL}/index.json`);
			expect(indexResponse.status(), 'the Storybook index must answer').toBe(200);
			const index = (await indexResponse.json()) as StoryIndex;
			const entry = resolveStoryEntry(index, story.file, story.export);

			expect(entry.title, `${story.file}#${story.export} is published under another title`).toBe(
				story.title,
			);

			const response = await page.goto(`${BASE_URL}/iframe.html?id=${entry.id}&viewMode=story`, {
				waitUntil: 'domcontentloaded',
			});
			expect(response?.status(), 'the story preview must resolve').toBe(200);
			// The story is "rendered" when the preview root has content.
			// Waiting for the network to fall idle instead would make the
			// audit depend on requests the story does not own — a font, a
			// dev-server heartbeat — and a story that keeps one open would
			// time out without any accessibility question being asked.
			await page.waitForFunction((selector) => {
				const root = document.querySelector(selector);
				return Boolean(root && root.childElementCount > 0);
			}, STORY_ROOT_SELECTOR);

			const violations = await scan(page);
			const key = storyKey(story.file, story.export);
			const records = recordsForStory(key, baseline.records);
			const verdict = verdictFor(violations, key, baseline.records);
			const stale = staleRecords(violations, key, baseline.records);

			// The core contract, checked WITHOUT reading the manifest:
			// an observed violation that the ledger does not record
			// fails the audit, whatever the manifest declares.
			expect(
				newViolationLines(violations, key, baseline.records),
				`${key}: the scan found violation(s) the ledger does not record. Fix the violation, or record it in e2e/a11y/axe-storybook-baseline.json with a reason (the ledger is the only place where a known violation may be allowed to exist). The manifest cannot allow a failure.`,
			).toEqual([]);

			// A file the manifest declares `pass` measures `pass`: it has
			// no tolerated violation, so any violation at all is a new
			// one — and the previous assertion already failed on it.
			if (story.expect === 'pass') {
				expect(
					records,
					`${key}: the file is declared "pass", so the ledger may not record a tolerated violation for it.`,
				).toEqual([]);
				expect(
					verdict,
					`${key}: the file is declared "pass" but the scan measured "${verdict}".`,
				).toBe('pass');
			}

			// A stale ledger record means the ledger is no longer the
			// record of what is known.
			expect(
				stale.map((record) => `${record.ruleId} @ ${record.nodes.join(', ')}`),
				`${key}: the baseline ledger records violations the scan no longer observes. Remove the record (the violation was fixed) — do not leave it behind.`,
			).toEqual([]);

			const summary = {
				story: key,
				storyId: entry.id,
				title: entry.title,
				name: entry.name,
				verdict,
				declared: story.expect,
				violationsObserved: violations.length,
				baselineRecords: records.length,
				ruleIds: reportedRuleIds(violations),
				rules: violations.map((violation) => ({
					ruleId: violation.ruleId,
					impact: violation.impact,
					help: violation.help,
					tags: violation.tags,
					nodes: violation.nodes,
				})),
			};
			await testInfo.attach('axe-storybook-summary', {
				body: JSON.stringify(summary),
				contentType: 'application/json',
			});
		});
	}
});
