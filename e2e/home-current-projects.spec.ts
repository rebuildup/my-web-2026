import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { activityProjectRecords, readGitHubActivitySnapshot } from '../src/home/activity/snapshot';
import {
	type GitFactsSnapshot,
	gitSnapshotFacts,
	handwrittenFacts,
} from '../src/home/current/providers';
import { PROJECT_ROSTER } from '../src/home/current/roster';
import { composeRecords, selectPublishedProjects } from '../src/home/current/source';

/**
 * The "現在地 / Where I am now" section on `/` (Issue #316).
 *
 * The section is composed from three committed artefacts — the owner's
 * roster (`src/home/current/roster.ts`), this repository's git snapshot
 * and the GitHub activity snapshot (Issues #316 / #932) — so the browser
 * contract is exact:
 *
 *   - HOME publishes a bounded curated slice (Issue #1110 / ADR-0022
 *     C-8) — the first published records, with the complete
 *     enumeration deferred to `/now` behind the see-all link;
 *   - the GitHub-observed projects (`gh-` ids) are published alongside them;
 *   - a measured value is never shown without the word for its source, and a
 *     value the record does not carry is absent rather than filled with a
 *     placeholder;
 *   - the section states the total and the base date it computed against.
 *
 * What this spec deliberately does NOT pin is the set of measured values:
 * they change with the repository's history and with the owner's writing, and
 * a test that froze them would fail on every honest edit.
 */

function readJsonArtifact(path: string): unknown {
	return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

/**
 * The published count the loader computes for today, rebuilt from the
 * same committed artefacts and the same pure functions — the spec never
 * freezes the number, it re-derives it, so an honest roster or snapshot
 * edit moves both sides together.
 */
function expectedPublishedProjects() {
	const today = new Date().toISOString().slice(0, 10);
	const gitFacts = readJsonArtifact('../src/home/current/git-facts.json') as GitFactsSnapshot;
	const githubJson = readJsonArtifact('../src/home/activity/github-activity.json');
	const snapshot = readGitHubActivitySnapshot(githubJson);
	const githubProjects = snapshot ? activityProjectRecords(snapshot) : [];
	const rosterRecords = composeRecords(
		PROJECT_ROSTER,
		[handwrittenFacts(PROJECT_ROSTER), gitSnapshotFacts(gitFacts)],
		today,
	);
	return selectPublishedProjects([...rosterRecords, ...githubProjects], today);
}

function expectedPublishedCount(): number {
	return expectedPublishedProjects().length;
}
test.describe('home — current projects section (Issue #316)', () => {
	test('publishes the section with its own heading', async ({ page }) => {
		const response = await page.goto('/');
		expect(response?.status()).toBe(200);

		const section = page.locator('[data-testid="home-current-projects"]');
		await expect(section).toHaveCount(1);
		await expect(section.locator('#current-projects-heading')).toHaveText('現在地 Where I am now');
	});

	test('publishes the curated slice and defers the full list to /now', async ({ page }) => {
		await page.goto('/');

		// Issue #1110 — HOME is a curated surface (ADR-0022 C-8): it
		// renders `published.slice(0, 4)` and links to `/now` for the
		// complete enumeration, which `e2e/now.spec.ts` covers.
		const published = expectedPublishedProjects();
		const visible = published.slice(0, 4);
		const items = page.locator('[data-testid="home-current-project"]');
		await expect(items).toHaveCount(visible.length);

		for (const project of visible) {
			const item = page.locator(
				`[data-testid="home-current-project"][data-project-id="${project.id}"]`,
			);
			await expect(item).toHaveCount(1);
			await expect(item).toContainText(project.name);
			await expect(item).toContainText(project.statusJa);
		}

		const seeAll = page.locator('[data-testid="home-current-projects-see-all"]');
		if (published.length > visible.length) {
			await expect(seeAll).toHaveAttribute('href', '/now');
		} else {
			await expect(seeAll).toHaveCount(0);
		}
	});

	test('states the total, the base date and the counting window', async ({ page }) => {
		await page.goto('/');

		const summary = page.locator('[data-testid="home-current-projects-summary"]');
		await expect(summary).toHaveCount(1);
		await expect(summary).toContainText(`全 ${expectedPublishedCount()} 件。`);
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
