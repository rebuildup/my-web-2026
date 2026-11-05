import { expect, test } from '@playwright/test';
import { PROJECT_ROSTER } from '../src/home/current/roster';

/**
 * The "現在地 / Where I am now" section on `/` (Issue #316).
 *
 * The section is composed from two committed artefacts — the owner's roster
 * (`src/home/current/roster.ts`) and this repository's git snapshot — so the
 * browser contract is exact:
 *
 *   - every roster project appears, with its name and its Japanese one-liner;
 *   - a measured value is never shown without the word for its source, and a
 *     value the record does not carry is absent rather than filled with a
 *     placeholder;
 *   - the section states the total and the base date it computed against.
 *
 * What this spec deliberately does NOT pin is the set of measured values:
 * they change with the repository's history and with the owner's writing, and
 * a test that froze them would fail on every honest edit.
 */
test.describe('home — current projects section (Issue #316)', () => {
	test('publishes the section with its own heading', async ({ page }) => {
		const response = await page.goto('/');
		expect(response?.status()).toBe(200);

		const section = page.locator('[data-testid="home-current-projects"]');
		await expect(section).toHaveCount(1);
		await expect(section.locator('#current-projects-heading')).toHaveText(
			'現在地 / Where I am now',
		);
	});

	test('publishes every roster project with its name and one-liner', async ({ page }) => {
		await page.goto('/');

		const items = page.locator('[data-testid="home-current-project"]');
		await expect(items).toHaveCount(PROJECT_ROSTER.length);

		for (const project of PROJECT_ROSTER) {
			const item = page.locator(
				`[data-testid="home-current-project"][data-project-id="${project.id}"]`,
			);
			await expect(item).toHaveCount(1);
			await expect(item).toContainText(project.name);
			await expect(item).toContainText(project.statusJa);
		}
	});

	test('states the total, the base date and the counting window', async ({ page }) => {
		await page.goto('/');

		const summary = page.locator('[data-testid="home-current-projects-summary"]');
		await expect(summary).toHaveCount(1);
		await expect(summary).toContainText(`全 ${PROJECT_ROSTER.length} 件。`);
		await expect(summary).toContainText(/時点・直近 30 日の更新は/);
	});

	test('never renders a placeholder for a value it does not have', async ({ page }) => {
		await page.goto('/');

		const section = page.locator('[data-testid="home-current-projects"]');
		await expect(section).not.toContainText('未記入');
		await expect(section).not.toContainText('準備中');
	});

	test('tags every measured value with the word for its source', async ({ page }) => {
		await page.goto('/');

		// This repository's facts come from git, so at least one 手書き/git tag
		// must be present — and every tag must be one of the three words.
		const tags = page.locator('[data-testid="home-current-project-source"]');
		const count = await tags.count();
		expect(count).toBeGreaterThan(0);
		for (let index = 0; index < count; index += 1) {
			await expect(tags.nth(index)).toHaveText(/^(手書き|git|GitHub)$/);
		}
	});

	test('publishes only publishable links, each with a visible label', async ({ page }) => {
		await page.goto('/');

		const links = page.locator('[data-testid="home-current-projects"] a');
		const count = await links.count();
		for (let index = 0; index < count; index += 1) {
			const link = links.nth(index);
			const href = await link.getAttribute('href');
			expect(href, 'every published link carries an href').toBeTruthy();
			// The same rule the loader applies (`isPublishableHref`): an
			// `https://` URL or an internal path, never the protocol-relative
			// `//…` that would leave the site under a scheme the page does
			// not choose.
			const publishable = href?.startsWith('https://') === true || href?.startsWith('/') === true;
			expect(publishable, `"${href}" is an https URL or an internal path`).toBe(true);
			expect(href?.startsWith('//'), `"${href}" is not protocol-relative`).toBe(false);
			// The visible label is the accessible name (WCAG 2.2 SC 2.5.3).
			await expect(link).not.toBeEmpty();
		}
	});

	test('publishes a meaningful sentence when there is nothing to publish', async ({ page }) => {
		await page.goto('/');

		// The roster is not empty, so this is a guard on the fail-closed
		// shape rather than a claim about today's content.
		const empty = page.locator('[data-testid="home-current-projects-empty"]');
		if (PROJECT_ROSTER.length === 0) {
			await expect(empty).toHaveCount(1);
			await expect(empty).toContainText('現在、公開している進行中のプロジェクトはありません。');
			await expect(page.locator('[data-testid="home-current-projects-list"]')).toHaveCount(0);
		} else {
			await expect(empty).toHaveCount(0);
		}
	});
});
