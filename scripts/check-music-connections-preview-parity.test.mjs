#!/usr/bin/env node

/**
 * check-music-connections-preview-parity — the Issue #525 parity
 * gate between `docs/influences/music-connections.md` (the reference
 * document) and
 * `src/personal/music-connections/MusicConnections.preview.ts` (the
 * preview's copy of it).
 *
 * Why this gate exists
 * --------------------
 * The reference document is a Markdown file and the preview is a data
 * module. Two copies of one text drift: a rule is added to the
 * Markdown and the preview keeps showing the old set; a bullet is
 * reworded in the preview and the document and the picture disagree.
 * A reviewer reading only the screenshot would then approve a rule
 * they never read.
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
 * The comparison is EQUALITY, not containment: a heading or a list
 * item that exists on one side only is a failure. The gate never
 * decides which side is right — a difference is a difference the
 * reference document has to record (as a held item) or a difference
 * the preview has to drop.
 *
 * The document's front matter (the title, the `>` header block and
 * the three sentences before §1) is the document's own opening and is
 * not part of the preview, so the comparison starts at §1.
 *
 * What else is asserted here
 * --------------------------
 * The document states four mechanical properties in its own "機械で
 * 守っていること" section. They are checked here rather than left to
 * a reader's memory:
 *
 *   - the four kinds (音楽 / 制作文化 / アーティスト / 映像作品)
 *     exist exactly once each, on both sides;
 *   - the four contact axes (楽曲 / 制作文化 / 映像表現 / ソフトウェア
 *     制作) exist exactly once each, on both sides;
 *   - the three prohibited vocabularies (a causal claim, a third
 *     party's private life, a fabricated measurement) appear only
 *     where they are forbidden — a sentence that names one of them in
 *     order to ban it has to carry that ban, otherwise the gate
 *     cannot tell an assertion from a prohibition;
 *   - every repository path the document and the preview cite
 *     exists, so a document that points at a capture script or an
 *     artefact nobody produced fails instead of shipping a false
 *     reference.
 *
 * Run:
 *   node --experimental-strip-types --test scripts/check-music-connections-preview-parity.test.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MUSIC_CONNECTIONS } from '../src/personal/music-connections/MusicConnections.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The reference document (the canonical text). */
const DOCUMENT_PATH = 'docs/influences/music-connections.md';

/** The preview's copy of the reference document. */
const PREVIEW_PATH = 'src/personal/music-connections/MusicConnections.preview.ts';

/** The four kinds the document distinguishes. */
const KINDS = ['音楽', '制作文化', 'アーティスト', '映像作品'];

/** The four contact axes the document records. */
const AXES = ['楽曲', '制作文化', '映像表現', 'ソフトウェア制作'];

/**
 * The three vocabularies the document prohibits, and the wording that
 * marks a sentence as naming one of them in order to ban it.
 *
 * The distinction matters: a document that says "私生活を記録しない"
 * is obeying the rule, and a document that says "私生活を記録した" is
 * breaking it. A keyword scan cannot tell the two apart unless the
 * ban itself is part of the sentence, so a sentence that carries one
 * of the terms has to carry a ban too.
 */
const PROHIBITION_VOCABULARY = [
	{ label: '因果の断定', terms: ['影響'] },
	{
		label: '第三者の私生活',
		terms: ['私生活', '家族', '交際', '収入', '健康', '所在地'],
	},
	{
		label: '創作された数値',
		terms: ['再生数', '視聴者数', '順位', '売上', '評価', '人数', '年表', '万人', '億', '%'],
	},
];

/** The wording that marks a sentence as a prohibition. */
const PROHIBITION_MARKERS = [
	'記録しない',
	'書かない',
	'作らない',
	'創作されていない',
	'置かない',
	'使わない',
	'現れない',
	'主張ではない',
	'禁止',
	'測っていない',
	'測定していない',
];

/**
 * Parse the reference document into sections, blocks and list items.
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
function parseDocument(source) {
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
			current = { heading: line.slice(3), lead: '', blocks: [], paragraphs: [] };
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

/** The reference document's sections, read from the file. */
function documentSections() {
	const source = readFileSync(resolve(REPO_ROOT, DOCUMENT_PATH), 'utf8');
	return parseDocument(source);
}

/** The preview's sections, read as plain data. */
function previewSections() {
	return MUSIC_CONNECTIONS.sections;
}

/** Every bullet of every block of every section. */
function allBullets(sections) {
	return sections.flatMap((section) => section.blocks.flatMap((block) => block.bullets));
}

/**
 * Every repository path a text cites.
 *
 * @param {string} source
 * @returns {string[]}
 */
function citedPaths(source) {
	const paths = source.match(/(?:docs|src|scripts)\/[A-Za-z0-9._/-]+/g) ?? [];
	return [...new Set(paths.map((path) => path.replace(/\.+$/, '')))];
}

describe('music-connections preview parity', () => {
	it('the reference document and the preview agree on every heading', () => {
		const { sections } = documentSections();
		const documentHeadings = sections.map((section) => section.heading);
		const previewHeadings = previewSections().map((section) => section.heading);
		assert.deepEqual(
			previewHeadings,
			documentHeadings,
			`the ${PREVIEW_PATH} headings and the ${DOCUMENT_PATH} headings differ`,
		);
	});

	it('every section has exactly one paragraph, and the preview carries it', () => {
		const { sections, stray } = documentSections();
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
		const { sections } = documentSections();
		for (const [index, section] of sections.entries()) {
			const preview = previewSections()[index];
			const documentSubHeadings = section.blocks
				.map((entry) => entry.heading)
				.filter((heading) => heading !== null);
			const previewSubHeadings = preview.blocks
				.map((entry) => entry.heading)
				.filter((heading) => heading !== null);
			assert.deepEqual(
				previewSubHeadings,
				documentSubHeadings,
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

	it('the document metadata appears in the reference document', () => {
		const source = readFileSync(resolve(REPO_ROOT, DOCUMENT_PATH), 'utf8');
		const metadata = MUSIC_CONNECTIONS.document;
		for (const value of [
			metadata.title,
			metadata.status,
			metadata.source,
			metadata.verification,
			metadata.preview,
		]) {
			assert.ok(
				source.includes(value),
				`the preview metadata "${value}" does not appear in ${DOCUMENT_PATH}`,
			);
		}
	});

	it('the four kinds exist exactly once each, on both sides', () => {
		const index = previewSections().findIndex((section) => section.kind === 'kinds');
		assert.ok(index >= 0, 'the preview has no section for the four kinds');
		const { sections } = documentSections();
		const documentHeadings = sections[index].blocks.map((block) => block.heading);
		const previewHeadings = previewSections()[index].blocks.map((block) => block.heading);
		for (const kind of KINDS) {
			assert.equal(
				documentHeadings.filter((heading) => heading === kind).length,
				1,
				`the reference document does not carry "${kind}" exactly once`,
			);
			assert.equal(
				previewHeadings.filter((heading) => heading === kind).length,
				1,
				`the preview does not carry "${kind}" exactly once`,
			);
		}
	});

	it('the four contact axes exist exactly once each, on both sides', () => {
		const index = previewSections().findIndex((section) => section.kind === 'axes');
		assert.ok(index >= 0, 'the preview has no section for the four contact axes');
		const { sections } = documentSections();
		const documentHeadings = sections[index].blocks.map((block) => block.heading);
		const previewHeadings = previewSections()[index].blocks.map((block) => block.heading);
		for (const axis of AXES) {
			assert.equal(
				documentHeadings.filter((heading) => heading === axis).length,
				1,
				`the reference document does not carry "${axis}" exactly once`,
			);
			assert.equal(
				previewHeadings.filter((heading) => heading === axis).length,
				1,
				`the preview does not carry "${axis}" exactly once`,
			);
		}
	});

	it('a prohibited vocabulary appears only where it is forbidden', () => {
		for (const section of previewSections()) {
			if (section.kind === 'prohibition') continue;
			const sentences = [
				{ text: section.lead, context: section.heading },
				...section.blocks.flatMap((block) =>
					block.bullets.map((bullet) => ({
						text: bullet,
						context: block.heading ?? section.heading,
					})),
				),
			];
			for (const sentence of sentences) {
				for (const vocabulary of PROHIBITION_VOCABULARY) {
					if (!vocabulary.terms.some((term) => sentence.text.includes(term))) continue;
					const carriesTheBan =
						PROHIBITION_MARKERS.some((marker) => sentence.text.includes(marker)) ||
						PROHIBITION_MARKERS.some((marker) => sentence.context.includes(marker));
					assert.ok(
						carriesTheBan,
						`"${sentence.text}" uses the ${vocabulary.label} vocabulary without forbidding it`,
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
			for (const bullet of allBullets([section])) {
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

	it('every repository path the document and the preview cite exists', () => {
		const documentSource = readFileSync(resolve(REPO_ROOT, DOCUMENT_PATH), 'utf8');
		const previewSource = readFileSync(resolve(REPO_ROOT, PREVIEW_PATH), 'utf8');
		const paths = [...citedPaths(documentSource), ...citedPaths(previewSource)];
		assert.ok(paths.length > 0, 'the reference document cites no repository path');
		for (const path of paths) {
			assert.ok(
				existsSync(resolve(REPO_ROOT, path)),
				`the reference document cites "${path}", which does not exist in the repository`,
			);
		}
	});
});
