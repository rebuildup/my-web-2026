import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CURRENT_RECOMMENDATIONS,
	INTEREST_STATE_LABELS,
	SUPERSEDED_OBSERVATIONS,
	TECH_INTEREST_ENTRIES,
	TECH_INTEREST_ENTRY_BY_ID,
	TECH_INTEREST_SECTIONS,
} from '../src/personal/tech-interests/TechInterests.preview.ts';

/**
 * Preview / document parity for the tech-interest inventory (Issue #528).
 *
 * What this gate is for
 * ----------------------
 * The inventory has two faces: the Markdown document a reader reads
 * (`docs/influences/tech-interests.md`) and the standalone Storybook
 * preview a reviewer looks at (`src/personal/tech-interests/`). They
 * are two renderings of ONE committed record, so a section that exists
 * in one and not the other is a defect: the reader would see a state
 * the preview does not have, or the reverse.
 *
 * What it asserts
 * ---------------
 * 1. The document's `##` headings and the preview's `heading:` values
 *    are the same list, in the same order.
 * 2. Each section's summary and points appear in the document.
 * 3. Each observation has a `###` subsection in the document, and that
 *    subsection carries its state, its observation date, its evidence
 *    and its note.
 * 4. The document has no observation the preview does not have.
 * 5. The record itself holds together: every observation has a date
 *    and an evidence path that exists, ids and names are unique, a
 *    replaced observation points at an observation that exists and is
 *    newer, and the derived "current recommendations" list excludes
 *    every replaced observation.
 *
 * Rule 5 is the machine half of the Issue's "do not show an old
 * recommendation as the current one": the current list is derived from
 * the record, so a replaced observation cannot be in it.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = join(REPO_ROOT, 'docs/influences/tech-interests.md');

/** The `##` sections of the document, with their body lines. */
function parseSections(markdown) {
	const sections = [];
	let current = null;
	for (const line of markdown.split('\n')) {
		if (line.startsWith('## ')) {
			current = { heading: line.slice(3).trim(), lines: [] };
			sections.push(current);
			continue;
		}
		if (current) current.lines.push(line);
	}
	return sections;
}

/** The `###` subsections of one section body, with their body lines. */
function parseSubsections(sectionLines) {
	const subsections = [];
	let current = null;
	for (const line of sectionLines) {
		const match = /^### `(.+)`$/.exec(line);
		if (match) {
			current = { name: match[1], lines: [] };
			subsections.push(current);
			continue;
		}
		if (current) current.lines.push(line);
	}
	return subsections;
}

const document = readFileSync(DOC_PATH, 'utf8');
const documentSections = parseSections(document);

describe('tech-interest inventory — document / preview parity', () => {
	it('the document and the preview declare the same sections, in the same order', () => {
		assert.deepEqual(
			documentSections.map((section) => section.heading),
			TECH_INTEREST_SECTIONS.map((section) => section.heading),
		);
	});

	it('every section summary appears in the document section body', () => {
		for (const [index, section] of TECH_INTEREST_SECTIONS.entries()) {
			const body = documentSections[index].lines.join('\n');
			assert.ok(
				body.includes(section.summary),
				`section "${section.heading}" does not carry its summary verbatim`,
			);
		}
	});

	it('every section point appears in the document section body', () => {
		for (const [index, section] of TECH_INTEREST_SECTIONS.entries()) {
			const body = documentSections[index].lines.join('\n');
			for (const point of section.points) {
				assert.ok(
					body.includes(point),
					`section "${section.heading}" is missing one of its points`,
				);
			}
		}
	});

	it('every observation has a document subsection carrying its facts', () => {
		for (const [index, section] of TECH_INTEREST_SECTIONS.entries()) {
			const subsections = parseSubsections(documentSections[index].lines);
			for (const entry of section.entries) {
				const subsection = subsections.find((candidate) => candidate.name === entry.name);
				assert.ok(
					subsection,
					`observation "${entry.name}" has no \`###\` subsection in "${section.heading}"`,
				);
				const body = subsection.lines.join('\n');
				assert.ok(
					body.includes(INTEREST_STATE_LABELS[entry.state]),
					`observation "${entry.name}" does not state its state`,
				);
				assert.ok(
					body.includes(entry.observedOn),
					`observation "${entry.name}" does not state its observation date`,
				);
				assert.ok(
					body.includes(entry.evidence),
					`observation "${entry.name}" does not state its evidence`,
				);
				if (entry.corroborating) {
					assert.ok(
						body.includes(entry.corroborating),
						`observation "${entry.name}" does not state its corroborating record`,
					);
				}
				assert.ok(body.includes(entry.note), `observation "${entry.name}" does not state its note`);
			}
		}
	});

	it('the document has no observation the preview does not have', () => {
		for (const [index, section] of TECH_INTEREST_SECTIONS.entries()) {
			const known = new Set(section.entries.map((entry) => entry.name));
			for (const subsection of parseSubsections(documentSections[index].lines)) {
				assert.ok(
					known.has(subsection.name),
					`"${subsection.name}" is documented in "${section.heading}" but is not an observation of that section`,
				);
			}
		}
	});
});

describe('tech-interest inventory — the record holds together', () => {
	it('every observation has a state, a date and an evidence path', () => {
		for (const entry of TECH_INTEREST_ENTRIES) {
			assert.ok(entry.name.length > 0, `observation "${entry.id}" has no name`);
			assert.ok(
				/^\d{4}-\d{2}-\d{2}$/.test(entry.observedOn),
				`observation "${entry.id}" has no ISO observation date`,
			);
			assert.ok(
				!Number.isNaN(Date.parse(entry.observedOn)),
				`observation "${entry.id}" has an unparsable observation date`,
			);
			assert.ok(entry.evidence.length > 0, `observation "${entry.id}" has no evidence`);
			assert.ok(
				entry.note.length > 0,
				`observation "${entry.id}" has no note, so it cannot be read on its own`,
			);
		}
	});

	it('every evidence path exists in the repository', () => {
		for (const entry of TECH_INTEREST_ENTRIES) {
			assert.ok(
				existsSync(join(REPO_ROOT, entry.evidence)),
				`observation "${entry.id}" cites "${entry.evidence}", which does not exist`,
			);
			if (entry.corroborating) {
				assert.ok(
					existsSync(join(REPO_ROOT, entry.corroborating)),
					`observation "${entry.id}" cites "${entry.corroborating}", which does not exist`,
				);
			}
		}
	});

	it('observation ids and names are unique', () => {
		const ids = new Set();
		const names = new Set();
		for (const entry of TECH_INTEREST_ENTRIES) {
			assert.ok(!ids.has(entry.id), `observation id "${entry.id}" is used twice`);
			assert.ok(!names.has(entry.name), `observation name "${entry.name}" is used twice`);
			ids.add(entry.id);
			names.add(entry.name);
		}
	});

	it('a replaced observation points at an existing, newer observation', () => {
		for (const entry of TECH_INTEREST_ENTRIES) {
			if (entry.supersededBy === undefined) continue;
			const successor = TECH_INTEREST_ENTRY_BY_ID.get(entry.supersededBy);
			assert.ok(
				successor,
				`observation "${entry.id}" is replaced by "${entry.supersededBy}", which does not exist`,
			);
			assert.ok(
				successor.observedOn > entry.observedOn,
				`observation "${entry.id}" (${entry.observedOn}) is replaced by an older one (${successor.observedOn})`,
			);
		}
	});

	it('a replaced observation is never a current recommendation', () => {
		const current = new Set(CURRENT_RECOMMENDATIONS.map((entry) => entry.id));
		for (const entry of SUPERSEDED_OBSERVATIONS) {
			assert.ok(
				!current.has(entry.id),
				`observation "${entry.id}" was replaced but is still listed as a current recommendation`,
			);
		}
	});

	it('the current recommendations are exactly the unreplaced currently-using observations', () => {
		const expected = TECH_INTEREST_ENTRIES.filter(
			(entry) => entry.state === 'currently-using' && entry.supersededBy === undefined,
		).map((entry) => entry.id);
		assert.deepEqual(
			CURRENT_RECOMMENDATIONS.map((entry) => entry.id),
			expected,
		);
	});

	it('every state carries at least two observations', () => {
		for (const state of Object.keys(INTEREST_STATE_LABELS)) {
			const count = TECH_INTEREST_ENTRIES.filter((entry) => entry.state === state).length;
			assert.ok(
				count >= 2,
				`state "${state}" has ${count} observation(s); the Issue asks for at least two`,
			);
		}
	});

	it('a section only lists observations of its own state', () => {
		const SECTION_STATE = {
			'currently-using': 'currently-using',
			'used-in-production': 'used-in-production',
			tried: 'tried',
			liked: 'liked',
		};
		for (const section of TECH_INTEREST_SECTIONS) {
			if (section.id === 'supersede-rule') {
				// The rule section holds the replaced observations. Their
				// `state` is the state they HELD when they were made, so
				// it is not the section's own state.
				for (const entry of section.entries) {
					assert.ok(
						entry.supersededBy !== undefined,
						`"${entry.name}" is listed as a replaced observation but is not replaced`,
					);
				}
				continue;
			}
			const expectedState = SECTION_STATE[section.id];
			if (expectedState === undefined) {
				assert.equal(
					section.entries.length,
					0,
					`"${section.heading}" is a prose section and lists observations`,
				);
				continue;
			}
			for (const entry of section.entries) {
				assert.equal(
					entry.state,
					expectedState,
					`"${entry.name}" is listed under "${section.heading}", which is not its state`,
				);
				if (section.id === 'currently-using') {
					assert.equal(
						entry.supersededBy,
						undefined,
						`"${entry.name}" was replaced, so it may not sit in the current section`,
					);
				}
			}
		}
	});
});
