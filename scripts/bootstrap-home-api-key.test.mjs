import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
/**
 * `bootstrap-home-api-key.mjs` machine-readable JSON output tests.
 *
 * The full script invokes `wrangler d1 execute` (a real CLI sub-process)
 * which we cannot exercise from a unit test. We instead verify the
 * pure formatting logic that produces the machine-readable JSON output
 * (ADR-0015 §E) by sourcing the script's pure helper functions and
 * calling them directly.
 *
 * Invariants tested:
 *   - The JSON output has exactly 7 fields (id, prefix, start,
 *     createdAt, enabled, name, referenceId) — matches §6 step 0
 *     query contract
 *   - Keys are sorted alphabetically for stable diffs
 *   - Coercion: createdAt / enabled are always Number; id / prefix /
 *     start / name / referenceId are always String
 *   - Output is single-line (no embedded newlines)
 */
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, 'bootstrap-home-api-key.mjs');

// Extract pure helpers from the script via a thin shim. We do not
// want to import the whole module because it runs at import time
// (parses argv, calls D1). Instead we read the source and pull out
// `normalizeRow` and `formatKeyRowJson` via a `Function` constructor
// inside an isolated scope.
async function loadPureHelpers() {
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(SCRIPT, 'utf8');

	// Slice out the function bodies (regex-based; the script is small
	// and stable). We deliberately do NOT eval the whole script.
	function extract(name) {
		const re = new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`, 'm');
		const match = source.match(re);
		if (!match) throw new Error(`Could not extract ${name}`);
		return match[0];
	}

	const normalizeRow = extract('normalizeRow');
	const formatKeyRowJson = extract('formatKeyRowJson');

	const factory = new Function(`
		${normalizeRow}
		${formatKeyRowJson}
		return { normalizeRow, formatKeyRowJson };
	`);
	return factory();
}

describe('bootstrap-home-api-key.mjs', () => {
	describe('machine-readable JSON output (ADR-0015 §E)', () => {
		it('produces a single-line JSON with all 7 required fields', async () => {
			const { formatKeyRowJson } = await loadPureHelpers();
			const row = {
				id: 'row-uuid-1234',
				prefix: 'mk_home_',
				start: 'mk_hom',
				createdAt: 1737830400000,
				enabled: 1,
				name: 'home-self-consumption',
				referenceId: 'admin-uuid-5678',
			};
			const out = formatKeyRowJson(row);
			assert.doesNotMatch(out, /\n/);
			const parsed = JSON.parse(out);
			assert.deepEqual(Object.keys(parsed).sort(), [
				'createdAt',
				'enabled',
				'id',
				'name',
				'prefix',
				'referenceId',
				'start',
			]);
			assert.equal(parsed.id, 'row-uuid-1234');
			assert.equal(parsed.prefix, 'mk_home_');
			assert.equal(parsed.start, 'mk_hom');
			assert.equal(parsed.createdAt, 1737830400000);
			assert.equal(parsed.enabled, 1);
			assert.equal(parsed.name, 'home-self-consumption');
			assert.equal(parsed.referenceId, 'admin-uuid-5678');
		});

		it('sorts keys alphabetically for stable diffs', async () => {
			const { formatKeyRowJson } = await loadPureHelpers();
			const row = {
				id: 'a',
				prefix: 'b',
				start: 'c',
				createdAt: 1,
				enabled: 1,
				name: 'd',
				referenceId: 'e',
			};
			const out = formatKeyRowJson(row);
			// Keys should appear in alphabetical order: createdAt,
			// enabled, id, name, prefix, referenceId, start.
			const expected =
				'{"createdAt":1,"enabled":1,"id":"a","name":"d","prefix":"b","referenceId":"e","start":"c"}';
			assert.equal(out, expected);
		});

		it('JSON.stringify output is round-trip parseable', async () => {
			const { formatKeyRowJson } = await loadPureHelpers();
			const row = {
				id: 'a',
				prefix: 'b',
				start: 'c',
				createdAt: 1737830400000,
				enabled: 0,
				name: 'd',
				referenceId: 'e',
			};
			const parsed = JSON.parse(formatKeyRowJson(row));
			assert.deepEqual(parsed, row);
		});
	});

	describe('normalizeRow coercion', () => {
		it('coerces createdAt / enabled to Number even if D1 returns strings', async () => {
			const { normalizeRow } = await loadPureHelpers();
			const rawRow = {
				id: 'row-uuid',
				prefix: 'mk_home_',
				start: 'mk_hom',
				createdAt: '1737830400000', // string from D1
				enabled: '1', // string from D1
				name: 'home-self-consumption',
				referenceId: 'admin-uuid',
			};
			const normalized = normalizeRow(rawRow);
			assert.equal(typeof normalized.createdAt, 'number');
			assert.equal(normalized.createdAt, 1737830400000);
			assert.equal(typeof normalized.enabled, 'number');
			assert.equal(normalized.enabled, 1);
			assert.equal(typeof normalized.id, 'string');
			assert.equal(typeof normalized.prefix, 'string');
			assert.equal(typeof normalized.start, 'string');
			assert.equal(typeof normalized.name, 'string');
			assert.equal(typeof normalized.referenceId, 'string');
		});

		it('preserves already-correct types', async () => {
			const { normalizeRow } = await loadPureHelpers();
			const row = {
				id: 'a',
				prefix: 'b',
				start: 'c',
				createdAt: 1737830400000,
				enabled: 1,
				name: 'd',
				referenceId: 'e',
			};
			const normalized = normalizeRow(row);
			assert.deepEqual(normalized, row);
		});
	});

	describe('output round-trip', () => {
		it('JSON output + plaintext enables rotation runbook step 0 query', async () => {
			const { normalizeRow, formatKeyRowJson } = await loadPureHelpers();
			// Simulate the flow: INSERT OR IGNORE inserts, then we
			// re-read by hash, then we output plaintext + JSON.
			const rawRow = {
				id: 'inserted-uuid-1234',
				prefix: 'mk_home_',
				start: 'mk_hom',
				createdAt: Date.now(),
				enabled: 1,
				name: 'home-self-consumption',
				referenceId: 'admin-user-uuid',
			};
			const normalized = normalizeRow(rawRow);
			const plaintext = 'mk_home_TestPlaintextXXXXXXXXXXXXXXXXXXXXX';
			const jsonLine = formatKeyRowJson(normalized);

			// Output structure:
			//   <banner>
			//   <blank>
			//   <plaintext>
			//   <blank>
			//   <json line>
			const output = `# banner\n\n${plaintext}\n\n${jsonLine}`;

			const lines = output.split('\n');
			assert.equal(lines[0], '# banner');
			assert.equal(lines[1], '');
			assert.equal(lines[2], plaintext);
			assert.equal(lines[3], '');
			const parsed = JSON.parse(lines[4]);
			assert.equal(parsed.id, 'inserted-uuid-1234');
			assert.equal(parsed.enabled, 1);
			assert.equal(parsed.name, 'home-self-consumption');
		});
	});
});

// Suppress unused imports (pathToFileURL kept for future ESM-direct import tests).
void pathToFileURL;
