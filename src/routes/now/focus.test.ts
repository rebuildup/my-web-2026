import { describe, expect, it } from 'vitest';
import type { CurrentProjectRecord, ProjectFact } from '../../home/current/types';
import { NOW_FOCUS_LIMIT, NOW_FOCUS_PORTFOLIO_SLUGS, selectNowFocus } from './focus';

/**
 * `/now` focus selection (Issue #1316).
 *
 * The band is the editorial answer to "what is the owner focused on
 * now": named records whose owner-written level is 主軸 / 並行. These
 * tests pin the partition rules — provenance split, level gate, order
 * preservation and the cap — so a roster or snapshot change cannot
 * silently widen or empty the band.
 */

const TODAY = '2026-11-28';

function fact<T>(value: T): ProjectFact<T> {
	return { value, source: 'handwritten', observedOn: TODAY };
}

function record(
	id: string,
	level?: 'primary' | 'active' | 'side' | 'paused',
): CurrentProjectRecord {
	return {
		id,
		name: id,
		statusJa: 'status',
		...(level ? { weight: { level: fact(level) } } : {}),
	};
}

describe('selectNowFocus', () => {
	it('keeps named records at primary or active level, in published order', () => {
		const projects = [
			record('side-project', 'side'),
			record('primary-project', 'primary'),
			record('active-project', 'active'),
			record('paused-project', 'paused'),
			record('no-level-project'),
		];
		expect(selectNowFocus(projects).map((r) => r.id)).toEqual([
			'primary-project',
			'active-project',
		]);
	});

	it('excludes GitHub-observed records even when they carry a focus level', () => {
		const projects = [record('gh-repo', 'primary'), record('named', 'active')];
		expect(selectNowFocus(projects).map((r) => r.id)).toEqual(['named']);
	});

	it('caps the band at NOW_FOCUS_LIMIT', () => {
		const projects = Array.from({ length: NOW_FOCUS_LIMIT + 2 }, (_, i) =>
			record(`p${i}`, 'primary'),
		);
		expect(selectNowFocus(projects)).toHaveLength(NOW_FOCUS_LIMIT);
	});

	it('returns an empty list when nothing qualifies', () => {
		expect(selectNowFocus([record('a', 'side'), record('b')])).toEqual([]);
		expect(selectNowFocus([])).toEqual([]);
	});
});

describe('NOW_FOCUS_PORTFOLIO_SLUGS', () => {
	it('maps only roster ids, never gh- observed ids', () => {
		for (const id of Object.keys(NOW_FOCUS_PORTFOLIO_SLUGS)) {
			expect(id.startsWith('gh-')).toBe(false);
		}
	});
});
