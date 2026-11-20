#!/usr/bin/env node
/**
 * capture-github-activity — browser capture of the Home "GitHub の活動 /
 * GitHub activity" card (Issue #319) into
 * `docs/verification/home/github-activity{,-mobile}.png`.
 *
 * Sibling of `scripts/shoot-robots-screenshot.mjs` (#423): the capture
 * photographs the card AS SERVED by the running app — the data comes
 * from the `getHomeGitHubActivity` server function, which prefers the
 * D1 snapshot when one is pushed and falls back to the committed
 * `src/home/activity/github-activity.json`. There is no story to render
 * instead: the card's content is decided server-side, so a harness
 * capture would prove nothing about what visitors see.
 *
 * It does not start a server — start one first, because "served over
 * HTTP by the same pipeline that ships" is the point:
 *
 *   pnpm run dev
 *   node scripts/capture-github-activity.mjs [base-url]
 *
 * The committed artefacts are element captures of
 * `[data-testid="github-activity-card"]` at two viewport widths:
 *
 *   - github-activity.png        — desktop, 1440 × 900
 *   - github-activity-mobile.png — mobile,  390 × 844
 *
 * Exits non-zero when the capture would be worthless: the card testid
 * never appears, or the card renders the unavailable state instead of
 * a snapshot.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const outDir = process.argv[3] ?? 'docs/verification/home';

const CARD_TEST_ID = 'github-activity-card';
/** The card's honest-state wording when no snapshot could be read. */
const UNAVAILABLE_TEXT = '読み込めませんでした';

const CAPTURES = [
	{ file: 'github-activity.png', width: 1440, height: 900 },
	{ file: 'github-activity-mobile.png', width: 390, height: 844 },
];

const browser = await chromium.launch();
try {
	for (const capture of CAPTURES) {
		const context = await browser.newContext({
			viewport: { width: capture.width, height: capture.height },
			deviceScaleFactor: 1,
		});
		try {
			const page = await context.newPage();
			await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			const card = page.locator(`[data-testid="${CARD_TEST_ID}"]`);
			await card.waitFor({ timeout: 60_000 });
			// The selector can appear before the Panda stylesheet and the
			// web fonts finish applying; a capture taken in that window
			// photographs the unstyled flash, not the shipped card.
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(800);
			const text = await card.innerText();
			if (text.includes(UNAVAILABLE_TEXT)) {
				throw new Error(
					`the ${capture.file} capture would show the unavailable state — the snapshot did not render`,
				);
			}
			if (!text.includes('観測日')) {
				throw new Error(
					`the ${capture.file} capture is missing the observation-date line — not the shipped card`,
				);
			}
			const out = resolve(REPO_ROOT, outDir, capture.file);
			mkdirSync(dirname(out), { recursive: true });
			await card.screenshot({ path: out, type: 'png' });
			console.log(`captured ${outDir}/${capture.file} (${capture.width}×${capture.height})`);
		} finally {
			await context.close();
		}
	}
} finally {
	await browser.close();
}
