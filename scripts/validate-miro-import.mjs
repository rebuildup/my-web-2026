#!/usr/bin/env node
/**
 * Validate a Miro board export dropped at quality/miro/board-export.json
 * against the import contract (Issue #741).
 *
 * The agent environment has no Miro read path — the board content is
 * supplied out-of-band (ChatGPT Miro connection export, manual export,
 * or shared file). The raw export may contain private information:
 * it is gitignored, treated as private input, and NEVER committed.
 * Only derived, publicity-checked ledgers are published.
 *
 * This script is the ingest gate. It proves the file is structurally
 * complete BEFORE the Issue cross-reference table is generated, so a
 * partial or malformed export cannot silently produce a wrong ledger.
 *
 * Checks (all fail-closed):
 *   1. JSON Schema validation (ajv, draft 2020-12) against
 *      quality/miro/board-import.schema.json — required sections,
 *      field shapes, enums, additionalProperties.
 *   2. Board identity: board.id must equal the source-counts boardId,
 *      so the wrong board cannot pass.
 *   3. Uniqueness: item, connector and frame ids are each unique.
 *   4. References: item.parentFrameId resolves to a declared frame;
 *      connector startRefId/endRefId resolve to a declared item OR
 *      frame (Miro treats frames as connectable items).
 *   5. Self-consistency: board.itemCounts equals the actual array
 *      contents (catches a truncated-but-recounted export).
 *   6. Completeness floor: actual counts must meet the source-observed
 *      minimums in quality/miro/source-counts.json (571 stickies /
 *      583 connectors / 1 frame as counted 2026-11). Self-consistency
 *      alone is NOT proof of completeness — a truncated export that
 *      recounts itself would pass check 5 and fail here.
 *
 * Usage:
 *   node scripts/validate-miro-import.mjs [export-path]
 *       [--counts=path] [--schema=path]
 * Defaults: quality/miro/board-export.json,
 *           quality/miro/source-counts.json,
 *           quality/miro/board-import.schema.json
 * Exit codes: 0 pass, 1 validation failures, 2 undecidable input.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import addFormats from 'ajv-formats';
import Ajv from 'ajv/dist/2020.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const DEFAULTS = {
	export: 'quality/miro/board-export.json',
	counts: 'quality/miro/source-counts.json',
	schema: 'quality/miro/board-import.schema.json',
};

function parseArgs(argv) {
	const opts = { export: DEFAULTS.export, counts: DEFAULTS.counts, schema: DEFAULTS.schema };
	const positional = [];
	for (const arg of argv) {
		const eq = arg.indexOf('=');
		if (eq > 0 && arg.startsWith('--')) {
			const key = arg.slice(2, eq);
			const value = arg.slice(eq + 1);
			if (key === 'counts') opts.counts = value;
			else if (key === 'schema') opts.schema = value;
			else throw new Error(`unknown option: --${key}`);
		} else {
			positional.push(arg);
		}
	}
	if (positional.length > 1) throw new Error(`unexpected argument: ${positional[1]}`);
	if (positional.length === 1) opts.export = positional[0];
	return opts;
}

function readJson(path, label) {
	try {
		return JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
	} catch (error) {
		console.error(`[miro-import] UNDECIDABLE: cannot read ${label} ${path}: ${error.message}`);
		process.exit(2);
	}
}

const opts = parseArgs(process.argv.slice(2));
const schema = readJson(opts.schema, 'schema');
const counts = readJson(opts.counts, 'source counts');
const data = readJson(opts.export, 'export');

const errors = [];
const fail = (msg) => errors.push(msg);

/* 1. JSON Schema validation — the contract itself, not a restatement. */
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
let validate;
try {
	validate = ajv.compile(schema);
} catch (error) {
	console.error(`[miro-import] UNDECIDABLE: schema does not compile: ${error.message}`);
	process.exit(2);
}
const schemaValid = validate(data);
if (!schemaValid) {
	for (const err of validate.errors ?? []) {
		fail(`schema ${err.instancePath || '/'} ${err.message}`);
	}
}

/* Semantic checks run defensively even when the schema failed, so one
 * pass reports every problem class at once. */
const items = Array.isArray(data?.items) ? data.items : [];
const connectors = Array.isArray(data?.connectors) ? data.connectors : [];
const frames = Array.isArray(data?.frames) ? data.frames : [];

/* 2. Board identity. */
const expectedBoardId = counts?.boardId;
if (typeof expectedBoardId === 'string' && data?.board?.id !== expectedBoardId) {
	fail(
		`board.id ${JSON.stringify(data?.board?.id)} does not match source-counts boardId ${JSON.stringify(expectedBoardId)}`,
	);
}

const frameIds = new Set();
for (const frame of frames) {
	if (!frame?.id) continue;
	if (frameIds.has(frame.id)) fail(`duplicate frame id ${frame.id}`);
	frameIds.add(frame.id);
}

const itemIds = new Set();
for (const item of items) {
	if (!item?.id) continue;
	if (itemIds.has(item.id)) fail(`duplicate item id ${item.id}`);
	itemIds.add(item.id);
	if (item.parentFrameId != null && !frameIds.has(item.parentFrameId)) {
		fail(`item ${item.id} references unknown frame ${item.parentFrameId}`);
	}
}

/* 4. Connector endpoints resolve to a declared item OR frame. */
const endpointIds = new Set([...itemIds, ...frameIds]);
const connectorIds = new Set();
for (const c of connectors) {
	if (!c?.id) continue;
	if (connectorIds.has(c.id)) fail(`duplicate connector id ${c.id}`);
	connectorIds.add(c.id);
	if (c.startRefId != null && !endpointIds.has(c.startRefId)) {
		fail(`connector ${c.id} start ${c.startRefId} unresolved`);
	}
	if (c.endRefId != null && !endpointIds.has(c.endRefId)) {
		fail(`connector ${c.id} end ${c.endRefId} unresolved`);
	}
}

/* 5. Self-consistency: declared itemCounts vs actual arrays. */
const actual = {
	stickies: items.filter((i) => i?.kind === 'sticky').length,
	connectors: connectors.length,
	frames: frames.length,
};
const declared = data?.board?.itemCounts;
if (declared && typeof declared === 'object') {
	for (const [k, v] of Object.entries(actual)) {
		if (k in declared && declared[k] !== v) {
			fail(`itemCounts.${k}=${declared[k]} but export has ${v}`);
		}
	}
}

/* 6. Completeness floor vs the source-observed minimums. */
const minimums = counts?.minimums;
if (minimums && typeof minimums === 'object') {
	for (const [k, floor] of Object.entries(minimums)) {
		if (typeof floor !== 'number') continue;
		const have = actual[k];
		if (have === undefined) {
			fail(`source-counts minimums.${k} has no corresponding export section`);
		} else if (have < floor) {
			fail(
				`completeness: ${k}=${have} is below the source-observed minimum ${floor} — export is likely truncated`,
			);
		}
	}
}

if (errors.length) {
	console.error(`[miro-import] FAIL (${errors.length}):\n${errors.join('\n')}`);
	process.exit(1);
}
const floorNote = minimums
	? ` (floors ${JSON.stringify(minimums)} met)`
	: ' (no source-counts floors declared)';
console.log(
	`[miro-import] OK — ${items.length} items (${actual.stickies} stickies), ${connectors.length} connectors, ${frames.length} frames${floorNote}`,
);
