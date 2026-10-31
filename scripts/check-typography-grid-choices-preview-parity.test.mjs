#!/usr/bin/env node

/**
 * check-typography-grid-choices-preview-parity — the Issue #527 parity
 * gate between `docs/influences/typography-grid-swiss-design.md` (the
 * record) and
 * `src/personal/typography-grid-swiss/TypographyGridChoices.preview.ts`
 * (the preview's copy of it).
 *
 * Why this gate exists
 * --------------------
 * The record is a Markdown file and the preview is a data module. Two
 * copies of one text drift: a heading is added to the Markdown and the
 * preview keeps showing the old set; a decision is reworded in the
 * preview and the document and the picture disagree. A reviewer reading
 * only the screenshot would then approve a record they never read.
 *
 * So the two are compared mechanically, on every `pnpm run test` (the
 * runner discovers every `scripts/*.test.mjs` by convention):
 *
 *   - the `##` headings, in order;
 *   - the `###` headings of each section, in order;
 *   - every list item of every block, in order;
 *   - the one paragraph of every section;
 *   - the document metadata, which has to appear in the Markdown.
 *
 * The comparison is EQUALITY, not containment: a heading or a list item
 * that exists on one side only is a failure. The gate never decides
 * which side is right — a difference is a difference the record has to
 * record (as a held item) or a difference the preview has to drop.
 *
 * What else is asserted here
 * --------------------------
 * The record's examples and counter-examples are supposed to be the
 * SHIPPED ones, so the gate reads the shipped registries and proves the
 * fixture is exactly them:
 *
 *   - the compared screen's four rows are
 *     `src/home/capabilities/registry.ts`, in the shipped order, with
 *     the shipped label / summary / status;
 *   - the status rows of the first counter-example are
 *     `src/home/status/services.ts`;
 *   - the measured Japanese paragraph is the record's own section 5
 *     lead paragraph, so the comparison measures text this repository
 *     already owns.
 *
 * And the record's own decisions are asserted to be present, because a
 * record without an adoption, a held item and a rejection is not a
 * record:
 *
 *   - the adopted, held and rejected blocks each exist;
 *   - a held item carries exactly `理由` / `根拠` / `解除条件`;
 *   - a rejected item carries exactly `理由` / `根拠` / `代替`;
 *   - the preview carries no absolute URL, no e-mail address and no
 *     home directory path (the preview ships in the public repository
 *     and in the public build).
 *
 * Run:
 *   node --experimental-strip-types --test scripts/check-typography-grid-choices-preview-parity.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES } from '../src/home/capabilities/registry.ts';
import { SYSTEM_SERVICES } from '../src/home/status/services.ts';
import {
	COMPARISON_PARAGRAPH,
	COMPARISON_SCREEN,
	STATUS_ROWS,
	TYPOGRAPHY_GRID_CHOICES,
} from '../src/personal/typography-grid-swiss/TypographyGridChoices.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The record (the canonical text). */
const RECORD_PATH = 'docs/influences/typography-grid-swiss-design.md';

/** The preview's copy of the record. */
const PREVIEW_PATH = 'src/personal/typography-grid-swiss/TypographyGridChoices.preview.ts';

/**
 * Parse the record into sections, blocks and list items.
 *
 * The parser is intentionally strict: a line that is neither a
 * heading, a list item, a blank line nor a quoted line is a
 * paragraph. A section may hold exactly one paragraph (its lead); a
 * second one is reported rather than dropped, because "the preview
 * shows one paragraph and the document shows two" is exactly the
 * drift this gate is about.
 *
 * @param {string} source
 * @returns {{ sections: { heading: string, lead: string, blocks: { heading: string | null, bullets: string[] }[] }[], stray: string[] }}
 */
function parseRecord(source) {
	/** @type {any[]} */
	const sections = [];
	let current = null;
	let block = null;
	let paragraph = null;
	/** @type {string[]} */
	const stray = [];

	for (const line of source.split('\n')) {
		if (line.startsWith('## ')) {
			if (current) sections.push(current);
			current = { heading: line.slice(3), lead: null, blocks: [], paragraphs: [] };
			block = null;
			paragraph = null;
			continue;
		}
		if (!current) continue;
		if (line.startsWith('### ')) {
			block = { heading: line.slice(4), bullets: [] };
			current.blocks.push(block);
			paragraph = null;
			continue;
		}
		if (line.startsWith('- ')) {
			if (!block) {
				block = { heading: null, bullets: [] };
				current.blocks.push(block);
			}
			block.bullets.push(line.slice(2));
			continue;
		}
		if (line.trim() === '') continue;
		// The quoted header block (`> Status: …`) sits above the first
		// `##`, so it never reaches this branch; a `>` line inside a
		// section would be a quote, and is not a paragraph.
		if (line.startsWith('>')) continue;
		if (paragraph === null) {
			paragraph = line;
			current.paragraphs.push(line);
		} else {
			stray.push(`${current.heading}: ${line}`);
		}
	}
	if (current) sections.push(current);

	for (const section of sections) {
		section.lead = section.paragraphs[0] ?? '';
	}
	return { sections, stray };
}

/** The record's sections, read from the file. */
function recordSections() {
	const source = readFileSync(resolve(REPO_ROOT, RECORD_PATH), 'utf8');
	return parseRecord(source);
}

/** The preview's sections, read as plain data. */
function previewSections() {
	return TYPOGRAPHY_GRID_CHOICES.sections;
}

describe('typography-grid-choices preview parity', () => {
	it('the record and the preview agree on every heading', () => {
		const { sections } = recordSections();
		const recordHeadings = sections.map((section) => section.heading);
		const previewHeadings = previewSections().map((section) => section.heading);
		assert.deepEqual(
			previewHeadings,
			recordHeadings,
			`the ${PREVIEW_PATH} headings and the ${RECORD_PATH} headings differ`,
		);
	});

	it('every section has exactly one paragraph, and the preview carries it', () => {
		const { sections, stray } = recordSections();
		assert.deepEqual(stray, [], 'a section holds more than one paragraph');
		for (const [index, section] of sections.entries()) {
			const preview = previewSections()[index];
			assert.equal(
				preview.lead,
				section.lead,
				`the lead paragraph of "${section.heading}" differs between the Markdown and the preview`,
			);
		}
	});

	it('every sub-heading and every list item agrees, in order', () => {
		const { sections } = recordSections();
		for (const [index, section] of sections.entries()) {
			const preview = previewSections()[index];
			const recordSubHeadings = section.blocks
				.map((entry) => entry.heading)
				.filter((heading) => heading !== null);
			const previewSubHeadings = preview.blocks
				.map((entry) => entry.heading)
				.filter((heading) => heading !== null);
			assert.deepEqual(
				previewSubHeadings,
				recordSubHeadings,
				`the sub-headings of "${section.heading}" differ between the Markdown and the preview`,
			);
			for (const [blockIndex, block] of section.blocks.entries()) {
				assert.deepEqual(
					preview.blocks[blockIndex].bullets,
					block.bullets,
					`the list items of "${section.heading} / ${block.heading ?? '(inline)'}" differ between the Markdown and the preview`,
				);
			}
		}
	});

	it('the document metadata appears in the record', () => {
		const source = readFileSync(resolve(REPO_ROOT, RECORD_PATH), 'utf8');
		const metadata = TYPOGRAPHY_GRID_CHOICES.document;
		for (const value of [
			metadata.title,
			metadata.status,
			metadata.source,
			metadata.verification,
			metadata.preview,
		]) {
			assert.ok(
				source.includes(value),
				`the preview metadata "${value}" does not appear in ${RECORD_PATH}`,
			);
		}
	});

	it('the compared screen is listed in the record, string by string', () => {
		const { sections } = recordSections();
		const comparison = sections.find((section) => section.heading.startsWith('7. '));
		assert.ok(comparison, 'the record has no section 7');
		const strings = comparison.blocks.find((block) => block.heading === '比較対象の文字列');
		assert.ok(strings, 'the record has no "比較対象の文字列" block');
		const expected = [
			`eyebrow: ${COMPARISON_SCREEN.eyebrow}`,
			`見出し: ${COMPARISON_SCREEN.title}`,
			`説明: ${COMPARISON_SCREEN.description}`,
			...COMPARISON_SCREEN.rows.map(
				(row, index) => `行 ${index + 1}: ${row.label} / ${row.value} / ${row.status}`,
			),
		];
		assert.deepEqual(
			strings.bullets,
			expected,
			'the compared screen in the record and in the preview differ',
		);
	});

	it('the compared screen is the shipped capability registry', () => {
		assert.deepEqual(
			COMPARISON_SCREEN.rows.map((row) => ({
				label: row.label,
				value: row.value,
				status: row.status,
			})),
			CAPABILITIES.map((capability) => ({
				label: capability.labelJa,
				value: capability.summaryJa,
				status: capability.status,
			})),
			'the compared screen is not the shipped capability registry',
		);
	});

	it('the status rows of the counter-example are the shipped service registry', () => {
		assert.deepEqual(
			STATUS_ROWS.map((row) => ({
				label: row.label,
				binding: row.binding,
				detail: row.detail,
			})),
			SYSTEM_SERVICES.map((service) => ({
				label: service.label,
				binding: service.binding,
				detail: service.description,
			})),
			'the counter-example rows are not the shipped service registry',
		);
	});

	it("the measured paragraph is the record's own section 5 lead", () => {
		const { sections } = recordSections();
		const counterExample = sections.find((section) => section.heading.startsWith('5. '));
		assert.ok(counterExample, 'the record has no section 5');
		assert.equal(
			COMPARISON_PARAGRAPH,
			counterExample.lead,
			"the measured paragraph is not the record's own section 5 lead paragraph",
		);
	});

	it('the record adopts, holds and rejects', () => {
		const { sections } = recordSections();
		const decision = sections.find((section) => section.heading.startsWith('6. '));
		assert.ok(decision, 'the record has no section 6');
		const kinds = decision.blocks.map((block) => block.heading);
		for (const kind of ['採用', '保留', '却下']) {
			assert.ok(kinds.includes(kind), `the record has no "${kind}" decision`);
		}
		const held = decision.blocks.find((block) => block.heading === '保留');
		assert.ok(held, 'the record has no held decision');
		assert.deepEqual(
			held.bullets.map((bullet) => bullet.split(':', 1)[0]),
			['保留', '理由', '根拠', '解除条件'],
			'a held decision carries exactly a decision, a reason, a basis and a release condition',
		);
		const rejected = decision.blocks.find((block) => block.heading === '却下');
		assert.ok(rejected, 'the record has no rejected decision');
		assert.deepEqual(
			rejected.bullets.map((bullet) => bullet.split(':', 1)[0]),
			['却下', '理由', '根拠', '代替'],
			'a rejected decision carries exactly a decision, a reason, a basis and an alternative',
		);
	});

	it('the preview carries no URL, no e-mail address and no home path', () => {
		// A repository path such as `src/home/...` is a source reference,
		// not a home directory; only a path that STARTS at the root of a
		// home directory counts.
		const privateLike =
			/https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+|(?:^|[\s"'([])\/(?:Users|home)\/[^\s]*/;
		for (const section of previewSections()) {
			assert.ok(
				!privateLike.test(section.lead),
				'the preview lead carries a private-looking value',
			);
			for (const bullet of section.blocks.flatMap((block) => block.bullets)) {
				assert.ok(
					!privateLike.test(bullet),
					`the preview carries a private-looking value: ${bullet}`,
				);
			}
		}
	});
});
