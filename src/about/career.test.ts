import { describe, expect, it } from 'vitest';
import {
	CAREER_LEGACY_SOURCE_URL,
	CAREER_TIMELINE,
	type CareerEntry,
	selectPublishableCareerEntries,
} from './career';

/**
 * Career timeline data contract tests (Issue #389).
 *
 * These tests pin the fail-closed publication rule: only
 * `verified` entries may reach a visitor surface, every entry must
 * name where it was observed, and the committed file must not grow
 * private-life fields (birth date, family, purchase history) that the
 * legacy site carried but this obligation deliberately excludes.
 */

const ENTRY_KEYS = new Set([
	'id',
	'kind',
	'dateLabel',
	'title',
	'summary',
	'sources',
	'verification',
]);
const VERIFICATION_KEYS = new Set(['status', 'checkedOn', 'note']);
const SOURCE_KEYS = new Set(['url', 'label']);
const KINDS = new Set(['event', 'state', 'planned']);
const STATUSES = new Set(['verified', 'legacy-only', 'unverified']);

function expectWellFormedEntry(entry: CareerEntry) {
	for (const key of Object.keys(entry)) {
		expect(ENTRY_KEYS.has(key), `unexpected key "${key}" on ${entry.id}`).toBe(true);
	}
	expect(KINDS.has(entry.kind), `${entry.id} kind`).toBe(true);
	expect(entry.id.length).toBeGreaterThan(0);
	expect(entry.dateLabel.trim().length).toBeGreaterThan(0);
	expect(entry.title.trim().length).toBeGreaterThan(0);
	expect(entry.sources.length).toBeGreaterThanOrEqual(1);
	for (const source of entry.sources) {
		for (const key of Object.keys(source)) {
			expect(SOURCE_KEYS.has(key), `unexpected source key "${key}"`).toBe(true);
		}
		expect(source.url).toMatch(/^https:\/\//);
	}
	for (const key of Object.keys(entry.verification)) {
		expect(VERIFICATION_KEYS.has(key), `unexpected verification key "${key}"`).toBe(true);
	}
	expect(STATUSES.has(entry.verification.status)).toBe(true);
	expect(entry.verification.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
}

describe('CAREER_TIMELINE data contract', () => {
	it('commits at least one entry', () => {
		expect(CAREER_TIMELINE.length).toBeGreaterThan(0);
	});

	it('every entry is well formed and names an absolute source URL', () => {
		for (const entry of CAREER_TIMELINE) expectWellFormedEntry(entry);
	});

	it('entry ids are unique', () => {
		const ids = CAREER_TIMELINE.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('keeps the legacy source URL on the migrated claims', () => {
		// The education / award claims migrated from the legacy site must
		// still cite it — the URL is the provenance, not decoration.
		const legacyBacked = CAREER_TIMELINE.filter((entry) =>
			entry.sources.some((source) => source.url === CAREER_LEGACY_SOURCE_URL),
		);
		expect(legacyBacked.length).toBeGreaterThan(0);
	});

	it('covers all three temporal kinds', () => {
		const kinds = new Set(CAREER_TIMELINE.map((entry) => entry.kind));
		expect(kinds.has('event')).toBe(true);
		expect(kinds.has('state')).toBe(true);
		expect(kinds.has('planned')).toBe(true);
	});
});

describe('selectPublishableCareerEntries (fail-closed gate)', () => {
	it('returns only verified entries', () => {
		const publishable = selectPublishableCareerEntries();
		expect(publishable.length).toBeGreaterThan(0);
		for (const entry of publishable) {
			expect(entry.verification.status).toBe('verified');
		}
	});

	it('never returns legacy-only or unverified entries', () => {
		const publishable = selectPublishableCareerEntries();
		const publishableIds = new Set(publishable.map((entry) => entry.id));
		for (const entry of CAREER_TIMELINE) {
			if (entry.verification.status !== 'verified') {
				expect(publishableIds.has(entry.id)).toBe(false);
			}
		}
	});

	it('holds the unverified award claims off the publishable list', () => {
		// Issue #389: 不明な受賞名/年次は現状の文面を無条件に正しいとしない。
		const publishableTitles = selectPublishableCareerEntries().map((entry) => entry.title);
		expect(publishableTitles.some((title) => title.includes('U-16'))).toBe(false);
		expect(publishableTitles.some((title) => title.includes('コンピュータフェスティバル'))).toBe(
			false,
		);
	});

	it('returns an empty list when nothing is approved (empty-state contract)', () => {
		expect(selectPublishableCareerEntries([])).toEqual([]);
		expect(
			selectPublishableCareerEntries(
				CAREER_TIMELINE.filter((entry) => entry.verification.status !== 'verified'),
			),
		).toEqual([]);
	});
});
