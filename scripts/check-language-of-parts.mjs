#!/usr/bin/env node

/**
 * check-language-of-parts — enforce the WCAG 2.2 SC 3.1.2 contract
 * (Issue #409).
 *
 * What this gate is for
 * ---------------------
 * The obligation is `src/i18n/language-of-parts.ts`: *a `lang`
 * attribute is written on a passage whose language differs from the
 * document language, and on nothing else*. `src/editorial/language-of-parts.tsx`
 * renders what that policy classifies. This gate is what stops the rest
 * of the repository from quietly undoing it — by adding a tag to a code
 * identifier, by tagging every Latin word, or by letting the fixture and
 * the shipped document language drift apart.
 *
 * Every rule corresponds to a claim the verification artefact
 * (`docs/verification/a11y/mixed-language-content.webp`) makes:
 *
 *   document-language-mismatch
 *       the document language the policy compares against is the one
 *       the product actually declares. `<html lang>` lives in
 *       `src/routes/__root.tsx` (SC 3.1.1, level A); a partial tag is
 *       only meaningful against it, so a fixture claiming `ja` while the
 *       pages say `en` would make every verdict in the artefact false.
 *   dangling-part-reference
 *       every run that names a part resolves in the registry. A
 *       dangling reference renders as prose with no tag — a silent
 *       regression that no DOM assertion in the fixture's unit tests
 *       would notice.
 *   orphan-part
 *       every declared part is rendered by some body. An orphan part is
 *       dead policy: it documents a case no artefact ever shows.
 *   language-tag-required
 *       a `sentence` / `phrase` part declares a tag. SC 3.1.2 asks for
 *       the passage's language; a passage with no tag is exactly the
 *       defect this Issue exists to remove.
 *   language-tag-malformed
 *       a declared tag is well formed — and a malformed tag may only
 *       appear in a `failure` body, where the refusal is the point.
 *   language-tag-redundant
 *       no body emits a `lang` equal to the document language. It would
 *       tell a screen reader nothing (and it is what "全英単語に機械
 *       追加しない" degenerates into when a mechanical rule runs).
 *   language-tag-on-non-language
 *       a `code` or `loanword` part is never tagged. `<code>` already
 *       gives the non-text-presentational distinction, and a single
 *       adopted word inside document-language text is read with the
 *       document language's rules.
 *   unobserved-verdict
 *       a verdict the policy can produce is exercised by a body: tagged
 *       parts appear in a normal body, refusals in the failure body.
 *       A refusal nobody renders is an untested branch.
 *   guard-not-preserved
 *       each part's guard token is still inside its text, character for
 *       character (apart from the empty-run refusal, whose emptiness is
 *       the refusal).
 *   capture-drift
 *       the capture script still names this fixture's story module,
 *       export and readiness marker. The capture photographs the story;
 *       a renamed story would otherwise leave a plausible-looking,
 *       stale artefact behind.
 *
 * Machine vs. human
 * -----------------
 * This gate decides ATTRIBUTES. It cannot prove that a screen reader
 * changed voice, and `src/i18n/language-of-parts.ts` records that row
 * as `checked: 'human'` so the artefact reports it as open rather than
 * as satisfied. Usage:
 *
 *   node --experimental-strip-types scripts/check-language-of-parts.mjs [--quiet] [--json=FILE]
 *
 * Exit codes: 0 = clean, 1 = at least one error, 2 = bad input.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped document element (SC 3.1.1). */
export const DOCUMENT_ROOT = 'src/routes/__root.tsx';

/** The capture that photographs the Storybook gallery for this Issue. */
export const CAPTURE_SCRIPT = 'scripts/capture-language-of-parts.mjs';

/** The story the capture renders, and the marker it waits for. */
export const STORY_MODULE = 'src/editorial/language-of-parts.stories.tsx';
export const STORY_EXPORT = 'Gallery';
export const STORY_TEST_ID = 'a11y-mixed-language-gallery';

export const RULES = [
	'document-language-mismatch',
	'dangling-part-reference',
	'orphan-part',
	'language-tag-required',
	'language-tag-malformed',
	'language-tag-redundant',
	'language-tag-on-non-language',
	'unobserved-verdict',
	'guard-not-preserved',
	'capture-drift',
];

/** Kinds SC 3.1.2 may tag. Everything else is refused by policy. */
const TAGGABLE_KINDS = new Set(['sentence', 'phrase']);

/**
 * Read the language the shipped document element declares (pure).
 *
 * A source-level read rather than a rendered one: the gate runs before
 * a Worker is built, and `<html lang="…">` in the route root is the
 * declaration every rendered document inherits. `null` when the file
 * declares none, which is itself an error worth reporting.
 */
export function readDocumentLanguage(source) {
	return /<html[^>]*\slang="([^"]*)"/.exec(source)?.[1] ?? null;
}

/**
 * Audit the fixture against the policy (pure).
 *
 * `policy` is the shipped module (`src/i18n/language-of-parts.ts`),
 * injected rather than imported so this function is testable without a
 * TypeScript loader, and so a future caller cannot audit a copy.
 * Returns `{ errors, rows, documentLanguage, wcag }` where every row is
 * one part with the attribute it renders.
 */
export function auditLanguageFixture(policy, declaredDocumentLanguage) {
	const {
		DOCUMENT_LANGUAGE,
		LANGUAGE_DOCUMENTS,
		LANGUAGE_PARTS,
		LANGUAGE_WCAG_MAPPING,
		classifyLanguagePart,
		inspectLanguageTag,
		languageAttributeFor,
	} = policy;
	// Resolved from the INJECTED registry rather than from the module's
	// own lookup: auditing a fixture has to read the fixture that was
	// handed in, or a caller could not audit a table the gate did not
	// ship.
	const registry = new Map(LANGUAGE_PARTS.map((part) => [part.id, part]));
	const errors = [];
	const fail = (rule, message) => errors.push({ rule, message });

	if (declaredDocumentLanguage !== DOCUMENT_LANGUAGE) {
		fail(
			'document-language-mismatch',
			`${DOCUMENT_ROOT} declares lang="${declaredDocumentLanguage ?? '(none)'}", the policy compares against "${DOCUMENT_LANGUAGE}". A partial lang is only meaningful against the language the document actually declares (SC 3.1.1).`,
		);
	}

	// Which bodies render each part, and which verdict each part got.
	const renderedIn = new Map();
	for (const document of LANGUAGE_DOCUMENTS) {
		for (const run of document.runs) {
			if (run.part === undefined) continue;
			if (!registry.has(run.part)) {
				fail(
					'dangling-part-reference',
					`document "${document.id}" references part "${run.part}", which the registry does not declare. The run renders as untagged prose.`,
				);
				continue;
			}
			renderedIn.set(run.part, [...(renderedIn.get(run.part) ?? []), document]);
		}
	}

	// Runs of one document resolved with the INJECTED policy functions
	// (pure): the same arithmetic the renderer performs, so the gate
	// never re-implements the decision it is auditing.
	const resolveRuns = (document) =>
		document.runs.map((run) => {
			const part = run.part === undefined ? undefined : registry.get(run.part);
			if (!part) return { text: run.text, part: null, lang: null };
			return { text: part.text, part, lang: languageAttributeFor(part, DOCUMENT_LANGUAGE) };
		});

	const rows = LANGUAGE_PARTS.map((part) => {
		const verdict = classifyLanguagePart(part, DOCUMENT_LANGUAGE);
		const inspection = inspectLanguageTag(part.tag);
		const documents = renderedIn.get(part.id) ?? [];
		const cases = [...new Set(documents.map((document) => document.case))];

		if (documents.length === 0) {
			fail(
				'orphan-part',
				`part "${part.id}" is declared but no body renders it: dead policy, and a case the verification artefact never shows.`,
			);
		}
		if (!TAGGABLE_KINDS.has(part.kind) && verdict === 'tagged') {
			fail(
				'language-tag-on-non-language',
				`part "${part.id}" is a ${part.kind} and must not be tagged. <code> already distinguishes a code identifier, and a single adopted word is read with the document language's rules.`,
			);
		}
		if (TAGGABLE_KINDS.has(part.kind)) {
			if (part.tag === null || part.tag === '') {
				fail(
					'language-tag-required',
					`part "${part.id}" is a ${part.kind} with no declared tag. SC 3.1.2 asks for the passage's language; the rendering cannot supply one the author did not write.`,
				);
			} else if (inspection.problem !== null && verdict !== 'malformed-tag') {
				fail(
					'language-tag-malformed',
					`part "${part.id}" declares lang="${part.tag}" which this policy refuses (${inspection.problem}).`,
				);
			}
			if (verdict === 'malformed-tag' && cases.some((state) => state !== 'failure')) {
				fail(
					'language-tag-malformed',
					`part "${part.id}" declares an unverifiable tag and is rendered by a non-failure body (${cases.join(', ')}); a malformed tag may only appear where the refusal itself is the state under test.`,
				);
			}
		}
		if (part.guard === '') {
			if (part.text !== '') {
				fail(
					'guard-not-preserved',
					`part "${part.id}" declares an empty guard but carries text; the empty guard exists for the empty-run refusal only.`,
				);
			}
		} else if (!part.text.includes(part.guard)) {
			fail(
				'guard-not-preserved',
				`part "${part.id}" lost its guard token ${JSON.stringify(part.guard)}; the artefact claims a sentence the source no longer contains.`,
			);
		}
		if (verdict === 'tagged' && !cases.includes('normal')) {
			fail(
				'unobserved-verdict',
				`part "${part.id}" is tagged but no normal body renders it, so the "tagged" path is never observed in the artefact.`,
			);
		}
		if (
			(verdict === 'malformed-tag' || verdict === 'tag-redundant' || verdict === 'empty-text') &&
			!cases.includes('failure')
		) {
			fail(
				'unobserved-verdict',
				`part "${part.id}" resolves to "${verdict}" but the failure body never renders it, so that refusal is never observed.`,
			);
		}

		return {
			id: part.id,
			kind: part.kind,
			tag: part.tag,
			verdict,
			problem: inspection.problem,
			lang: languageAttributeFor(part, DOCUMENT_LANGUAGE),
			renderedIn: documents.map((document) => document.id),
		};
	});

	for (const document of LANGUAGE_DOCUMENTS) {
		const redundant = resolveRuns(document).filter((run) => run.lang === DOCUMENT_LANGUAGE);
		if (redundant.length > 0) {
			fail(
				'language-tag-redundant',
				`document "${document.id}" emits lang="${DOCUMENT_LANGUAGE}" for [${redundant
					.map((run) => run.part?.id)
					.join(
						', ',
					)}], equal to the document language. Write no attribute instead — the run is already read in the document language.`,
			);
		}
	}

	return {
		documentLanguage: DOCUMENT_LANGUAGE,
		declaredDocumentLanguage,
		wcag: LANGUAGE_WCAG_MAPPING,
		rows,
		errors,
	};
}

/**
 * Read an exported string constant out of a script source (pure).
 *
 * Used for the drift rule: the capture and the gate both name the story
 * they share, and two declarations that disagree would let the capture
 * photograph a stale artefact. Comparing the DECLARED value is why this
 * exists — a substring search would pass whenever either file mentioned
 * the path somewhere, including in its own constant.
 */
export function readExportedString(source, name) {
	return new RegExp(`export const ${name} = '([^']*)'`).exec(source)?.[1] ?? null;
}

/**
 * The capture-drift rule: the capture must still point at this fixture
 * (pure, over source text).
 */
export function auditCaptureDrift({ storySource, captureSource }) {
	const errors = [];
	const fail = (rule, message) => errors.push({ rule, message });
	if (!new RegExp(`export function ${STORY_EXPORT}\\b`).test(storySource)) {
		fail('capture-drift', `${STORY_MODULE} does not export ${STORY_EXPORT}.`);
	}
	if (!storySource.includes(`data-testid="${STORY_TEST_ID}"`)) {
		fail(
			'capture-drift',
			`${STORY_MODULE} does not carry data-testid="${STORY_TEST_ID}", the capture's readiness marker. Without it the capture would photograph an empty page and still write a plausible artefact.`,
		);
	}
	for (const [name, expected] of [
		['STORY_MODULE', STORY_MODULE],
		['STORY_EXPORT', STORY_EXPORT],
		['GALLERY_TEST_ID', STORY_TEST_ID],
	]) {
		const declared = readExportedString(captureSource, name);
		if (declared !== expected) {
			fail(
				'capture-drift',
				`${CAPTURE_SCRIPT} declares ${name} = ${JSON.stringify(declared)}, the gate expects ${JSON.stringify(expected)}; the verification artefact would go stale.`,
			);
		}
	}
	return errors;
}

function usage() {
	process.stderr.write(
		'usage: check-language-of-parts.mjs [--quiet] [--json=FILE]\n' +
			'  --quiet     print errors only\n' +
			'  --json=FILE write the report (fixture rows + WCAG mapping) as JSON\n',
	);
}

export async function runGate(argv = process.argv.slice(2)) {
	const quiet = argv.includes('--quiet');
	const jsonIndex = argv.indexOf('--json');
	const jsonOut = jsonIndex === -1 ? null : (argv[jsonIndex + 1] ?? null);
	for (const arg of argv) {
		if (arg.startsWith('--') && !['--quiet', '--json'].includes(arg.split('=')[0])) {
			usage();
			throw new Error(`unknown option: ${arg}`);
		}
	}
	if (jsonIndex !== -1 && jsonOut === null) {
		usage();
		throw new Error('--json requires a path');
	}

	let policy;
	try {
		policy = await import('../src/i18n/language-of-parts.ts');
	} catch (error) {
		throw new Error(
			`cannot load the shipped language-of-parts policy (${error.message}). This gate imports the TypeScript source directly, which needs Node >= 22.18 (the version in package.json#engines and in CI).`,
		);
	}

	const declaredDocumentLanguage = readDocumentLanguage(
		readFileSync(join(REPO_ROOT, DOCUMENT_ROOT), 'utf8'),
	);
	const audit = auditLanguageFixture(policy, declaredDocumentLanguage);
	const errors = [
		...audit.errors,
		...auditCaptureDrift({
			storySource: readFileSync(join(REPO_ROOT, STORY_MODULE), 'utf8'),
			captureSource: readFileSync(join(REPO_ROOT, CAPTURE_SCRIPT), 'utf8'),
		}),
	];

	const report = {
		issue: '#409',
		generatedBy: 'scripts/check-language-of-parts.mjs',
		verdict: errors.length === 0 ? 'pass' : 'fail',
		rules: RULES,
		document: { root: DOCUMENT_ROOT, declared: declaredDocumentLanguage },
		rows: audit.rows,
		wcag: audit.wcag,
		errors,
	};

	if (!quiet) {
		const lines = [
			`language-of-parts (#409): document lang "${audit.declaredDocumentLanguage}" vs policy "${audit.documentLanguage}"`,
			...audit.rows.map(
				(row) =>
					`  ${row.id.padEnd(26)} kind=${row.kind.padEnd(8)} verdict=${row.verdict.padEnd(14)} lang=${row.lang ?? '(none)'}`,
			),
			'  WCAG mapping (machine rows are decided here; human rows are open, not satisfied):',
			...audit.wcag.map((row) => `    ${row.criterion} (${row.level}) [${row.checked}]`),
		];
		process.stdout.write(`${lines.join('\n')}\n`);
	}
	for (const error of errors) {
		process.stderr.write(`error [${error.rule}]: ${error.message}\n`);
	}
	if (jsonOut) {
		mkdirSync(dirname(resolve(REPO_ROOT, jsonOut)), { recursive: true });
		writeFileSync(resolve(REPO_ROOT, jsonOut), `${JSON.stringify(report, null, 2)}\n`);
		process.stdout.write(`check-language-of-parts: report ${jsonOut}\n`);
	}
	return errors.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runGate()
		.then((ok) => {
			if (!ok) process.exit(1);
		})
		.catch((error) => {
			process.stderr.write(`check-language-of-parts: ${error.message}\n`);
			process.exit(2);
		});
}
