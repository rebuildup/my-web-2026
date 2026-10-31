#!/usr/bin/env node

/**
 * check-usable-product-preview-parity — Issue #515.
 *
 * What this proves
 * ----------------
 * The document `docs/personal/usable-product-publication.md` and the
 * standalone preview data (`src/personal/usable-product-publication/
 * UsableProductPublication.preview.ts`) carry the SAME content:
 *
 *   1. the document's `##` heading set equals the preview's `heading:`
 *      values, in the same order — a heading that exists on only one
 *      side is a failure, not a warning;
 *   2. every stage, every stage check, every worked example, every
 *      note and every decision appears on both sides — a fact that
 *      exists on only one side is a failure;
 *   3. the concrete facts the preview prints still match the COMMITTED
 *      RECORDS they were read from (`src/tools/manifest.json` and
 *      `src/http/api-directory/catalog.ts`), so the document cannot
 *      drift away from the Tool Registry or the public API directory
 *      while still claiming to describe them.
 *
 * Why (3) is part of a parity test
 * --------------------------------
 * A document that describes a published Tool or a published API is only
 * honest while it still describes what the repository ships. The Miro
 * board behind this Issue is NOT reachable, so the only checkable
 * source for a concrete value is the record it came from — this test
 * re-reads that record and fails when the preview and the record
 * disagree.
 *
 * Exit codes: node:test's own (0 = every assertion passed).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	usableProductAdopted,
	usableProductExamples,
	usableProductHeld,
	usableProductLabels,
	usableProductNextActionTargets,
	usableProductNoAction,
	usableProductOpenDecisions,
	usableProductRuleScope,
	usableProductSections,
	usableProductStages,
	usableProductVerdictDefinitions,
	usableProductVerdicts,
} from '../src/personal/usable-product-publication/UsableProductPublication.preview.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The document this test keeps in step with the preview. */
const DOCUMENT_PATH = 'docs/personal/usable-product-publication.md';

/** The committed records the preview's facts were read from. */
const TOOL_MANIFEST_PATH = 'src/tools/manifest.json';
const API_CATALOG_PATH = 'src/http/api-directory/catalog.ts';

const documentText = readFileSync(join(REPO_ROOT, DOCUMENT_PATH), 'utf8');

/**
 * The document's `##` headings, in order.
 *
 * `###` sub-headings are NOT included (the character after `##` must be
 * a space), and a heading inside a fenced code block is not a heading —
 * the fence state is tracked so a fence in the document cannot invent
 * one.
 */
function documentHeadings(markdown) {
	const headings = [];
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^## (.+)$/.exec(line);
		if (match) headings.push(match[1]);
	}
	return headings;
}

/**
 * The document split into sections, keyed by heading.
 *
 * The body of a section is everything up to the next `##` heading; the
 * `###` sub-headings stay inside the body, because a sub-heading is
 * part of the section it belongs to.
 */
function documentSections(markdown) {
	const sections = new Map();
	let current = null;
	let inFence = false;
	for (const line of markdown.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			if (current) current.body.push(line);
			continue;
		}
		if (!inFence) {
			const heading = /^## (.+)$/.exec(line);
			if (heading) {
				current = { heading: heading[1], body: [] };
				sections.set(heading[1], current);
				continue;
			}
		}
		if (current) current.body.push(line);
	}
	return sections;
}

/** The bullet lines of one section body. */
function sectionBullets(body) {
	return body.filter((line) => /^- /.test(line));
}

/**
 * The `- **<stage>** — <text>` lines of one section body, with the
 * stage name and the text separated.
 */
function sectionStageLines(body) {
	const found = [];
	for (const line of body) {
		const match = /^- \*\*(.+?)\*\* — (.*)$/.exec(line);
		if (match) found.push({ stage: match[1], text: match[2] });
	}
	return found;
}

/**
 * The catalog entries the public API directory declares for one path.
 *
 * The source is read as TEXT on purpose: importing the module would
 * pull `package.json` into a plain Node ESM import, and the point of
 * this check is to compare against the record AS COMMITTED, not to
 * re-evaluate it.
 */
function catalogEntriesFor(source, path) {
	const start = source.indexOf('export const publicApiCatalog');
	const end = source.indexOf('\n];', start);
	if (start === -1 || end === -1) return [];
	const block = source.slice(start, end);
	return block
		.split(/\n\t\{\n/)
		.slice(1)
		.filter((entry) => entry.includes(`path: '${path}',`));
}

/** Resolve a dotted path inside a plain object. */
function resolveFact(record, label) {
	let current = record;
	for (const key of label.split('.')) {
		if (current === null || typeof current !== 'object') return undefined;
		current = current[key];
	}
	return current;
}

/**
 * The three meta lines an example section carries, parsed.
 *
 *   `- 対象: <subject>`
 *   `- 典拠: `<record>`（<pointer>）`
 *   `- 事実: <label> = <value> ／ <label> = <value> …`
 *
 * They are PARSED rather than substring-matched: a section that keeps
 * the right words somewhere else but states a different path would pass
 * a substring check and fail this one, which is the whole point.
 */
function parseExampleMeta(body, labels) {
	const lines = body.filter((line) => /^- /.test(line));
	const subjectLine = lines.find((line) => line.startsWith(`- ${labels.subject}: `));
	const recordLine = lines.find((line) => line.startsWith(`- ${labels.record}: `));
	const factsLine = lines.find((line) => line.startsWith(`- ${labels.facts}: `));
	const recordMatch = recordLine
		? /^- (?<label>[^:]+): `(?<record>[^`]+)`（(?<pointer>.+)）$/.exec(recordLine)
		: null;
	const facts = factsLine
		? factsLine
				.slice(`- ${labels.facts}: `.length)
				.split(' ／ ')
				.map((pair) => {
					const separator = pair.indexOf(' = ');
					return { label: pair.slice(0, separator), value: pair.slice(separator + 3) };
				})
		: [];
	return {
		subject: subjectLine?.slice(`- ${labels.subject}: `.length) ?? null,
		record: recordMatch?.groups?.record ?? null,
		pointer: recordMatch?.groups?.pointer ?? null,
		facts,
	};
}

const sections = documentSections(documentText);

describe('document / preview heading parity', () => {
	it('declares the same `##` headings, in the same order', () => {
		assert.deepEqual(
			documentHeadings(documentText),
			usableProductSections.map((s) => s.heading),
		);
	});

	it('has a body for every heading the preview declares', () => {
		for (const section of usableProductSections) {
			assert.ok(sections.has(section.heading), `missing section: ${section.heading}`);
		}
	});

	it('carries every paragraph and bullet of every section', () => {
		for (const section of usableProductSections) {
			const body = sections.get(section.heading)?.body.join('\n') ?? '';
			for (const paragraph of section.paragraphs) {
				assert.ok(body.includes(paragraph), `${section.heading}: missing paragraph`);
			}
			for (const bullet of section.bullets) {
				assert.ok(body.includes(bullet), `${section.heading}: missing bullet`);
			}
		}
	});
});

describe('stage parity', () => {
	const stagesHeading = usableProductSections.find((section) => section.kind === 'stages')?.heading;
	const checklistHeading = usableProductSections.find(
		(section) => section.kind === 'checklist',
	)?.heading;

	it('names the five stages in the stage section', () => {
		const body = sections.get(stagesHeading ?? '')?.body.join('\n') ?? '';
		for (const stage of usableProductStages) {
			assert.ok(body.includes(stage.name), `missing stage name: ${stage.name}`);
			assert.ok(body.includes(stage.exit), `missing exit: ${stage.name}`);
			assert.ok(body.includes(stage.judgement), `missing judgement: ${stage.name}`);
		}
	});

	it('carries every stage check in the checklist section, and nothing else', () => {
		const body = sections.get(checklistHeading ?? '')?.body.join('\n') ?? '';
		for (const stage of usableProductStages) {
			for (const item of stage.items) {
				assert.ok(body.includes(item.label), `missing check: ${item.id}`);
			}
		}
		const expected = usableProductStages.flatMap((stage) =>
			stage.items.map((item) => `- **${stage.name}** — ${item.label}`),
		);
		assert.deepEqual(
			sectionStageLines(body.split('\n')),
			expected.map((line) => {
				const match = /^- \*\*(.+?)\*\* — (.*)$/.exec(line);
				return { stage: match?.[1] ?? '', text: match?.[2] ?? '' };
			}),
		);
	});
});

describe('worked example parity', () => {
	for (const example of usableProductExamples) {
		const section = usableProductSections.find((item) => item.exampleId === example.id);
		it(`carries every fact of ${example.subject}`, () => {
			assert.ok(section, `no preview section for ${example.id}`);
			const body = sections.get(section?.heading ?? '')?.body ?? [];
			const meta = parseExampleMeta(body, usableProductLabels);
			assert.equal(meta.subject, example.subject);
			assert.equal(meta.record, example.record);
			assert.equal(meta.pointer, example.pointer);
			assert.deepEqual(
				meta.facts,
				example.facts.map((fact) => ({ ...fact })),
			);
		});

		it(`carries every stage note of ${example.subject}, and nothing else`, () => {
			const body = sections.get(section?.heading ?? '')?.body.join('\n') ?? '';
			for (const note of example.notes) {
				assert.ok(body.includes(note.evidence), `missing evidence for ${note.stageId}`);
				if (note.gap !== null) {
					assert.ok(body.includes(note.gap), `missing gap for ${note.stageId}`);
				}
			}
			const stageLines = sectionStageLines(body.split('\n'));
			assert.equal(stageLines.length, example.notes.length);
			const expectedStages = example.notes.map((note) => {
				const stage = usableProductStages.find((item) => item.id === note.stageId);
				return stage?.name ?? note.stageId;
			});
			assert.deepEqual(
				stageLines.map((line) => line.stage),
				expectedStages,
			);
		});
	}
});

describe('verdict parity', () => {
	const stagesHeading = usableProductSections.find((section) => section.kind === 'stages')?.heading;
	const verdictsHeading = usableProductSections.find(
		(section) => section.kind === 'verdicts',
	)?.heading;

	it('states the scope of the rule in the document', () => {
		const body = sections.get(stagesHeading ?? '')?.body.join('\n') ?? '';
		assert.ok(body.includes(usableProductRuleScope), 'the document does not state the scope');
	});

	it('defines exactly the three verdicts, and the document carries them', () => {
		assert.equal(usableProductVerdictDefinitions.length, 3);
		assert.deepEqual(
			usableProductVerdictDefinitions.map((entry) => entry.verdict),
			Object.values(usableProductVerdicts),
		);
		const body = sections.get(verdictsHeading ?? '')?.body.join('\n') ?? '';
		for (const entry of usableProductVerdictDefinitions) {
			const line = `${entry.verdict} — ${entry.definition}`;
			assert.ok(body.includes(line), `missing definition: ${entry.verdict}`);
		}
	});

	it('records the withdrawal of a published surface as an open owner decision', () => {
		assert.ok(
			usableProductOpenDecisions.some((item) => item.includes('撤回')),
			'no open owner decision about withdrawing an already-published surface',
		);
	});

	for (const example of usableProductExamples) {
		const section = usableProductSections.find((item) => item.exampleId === example.id);
		it(`gives every stage of ${example.subject} a verdict and a next action`, () => {
			const body = sections.get(section?.heading ?? '')?.body.join('\n') ?? '';
			const stageLines = sectionStageLines(body.split('\n'));
			assert.equal(stageLines.length, example.notes.length);
			for (const [index, note] of example.notes.entries()) {
				const line = stageLines[index];
				assert.ok(
					Object.values(usableProductVerdicts).includes(note.verdict),
					`unknown verdict for ${example.subject}/${note.stageId}: ${note.verdict}`,
				);
				assert.ok(
					line.text.includes(`${usableProductLabels.verdict}: ${note.verdict}`),
					`the stage line of ${example.subject}/${note.stageId} does not carry the verdict`,
				);
				assert.ok(
					line.text.includes(`${usableProductLabels.nextAction}: ${note.nextAction}`),
					`the stage line of ${example.subject}/${note.stageId} does not carry the next action`,
				);
				assert.ok(
					body.includes(note.nextAction),
					`the next action of ${example.subject}/${note.stageId} is missing`,
				);
				if (note.verdict === usableProductVerdicts.conforming) {
					assert.equal(
						note.nextAction,
						usableProductNoAction,
						`a conforming stage of ${example.subject}/${note.stageId} needs no action`,
					);
					continue;
				}
				assert.ok(
					usableProductNextActionTargets.some((target) => note.nextAction.includes(target)),
					`the next action of ${example.subject}/${note.stageId} points at no place this document has`,
				);
			}
		});
	}
});

describe('decision parity', () => {
	it('carries every adopted and held decision', () => {
		const heading = usableProductSections.find((section) => section.kind === 'decisions')?.heading;
		const body = sections.get(heading ?? '')?.body.join('\n') ?? '';
		for (const item of usableProductAdopted) {
			assert.ok(body.includes(item), `missing adopted decision: ${item}`);
		}
		for (const item of usableProductHeld) {
			assert.ok(body.includes(item), `missing held decision: ${item}`);
		}
		assert.ok(body.includes(`### ${usableProductLabels.adopted}`));
		assert.ok(body.includes(`### ${usableProductLabels.held}`));
	});

	it('carries every open owner decision', () => {
		const heading = usableProductSections.find((section) => section.kind === 'open')?.heading;
		const body = sections.get(heading ?? '')?.body.join('\n') ?? '';
		for (const item of usableProductOpenDecisions) {
			assert.ok(body.includes(item), `missing open decision: ${item}`);
		}
	});
});

describe('the preview still matches the committed records', () => {
	const manifest = JSON.parse(readFileSync(join(REPO_ROOT, TOOL_MANIFEST_PATH), 'utf8'));
	const catalogSource = readFileSync(join(REPO_ROOT, API_CATALOG_PATH), 'utf8');

	for (const example of usableProductExamples) {
		if (example.kind === 'tool') {
			it(`matches the Tool Registry manifest for ${example.subject}`, () => {
				const tool = manifest.tools.find((entry) => entry.slug === example.subject);
				assert.ok(tool, `no tool in the manifest: ${example.subject}`);
				for (const fact of example.facts) {
					const actual = resolveFact(tool, fact.label);
					assert.equal(actual, fact.value, `${example.subject}.${fact.label}`);
				}
				assert.ok(example.pointer.includes(example.subject));
			});
			continue;
		}

		it(`matches the public API directory for ${example.subject}`, () => {
			const entries = catalogEntriesFor(catalogSource, example.subject);
			assert.ok(entries.length > 0, `no catalog entry for ${example.subject}`);
			for (const fact of example.facts) {
				if (fact.label === 'path') {
					assert.ok(entries.every((entry) => entry.includes(`path: '${fact.value}'`)));
					continue;
				}
				if (fact.label === 'methods') {
					for (const method of fact.value.split(' / ')) {
						assert.ok(
							entries.some((entry) => entry.includes(`method: '${method}'`)),
							`missing method ${method}`,
						);
					}
					continue;
				}
				if (fact.label === 'scopes') {
					for (const scope of fact.value.split(' / ')) {
						assert.ok(
							entries.some((entry) => entry.includes(scope)),
							`missing scope ${scope}`,
						);
					}
					continue;
				}
				assert.ok(
					entries.every((entry) => entry.includes(`${fact.label}: '${fact.value}'`)),
					`missing ${fact.label} = ${fact.value}`,
				);
			}
		});
	}
});
