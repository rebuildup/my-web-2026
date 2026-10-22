import { expect, test } from '@playwright/test';

/**
 * `/projects/dotfiles` — public introduction to `rebuildup/dotfiles`
 * (Issue #621).
 *
 * What this spec pins:
 *   - the route renders from the COMMITTED snapshot (no request-time
 *     GitHub call), so the page is available with the network down;
 *   - the authored boundary sections and every allowlisted README
 *     section are present;
 *   - the canonical URL and the page title are the published contract;
 *   - the README excerpt is rendered as text + links, never as raw
 *     Markdown/HTML;
 *   - the layout does not overflow horizontally at phone width.
 *
 * The status/robots half of the same route is proved by
 * `e2e/seo-status.spec.ts` (`public-projects-dotfiles`), which reads
 * the shared SEO contract instead of restating the status here.
 */

const CANONICAL = 'https://rebuildup.dev/projects/dotfiles';
const README_HEADINGS = [
	'設計原則',
	'リポジトリ構成',
	'エージェントランチャー',
	'エージェント設定の固定',
	'設計判断と調査',
];

test.describe('projects/dotfiles — committed snapshot rendering (#621)', () => {
	test('renders the introduction and its provenance', async ({ page }) => {
		const response = await page.goto('/projects/dotfiles');
		expect(response?.status()).toBe(200);

		await expect(page).toHaveTitle('dotfiles — rebuildup.dev');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', CANONICAL);

		await expect(page.getByRole('heading', { level: 1, name: 'dotfiles' })).toBeVisible();
		await expect(
			page.getByText('ユーザー設定・エージェント配線・実行時 secret 注入'),
		).toBeVisible();

		for (const heading of README_HEADINGS) {
			await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
		}

		await expect(page.getByRole('heading', { name: 'dotfiles と pc-setup の境界' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'rebuildup/pc-setup' }).first()).toBeVisible();

		// Provenance is part of the page: a reader can name the commit the
		// excerpt came from and when it was verified.
		await expect(page.getByText('README commit')).toBeVisible();
		await expect(page.getByText('last verified')).toBeVisible();
		await expect(
			page.getByRole('link', { name: /README\.md @ [0-9a-f]{7}/ }).first(),
		).toBeVisible();
	});

	test('renders README content as text and links, never as executable markup', async ({ page }) => {
		await page.goto('/projects/dotfiles');
		const html = await page.content();
		expect(html).not.toContain('<script>alert');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('~/.gitconfig');
		expect(html).not.toContain('secrets.example');

		// The allowlisted excerpt must not leak raw Markdown syntax into
		// the rendered text.
		const main = page.locator('main');
		await expect(main).not.toContainText('## Layout');
		await expect(main).not.toContainText('```');
	});

	test('stays inside the viewport at phone width', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/projects/dotfiles');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
		await expect(page.getByRole('heading', { level: 1, name: 'dotfiles' })).toBeVisible();
	});
});
