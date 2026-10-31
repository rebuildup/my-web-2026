#!/usr/bin/env node
/**
 * Preview / document parity for the Issue #516 editorial policy.
 *
 * What this proves
 * ----------------
 * The policy document (`docs/vision/audience-purpose-separation.md`) and
 * the preview data (`src/personal/audience-purpose/AudiencePurposeMatrix.preview.ts`)
 * say the SAME thing. A preview that drifts from its document is worse
 * than no preview: a reviewer reads the rendered matrix, believes it is
 * the rule, and edits the site against a rule that is written down
 * somewhere else.
 *
 * The rules
 * ---------
 *   - the `#` title is the same string in both;
 *   - the `##` headings are the same set, in the same order;
 *   - the bullets under a heading are the same lines, in the same order;
 *   - a section's table has the same caption, the same header row and
 *     the same body rows, cell by cell;
 *   - every bullet starts with one of the labels the document declares
 *     (実例 / 反例 / 判断根拠 / 主張種別 / 決定), so a bullet cannot grow
 *     into an unlabelled example;
 *   - nothing structured (a bullet, a table) exists outside the
 *     sections — the preamble is prose, so every example a reader can
 *     find is one the preview also renders.
 *
 * The last rule is the "片方にだけ存在する見出し / 事例" check in both
 * directions: a heading or an example that exists on one side only is a
 * failure, not a difference to be reconciled by hand.
 *
 * Why the data module is imported, not parsed
 * --------------------------------------------
 * The preview data is TypeScript, but it imports nothing and declares
 * no runtime-only syntax, so Node's type stripping reads it directly.
 * Reading the ACTUAL module (rather than a copy of it in the test) is
 * what makes the assertion about the shipped preview and not about a
 * fixture that could drift away from it.
 *
 * Usage: node --experimental-strip-types --test scripts/check-audience-purpose-preview-parity.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	AUDIENCE_PURPOSE_SECTIONS,
	AUDIENCE_PURPOSE_TITLE,
} from '../src/personal/audience-purpose/AudiencePurposeMatrix.preview.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The policy document this gate keeps in step with the preview. */
const DOCUMENT_RELATIVE_PATH = 'docs/vision/audience-purpose-separation.md';

/**
 * The labels a policy bullet may start with.
 *
 * `採用` and `保留` are the DECISION labels (what this Issue adopted,
 * what it deliberately held). The 主張の種別 `採用` (the hiring
 * register) is a different word in a different place: it only appears
 * inside a `主張種別:` bullet or as a table row header, and the
 * decision bullets never repeat it.
 */
const BULLET_LABELS = ['実例', '反例', '判断根拠', '主張種別', '決定', '採用', '保留'];

/** Remove the emphasis markers a Markdown line may carry. */
function stripEmphasis(line) {
	const trimmed = line.trim();
	const strong = /^\*\*(.*)\*\*$/.exec(trimmed);
	if (strong) return strong[1];
	const emphasis = /^\*(.*)\*$/.exec(trimmed) ?? /^_(.*)_$/.exec(trimmed);
	return emphasis ? emphasis[1] : trimmed;
}

/** Split one Markdown table row into its cells. */
function parseTableRow(line) {
	return line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim());
}

/** Whether a line is a table row (the separator row included). */
function isTableRow(line) {
	return line.trim().startsWith('|');
}

/**
 * Parse the document into its title, its preamble and its sections.
 *
 * A section keeps the raw lines under its `##` heading so the bullets
 * and the table can be compared with the preview data.
 */
function parseDocument(text) {
	const lines = text.split('\n');
	let title = null;
	const preamble = [];
	const sections = [];
	let current = null;

	for (const line of lines) {
		if (title === null && line.startsWith('# ')) {
			title = line.slice(2).trim();
			continue;
		}
		if (line.startsWith('## ')) {
			current = { heading: line.slice(3).trim(), lines: [] };
			sections.push(current);
			continue;
		}
		if (current) {
			current.lines.push(line);
		} else {
			preamble.push(line);
		}
	}

	return { title, preamble, sections };
}

/** The bullet lines of a section body, in order. */
function sectionBullets(section) {
	return section.lines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim());
}

/**
 * The first table of a section body.
 *
 * Returns `null` when the section has no table. The header row is the
 * first row, the separator row is dropped, and the rest are the body
 * rows.
 */
function sectionTable(section) {
	const start = section.lines.findIndex(isTableRow);
	if (start === -1) return null;
	const rows = [];
	for (const line of section.lines.slice(start)) {
		if (!isTableRow(line)) break;
		rows.push(parseTableRow(line));
	}
	const [header, separator, ...body] = rows;
	if (!separator || !separator.every((cell) => /^-+$/.test(cell))) return null;
	return { header, body };
}

const document = parseDocument(readFileSync(join(ROOT, DOCUMENT_RELATIVE_PATH), 'utf8'));

describe('audience-purpose preview parity (Issue #516)', () => {
	it('names the document and the preview identically', () => {
		assert.equal(document.title, AUDIENCE_PURPOSE_TITLE);
	});

	it('carries the same section headings in the same order', () => {
		assert.deepEqual(
			document.sections.map((section) => section.heading),
			AUDIENCE_PURPOSE_SECTIONS.map((section) => section.heading),
		);
	});

	it('keeps the preamble prose-only, so every example is a mirrored one', () => {
		const bullets = document.preamble.filter((line) => line.startsWith('- '));
		const tables = document.preamble.filter(isTableRow);
		assert.deepEqual(bullets, [], 'the preamble must not carry bullets');
		assert.deepEqual(tables, [], 'the preamble must not carry a table');
	});

	for (const expected of AUDIENCE_PURPOSE_SECTIONS) {
		describe(expected.heading, () => {
			const section = document.sections.find((entry) => entry.heading === expected.heading);
			assert.ok(section, `the document must have a section named "${expected.heading}"`);

			it('carries the same bullets in the same order', () => {
				assert.deepEqual(sectionBullets(section), [...(expected.points ?? [])]);
			});

			it('labels every bullet', () => {
				for (const point of expected.points ?? []) {
					const label = BULLET_LABELS.find((candidate) => point.startsWith(`${candidate}:`));
					assert.ok(
						label,
						`the bullet "${point}" must start with one of ${BULLET_LABELS.join(' / ')}`,
					);
				}
			});

			it('carries the same table, or no table at all', () => {
				const table = sectionTable(section);
				if (!expected.matrix) {
					assert.equal(table, null, 'the preview has no table, so the document must not have one');
					return;
				}
				assert.ok(table, 'the preview has a table, so the document must have one');
				assert.deepEqual(table.header, [...expected.matrix.columns]);
				assert.deepEqual(
					table.body,
					expected.matrix.rows.map((row) => [...row]),
				);
				const captions = section.lines
					.map(stripEmphasis)
					.filter((line) => line === expected.matrix.caption);
				assert.deepEqual(
					captions,
					[expected.matrix.caption],
					'the table caption must appear exactly once, and with the same wording',
				);
			});
		});
	}

	it('gives every section at least one thing to render', () => {
		for (const section of AUDIENCE_PURPOSE_SECTIONS) {
			const hasPoints = (section.points ?? []).length > 0;
			const hasMatrix = Boolean(section.matrix);
			assert.ok(
				hasPoints || hasMatrix,
				`the section "${section.heading}" renders nothing in the preview`,
			);
		}
	});
});
