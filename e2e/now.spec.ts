import { expect, test } from '@playwright/test';

/**
 * `/now` — the full enumeration surface for the "現在地 / Where I am
 * now" records (Issue #1108, ADR-0022 C-8).
 *
 * What this spec pins:
 *   - the route renders 200 from the COMMITTED snapshot (the same
 *     data obligation as the home loader — no request-time fetch);
 *   - every published record is reachable here: the section shows the
 *     complete list and carries NO see-all link (the see-all link
 *     lives on `/`, pointing here);
 *   - the canonical URL and the document title are the published
 *     contract;
 *   - the layout does not overflow horizontally at phone width.
 */

const CANONICAL = 'https://rebuildup.dev/now';

test.describe('/now — full current-project enumeration (#1108)', () => {
	test('renders the complete list from the committed snapshot', async ({ page }) => {
		const response = await page.goto('/now');
		expect(response?.status()).toBe(200);

		await expect(page).toHaveTitle('現在地 / Where I am now — rebuildup.dev');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', CANONICAL);

		// Issue #1185 — the page's title and its scale sentence live in the
		// entry hero; the enumeration below is the section's list alone.
		await expect(
			page.getByRole('heading', { level: 1, name: '現在地 Where I am now' }),
		).toBeVisible();

		// Issue #1297 — the enumeration split into two provenance
		// sections (named roster records / GitHub-observed records),
		// each with its own list hook. The summary count and the UNION
		// of both lists' record rows must still agree, and there is no
		// see-all link — this IS the see-all destination.
		// Issue #1316 — the page now leads with the editorial "in
		// focus" band (owner-declared 主軸 / 並行 records, with
		// portfolio covers where a case study is mapped) before the
		// two provenance enumerations.
		await expect(
			page.getByRole('heading', { level: 2, name: 'いまの焦点 In focus' }),
		).toBeVisible();
		await expect(page.getByTestId('now-focus-item').first()).toBeVisible();
		await expect(
			page.getByRole('heading', { level: 2, name: '名付けたプロジェクト' }),
		).toBeVisible();
		await expect(
			page.getByRole('heading', { level: 2, name: 'GitHub で観測されたリポジトリ' }),
		).toBeVisible();
		const summary = page.getByTestId('home-current-projects-summary');
		await expect(summary).toBeVisible();
		const summaryText = (await summary.innerText()) ?? '';
		const declared = /全 (\d+) 件/.exec(summaryText);
		expect(declared, `summary must declare a total count: ${summaryText}`).not.toBeNull();
		const namedRows = page
			.getByTestId('now-named-projects-list')
			.getByTestId('home-current-project');
		const observedRows = page
			.getByTestId('now-observed-projects-list')
			.getByTestId('home-current-project');
		const rowCount = (await namedRows.count()) + (await observedRows.count());
		expect(rowCount).toBe(Number(declared?.[1]));
		await expect(page.getByTestId('home-current-projects-see-all')).toHaveCount(0);
		// Issue #1316 — the observed section hands off to the full
		// timeline instead of ending the enumeration cold.
		await expect(page.getByTestId('now-activity-link')).toHaveAttribute('href', '/activity');
	});

	test('is reachable from the home see-all link', async ({ page }) => {
		await page.goto('/');
		const seeAll = page.getByTestId('home-current-projects-see-all');
		await expect(seeAll).toBeVisible();
		await expect(seeAll).toHaveAttribute('href', '/now');
	});

	test('stays inside the viewport at phone width', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/now');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
