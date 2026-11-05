import { describe, expect, it } from 'vitest';
import { daysBetween, isValidIsoDate } from './derive';
import { GIT_FACTS, currentProjectsFor } from './loader';
import { RECENT_UPDATE_WINDOW_DAYS } from './source';

/**
 * The committed git snapshot (Issue #316).
 *
 * The snapshot is generated offline by `scripts/sync-home-git-facts.mjs` and
 * committed, so `validate:fast` can check it without a git history. What is
 * checked here is the part that is decidable from the file alone:
 *
 *   - the shape a reader of the file can rely on;
 *   - the window it claims matches the window the section prints;
 *   - its dates are real, ordered and not in the future;
 *   - the section actually publishes the facts it supplies, stamped `git`.
 *
 * Re-deriving the numbers needs the history and therefore lives in the
 * script's `--check` mode, not here.
 */
const TODAY = new Date().toISOString().slice(0, 10);

describe('git-facts.json', () => {
	it('is a versioned snapshot with a full commit id', () => {
		expect(GIT_FACTS.schemaVersion).toBe(1);
		expect(GIT_FACTS.headSha).toMatch(/^[0-9a-f]{40}$/);
		expect(GIT_FACTS.commitsTotal).toBeGreaterThan(0);
	});

	it('counts over the same window the section prints', () => {
		expect(GIT_FACTS.windowDays).toBe(RECENT_UPDATE_WINDOW_DAYS);
	});

	it('was generated on a real day that is not in the future', () => {
		expect(isValidIsoDate(GIT_FACTS.generatedOn)).toBe(true);
		expect(daysBetween(GIT_FACTS.generatedOn, TODAY)).toBeGreaterThanOrEqual(0);
	});

	it('carries ordered, real dates and a consistent count per project', () => {
		const projects = Object.entries(GIT_FACTS.projects);
		expect(projects.length).toBeGreaterThan(0);
		for (const [id, project] of projects) {
			expect(project.firstCommit.sha).toMatch(/^[0-9a-f]{40}$/);
			expect(project.lastCommit.sha).toMatch(/^[0-9a-f]{40}$/);
			expect(isValidIsoDate(project.firstCommit.date), `${id} first commit date`).toBe(true);
			expect(isValidIsoDate(project.lastCommit.date), `${id} last commit date`).toBe(true);
			expect(
				daysBetween(project.firstCommit.date, project.lastCommit.date),
				`${id} first commit is not after the last one`,
			).toBeGreaterThanOrEqual(0);
			expect(project.commits.recent).toBeGreaterThanOrEqual(0);
			expect(project.commits.total).toBeGreaterThanOrEqual(project.commits.recent);
		}
	});

	it('does not claim a commit dated after the snapshot was generated', () => {
		for (const [id, project] of Object.entries(GIT_FACTS.projects)) {
			expect(
				daysBetween(project.lastCommit.date, GIT_FACTS.generatedOn),
				`${id} last commit is after the snapshot date`,
			).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('the shipped records', () => {
	const published = currentProjectsFor(TODAY);
	const project = published.find((entry) => entry.id === 'my-web-2026');

	it('publishes this repository with git-stamped dates', () => {
		expect(project).toBeDefined();
		expect(project?.startedOn?.source).toBe('git');
		expect(project?.updatedOn?.source).toBe('git');
	});

	it('points every git fact at the commit it came from', () => {
		expect(project?.startedOn?.evidence).toBe(GIT_FACTS.projects['my-web-2026']?.firstCommit.sha);
		expect(project?.updatedOn?.evidence).toBe(GIT_FACTS.projects['my-web-2026']?.lastCommit.sha);
		expect(project?.weight?.activity?.evidence).toContain(GIT_FACTS.headSha);
	});

	it('publishes the activity over the snapshot window', () => {
		expect(project?.weight?.activity?.value.windowDays).toBe(GIT_FACTS.windowDays);
		expect(project?.weight?.activity?.value.commits).toBe(
			GIT_FACTS.projects['my-web-2026']?.commits.recent,
		);
	});

	it('invents no fact for a project the sources know nothing about', () => {
		for (const entry of published) {
			if (entry.id === 'my-web-2026') continue;
			expect(entry.startedOn, `${entry.id} has no source for a start date`).toBeUndefined();
			expect(entry.updatedOn, `${entry.id} has no source for an update date`).toBeUndefined();
			expect(entry.weight?.activity, `${entry.id} has no measured activity`).toBeUndefined();
		}
	});
});
