#!/usr/bin/env node
/**
 * Validate a Miro board export dropped at quality/miro/board-export.json
 * against the import contract (Issue #741).
 *
 * The agent environment has no Miro read path — the board content is
 * supplied out-of-band (ChatGPT Miro connection export, manual export,
 * or shared file). This script is the ingest gate: it proves the file
 * is structurally complete BEFORE the Issue cross-reference table is
 * generated, so a partial or malformed export cannot silently produce
 * a wrong ledger.
 *
 * Checks (all fail-closed):
 *   - required top-level sections present
 *   - item ids unique; connector endpoints resolve to real items
 *   - parentFrameId resolves to a declared frame
 *   - declared itemCounts match the actual arrays (catches truncation)
 *
 * Usage: node scripts/validate-miro-import.mjs [path]
 */

import { readFileSync } from 'node:fs';

const target = process.argv[2] ?? 'quality/miro/board-export.json';
const data = JSON.parse(readFileSync(target, 'utf8'));
const errors = [];
const fail = (msg) => errors.push(msg);

for (const key of ['board', 'exportedAt', 'items', 'connectors', 'frames']) {
	if (!(key in data)) fail(`missing top-level "${key}"`);
}
if (errors.length) {
	console.error(`[miro-import] FAIL: ${errors.join('; ')}`);
	process.exit(1);
}

const items = data.items ?? [];
const connectors = data.connectors ?? [];
const frames = data.frames ?? [];
const itemIds = new Set();
for (const item of items) {
	if (!item.id) { fail('item without id'); continue; }
	if (itemIds.has(item.id)) fail(`duplicate item id ${item.id}`);
	itemIds.add(item.id);
	if (item.parentFrameId != null && !frames.some((f) => f.id === item.parentFrameId)) {
		fail(`item ${item.id} references unknown frame ${item.parentFrameId}`);
	}
}
const frameIds = new Set(frames.map((f) => f.id));
for (const c of connectors) {
	if (!itemIds.has(c.startItemId)) fail(`connector ${c.id} start ${c.startItemId} unresolved`);
	if (!itemIds.has(c.endItemId)) fail(`connector ${c.id} end ${c.endItemId} unresolved`);
}
const counts = data.board?.itemCounts;
if (counts) {
	const actual = {
		stickies: items.filter((i) => i.kind === 'sticky').length,
		connectors: connectors.length,
		frames: frames.length,
	};
	for (const [k, v] of Object.entries(counts)) {
		if (k in actual && actual[k] !== v) {
			fail(`itemCounts.${k}=${v} but export has ${actual[k]}`);
		}
	}
}
void frameIds;

if (errors.length) {
	console.error(`[miro-import] FAIL (${errors.length}):\n${errors.join('\n')}`);
	process.exit(1);
}
console.log(
	`[miro-import] OK — ${items.length} items, ${connectors.length} connectors, ${frames.length} frames`,
);
