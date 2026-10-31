#!/usr/bin/env node

/**
 * check-growth-through-making-preview-parity — the Issue #513 parity
 * gate between `docs/personal/growth-through-making.md` (the
 * specification) and `src/routes/design-system/sections/GrowthThroughMaking.preview.ts`
 * (the preview's copy of it).
 *
 * Why this gate exists
 * --------------------
 * The specification is a Markdown file and the preview is a data
 * module. Two copies of one text drift: a heading is added to the
 * Markdown and the preview keeps showing the old set; a bullet is
 * reworded in the preview and the document and the picture disagree.
 * A reviewer reading only the screenshot would then approve a
 * specification they never read.
 *
 * So the two are compared mechanically, on every `pnpm run test`
 * (the runner discovers every `scripts/*.test.mjs` by convention):
 *
 *   - the `##` headings, in order;
 *   - the `###` headings of each section, in order;
 *   - every list item of every block, in order;
 *   - the one paragraph of every section;
 *   - the document metadata, which has to appear in the Markdown.
 *
 * The comparison is EQUALITY, not containment: a heading or a list
 * item that exists on one side only is a failure. The gate never
 * decides which side is right — a difference is a difference the
 * specification has to record (as a held item) or a difference the
 * preview has to drop.
 *
 * What else is asserted here
 * --------------------------
 * The specification states three prohibitions. Two of them are
 * mechanical properties of the content itself, and they are checked
 * here rather than left to a reader's memory:
 *
 *   - no self-scoring. A score-shaped token (`100 点`, `5 段階`) may
 *     appear only inside a prohibition, where it is named in order to
 *     be banned. The adopted case's labels are exactly `before:` /
 *     `after:` / `学び:` / `証拠:` — a case study is a difference and
 *     its evidence, never a mark out of ten.
 *   - no private data. The preview ships in the public repository and
 *     in the public build, so it may not carry an absolute home path,
 *     an e-mail address, or a year (a timeline is the owner's record
 *     to make, and this specification records none).
 *
 * Run:
 *   node --experimental-strip-types --test scripts/check-growth-through-making-preview-parity.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GROWTH_THROUGH_MAKING } from '../src/routes/design-system/sections/GrowthThroughMaking.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The specification (the canonical text). */
const SPEC_PATH = 'docs/personal/growth-through-making.md';

/** The preview's copy of the specification. */
const PREVIEW_PATH = 'src/routes/design-system/sections/GrowthThroughMaking.preview.ts';

/**
 * Parse the specification into sections, blocks and list items.
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
function parseSpecification(source) {
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

/** The specification's sections, read from the file. */
function markdownSections() {
	const source = readFileSync(resolve(REPO_ROOT, SPEC_PATH), 'utf8');
	return parseSpecification(source);
}

/** The preview's sections, read as plain data. */
function previewSections() {
	return GROWTH_THROUGH_MAKING.sections;
}

describe('growth-through-making preview parity', () => {
	it('the specification and the preview agree on every heading', () => {
		const { sections } = markdownSections();
		const markdownHeadings = sections.map((section) => section.heading);
		const previewHeadings = previewSections().map((section) => section.heading);
		assert.deepEqual(
			previewHeadings,
			markdownHeadings,
			`the ${PREVIEW_PATH} headings and the ${SPEC_PATH} headings differ`,
		);
	});

	it('every section has exactly one paragraph, and the preview carries it', () => {
		const { sections, stray } = markdownSections();
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
		const { sections } = markdownSections();
		for (const [index, section] of sections.entries()) {
			const preview = previewSections()[index];
			const markdownSubHeadings = section.blocks
				.map((entry) => entry.heading)
				.filter((heading) => heading !== null);
			const previewSubHeadings = preview.blocks
				.map((entry) => entry.heading)
				.filter((heading) => heading !== null);
			assert.deepEqual(
				previewSubHeadings,
				markdownSubHeadings,
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

	it('the document metadata appears in the specification', () => {
		const source = readFileSync(resolve(REPO_ROOT, SPEC_PATH), 'utf8');
		const metadata = GROWTH_THROUGH_MAKING.document;
		for (const value of [
			metadata.title,
			metadata.status,
			metadata.source,
			metadata.verification,
			metadata.preview,
		]) {
			assert.ok(
				source.includes(value),
				`the preview metadata "${value}" does not appear in ${SPEC_PATH}`,
			);
		}
	});

	it('the adopted case is a before / after difference with evidence', () => {
		const adopted = previewSections().filter((section) => section.kind === 'adopted-case');
		assert.ok(adopted.length >= 1, 'the specification adopts no before/after case');
		const labels = adopted
			.flatMap((section) => section.blocks)
			.filter((block) => block.kind === 'case')
			.flatMap((block) => block.bullets.map((bullet) => bullet.split(':', 1)[0]));
		assert.deepEqual(
			labels,
			['before', 'after', '学び', '証拠'],
			'an adopted case carries exactly a before, an after, a learning and its evidence',
		);
	});

	it('no self-scoring outside a prohibition', () => {
		const scoreLike = /\d+\s*点|\d+\s*段階/;
		for (const section of previewSections()) {
			if (section.kind === 'prohibition') continue;
			for (const block of section.blocks) {
				for (const bullet of block.bullets) {
					assert.ok(
						!scoreLike.test(bullet),
						`"${section.heading}" carries a score-shaped token: ${bullet}`,
					);
				}
			}
		}
	});

	it('the preview carries no private data and no timeline', () => {
		const privateLike = /\/Users\/|\/home\/|[\w.+-]+@[\w-]+\.[\w.]+/;
		const yearLike = /\b(?:19|20)\d{2}\b/;
		// The platform's own name carries a year, and it is not a
		// timeline entry: it is the repository's name.
		const withoutPlatformName = (value) => value.replace(/my-web-\d{4}/g, 'my-web');
		for (const section of previewSections()) {
			for (const bullet of section.blocks.flatMap((block) => block.bullets)) {
				assert.ok(
					!privateLike.test(bullet),
					`the preview carries a private-looking value: ${bullet}`,
				);
				assert.ok(
					!yearLike.test(withoutPlatformName(bullet)),
					`the preview carries a year; a timeline is the owner's record to make: ${bullet}`,
				);
			}
			assert.ok(!privateLike.test(section.lead), 'the preview lead carries a private value');
			assert.ok(
				!yearLike.test(withoutPlatformName(section.lead)),
				'the preview lead carries a year',
			);
		}
	});
});
