import { describe, expect, it } from 'vitest';
import { KEYBOARD_SOURCES } from './index';
import { loadKeyboardPage, validateManifest } from './load';
import { KEYBOARD_STALE_AFTER_DAYS, type KeyboardManifest } from './types';

const SYNCED_AT = Date.parse(KEYBOARD_SOURCES.manifest.syncedAt);
const DAY = 24 * 60 * 60 * 1_000;

function manifestClone(): KeyboardManifest {
	return JSON.parse(JSON.stringify(KEYBOARD_SOURCES.manifest)) as KeyboardManifest;
}

describe('keyboard manifest — provenance allowlist', () => {
	it('accepts the committed manifest', () => {
		expect(validateManifest(KEYBOARD_SOURCES.manifest)).toEqual({ ok: true, codes: [] });
	});

	it('rejects a branch name where a commit SHA is required', () => {
		const manifest = manifestClone();
		const mutated = {
			...manifest,
			sources: manifest.sources.map((entry) =>
				entry.id === 'win-kanata'
					? { ...entry, ref: 'main', url: entry.url.replace(entry.ref, 'main') }
					: entry,
			),
		};
		expect(validateManifest(mutated).codes).toContain('source-ref');
	});

	it('rejects a URL that does not match the recorded repository / ref / path', () => {
		const manifest = manifestClone();
		const mutated = {
			...manifest,
			sources: manifest.sources.map((entry) =>
				entry.id === 'onishi-json' ? { ...entry, url: 'https://example.com/onishi.json' } : entry,
			),
		};
		expect(validateManifest(mutated).codes).toContain('source-url');
	});

	it('rejects an unknown repository or path', () => {
		const manifest = manifestClone();
		const mutated = {
			...manifest,
			sources: manifest.sources.map((entry) =>
				entry.id === 'onishi-json'
					? {
							...entry,
							repository: 'someone/else',
							path: 'private/onishi.json',
						}
					: entry,
			),
		};
		const codes = validateManifest(mutated).codes;
		expect(codes).toContain('source-repository');
		expect(codes).toContain('source-path');
	});

	it('rejects a missing source', () => {
		const manifest = manifestClone();
		const mutated = {
			...manifest,
			sources: manifest.sources.filter((entry) => entry.id !== 'mac-kanata'),
		};
		expect(validateManifest(mutated).codes).toContain('missing-source');
	});

	it('rejects an adoption ref that disagrees with the macOS source', () => {
		const manifest = manifestClone();
		const mutated = {
			...manifest,
			adoption: { ...manifest.adoption, declaredRef: '0'.repeat(40) },
		};
		expect(validateManifest(mutated).codes).toContain('adoption-ref');
	});

	it('rejects an unparsable sync timestamp', () => {
		const manifest = manifestClone();
		const mutated = { ...manifest, syncedAt: 'not-a-date' };
		expect(validateManifest(mutated).codes).toContain('synced-at');
	});
});

describe('keyboard page state', () => {
	it('returns ready and fresh at the sync instant', () => {
		const data = loadKeyboardPage(KEYBOARD_SOURCES, SYNCED_AT);
		expect(data.status).toBe('ready');
		if (data.status !== 'ready') return;
		expect(data.freshness).toBe('fresh');
		expect(data.ageDays).toBe(0);
		expect(data.staleAfterDays).toBe(KEYBOARD_STALE_AFTER_DAYS);
		expect(data.catalog.platforms).toHaveLength(2);
	});

	it('keeps rendering the last good diagram but marks it stale', () => {
		const data = loadKeyboardPage(
			KEYBOARD_SOURCES,
			SYNCED_AT + (KEYBOARD_STALE_AFTER_DAYS + 1) * DAY,
		);
		expect(data.status).toBe('ready');
		if (data.status !== 'ready') return;
		expect(data.freshness).toBe('stale');
		expect(data.ageDays).toBe(KEYBOARD_STALE_AFTER_DAYS + 1);
	});

	it('returns unavailable when the manifest provenance is invalid', () => {
		const manifest = manifestClone();
		const data = loadKeyboardPage(
			{
				...KEYBOARD_SOURCES,
				manifest: { ...manifest, syncedAt: 'not-a-date' },
			},
			SYNCED_AT,
		);
		expect(data.status).toBe('unavailable');
		if (data.status !== 'unavailable') return;
		expect(data.reason).toBe('invalid-manifest');
		expect(data.detailCodes).toContain('synced-at');
	});

	it('never puts manifest content into the public failure detail', () => {
		const manifest = manifestClone();
		const data = loadKeyboardPage(
			{
				...KEYBOARD_SOURCES,
				manifest: {
					...manifest,
					sources: manifest.sources.map((entry) => ({
						...entry,
						url: 'https://example.com/private',
					})),
				},
			},
			SYNCED_AT,
		);
		expect(data.status).toBe('unavailable');
		if (data.status !== 'unavailable') return;
		const rendered = JSON.stringify(data);
		expect(rendered).not.toContain('example.com');
		expect(data.detailCodes.every((code) => /^[a-z-]+$/.test(code))).toBe(true);
	});

	it('still renders the page when both platform sources are corrupt', () => {
		const data = loadKeyboardPage(
			{
				...KEYBOARD_SOURCES,
				macKanata: '(defsrc esc)',
				winKanata: '(defsrc esc)',
			},
			SYNCED_AT,
		);
		expect(data.status).toBe('ready');
		if (data.status !== 'ready') return;
		expect(data.catalog.platforms.every((platform) => platform.status === 'unavailable')).toBe(
			true,
		);
	});
});
