import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	FLAT_VS_DEPTH_CANDIDATES,
	FLAT_VS_DEPTH_METHOD,
	FLAT_VS_DEPTH_SCREENS,
	FLAT_VS_DEPTH_SECTIONS,
} from '../src/personal/flat-vs-depth/FlatVsDepth.preview.ts';
import { ARTEFACT_PATH, STORY_EXPORT, STORY_MODULE } from './capture-flat-vs-depth.mjs';
import { DEFAULT_BASE_URL, SCREENS } from './measure-flat-vs-depth.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCUMENT_PATH = 'docs/visual/flat-vs-depth-review.md';

/**
 * The review document and the preview data are two renderings of one
 * content. This test is the gate that keeps them from drifting apart:
 * a heading, a case, a measurement or a decision that exists on only one
 * side is a defect in the review, not a formatting difference.
 */
function readDocument() {
	return readFileSync(resolve(REPO_ROOT, DOCUMENT_PATH), 'utf8');
}

/** Every `##` heading of the document, in order. */
function documentHeadings(markdown) {
	return markdown
		.split('\n')
		.filter((line) => line.startsWith('## '))
		.map((line) => line.slice(3).trim());
}

/** Every line of the document that mentions `id`. */
function linesMentioning(markdown, id) {
	return markdown.split('\n').filter((line) => line.includes(id));
}

describe('flat vs depth review — document and preview parity', () => {
	it('carries the same `##` headings, in the same order', () => {
		const headings = documentHeadings(readDocument());
		assert.deepEqual(
			headings,
			FLAT_VS_DEPTH_SECTIONS.map((section) => section.heading),
		);
	});

	it('writes every section intent and premise into the document', () => {
		const markdown = readDocument();
		for (const section of FLAT_VS_DEPTH_SECTIONS) {
			assert.ok(
				markdown.includes(section.intent),
				`the document does not carry the intent of "${section.heading}"`,
			);
			for (const note of section.notes) {
				assert.ok(
					markdown.includes(note),
					`the document does not carry a premise of "${section.heading}": ${note}`,
				);
			}
		}
	});

	it('carries both screens with their traits and every measurement', () => {
		const markdown = readDocument();
		for (const screen of FLAT_VS_DEPTH_SCREENS) {
			assert.ok(markdown.includes(screen.id), `the document does not mention ${screen.id}`);
			assert.ok(markdown.includes(screen.label), `the document does not name ${screen.label}`);
			assert.ok(markdown.includes(screen.url), `the document does not link ${screen.url}`);
			assert.ok(markdown.includes(screen.summary), `the document does not summarise ${screen.id}`);
			for (const trait of screen.traits) {
				assert.ok(
					markdown.includes(trait),
					`the document does not carry a trait of ${screen.id}: ${trait}`,
				);
			}
			for (const measurement of screen.measurements) {
				assert.ok(
					markdown.includes(measurement.label),
					`the document does not carry the measurement "${measurement.label}" of ${screen.id}`,
				);
				assert.ok(
					markdown.includes(measurement.value),
					`the document does not carry the measured value of "${measurement.label}" of ${screen.id}: ${measurement.value}`,
				);
				assert.ok(
					markdown.includes(measurement.how),
					`the document does not carry the measurement method of "${measurement.label}" of ${screen.id}`,
				);
			}
		}
	});

	it('carries every decision with its verdict on the same line', () => {
		const markdown = readDocument();
		const decisions = FLAT_VS_DEPTH_SECTIONS.flatMap((section) => section.decisions);
		for (const decision of decisions) {
			const lines = linesMentioning(markdown, decision.id);
			assert.ok(lines.length > 0, `the document does not mention ${decision.id}`);
			for (const line of lines) {
				assert.ok(
					line.includes(`（${decision.verdict}）`),
					`${decision.id} is not marked as ${decision.verdict} on the line that mentions it`,
				);
			}
			assert.ok(
				markdown.includes(decision.statement),
				`the document does not carry the statement of ${decision.id}`,
			);
			assert.ok(
				markdown.includes(decision.reason),
				`the document does not carry the reason of ${decision.id}`,
			);
		}
	});

	it('carries every improvement candidate with its verdict, basis and proposal', () => {
		const markdown = readDocument();
		for (const candidate of FLAT_VS_DEPTH_CANDIDATES) {
			const lines = linesMentioning(markdown, candidate.id);
			assert.ok(lines.length > 0, `the document does not mention ${candidate.id}`);
			for (const line of lines) {
				assert.ok(
					line.includes(`（${candidate.verdict}）`),
					`${candidate.id} is not marked as ${candidate.verdict} on the line that mentions it`,
				);
			}
			assert.ok(
				markdown.includes(candidate.title),
				`the document does not carry the title of ${candidate.id}`,
			);
			assert.ok(
				markdown.includes(candidate.basis),
				`the document does not carry the basis of ${candidate.id}`,
			);
			assert.ok(
				markdown.includes(candidate.proposal),
				`the document does not carry the proposal of ${candidate.id}`,
			);
		}
	});

	it('lists each improvement candidate in exactly one section', () => {
		const listed = FLAT_VS_DEPTH_SECTIONS.flatMap((section) => section.candidateIds);
		const expected = FLAT_VS_DEPTH_CANDIDATES.map((candidate) => candidate.id);
		assert.deepEqual([...listed].sort(), [...expected].sort());
		for (const id of listed) {
			const owners = FLAT_VS_DEPTH_SECTIONS.filter((section) => section.candidateIds.includes(id));
			assert.equal(owners.length, 1, `${id} is listed in ${owners.length} sections`);
		}
	});

	it('mentions no case, decision or candidate that the preview does not know', () => {
		const markdown = readDocument();
		const known = new Set([
			...FLAT_VS_DEPTH_SCREENS.map((screen) => screen.id),
			...FLAT_VS_DEPTH_CANDIDATES.map((candidate) => candidate.id),
			...FLAT_VS_DEPTH_SECTIONS.flatMap((section) => section.decisions).map(
				(decision) => decision.id,
			),
		]);
		const mentioned = markdown.match(/`(case|candidate|decision)-[a-z0-9-]+`/g) ?? [];
		for (const token of mentioned) {
			const id = token.replace(/`/g, '');
			assert.ok(known.has(id), `the document mentions an unknown id: ${id}`);
		}
	});
});

describe('flat vs depth review — the observation the document quotes', () => {
	it('measures the same two screens the preview compares', () => {
		assert.deepEqual(
			SCREENS.map((screen) => screen.id),
			FLAT_VS_DEPTH_SCREENS.map((screen) => screen.id),
		);
		assert.deepEqual(
			SCREENS.map((screen) => screen.path),
			FLAT_VS_DEPTH_SCREENS.map((screen) => new URL(screen.url).pathname),
		);
	});

	it('measures the canonical production origin the document names', () => {
		assert.equal(DEFAULT_BASE_URL, FLAT_VS_DEPTH_METHOD.origin);
		const markdown = readDocument();
		assert.ok(markdown.includes(FLAT_VS_DEPTH_METHOD.origin));
		assert.ok(markdown.includes(FLAT_VS_DEPTH_METHOD.measuredOn));
		assert.ok(markdown.includes(FLAT_VS_DEPTH_METHOD.command));
	});

	it('captures the preview story the document names, into a WebP artefact', () => {
		assert.equal(STORY_MODULE, FLAT_VS_DEPTH_METHOD.preview);
		assert.equal(ARTEFACT_PATH, 'docs/verification/visual/flat-vs-depth-comparison.webp');
		const storySource = readFileSync(resolve(REPO_ROOT, STORY_MODULE), 'utf8');
		assert.ok(
			storySource.includes(`export const ${STORY_EXPORT}`),
			`${STORY_MODULE} does not export ${STORY_EXPORT}`,
		);
	});
});
