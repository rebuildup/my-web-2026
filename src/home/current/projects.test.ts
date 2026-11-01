import { describe, expect, it } from 'vitest';
import type { CurrentProject } from './projects';
import { CURRENT_PROJECTS, MAX_CURRENT_PROJECTS, selectPublicProjects } from './projects';

/**
 * The publication rules of the current-projects snapshot (Issue #316).
 *
 * The rules are the fail-closed contract: an unusable entry is
 * dropped, an unusable LINK removes the link and keeps the entry, and
 * the list is capped. They are pure functions, so they are asserted
 * directly rather than through a rendered document.
 */
describe('selectPublicProjects', () => {
	it('drops an entry whose id, name or status is empty after trimming', () => {
		const entries: CurrentProject[] = [
			{ id: '  ', name: '空 id', statusJa: '説明' },
			{ id: 'no-name', name: '   ', statusJa: '説明' },
			{ id: 'no-status', name: '状態なし', statusJa: '  ' },
			{ id: 'kept', name: '残る', statusJa: '説明' },
		];
		const published = selectPublicProjects(entries);
		expect(published.map((entry) => entry.id)).toEqual(['kept']);
	});

	it('keeps the FIRST entry when an id repeats', () => {
		const entries: CurrentProject[] = [
			{ id: 'dupe', name: '先頭', statusJa: '最初の説明' },
			{ id: 'dupe', name: '後ろ', statusJa: '後の説明' },
		];
		const published = selectPublicProjects(entries);
		expect(published).toHaveLength(1);
		expect(published[0]?.name).toBe('先頭');
		expect(published[0]?.statusJa).toBe('最初の説明');
	});

	it('drops only the link when its scheme is not publishable, and keeps the entry', () => {
		const entries: CurrentProject[] = [
			{
				id: 'js',
				name: 'JS',
				statusJa: '説明',
				link: { label: '開く', href: 'javascript:alert(1)' },
			},
			{
				id: 'data',
				name: 'Data',
				statusJa: '説明',
				link: { label: '開く', href: 'data:text/html,x' },
			},
			{
				id: 'http',
				name: 'HTTP',
				statusJa: '説明',
				link: { label: '開く', href: 'http://example.com' },
			},
			{
				id: 'relative',
				name: 'Relative',
				statusJa: '説明',
				link: { label: '開く', href: 'about' },
			},
		];
		const published = selectPublicProjects(entries);
		expect(published.map((entry) => entry.id)).toEqual(['js', 'data', 'http', 'relative']);
		for (const entry of published) {
			expect(entry.link).toBeUndefined();
		}
	});

	it('drops a protocol-relative link, and keeps the entry', () => {
		const published = selectPublicProjects([
			{
				id: 'proto',
				name: 'Proto',
				statusJa: '説明',
				link: { label: '開く', href: '//example.com' },
			},
		]);
		expect(published).toHaveLength(1);
		expect(published[0]?.link).toBeUndefined();
	});

	it('drops the link when its label is empty, and keeps the entry', () => {
		const published = selectPublicProjects([
			{ id: 'no-label', name: 'ラベルなし', statusJa: '説明', link: { label: '   ', href: '/x' } },
		]);
		expect(published).toHaveLength(1);
		expect(published[0]?.link).toBeUndefined();
	});

	it('keeps an internal path and an https URL, and trims them', () => {
		const published = selectPublicProjects([
			{
				id: 'internal',
				name: '内部',
				statusJa: '説明',
				link: { label: '  内部  ', href: ' /about ' },
			},
			{
				id: 'external',
				name: '外部',
				statusJa: '説明',
				link: { label: '外部', href: 'https://example.com/x' },
			},
		]);
		expect(published[0]?.link).toEqual({ label: '内部', href: '/about' });
		expect(published[1]?.link).toEqual({ label: '外部', href: 'https://example.com/x' });
	});

	it('publishes at most MAX_CURRENT_PROJECTS entries, from the front', () => {
		const entries: CurrentProject[] = Array.from({ length: 6 }, (_unused, index) => ({
			id: `p${index}`,
			name: `プロジェクト ${index}`,
			statusJa: `説明 ${index}`,
		}));
		const published = selectPublicProjects(entries);
		expect(MAX_CURRENT_PROJECTS).toBe(4);
		expect(published).toHaveLength(MAX_CURRENT_PROJECTS);
		expect(published.map((entry) => entry.id)).toEqual(['p0', 'p1', 'p2', 'p3']);
	});

	it('publishes the committed snapshot without dropping anything', () => {
		const published = selectPublicProjects(CURRENT_PROJECTS);
		expect(published).toHaveLength(CURRENT_PROJECTS.length);
		expect(published.map((entry) => entry.id)).toEqual(CURRENT_PROJECTS.map((entry) => entry.id));
	});
});
