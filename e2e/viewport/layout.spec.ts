/**
 * Viewport layout gate (Issue #417).
 *
 * Captures the representative public surfaces at the four viewport
 * classes named by the Issue (390 / 768 / 1024 / 1440) and judges each
 * cell with the contract in `./contract.ts`. Every capture is written
 * to `.tmp/` so `scripts/make-viewport-diff-grid-report.mjs` can lay
 * them out as the grid the Issue requires — the screenshot is
 * evidence, this file is the gate.
 *
 * Each cell writes its own fingerprint file
 * (`.tmp/viewport-cells/<route>-<viewport>.json`) instead of appending
 * to one shared document: Playwright runs tests in parallel workers,
 * and one file per cell removes the write race without a lock.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { VIEWPORTS, VIEWPORT_ROUTES, assertViewportLayout, observeLayout } from './contract';

const SHOT_DIR = join('.tmp', 'viewport-screenshots');
const CELL_DIR = join('.tmp', 'viewport-cells');

/**
 * The roster snapshot the report renders its coverage band from. It is
 * written by the gate rather than restated in the report script, so a
 * route cannot leave the report by being edited in one place only.
 *
 * Written through a temp file + rename: `beforeAll` runs once per
 * worker, so four workers would otherwise write the same path at the
 * same time.
 */
test.beforeAll(() => {
	mkdirSync('.tmp', { recursive: true });
	mkdirSync(SHOT_DIR, { recursive: true });
	mkdirSync(CELL_DIR, { recursive: true });
	const roster = join('.tmp', 'viewport-roster.json');
	// A per-process temp name: `beforeAll` runs once per worker PROCESS,
	// and a shared `roster.tmp` lets worker A rename the file before
	// worker B does, failing B with ENOENT.
	const temp = `${roster}.${process.pid}.tmp`;
	writeFileSync(
		temp,
		`${JSON.stringify({ routes: VIEWPORT_ROUTES, viewports: VIEWPORTS }, null, 2)}\n`,
	);
	renameSync(temp, roster);
});

for (const viewport of VIEWPORTS) {
	test.describe(`${viewport.width}px (${viewport.label})`, () => {
		test.use({ viewport: { width: viewport.width, height: viewport.height } });

		for (const route of VIEWPORT_ROUTES) {
			test(`${route.path} @ ${viewport.width}px satisfies the layout contract`, async ({
				page,
			}) => {
				const observation = await observeLayout(page, route.path);

				// Capture before judging: a failing cell still contributes
				// the visual evidence the grid report needs.
				//
				// Viewport-sized, not `fullPage`: the Issue is about what
				// fits in the viewport, and a full-page capture of the
				// home surface would make the committed grid several
				// times larger for detail nobody reads at thumbnail
				// size.
				//
				// `animations: 'disabled'` / `caret: 'hide'` are the two
				// known sources of capture-to-capture noise, and the
				// re-capture control in `visual-diff.spec.ts` asserts
				// the pair still compares equal, so they stay honest.
				await page.screenshot({
					path: join(SHOT_DIR, `${route.slug}-${viewport.stem}.png`),
					fullPage: false,
					animations: 'disabled',
					caret: 'hide',
				});

				writeFileSync(
					join(CELL_DIR, `${route.slug}-${viewport.stem}.json`),
					`${JSON.stringify({ route: route.path, slug: route.slug, group: route.group, viewport, observation }, null, 2)}\n`,
				);

				assertViewportLayout(route, viewport, observation);

				// The screenshot is not the only evidence of a rendered
				// cell: a cell that captured a blank document would
				// still satisfy every geometry rule above.
				expect(observation.mainVisible, `${route.path} @${viewport.width} must paint a main`).toBe(
					true,
				);
			});
		}
	});
}
