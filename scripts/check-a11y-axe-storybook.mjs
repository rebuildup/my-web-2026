#!/usr/bin/env node

/**
 * check-a11y-axe-storybook — the Storybook story audit contract (Issue #392).
 *
 * What this gate is for
 * ---------------------
 * Issue #393 audits the RENDERED public ROUTES. This gate is the
 * offline half of the Storybook audit: it decides whether the audit
 * itself is wired up correctly, so the browser half cannot silently
 * stop measuring anything.
 *
 * It is a **static** gate on purpose. The browser half has to start
 * Storybook and drive Chromium, which is far too heavy for a gate
 * that runs on every `validate:fast`; the registration contract is a
 * source-level fact and is decided on every run instead.
 *
 * What it checks
 * --------------
 *   manifest-story-missing
 *       The manifest registers a story the source does not declare —
 *       the file is gone, or the exported story name is gone. A
 *       registration that points at nothing is not an audit record.
 *   manifest-duplicate-story
 *       The same story file, or the same story, is registered twice.
 *       Two records for one story make the ledger ambiguous.
 *   manifest-invalid-verdict
 *       The declared verdict is not `pass` or `baseline`. The manifest
 *       may NOT declare that a story is allowed to fail: the tolerance
 *       for a known violation lives in the ledger, with a reason.
 *   manifest-missing-note
 *       The entry states no title or no note. The manifest is the
 *       record of "what was audited", so an entry that says nothing
 *       cannot be reviewed.
 *   manifest-empty-file
 *       The registered file names no story. An audited file has to say
 *       which of its stories are measured; an empty list would audit
 *       nothing while looking audited.
 *   manifest-title-mismatch
 *       The registered title is not the title the story file itself
 *       declares. The manifest must record where the stories are
 *       published, not a copy that can drift.
 *   pending-story-missing
 *       A pending entry names a story the source no longer declares.
 *   pending-missing-reason
 *       A pending entry states no reason. A deferral without a reason
 *       is an omission, not a decision.
 *   baseline-story-not-audited
 *       The ledger records a violation for a story the manifest does
 *       not register. The ledger may only tolerate a violation of an
 *       audited story.
 *   baseline-record-without-reason
 *       A ledger record states no reason. A tolerance with no stated
 *       reason is not a decision.
 *   baseline-record-for-pass-story
 *       A story declared `pass` has ledger records. Either the
 *       declaration or the ledger is stale.
 *   baseline-missing-record
 *       A story declared `baseline` has no ledger record. The
 *       declaration claims a tolerated violation that nobody recorded.
 *   fixture-expectation-mismatch
 *       The gate's own fixtures stopped reproducing the verdicts they
 *       declare. The fixtures are what make the decision reproducible
 *       without a browser, so a fixture that stopped reproducing it
 *       is a defect of the gate itself.
 *
 * STAGED REGISTRATION
 * -------------------
 * A story that is not registered is NOT a violation: it was written
 * before this audit existed, and auditing every story at once would
 * make the gate permanently red. Such a story is an OPEN ITEM — the
 * gate lists every one of them, with the file and the export name, so
 * the gap is visible in the report instead of being indistinguishable
 * from an oversight. A story the owner has looked at and deferred on
 * purpose is recorded in `PENDING_STORIES` with a reason.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * The report prints the two kinds of statement separately. Everything
 * below "not machine-checked" is a judgement this gate cannot make:
 * whether a recorded violation may stay recorded, whether the wording
 * of an accessible name is good, and whether the rendered result is
 * acceptable to a reader. `docs/verification/a11y/axe-storybook.md`
 * records who looked at them.
 *
 * Exit codes: 0 = every rule passes, 1 = at least one violation,
 * 2 = the repository could not be read.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
	AUDITED_STORIES,
	AUDITED_STORY_FILES,
	PENDING_STORIES,
} from '../e2e/a11y/axe-storybook-manifest.ts';
import {
	DECLARABLE_VERDICTS,
	reportedRuleIds,
	storyKey,
	verdictFor,
} from '../e2e/a11y/axe-storybook-verdict.ts';
import { REPO_ROOT, collectSourceFiles, stripComments, toRepoPath } from './_source-scan.mjs';

/** The Issue this gate enforces. */
export const ISSUE = '#392';

/**
 * The rules this gate reports, in the order they are decided.
 *
 * The last one is the gate's own integrity rule: the fixtures are
 * what makes the decision reproducible without a browser, so a fixture
 * that stopped reproducing it is a defect of the gate itself.
 */
export const RULES = [
	'manifest-story-missing',
	'manifest-duplicate-story',
	'manifest-invalid-verdict',
	'manifest-missing-note',
	'manifest-empty-file',
	'manifest-title-mismatch',
	'pending-story-missing',
	'pending-missing-reason',
	'baseline-story-not-audited',
	'baseline-record-without-reason',
	'baseline-record-for-pass-story',
	'baseline-missing-record',
	'fixture-expectation-mismatch',
];

/**
 * Where the fixture DATA lives.
 *
 * The fixtures are recorded axe-core results, not shipped surfaces:
 * they exist so the verdict decision stays reproducible without a
 * browser. They live under `scripts/` for exactly that reason — a
 * fixture inside `src/` would be a surface the gate has to exempt,
 * and an exemption is a hole.
 */
export const FIXTURE_ROOT = 'scripts/fixtures/a11y-axe-storybook';

/** The ledger of tolerated violations. */
export const BASELINE_PATH = 'e2e/a11y/axe-storybook-baseline.json';

/** The Storybook configuration that declares which files are stories. */
export const STORYBOOK_CONFIG_PATH = '.storybook/main.ts';

/**
 * The fixture files the Issue names, as an EXACT set.
 *
 * The set is closed on purpose: a fixture that is deleted must fail
 * the gate, not shrink the coverage the gate claims. A lower bound
 * ("at least one") would let the repository verify a fraction of the
 * states and still be green.
 */
export const EXPECTED_PASS_FIXTURES = ['clean-story.json', 'known-violation.json'];

export const EXPECTED_FAIL_FIXTURES = ['unknown-violation.json'];

/**
 * What the gate cannot decide, printed next to the machine result so
 * the two are never mixed.
 */
export const HUMAN_EVALUATION = [
	'記録済みの違反を設計判断として許容してよいか（前景色と背景色のコントラストの取りうる値）',
	'代替テキスト・aria-label の文言が読み手に伝わるか',
	'実際のスクリーンリーダーで読み上げ品質が保たれるか（このゲートは測らない）',
	'キーボード操作だけで主要フローが完了できるか（このゲートは測らない）',
];

/**
 * Minimal glob → RegExp for the subset Storybook's `stories` globs use
 * (`**`, `*`, `?`, `@(a|b)`).
 *
 * The subject set is read from the REAL configuration rather than
 * hard-coded, so a story file the configuration does not declare is
 * not audited, and a configuration change is visible instead of
 * silently narrowing the gate.
 */
export function globToRegExp(pattern) {
	let source = '^';
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === '*') {
			if (pattern[index + 1] === '*') {
				index += 1;
				if (pattern[index + 1] === '/') {
					source += '(?:.*/)?';
					index += 1;
				} else {
					source += '.*';
				}
				continue;
			}
			source += '[^/]*';
			continue;
		}
		if (char === '?') {
			source += '[^/]';
			continue;
		}
		if (char === '@' && pattern[index + 1] === '(') {
			const end = pattern.indexOf(')', index);
			if (end === -1) {
				source += '\\@';
				continue;
			}
			const alternatives = pattern.slice(index + 2, end).split('|');
			source += `(?:${alternatives.map((alternative) => escapeRegExp(alternative)).join('|')})`;
			index = end;
			continue;
		}
		source += escapeRegExp(char);
	}
	return new RegExp(`${source}$`);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `stories` globs the Storybook configuration declares.
 *
 * Only string literals are accepted: a glob the gate cannot read is a
 * subject set it cannot compute, and a subject set it cannot compute
 * is reported as an error rather than guessed.
 */
export function readStoryGlobs(root = REPO_ROOT) {
	const configPath = join(root, STORYBOOK_CONFIG_PATH);
	const source = stripComments(readFileSync(configPath, 'utf8'));
	const block = source.match(/stories\s*:\s*\[([\s\S]*?)\]/);
	if (!block) return { patterns: [], reason: 'no-stories-field' };
	const literals = [...block[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(
		(match) => match[1] ?? match[2],
	);
	if (literals.length === 0) return { patterns: [], reason: 'no-string-literal' };
	const patterns = literals.map((literal) => ({
		literal,
		// The pattern is matched against the repository-relative path of
		// a file, so the glob is resolved against the repository root —
		// not against the absolute path of the configuration file.
		regexp: globToRegExp(relative(root, resolve(join(root, '.storybook'), literal))),
	}));
	return { patterns, reason: null };
}

/**
 * The component title a story file publishes its stories under.
 *
 * The title is read from the file's own `meta` object — the same
 * object Storybook reads — so the manifest's title can be checked
 * offline, without a browser. A file that declares no readable title
 * yields `null`, and the manifest then has nothing to agree with.
 */
export function findStoryTitle(source, fileName = 'story.tsx') {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	// The default export IS the meta object: either the object itself,
	// or the name of the variable that holds it.
	let metaName = null;
	let metaObject = null;
	for (const statement of sourceFile.statements) {
		if (
			ts.isExportAssignment(statement) &&
			!statement.isExportEquals &&
			ts.isIdentifier(statement.expression)
		) {
			metaName = statement.expression.text;
		}
		if (ts.isExportAssignment(statement) && ts.isObjectLiteralExpression(statement.expression)) {
			metaObject = statement.expression;
		}
	}
	if (metaName) {
		for (const statement of sourceFile.statements) {
			if (!ts.isVariableStatement(statement)) continue;
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || declaration.name.text !== metaName) continue;
				metaObject = unwrapExpression(declaration.initializer);
			}
		}
	}
	if (!metaObject || !ts.isObjectLiteralExpression(metaObject)) return null;
	for (const property of metaObject.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		if (property.name.getText(sourceFile).replace(/['"`]/g, '') !== 'title') continue;
		const value = property.initializer;
		if (ts.isStringLiteralLike(value)) return value.text;
	}
	return null;
}

/** The expression inside a `satisfies` / `as` / parenthesis wrapper. */
function unwrapExpression(expression) {
	let current = expression;
	while (
		current &&
		(ts.isAsExpression(current) ||
			ts.isSatisfiesExpression(current) ||
			ts.isParenthesizedExpression(current) ||
			ts.isTypeAssertionExpression(current))
	) {
		current = current.expression;
	}
	return current ?? null;
}

/**
 * The exported story names of one story file.
 *
 * Every top-level `export const` / `export function` in a story file is
 * a story: the story files in this repository declare their stories
 * that way (CSF3), and a non-story export would be a component the
 * file documents, not a preview of it.
 *
 * The names are read with the TypeScript PARSER, not with a regular
 * expression. The story files are `.tsx`, they carry JSX text with
 * inline-code markers, and their string literals contain sequences such
 * as `/api/v1/*` — a regular expression cannot tell code from text
 * there, and a scanner that guesses wrong either invents an export or
 * hides the real ones behind a "comment" that never ends. The parser
 * is already a dependency of this repository, it parses a single file
 * without a type checker, and it answers the question exactly.
 */
export function findStoryExports(source, fileName = 'story.tsx') {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const names = [];
	for (const statement of sourceFile.statements) {
		const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
		const isExported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
		if (!isExported) continue;
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
			}
			continue;
		}
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			names.push(statement.name.text);
		}
	}
	return names;
}

/**
 * Every story the configuration declares, with the stories it exports.
 */
export function discoverStories(root = REPO_ROOT) {
	const { patterns, reason } = readStoryGlobs(root);
	if (patterns.length === 0) {
		throw new Error(`cannot read the Storybook story globs: ${reason}`);
	}
	const stories = [];
	const seen = new Set();
	const walk = (directory) => {
		for (const file of collectSourceFiles(directory)) {
			const relativePath = toRepoPath(file, root);
			if (seen.has(relativePath)) continue;
			if (!patterns.some((pattern) => pattern.regexp.test(relativePath))) continue;
			seen.add(relativePath);
			stories.push({
				file: relativePath,
				exports: findStoryExports(readFileSync(file, 'utf8'), relativePath),
				title: findStoryTitle(readFileSync(file, 'utf8'), relativePath),
			});
		}
	};
	walk(join(root, 'src'));
	return stories;
}

/** The ledger of tolerated violations. */
export function readBaseline(root = REPO_ROOT) {
	return JSON.parse(readFileSync(join(root, BASELINE_PATH), 'utf8'));
}

/** One violation of the audit contract. */
function violation(rule, file, message) {
	return { rule, file, line: null, wcag: null, message };
}

/**
 * The manifest contract: every registered story must exist, must be
 * declared once, must carry a declarable verdict, and must say what
 * it audits.
 *
 * The manifest registers a FILE and the story exports inside it, so
 * one file is registered once and every export of it is named.
 */
export function auditManifest(stories, entries = AUDITED_STORY_FILES) {
	const violations = [];
	const known = new Map(stories.map((story) => [story.file, story]));
	const seenFiles = new Set();
	const seenStories = new Set();
	for (const entry of entries) {
		if (seenFiles.has(entry.file)) {
			violations.push(
				violation(
					'manifest-duplicate-story',
					entry.file,
					'the same story file is registered twice; one file is one audited record',
				),
			);
			continue;
		}
		seenFiles.add(entry.file);
		const story = known.get(entry.file);
		if (!story) {
			violations.push(
				violation('manifest-story-missing', entry.file, 'the registered story file does not exist'),
			);
			continue;
		}
		if (!Array.isArray(entry.exports) || entry.exports.length === 0) {
			violations.push(
				violation(
					'manifest-empty-file',
					entry.file,
					'the registered file names no story; an audited file must say which of its stories are measured',
				),
			);
		}
		for (const exportName of entry.exports ?? []) {
			const key = storyKey(entry.file, exportName);
			if (seenStories.has(key)) {
				violations.push(
					violation(
						'manifest-duplicate-story',
						key,
						'the same story is registered twice; the ledger would have two records for one story',
					),
				);
				continue;
			}
			seenStories.add(key);
			if (!story.exports.includes(exportName)) {
				violations.push(
					violation(
						'manifest-story-missing',
						key,
						`the file does not export a story named "${exportName}"`,
					),
				);
			}
		}
		if (!DECLARABLE_VERDICTS.includes(entry.expect)) {
			violations.push(
				violation(
					'manifest-invalid-verdict',
					entry.file,
					`the declared verdict "${entry.expect}" is not declarable (${DECLARABLE_VERDICTS.join(' / ')}); a manifest entry may not allow a story to fail`,
				),
			);
		}
		if (
			!entry.title ||
			entry.title.trim().length === 0 ||
			!entry.note ||
			entry.note.trim().length === 0
		) {
			violations.push(
				violation(
					'manifest-missing-note',
					entry.file,
					'the entry states no title or no note; the manifest is the record of what was audited',
				),
			);
			continue;
		}
		const sourceTitle = story.title;
		if (sourceTitle && sourceTitle !== entry.title) {
			violations.push(
				violation(
					'manifest-title-mismatch',
					entry.file,
					`the manifest records the title "${entry.title}", but the file declares "${sourceTitle}"`,
				),
			);
		}
	}
	return violations;
}

/** The pending list: a deferral must name a story that exists, and a reason. */
export function auditPending(stories, entries = PENDING_STORIES) {
	const violations = [];
	const known = new Map(stories.map((story) => [story.file, story]));
	for (const entry of entries) {
		const key = storyKey(entry.file, entry.export);
		const story = known.get(entry.file);
		if (!story || !story.exports.includes(entry.export)) {
			violations.push(
				violation('pending-story-missing', key, 'the deferred story does not exist in the source'),
			);
			continue;
		}
		if (!entry.reason || entry.reason.trim().length === 0) {
			violations.push(violation('pending-missing-reason', key, 'the deferral states no reason'));
		}
	}
	return violations;
}

/**
 * The ledger contract: it may only tolerate a violation of an audited
 * story, and a tolerated violation always states a reason.
 *
 * The declaration is per FILE: a file declared `pass` must not have a
 * tolerated violation at all, and a file declared `baseline` must have
 * at least one — otherwise the declaration is stale in one direction
 * or the other.
 */
export function auditBaseline(baseline, entries = AUDITED_STORY_FILES) {
	const violations = [];
	const auditedStories = new Map(
		entries.flatMap((entry) =>
			entry.exports.map((exportName) => [storyKey(entry.file, exportName), entry]),
		),
	);
	for (const record of baseline.records ?? []) {
		if (!auditedStories.has(record.story)) {
			violations.push(
				violation(
					'baseline-story-not-audited',
					record.story,
					'the ledger records a violation for a story the manifest does not register',
				),
			);
			continue;
		}
		if (!record.reason || record.reason.trim().length === 0) {
			violations.push(
				violation(
					'baseline-record-without-reason',
					record.story,
					'the ledger record states no reason; a tolerance with no reason is not a decision',
				),
			);
		}
	}
	for (const entry of entries) {
		const keys = entry.exports.map((exportName) => storyKey(entry.file, exportName));
		const records = (baseline.records ?? []).filter((record) => keys.includes(record.story));
		if (entry.expect === 'pass' && records.length > 0) {
			violations.push(
				violation(
					'baseline-record-for-pass-story',
					entry.file,
					`the file is declared "pass" but the ledger records ${records.length} tolerated violation(s)`,
				),
			);
		}
		if (entry.expect === 'baseline' && records.length === 0) {
			violations.push(
				violation(
					'baseline-missing-record',
					entry.file,
					'the file is declared "baseline" but the ledger records no tolerated violation',
				),
			);
		}
	}
	return violations;
}

/**
 * The gate's own fixtures, read for real.
 *
 * A `pass/` fixture is a measurement the contract ACCEPTS: no
 * violation at all, or only violations the ledger records. A `fail/`
 * fixture is a measurement the contract REJECTS: a violation the
 * ledger does not record. Both sets must be exactly the sets the gate
 * names, and every fixture must reproduce the verdict it declares —
 * otherwise the decision this gate makes is no longer reproducible.
 */
export function collectFixtureEvidence(root = REPO_ROOT) {
	const read = (kind) => {
		const directory = join(root, FIXTURE_ROOT, kind);
		let files = [];
		try {
			files = collectJsonFiles(directory);
		} catch {
			files = [];
		}
		return files.map((file) => {
			const relativePath = toRepoPath(file, root);
			let fixture = null;
			let error = null;
			try {
				fixture = JSON.parse(readFileSync(file, 'utf8'));
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
			}
			return { file: relativePath, fixture, error };
		});
	};

	const pass = read('pass');
	const fail = read('fail');
	const mismatches = [...auditFixtureSets({ pass, fail }), ...auditFixtureVerdicts({ pass, fail })];
	return { root: FIXTURE_ROOT, pass, fail, mismatches };
}

/** The set-level expectation: the fixture files must be exactly the named ones. */
export function auditFixtureSets({ pass, fail }) {
	const mismatches = [];
	const check = (found, expected, kind) => {
		const names = found.map((entry) => entry.file.split('/').pop());
		for (const name of expected) {
			if (!names.includes(name)) {
				mismatches.push(
					violation(
						'fixture-expectation-mismatch',
						`${FIXTURE_ROOT}/${kind}/${name}`,
						`the ${kind} fixture the gate names is missing`,
					),
				);
			}
		}
		for (const name of names) {
			if (!expected.includes(name)) {
				mismatches.push(
					violation(
						'fixture-expectation-mismatch',
						`${FIXTURE_ROOT}/${kind}/${name}`,
						`the ${kind} fixture is not one the gate names; the set of states is closed`,
					),
				);
			}
		}
	};
	check(pass, EXPECTED_PASS_FIXTURES, 'pass');
	check(fail, EXPECTED_FAIL_FIXTURES, 'fail');
	return mismatches;
}

/**
 * The verdict-level expectation: every fixture must reproduce the
 * verdict it declares, and a fail fixture must report the rule it
 * names — a fixture that stops detecting its own rule would make the
 * whole audit blind to that rule without anything going red.
 */
export function auditFixtureVerdicts({ pass, fail }) {
	const mismatches = [];
	const check = (entries, kind) => {
		for (const entry of entries) {
			if (entry.error) {
				mismatches.push(
					violation(
						'fixture-expectation-mismatch',
						entry.file,
						`the fixture cannot be read: ${entry.error}`,
					),
				);
				continue;
			}
			const fixture = entry.fixture;
			const expected = fixture?.expect ?? {};
			const violations = fixture?.axe?.violations ?? [];
			const records = fixture?.baseline ?? [];
			const measured = verdictFor(violations, fixture?.story ?? '', records);
			if (measured !== expected.verdict) {
				mismatches.push(
					violation(
						'fixture-expectation-mismatch',
						entry.file,
						`the ${kind} fixture declares the verdict "${expected.verdict}" but the decision produces "${measured}"`,
					),
				);
				continue;
			}
			const ruleIds = reportedRuleIds(violations);
			for (const ruleId of expected.ruleIds ?? []) {
				if (!ruleIds.includes(ruleId)) {
					mismatches.push(
						violation(
							'fixture-expectation-mismatch',
							entry.file,
							`the ${kind} fixture must report the rule "${ruleId}", but the decision reported ${ruleIds.length === 0 ? 'no rule' : ruleIds.map((id) => `"${id}"`).join(', ')}`,
						),
					);
				}
			}
			if (expected.verdict === 'pass' && ruleIds.length > 0) {
				mismatches.push(
					violation(
						'fixture-expectation-mismatch',
						entry.file,
						'a fixture that declares the verdict "pass" must report no rule at all',
					),
				);
			}
		}
	};
	check(pass, 'pass');
	check(fail, 'fail');
	return mismatches;
}

/**
 * The stories that exist and are neither registered nor deferred.
 *
 * They are OPEN ITEMS, not violations: a story that was written
 * before this audit existed is not evidence of a defect, but it is
 * not evidence of a pass either. The gate lists every one of them so
 * the gap is visible.
 */
export function collectUnregisteredStories(stories) {
	const registered = new Set(AUDITED_STORIES.map((entry) => storyKey(entry.file, entry.export)));
	const deferred = new Set(PENDING_STORIES.map((entry) => storyKey(entry.file, entry.export)));
	const unregistered = [];
	for (const story of stories) {
		for (const exportName of story.exports) {
			const key = storyKey(story.file, exportName);
			if (registered.has(key) || deferred.has(key)) continue;
			unregistered.push({ key, file: story.file, export: exportName });
		}
	}
	return unregistered;
}

/**
 * Every `.json` file under `directory`, recursively.
 *
 * The fixtures are JSON, so the shared source scanner (which knows the
 * TypeScript suffixes) cannot collect them.
 */
export function collectJsonFiles(directory) {
	const files = [];
	const walk = (current) => {
		let entries = [];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
		}
	};
	walk(directory);
	return files.sort();
}

/**
 * Scan the repository (pure over `root`, so the rules are unit
 * testable without a checkout).
 */
export function collectEvidence(root = REPO_ROOT) {
	const violations = [];
	const stories = discoverStories(root);
	const baseline = readBaseline(root);

	violations.push(...auditManifest(stories));
	violations.push(...auditPending(stories));
	violations.push(...auditBaseline(baseline));

	const fixtures = collectFixtureEvidence(root);
	violations.push(...fixtures.mismatches);

	return {
		storyFiles: stories.length,
		storyCount: stories.reduce((total, story) => total + story.exports.length, 0),
		audited: AUDITED_STORIES.length,
		deferred: PENDING_STORIES.length,
		unregistered: collectUnregisteredStories(stories),
		baselineRecords: (baseline.records ?? []).length,
		fixtures,
		violations,
		humanEvaluation: HUMAN_EVALUATION,
	};
}

/** The human-readable report, with the two kinds of statement separated. */
export function renderGateSummary(evidence) {
	const lines = [];
	lines.push(`Storybook story audit contract — Issue ${ISSUE}`);
	lines.push(
		`${evidence.storyFiles} story file(s), ${evidence.storyCount} story/stories; ${evidence.audited} registered, ${evidence.deferred} deferred, ${evidence.unregistered.length} not registered yet`,
	);
	lines.push('');
	lines.push('machine-checked:');
	for (const rule of RULES) {
		const count = evidence.violations.filter((entry) => entry.rule === rule).length;
		lines.push(`  ${count === 0 ? 'ok  ' : 'FAIL'} ${rule.padEnd(34)} ${count} violation(s)`);
	}
	lines.push('');
	lines.push('not machine-checked (human evaluation):');
	for (const item of evidence.humanEvaluation) lines.push(`  - ${item}`);
	lines.push('');
	lines.push('open items (not registered yet — visible, not a failure):');
	for (const entry of evidence.unregistered) lines.push(`  - ${entry.key}`);
	lines.push('');
	if (evidence.violations.length > 0) {
		lines.push(`violations (${evidence.violations.length}):`);
		for (const entry of evidence.violations) {
			lines.push(`  [${entry.rule}] ${entry.file} — ${entry.message}`);
		}
	} else {
		lines.push('no violations');
	}
	return lines.join('\n');
}

function main() {
	let evidence;
	try {
		evidence = collectEvidence();
	} catch (error) {
		process.stderr.write(`cannot read the Storybook audit state: ${error.message}\n`);
		return 2;
	}
	const report = `${renderGateSummary(evidence)}\n`;
	if (evidence.violations.length > 0) process.stderr.write(report);
	else process.stdout.write(report);
	return evidence.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}

export { main };
