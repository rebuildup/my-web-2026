import { describe, expect, it } from 'vitest';
import notionSnapshot from '../portfolio/notion/generated/snapshot.json';
import {
	SKILLS,
	SKILL_CATEGORY_LABELS,
	SKILL_CONTEXTS,
	SKILL_USAGE_LABELS,
	groupSkillsByContext,
	selectCurrentSkills,
	selectPastSkills,
} from './skills';

/**
 * Skills data contract tests (Issue #391).
 *
 * The acceptance criteria are enforced here as data invariants:
 *
 *   - every entry links to at least one work or record (evidence);
 *   - internal `/portfolio/<slug>` evidence resolves to a slug that
 *     exists in the committed Notion snapshot's public+published
 *     records — the corpus production actually serves — so a renamed
 *     or unpublished project cannot silently leave a dead link;
 *   - `usage` splits current from past, and the two selectors
 *     partition the list;
 *   - NO proficiency claim can exist: the entry shape has no level
 *     field and the committed data carries no level-shaped key or a
 *     percentage anywhere in its values.
 */

const ENTRY_KEYS = new Set(['id', 'name', 'category', 'usage', 'context', 'summary', 'evidence']);
const EVIDENCE_KEYS = new Set(['label', 'href']);
const CATEGORIES = new Set(Object.keys(SKILL_CATEGORY_LABELS));
const USAGES = new Set(Object.keys(SKILL_USAGE_LABELS));
const CONTEXTS = new Set(SKILL_CONTEXTS.map((context) => context.id));
const PROHIBITED_KEY = /level|proficien|percent|score|rank/i;

const PORTFOLIO_SLUGS = new Set(
	notionSnapshot.records
		.filter((record) => record.visibility === 'public' && record.status === 'published')
		.map((record) => record.slug),
);

describe('SKILLS data contract', () => {
	it('commits at least one entry', () => {
		expect(SKILLS.length).toBeGreaterThan(0);
	});

	it('every entry is well formed and carries at least one evidence link', () => {
		const ids = new Set<string>();
		for (const skill of SKILLS) {
			for (const key of Object.keys(skill)) {
				expect(ENTRY_KEYS.has(key), `unexpected key "${key}" on ${skill.id}`).toBe(true);
				expect(PROHIBITED_KEY.test(key), `proficiency-shaped key "${key}"`).toBe(false);
			}
			expect(ids.has(skill.id), `duplicate id ${skill.id}`).toBe(false);
			ids.add(skill.id);
			expect(skill.name.trim().length).toBeGreaterThan(0);
			expect(CATEGORIES.has(skill.category)).toBe(true);
			expect(USAGES.has(skill.usage)).toBe(true);
			expect(CONTEXTS.has(skill.context), `${skill.id} context`).toBe(true);
			expect(skill.evidence.length).toBeGreaterThanOrEqual(1);
			for (const evidence of skill.evidence) {
				for (const key of Object.keys(evidence)) {
					expect(EVIDENCE_KEYS.has(key), `unexpected evidence key "${key}"`).toBe(true);
				}
				expect(
					evidence.href.startsWith('/') || evidence.href.startsWith('https://'),
					`${skill.id} evidence href must be internal or absolute: ${evidence.href}`,
				).toBe(true);
			}
		}
	});

	it('internal /portfolio/<slug> evidence resolves to a committed project', () => {
		for (const skill of SKILLS) {
			for (const evidence of skill.evidence) {
				const match = /^\/portfolio\/([a-z0-9-]+)$/.exec(evidence.href);
				if (!match) continue;
				expect(
					PORTFOLIO_SLUGS.has(match[1] as string),
					`${skill.id} links to unknown portfolio slug "${match[1]}"`,
				).toBe(true);
			}
		}
	});

	it('at least one entry links to an actual work (Issue #391 acceptance)', () => {
		const withPortfolioEvidence = SKILLS.filter((skill) =>
			skill.evidence.some((evidence) => evidence.href.startsWith('/portfolio/')),
		);
		expect(withPortfolioEvidence.length).toBeGreaterThanOrEqual(1);
	});

	it('carries no proficiency claim anywhere in its values', () => {
		// No percentages, no 「N年」 expertise claims, no ordinal ranks.
		const serialized = JSON.stringify(SKILLS);
		expect(serialized).not.toMatch(/\d+\s*%/);
		expect(serialized).not.toMatch(/上級|中級|初級|エキスパート/);
	});
});

describe('usage split', () => {
	it('partitions the list into current and past without overlap', () => {
		const current = selectCurrentSkills();
		const past = selectPastSkills();
		expect(current.length + past.length).toBe(SKILLS.length);
		expect(current.every((skill) => skill.usage === 'current')).toBe(true);
		expect(past.every((skill) => skill.usage === 'past')).toBe(true);
	});

	it('keeps at least one past-use entry distinct from the current toolchain', () => {
		expect(selectPastSkills().length).toBeGreaterThan(0);
	});

	it('groups every entry under a declared context without loss (Issue #1296)', () => {
		const groups = groupSkillsByContext();
		const grouped = groups.flatMap((bucket) => bucket.skills);
		expect(grouped.length).toBe(SKILLS.length);
		for (const bucket of groups) {
			expect(bucket.skills.length).toBeGreaterThan(0);
			expect(bucket.skills.every((skill) => skill.context === bucket.context.id)).toBe(true);
		}
	});

	it('returns empty selections for an empty input (empty-state contract)', () => {
		expect(selectCurrentSkills([])).toEqual([]);
		expect(selectPastSkills([])).toEqual([]);
	});
});
