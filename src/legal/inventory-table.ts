import {
	type AssetLicenseRecord,
	type AssetReview,
	DECISION_LABEL,
	KIND_LABEL,
	evaluateAssetLicense,
} from './contract.ts';
import { faceValueObservations } from './inventory.ts';

/**
 * The record roster as the table-shaped projection `DataTable` takes.
 *
 * Why the row data lives HERE rather than in the story
 * ----------------------------------------------------
 * Panda reads an object literal in a module that imports a style function
 * as a style candidate, so `{ key: 'decision', label: '判定' }` written
 * inside a story would ship `#key_decision { key: decision; label: 判定 }`
 * and fail `pnpm run css:check` (Issue #407, same trap as
 * `src/home/format.compare.ts`). This module imports no style function, so
 * the roster stays data and the rendered table stays the primitive's job.
 */

/** Column descriptor; structurally the primitive's `TableColumn`. */
export interface AssetInventoryColumn {
	key: string;
	label: string;
}

/** Row descriptor; structurally the primitive's `TableRow`. */
export interface AssetInventoryRow {
	key: string;
	label: string;
	cells: Readonly<Record<string, string>>;
}

export interface AssetInventoryTable {
	readonly caption: string;
	readonly columns: readonly AssetInventoryColumn[];
	readonly rows: readonly AssetInventoryRow[];
	readonly note: string;
}

/**
 * The first column's key names the row header cell the primitive renders
 * (`columns.slice(1)` supplies the `<td>`s), so the record id goes first
 * and the DERIVED decision is an ordinary cell after it.
 */
const INVENTORY_COLUMNS: readonly AssetInventoryColumn[] = [
	{ key: 'record', label: '記録 id' },
	{ key: 'decision', label: '判定' },
	{ key: 'kind', label: '種別' },
	{ key: 'spdx', label: 'ライセンス' },
	{ key: 'covers', label: '対象' },
	{ key: 'title', label: '名称' },
];

/**
 * Coverage as the record states it.
 *
 * The real file count belongs to the gate, which walks the tree; a story
 * cannot, so the column shows the declared patterns and says so.
 */
function claimedPatterns(record: AssetLicenseRecord): string {
	return record.covers.length === 0 ? '—' : record.covers.join(' , ');
}

/**
 * One row per record, keyed by id, with the decision DERIVED from the
 * same pure evaluation the story's cards use.
 */
export function assetInventoryTable(records: readonly AssetLicenseRecord[]): AssetInventoryTable {
	// Face value: the roster shows what the record claims about itself,
	// never an unverified digest read (see `faceValueObservations`).
	const observations = faceValueObservations(records);
	const rows = records.map((record) => {
		const review: AssetReview = evaluateAssetLicense(record, observations);
		return {
			key: record.id,
			label: record.id,
			cells: {
				record: record.id,
				decision: DECISION_LABEL[review.decision],
				kind: KIND_LABEL[record.kind],
				spdx: record.license.spdx,
				covers: claimedPatterns(record),
				title: record.title,
			},
		};
	});
	return {
		caption: `資産記録 ${records.length} 件（記録 id / 導出判定 / 種別 / ライセンス / 対象 / 名称）`,
		columns: INVENTORY_COLUMNS,
		rows,
		note: '対象は記録が主張する covers のパターン。監査対象ファイルの実数は gate が数える（pnpm run assets:license:check）。',
	};
}
