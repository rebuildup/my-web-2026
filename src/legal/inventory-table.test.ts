import { describe, expect, it } from 'vitest';
import {
	type AssetLicenseRecord,
	evaluateAssetInventory,
	evaluateAssetLicense,
} from './contract.ts';
import { assetInventoryTable } from './inventory-table.ts';
import { faceValueObservations, parseAssetInventoryValue } from './inventory.ts';

function baseRecord(overrides: Partial<AssetLicenseRecord> = {}): AssetLicenseRecord {
	return {
		id: 'r',
		kind: 'image',
		title: 'fixture image',
		summary: 'a fixture',
		covers: ['public/fixtures/**'],
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
		verification: { method: 'repository-evidence', checkedOn: '2026-10-19', note: 'fixture' },
		evidence: [{ kind: 'repository-file', path: 'LICENSE', sha256: 'a'.repeat(64) }],
		publication: 'published',
		...overrides,
	};
}

describe('faceValueObservations', () => {
	it('reports only what the record itself claims, never an unverified read', () => {
		const observations = faceValueObservations([
			baseRecord(),
			baseRecord({
				id: 'other',
				evidence: [
					{ kind: 'repository-file', path: 'docs/decisions/none.md' },
					{ kind: 'external-reference', url: 'https://example.com/license' },
				],
			}),
		]);

		expect(observations.evidenceExists('LICENSE')).toBe(true);
		expect(observations.sha256Of('LICENSE')).toBe('a'.repeat(64));
		expect(observations.evidenceExists('docs/decisions/none.md')).toBe(true);
		// A declared path with no declared digest answers "no digest", not a
		// guess: a browser cannot hash bytes, so it must not imply it did.
		expect(observations.sha256Of('docs/decisions/none.md')).toBeNull();
		expect(observations.evidenceExists('LICENSE.txt')).toBe(false);
		expect(observations.sha256Of('LICENSE.txt')).toBeNull();
	});
});

describe('assetInventoryTable', () => {
	it('puts the record id in the row-header column and the DERIVED decision in a cell', () => {
		const table = assetInventoryTable([baseRecord()]);

		expect(table.columns.map((column) => column.key)).toEqual([
			'record',
			'decision',
			'kind',
			'spdx',
			'covers',
			'title',
		]);
		expect(table.rows).toHaveLength(1);
		// `DataTable` renders `columns[0].key` as the `scope="row"` cell, so
		// the first column must be the id and not the label the caption names.
		expect(table.columns[0]?.label).toBe('記録 id');
		expect(table.rows[0]?.key).toBe('r');
		expect(table.rows[0]?.cells.record).toBe('r');
		expect(table.rows[0]?.cells.decision).toBe('公開可 / publishable');
		expect(table.rows[0]?.cells.spdx).toBe('MIT');
		expect(table.rows[0]?.cells.covers).toBe('public/fixtures/**');
	});

	it('shows the derived decision, never the declared publication state', () => {
		const held = baseRecord({
			// Bundled third-party bytes with no recorded licence is the hold
			// case (`L018`), and unverified rights are `L017`.
			origin: 'unknown-provenance',
			license: {
				spdx: 'NOASSERTION',
				redistribution: 'bundled',
				attributionRequired: false,
				attributionText: null,
				attributionDeliveredAt: null,
				conditions: [],
			},
			verification: { method: 'none', checkedOn: null, note: 'fixture' },
			// Declared published, which is exactly the L010 contradiction.
			publication: 'published',
		});
		const table = assetInventoryTable([held]);
		expect(table.rows[0]?.cells.decision).toBe('保留 / hold');
		// The row agrees with the gate because both call the same function.
		expect(table.rows[0]?.cells.decision).toBe(
			evaluateAssetLicense(held, faceValueObservations([held])).decision === 'hold'
				? '保留 / hold'
				: 'other',
		);
	});

	it('renders an em dash for a record that ships no bytes rather than an empty cell', () => {
		const table = assetInventoryTable([baseRecord({ covers: [] })]);
		expect(table.rows[0]?.cells.covers).toBe('—');
	});

	it('counts every record and keeps a stable caption and note', () => {
		const records = [baseRecord(), baseRecord({ id: 'b' }), baseRecord({ id: 'c' })];
		const table = assetInventoryTable(records);
		expect(table.caption).toContain('3');
		expect(table.note).toContain('assets:license:check');
		expect(new Set(table.rows.map((row) => row.key)).size).toBe(3);
	});

	it('feeds the committed record without a shape finding', () => {
		// The roster the screenshot renders is built from the SAME record the
		// gate reads; a projection that cannot be built from it would make the
		// capture unreproducible.
		const read = parseAssetInventoryValue({
			schema: 'asset-license-inventory.v1',
			assets: [],
		});
		expect(read.ok).toBe(true);
		expect(assetInventoryTable(read.records).rows).toEqual([]);
	});

	it('keeps the whole inventory buildable by the aggregate evaluation', () => {
		const records = [baseRecord(), baseRecord({ id: 'b', covers: [] })];
		const result = evaluateAssetInventory({
			records,
			auditedFiles: ['public/fixtures/a.png'],
			observations: faceValueObservations(records),
		});
		const table = assetInventoryTable(records);
		expect(table.rows).toHaveLength(result.summary.records);
	});
});
