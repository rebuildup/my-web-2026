import { describe, expect, it } from 'vitest';
import { ABOUT_DATA } from '../../src/about/data';
import { PROJECT_ROSTER } from '../../src/home/current/roster';

/**
 * Home ↔ About consistency for the "current" claim (Issue #316).
 *
 * INTENT
 * ------
 * The home page publishes a "現在地 / Where I am now" section from the
 * owner's committed roster (`src/home/current/roster.ts`), and `/about`
 * publishes its own "current" narrative (`src/about/data.ts`). Both
 * make a claim about what the owner is working on at the time of
 * reading, so the two can drift apart silently — the home section
 * could keep naming a project the about page no longer mentions, and
 * a reader comparing the two pages would see two different truths.
 *
 * This test is the REVIEW RECORD of that decision, not a copy of it:
 * the mapping table below states, for every project the home section
 * publishes, WHICH About sentence is expected to describe it. If the
 * About wording is removed or rewritten so that the fragment no longer
 * exists, the test fails and the home snapshot has to be revisited by
 * a human — the test never rewrites either side.
 *
 * The mapping is EXPLICIT on purpose: an automatic "the home id
 * appears somewhere in the about text" check would pass for a project
 * that merely shares a word with an unrelated sentence. A reviewer
 * reads the table and confirms the pairing is the intended one.
 *
 * Reading the About side is allowed and reading it is the point; the
 * About obligation never imports from Home.
 */

/**
 * The review record: home project id → the About fragment that must
 * still describe it.
 *
 * A fragment is a substring of ONE `ABOUT_DATA.current` entry. Adding
 * a project to the home snapshot without adding its mapping here fails
 * the "every published project is mapped" assertion below.
 */
const HOME_TO_ABOUT: ReadonlyArray<{ id: string; aboutFragment: string }> = [
	{ id: 'my-web-2026', aboutFragment: 'my-web-2026' },
	{ id: 'tastile', aboutFragment: 'Tastile' },
	{ id: 'after-effects', aboutFragment: 'After Effects' },
	{ id: 'ai-coding-agent', aboutFragment: 'AI coding agent' },
];

describe('home current projects ↔ about current narrative', () => {
	it('publishes a project snapshot that is not empty', () => {
		expect(PROJECT_ROSTER.length).toBeGreaterThan(0);
	});

	it('maps every published home project to an About fragment', () => {
		const mapped = new Set(HOME_TO_ABOUT.map((entry) => entry.id));
		for (const project of PROJECT_ROSTER) {
			expect(
				mapped.has(project.id),
				`the home snapshot publishes "${project.id}", but HOME_TO_ABOUT has no About fragment for it`,
			).toBe(true);
		}
	});

	it('has no mapping for a project the home snapshot no longer publishes', () => {
		const published = new Set<string>(PROJECT_ROSTER.map((project) => project.id));
		for (const mapping of HOME_TO_ABOUT) {
			expect(
				published.has(mapping.id),
				`HOME_TO_ABOUT still maps "${mapping.id}", but the home snapshot does not publish it`,
			).toBe(true);
		}
	});

	it('finds the About sentence for every published home project', () => {
		for (const mapping of HOME_TO_ABOUT) {
			const matches = ABOUT_DATA.current.filter((entry) => entry.includes(mapping.aboutFragment));
			expect(
				matches.length,
				`no ABOUT_DATA.current entry mentions "${mapping.aboutFragment}" any more, so the home snapshot publishes a "current" project the about page does not describe`,
			).toBeGreaterThan(0);
		}
	});

	it('describes each published project on the about page, not only in the title', () => {
		// The fragment must appear in an entry that says something about
		// the work, not only in a heading-like string.
		for (const mapping of HOME_TO_ABOUT) {
			const described = ABOUT_DATA.current.some(
				(entry) =>
					entry.includes(mapping.aboutFragment) && entry.length > mapping.aboutFragment.length + 4,
			);
			expect(
				described,
				`ABOUT_DATA.current mentions "${mapping.aboutFragment}" without describing the work`,
			).toBe(true);
		}
	});
});
