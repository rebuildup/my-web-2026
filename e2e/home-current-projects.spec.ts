import { expect, test } from '@playwright/test';
import { CURRENT_PROJECTS } from '../src/home/current/projects';

/**
 * The "現在地 / Where I am now" section on `/` (Issue #316).
 *
 * The section publishes a committed snapshot (`src/home/current/projects.ts`),
 * so the browser contract is exact: the section is present, it is named
 * by its own heading, and every published project appears with its
 * name and its Japanese status line.
 *
 * The link assertion is written so it holds in BOTH honest states:
 * the snapshot today publishes no link (the owner has not confirmed a
 * public destination), and a future snapshot may publish an internal
 * path or an `https://` URL. What must never happen is a
 * protocol-relative link or an unusable scheme, so every anchor the
 * section renders has to be an `https://` URL or an internal path,
 * each with a visible label.
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

	test('publishes every project name and status line', async ({ page }) => {
		await page.goto('/');

		const items = page.locator('[data-testid="home-current-project"]');
		await expect(items).toHaveCount(CURRENT_PROJECTS.length);

		for (const project of CURRENT_PROJECTS) {
			const item = page.locator(
				`[data-testid="home-current-project"][data-project-id="${project.id}"]`,
			);
			await expect(item).toHaveCount(1);
			await expect(item).toContainText(project.name);
			await expect(item).toContainText(project.statusJa);
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
			// The same rule the snapshot applies (`isPublishableHref`): an
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

		// The shipped snapshot is not empty, so this is a guard on the
		// fail-closed shape rather than a claim about today's content.
		const empty = page.locator('[data-testid="home-current-projects-empty"]');
		if (CURRENT_PROJECTS.length === 0) {
			await expect(empty).toHaveCount(1);
			await expect(empty).toContainText('現在、公開している進行中のプロジェクトはありません。');
			await expect(page.locator('[data-testid="home-current-projects-list"]')).toHaveCount(0);
		} else {
			await expect(empty).toHaveCount(0);
		}
	});
});
