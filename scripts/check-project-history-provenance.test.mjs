#!/usr/bin/env node
/**
 * Provenance contract for the Issue #518 project-history fixture.
 *
 * The timeline is only honest if every event rests on a committed
 * record and no date or claim was invented. These assertions cover
 * what can be decided without a browser:
 *
 *   - the fixture covers the Issue's three event kinds
 *     (制作開始 / 改版 / 公開) on a real published work;
 *   - every event carries at least one source, and every source is
 *     either a path that exists in this repository or an absolute
 *     `https:` URL — a citation that points nowhere is a fabricated
 *     source;
 *   - `dateLabel` matches its declared `precision` (a month-precision
 *     entry can never smuggle in a day);
 *   - `kind` / `basis` stay inside the component's closed vocabulary;
 *   - no release-version literal appears: `package.json#version` is
 *     the sole current-version source (AGENTS.md §1), and historical
 *     versions are cited through `docs/release.md`, not restated;
 *   - the recollection event exists and stays `basis: 'recollection'`
 *     — the Issue's 「制作の記憶を事実でない言葉に置き換えない」 rule
 *     needs at least one memory kept as a memory.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MY_WEB_2026_PROJECT_HISTORY } from '../src/portfolio/fixtures/project-history.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KNOWN_KINDS = new Set(['start', 'revision', 'publication', 'note']);
const KNOWN_BASES = new Set(['record', 'recollection']);
const REQUIRED_KINDS = ['start', 'revision', 'publication'];
// X.Y.Z (or X.Y.Z-suffix) — the literal form AGENTS.md §1 reserves
// for package.json#version and docs/release.md's historical records.
const VERSION_LITERAL = /\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/;

function allText(event) {
	return [event.title, event.detail ?? '', ...event.sources.map((s) => s.label)].join('\n');
}

describe('project-history fixture provenance (Issue #518)', () => {
	it('covers the three event kinds the Issue names', () => {
		const kinds = new Set(MY_WEB_2026_PROJECT_HISTORY.events.map((e) => e.kind));
		for (const kind of REQUIRED_KINDS) {
			assert.ok(kinds.has(kind), `fixture has no "${kind}" event`);
		}
	});

	it('keeps kind and basis inside the component vocabulary', () => {
		for (const event of MY_WEB_2026_PROJECT_HISTORY.events) {
			assert.ok(KNOWN_KINDS.has(event.kind), `${event.id}: unknown kind ${event.kind}`);
			assert.ok(KNOWN_BASES.has(event.basis), `${event.id}: unknown basis ${event.basis}`);
		}
	});

	it('gives every event at least one source that resolves', () => {
		for (const event of MY_WEB_2026_PROJECT_HISTORY.events) {
			assert.ok(event.sources.length > 0, `${event.id} has no source`);
			for (const source of event.sources) {
				if (source.url) {
					assert.match(source.url, /^https:\/\//, `${event.id}: non-https source url`);
					continue;
				}
				assert.ok(
					existsSync(join(REPO_ROOT, source.label)),
					`${event.id}: source path does not exist: ${source.label}`,
				);
			}
		}
	});

	it('keeps dateLabel honest about its precision', () => {
		for (const event of MY_WEB_2026_PROJECT_HISTORY.events) {
			if (event.precision === 'month') {
				assert.match(event.dateLabel, /^\d{4}-\d{2}$/, `${event.id}: month label malformed`);
			} else {
				assert.match(event.dateLabel, /^\d{4}-\d{2}-\d{2}$/, `${event.id}: day label malformed`);
			}
		}
	});

	it('writes no release-version literal', () => {
		for (const event of MY_WEB_2026_PROJECT_HISTORY.events) {
			assert.ok(
				!VERSION_LITERAL.test(allText(event)),
				`${event.id}: release-version literal found — cite docs/release.md instead`,
			);
		}
	});

	it('keeps at least one recollection labelled as recollection', () => {
		const recollections = MY_WEB_2026_PROJECT_HISTORY.events.filter(
			(e) => e.basis === 'recollection',
		);
		assert.ok(recollections.length > 0, 'no recollection event — memories would be rewritten');
	});
});
