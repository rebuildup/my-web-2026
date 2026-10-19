import { describe, expect, it } from 'vitest';
import { INVENTORY_SCHEMA, parseAssetInventory, parseAssetInventoryValue } from './inventory';

/**
 * Reader tests for the reviewed record (Issue #497).
 *
 * The record is a human decision written in JSON, so the reader is the
 * thing that keeps a hand edit honest. The properties asserted here are
 * the ones that would otherwise fail SILENTLY: a misspelled key that
 * reads as an absent field, a `checkedOn` that is not a date, an
 * evidence path that escapes the repository, and a record whose id would
 * collide with another record's.
 */

const VALID_ASSET = {
	id: 'fixture-asset',
	kind: 'image',
	title: 'fixture asset',
	summary: 'a synthetic record',
	covers: ['public/fixture/**'],
	publicPaths: ['/fixture/one.png'],
	origin: 'repository-generated',
	rightsHolder: 'rebuildup',
	license: {
		spdx: 'MIT',
		redistribution: 'bundled',
		attributionRequired: false,
		attributionText: null,
		attributionDeliveredAt: null,
		conditions: ['MIT'],
	},
	verification: { method: 'repository-evidence', checkedOn: '2026-10-19', note: 'reviewed' },
	evidence: [{ kind: 'repository-file', path: 'LICENSE', sha256: 'a'.repeat(64) }],
	publication: 'published',
	externalHosts: [],
} as const;

function inventory(assets: unknown, overrides: Record<string, unknown> = {}) {
	return {
		schema: INVENTORY_SCHEMA,
		issue: '#497',
		reviewedAt: '2026-10-19',
		scope: 'test',
		assets,
		...overrides,
	};
}

function codes(result: { findings: readonly { code: string }[] }): string[] {
	return result.findings.map((item) => item.code);
}

describe('parseAssetInventoryValue', () => {
	it('reads a well-formed record without findings', () => {
		const result = parseAssetInventoryValue(inventory([VALID_ASSET]));
		expect(result.ok).toBe(true);
		expect(result.findings).toEqual([]);
		expect(result.records).toHaveLength(1);
		expect(result.records[0].id).toBe('fixture-asset');
		expect(result.records[0].license.redistribution).toBe('bundled');
		expect(result.records[0].evidence[0]).toEqual({
			kind: 'repository-file',
			path: 'LICENSE',
			sha256: 'a'.repeat(64),
		});
	});

	it('accepts NOASSERTION and an unverified asset as honest answers', () => {
		const unverified = {
			...VALID_ASSET,
			id: 'held-asset',
			kind: 'font',
			origin: 'unknown-provenance',
			rightsHolder: null,
			covers: [],
			publicPaths: [],
			license: {
				spdx: 'NOASSERTION',
				redistribution: 'bundled',
				attributionRequired: false,
				attributionText: null,
				attributionDeliveredAt: null,
				conditions: [],
			},
			verification: { method: 'none', checkedOn: null, note: 'no evidence in the tree' },
			evidence: [{ kind: 'external-reference', url: 'https://fonts.example/specimen' }],
		};
		const result = parseAssetInventoryValue(inventory([unverified]));
		expect(result.ok).toBe(true);
		expect(result.records[0].verification.method).toBe('none');
	});

	it('accepts a carve-out that hands a file to another record', () => {
		const carved = { ...VALID_ASSET, excludes: ['public/fixture/one.png'] };
		const result = parseAssetInventoryValue(inventory([carved]));
		expect(result.ok).toBe(true);
		expect(result.records[0].excludes).toEqual(['public/fixture/one.png']);
	});

	it('refuses a carve-out that is not a list of patterns', () => {
		const bad = { ...VALID_ASSET, excludes: 'public/fixture/one.png' };
		const result = parseAssetInventoryValue(inventory([bad]));
		expect(result.ok).toBe(false);
		expect(result.findings.some((item) => item.message.includes('excludes'))).toBe(true);
	});

	it('refuses a value that is not an object', () => {
		const result = parseAssetInventoryValue(['not', 'an', 'object']);
		expect(result.ok).toBe(false);
		expect(codes(result)).toContain('J001');
	});

	it('refuses an unknown schema version instead of guessing', () => {
		const result = parseAssetInventoryValue(inventory([VALID_ASSET], { schema: 'v9' }));
		expect(result.ok).toBe(false);
		expect(codes(result)).toContain('J002');
	});

	it('refuses a record list that is not a list', () => {
		const result = parseAssetInventoryValue(inventory(undefined));
		expect(result.ok).toBe(false);
		expect(codes(result)).toContain('J003');
	});

	it('names the offending field rather than failing the whole file silently', () => {
		const broken = { ...VALID_ASSET, license: { ...VALID_ASSET.license, spdx: 'free' } };
		const result = parseAssetInventoryValue(inventory([broken]));
		expect(result.ok).toBe(false);
		expect(result.records).toEqual([]);
		expect(result.findings.map((item) => item.subject)).toContain(
			'quality/asset-license-inventory.json#assets[0]',
		);
		expect(result.findings.some((item) => item.message.includes('license.spdx'))).toBe(true);
	});

	it('refuses an unknown key, so a typo cannot read as an absent field', () => {
		const typo = {
			...VALID_ASSET,
			license: { ...VALID_ASSET.license, attributionDeliveredAt: null },
			attributionDeliverdAt: '/licenses',
		};
		const result = parseAssetInventoryValue(inventory([typo]));
		expect(result.ok).toBe(false);
		expect(result.findings.some((item) => item.message.includes('attributionDeliverdAt'))).toBe(
			true,
		);
	});

	it('refuses a review date that is not a date', () => {
		const bad = {
			...VALID_ASSET,
			verification: { ...VALID_ASSET.verification, checkedOn: '19/10/2026' },
		};
		const result = parseAssetInventoryValue(inventory([bad]));
		expect(result.ok).toBe(false);
		expect(result.findings.some((item) => item.message.includes('checkedOn'))).toBe(true);
	});

	it('refuses an evidence path that escapes the repository', () => {
		const escaping = {
			...VALID_ASSET,
			evidence: [{ kind: 'repository-file', path: '../secrets/LICENSE' }],
		};
		expect(parseAssetInventoryValue(inventory([escaping])).ok).toBe(false);
		const absolute = {
			...VALID_ASSET,
			evidence: [{ kind: 'repository-file', path: '/etc/passwd' }],
		};
		expect(parseAssetInventoryValue(inventory([absolute])).ok).toBe(false);
	});

	it('refuses a digest that is not a sha256', () => {
		const bad = {
			...VALID_ASSET,
			evidence: [{ kind: 'repository-file', path: 'LICENSE', sha256: 'abc' }],
		};
		expect(parseAssetInventoryValue(inventory([bad])).ok).toBe(false);
	});

	it('refuses a non-bare hostname in externalHosts', () => {
		const bad = { ...VALID_ASSET, externalHosts: ['https://fonts.example/'] };
		expect(parseAssetInventoryValue(inventory([bad])).ok).toBe(false);
	});

	it('refuses an id that is not kebab-case, so ids stay comparable in reports', () => {
		const bad = { ...VALID_ASSET, id: 'Fixture Asset' };
		expect(parseAssetInventoryValue(inventory([bad])).ok).toBe(false);
	});

	it('keeps the records it could read when only one of several is broken', () => {
		const result = parseAssetInventoryValue(
			inventory([VALID_ASSET, { ...VALID_ASSET, kind: 'screenshot' }]),
		);
		expect(result.ok).toBe(false);
		expect(result.records.map((item) => item.id)).toEqual(['fixture-asset']);
	});
});

describe('parseAssetInventory', () => {
	it('reports unparsable text instead of throwing', () => {
		const result = parseAssetInventory('{ "schema": ');
		expect(result.ok).toBe(false);
		expect(result.records).toEqual([]);
		expect(codes(result)).toContain('J005');
	});
});
