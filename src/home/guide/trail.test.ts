import { describe, expect, it } from 'vitest';
import {
	VISIT_TRAIL_MAX,
	VISIT_TRAIL_STORAGE_KEY,
	type VisitTrailStorage,
	normalizeVisitPath,
	parseVisitTrail,
	pushVisit,
	readVisitTrail,
	recordVisit,
	writeVisitTrail,
} from './trail';

function fakeStorage(initial: Record<string, string> = {}): VisitTrailStorage & {
	data: Map<string, string>;
	failWrites: boolean;
} {
	const data = new Map(Object.entries(initial));
	const storage = {
		data,
		failWrites: false,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (storage.failWrites) throw new Error('denied');
			data.set(key, value);
		},
	};
	return storage;
}

describe('normalizeVisitPath', () => {
	it('accepts internal pathnames', () => {
		expect(normalizeVisitPath('/portfolio')).toBe('/portfolio');
		expect(normalizeVisitPath('/projects/dotfiles')).toBe('/projects/dotfiles');
	});
	it('rejects non-paths, queries, external URLs and empty input', () => {
		expect(normalizeVisitPath('')).toBeNull();
		expect(normalizeVisitPath('portfolio')).toBeNull();
		expect(normalizeVisitPath('/portfolio?x=1')).toBeNull();
		expect(normalizeVisitPath('/portfolio#top')).toBeNull();
		expect(normalizeVisitPath('https://evil.example/')).toBeNull();
		expect(normalizeVisitPath('//evil.example/')).toBeNull();
		expect(normalizeVisitPath(null)).toBeNull();
		expect(normalizeVisitPath(42)).toBeNull();
	});
	it('never records admin or api surfaces', () => {
		expect(normalizeVisitPath('/admin')).toBeNull();
		expect(normalizeVisitPath('/admin/keys')).toBeNull();
		expect(normalizeVisitPath('/api/v1/reactions')).toBeNull();
		expect(normalizeVisitPath('/apis')).toBe('/apis');
	});
});

describe('pushVisit / parseVisitTrail', () => {
	it('keeps most-recent-first order and dedupes', () => {
		let trail: string[] = [];
		trail = pushVisit(trail, '/about');
		trail = pushVisit(trail, '/portfolio');
		trail = pushVisit(trail, '/about');
		expect(trail).toEqual(['/about', '/portfolio']);
	});
	it('caps the trail at VISIT_TRAIL_MAX', () => {
		let trail: string[] = [];
		for (let i = 0; i < VISIT_TRAIL_MAX + 3; i += 1) {
			trail = pushVisit(trail, `/p${i}`);
		}
		expect(trail).toHaveLength(VISIT_TRAIL_MAX);
		expect(trail[0]).toBe(`/p${VISIT_TRAIL_MAX + 2}`);
	});
	it('parse drops invalid entries and duplicates', () => {
		const raw = JSON.stringify(['/a', '/admin/x', 'bad', '/a', '/b']);
		expect(parseVisitTrail(raw)).toEqual(['/a', '/b']);
		expect(parseVisitTrail('not json')).toEqual([]);
		expect(parseVisitTrail(null)).toEqual([]);
		expect(parseVisitTrail('{"a":1}')).toEqual([]);
	});
});

describe('recordVisit', () => {
	it('round-trips through storage', () => {
		const storage = fakeStorage();
		recordVisit(storage, '/about');
		recordVisit(storage, '/portfolio');
		recordVisit(storage, '/admin/secret');
		expect(readVisitTrail(storage)).toEqual(['/portfolio', '/about']);
	});
	it('survives storage that throws on read and write', () => {
		const storage = fakeStorage();
		storage.failWrites = true;
		expect(() => recordVisit(storage, '/about')).not.toThrow();
		const broken: VisitTrailStorage = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
		};
		expect(() => recordVisit(broken, '/about')).not.toThrow();
		expect(readVisitTrail(broken)).toEqual([]);
	});
	it('uses the versioned key', () => {
		expect(VISIT_TRAIL_STORAGE_KEY).toBe('mw_home_visit_trail_v1');
	});
});
