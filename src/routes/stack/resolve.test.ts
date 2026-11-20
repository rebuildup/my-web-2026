import { describe, expect, it } from 'vitest';
import {
	type StackFactSources,
	resolveFacts,
	resolveStackSections,
	resolveVersion,
	versionPart,
} from './resolve';
import { STACK_SECTIONS, type StackVersionRef } from './stack';

/**
 * Version-resolution contract for `/stack` (Issue #381).
 *
 * The page's whole factual claim is "the version shown is the one
 * the repository declares". These tests pin the three resolution
 * kinds and — just as important — the fail-closed `undetermined`
 * state: a reference that resolves to nothing must never produce a
 * guessed label.
 */

const sources = (overrides: Partial<StackFactSources> = {}): StackFactSources => ({
	profileStack: { framework: 'tanstack-start@1.168.x' },
	npmSpec: (name) => ({ react: '^19.2.0' })[name] ?? null,
	packageManager: 'pnpm@12.3.4',
	...overrides,
});

describe('versionPart', () => {
	it('keeps the range of a name@range declaration', () => {
		expect(versionPart('tanstack-start@1.168.x')).toBe('1.168.x');
	});

	it('uses the LAST @ so scoped package names resolve correctly', () => {
		expect(versionPart('@cloudflare/vitest-plugin@1.1.x')).toBe('1.1.x');
	});

	it('returns the input when there is no @', () => {
		expect(versionPart('latest')).toBe('latest');
	});
});

describe('resolveVersion', () => {
	it('resolves a profile key to its declared range', () => {
		const ref: StackVersionRef = { kind: 'profile', key: 'framework' };
		expect(resolveVersion(ref, sources())).toEqual({
			state: 'resolved',
			label: '1.168.x',
		});
	});

	it('resolves an npm name to its package.json spec', () => {
		const ref: StackVersionRef = { kind: 'npm', name: 'react' };
		expect(resolveVersion(ref, sources())).toEqual({
			state: 'resolved',
			label: '^19.2.0',
		});
	});

	it('resolves the packageManager field', () => {
		expect(resolveVersion({ kind: 'packageManager' }, sources())).toEqual({
			state: 'resolved',
			label: '12.3.4',
		});
	});

	it('marks a missing profile key undetermined', () => {
		const ref: StackVersionRef = { kind: 'profile', key: 'no_such_key' };
		expect(resolveVersion(ref, sources())).toEqual({
			state: 'undetermined',
			label: null,
		});
	});

	it('marks a missing npm spec undetermined', () => {
		const ref: StackVersionRef = { kind: 'npm', name: 'not-a-dep' };
		expect(resolveVersion(ref, sources())).toEqual({
			state: 'undetermined',
			label: null,
		});
	});

	it('marks a missing packageManager undetermined', () => {
		expect(resolveVersion({ kind: 'packageManager' }, sources({ packageManager: null }))).toEqual({
			state: 'undetermined',
			label: null,
		});
	});

	it('passes none and undetermined through untouched', () => {
		expect(resolveVersion({ kind: 'none' }, sources())).toEqual({
			state: 'none',
			label: null,
		});
		expect(resolveVersion({ kind: 'undetermined' }, sources())).toEqual({
			state: 'undetermined',
			label: null,
		});
	});
});

describe('resolveFacts', () => {
	it('resolves the biomeJson reference to the injected rows', () => {
		const rows = [{ label: 'formatter.lineWidth', value: '100' }];
		expect(resolveFacts({ kind: 'biomeJson' }, sources({ biomeSettings: rows }))).toEqual(rows);
	});

	it('fails closed when the source produced nothing', () => {
		expect(resolveFacts({ kind: 'biomeJson' }, sources())).toBeUndefined();
		expect(resolveFacts({ kind: 'biomeJson' }, sources({ biomeSettings: null }))).toBeUndefined();
	});
});

describe('resolveStackSections over the committed inventory', () => {
	it('resolves every declared reference against a complete source set', () => {
		const data = resolveStackSections(STACK_SECTIONS, {
			profileStack: {
				runtime: 'cloudflare-workers@2026-09-07',
				framework: 'tanstack-start@1.168.x',
				external_boundary: 'hono@4.13.x',
				styling: 'panda-css@1.12.x',
				format_lint: 'biome@1.9.x',
				test_runner: 'vitest@4.1.x',
				worker_test: '@cloudflare/vitest-plugin@1.1.x',
				unused_code: 'knip@6.42.x',
			},
			npmSpec: (name) =>
				({ react: '^19.2.0', typescript: '^5.9.0', vite: '^7.3.7', '@playwright/test': '^1.63.0' })[
					name
				] ?? null,
			packageManager: 'pnpm@12.3.4',
		});

		const items = data.sections.flatMap((section) => section.items);
		expect(items.length).toBeGreaterThan(0);
		for (const item of items) {
			expect(item.evidence.length).toBeGreaterThan(0);
			for (const link of item.evidence) {
				expect(link.href).toMatch(/^https:\/\//);
			}
		}
		// The deliberately-undetermined entry stays undetermined.
		const gha = items.find((item) => item.id === 'github-actions');
		expect(gha?.version).toEqual({ state: 'undetermined', label: null });
	});

	it('attaches resolved settings only to items that declare facts (Issue #382)', () => {
		const data = resolveStackSections(STACK_SECTIONS, {
			profileStack: { format_lint: 'biome@1.9.x' },
			npmSpec: () => null,
			packageManager: 'pnpm@12.3.4',
			biomeSettings: [{ label: 'formatter.lineWidth', value: '100' }],
		});

		const items = data.sections.flatMap((section) => section.items);
		const config = items.find((item) => item.id === 'biome-config');
		expect(config?.settings).toEqual([{ label: 'formatter.lineWidth', value: '100' }]);
		// Items without a `facts` reference carry no settings key.
		const workers = items.find((item) => item.id === 'cloudflare-workers');
		expect(workers !== undefined && 'settings' in workers).toBe(false);
		// And the committed samples survive resolution untouched.
		const sample = items.find((item) => item.id === 'biome-format-sample');
		expect(sample?.samples?.length).toBe(2);
	});

	it('omits the settings table when biome.json yields nothing', () => {
		const data = resolveStackSections(STACK_SECTIONS, {
			profileStack: {},
			npmSpec: () => null,
			packageManager: null,
			biomeSettings: null,
		});
		const config = data.sections
			.flatMap((section) => section.items)
			.find((item) => item.id === 'biome-config');
		expect(config?.settings).toBeUndefined();
	});
});
