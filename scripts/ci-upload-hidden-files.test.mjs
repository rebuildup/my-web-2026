/**
 * The retained byte set must equal the attested byte set (Issue #906).
 *
 * `scripts/check-artifact-attestation.mjs` hashes `.cloudflare/output/v0/`
 * INCLUDING hidden files, while `actions/upload-artifact` v4.4+ excludes
 * them unless the step sets `include-hidden-files: true`. On push run
 * `41953079799` the manifest recorded 492 files but the artifact kept
 * 491: `workers/default/bundle/.vite/manifest.json` was attested and
 * dropped, so release step 9.1 failed on the file list and on the
 * digest.
 *
 * This suite reads `.github/workflows/ci.yml` OFFLINE (regex over the
 * step blocks — no YAML dependency is installed) and pins, against the
 * shipped workflow and against counter-examples, that:
 *
 *   1. an upload step named `cf-build-output-*` exists;
 *   2. it sets `include-hidden-files: true`;
 *   3. its `path:` is exactly the attestation root
 *      (`DEFAULT_ARTIFACT_DIR` as hashed by the attestation manifest).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ARTIFACT_DIR } from './_artifact-attestation.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

/** The artifact name family whose bytes the attestation hashes. */
const ARTIFACT_NAME_PREFIX = 'cf-build-output-';

/** The attestation root as the upload step must spell it. */
const EXPECTED_PATH = `${DEFAULT_ARTIFACT_DIR}/`;

/**
 * Parse the `actions/upload-artifact` steps out of a workflow.
 *
 * A step block starts at `      - ` (6 spaces). A step-level comment or
 * a dedent below step level closes the current block, so the comment
 * prose that precedes a step never merges into the previous one.
 */
function parseUploadSteps(text) {
	const steps = [];
	let block = null;
	const flush = () => {
		if (block?.some((line) => /^\s*uses:\s*actions\/upload-artifact@/.test(line))) {
			steps.push(parseStep(block));
		}
		block = null;
	};

	for (const line of text.split('\n')) {
		if (block === null) {
			if (/^ {6}- /.test(line)) block = [line];
			continue;
		}
		if (/^ {6}- /.test(line)) {
			flush();
			block = [line];
			continue;
		}
		if (line.trim() !== '' && line.search(/\S/) < 6) {
			flush();
			continue;
		}
		if (/^ {6}#/.test(line)) {
			flush();
			continue;
		}
		block.push(line);
	}
	flush();
	return steps;
}

/** Read `step name`, `uses` and the `with:` keys of one step block. */
function parseStep(block) {
	let stepName = null;
	let uses = null;
	let lastKey = null;
	const withValues = {};

	for (const line of block) {
		const nameMatch = /^ {6}- name:\s*(.*)$/.exec(line);
		if (nameMatch) {
			stepName = nameMatch[1].trim();
			continue;
		}
		const usesMatch = /^ {8}uses:\s*(\S+)/.exec(line);
		if (usesMatch) {
			uses = usesMatch[1];
			continue;
		}
		const keyMatch = /^ {10}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (keyMatch) {
			lastKey = keyMatch[1];
			const value = keyMatch[2].trim();
			if (value === '|' || value === '|-' || value === '>' || value === '>-') {
				withValues[lastKey] = [];
			} else {
				withValues[lastKey] = value;
			}
			continue;
		}
		if (lastKey !== null && Array.isArray(withValues[lastKey]) && /^ {12}\S/.test(line)) {
			withValues[lastKey].push(line.trim());
		}
	}

	return { stepName, uses, with: withValues };
}

/** First `path:` entry, whether the key is scalar or a block list. */
function firstPath(step) {
	const value = step.with.path;
	if (Array.isArray(value)) return value[0];
	return value;
}

/**
 * Audit every `cf-build-output-*` upload step of a workflow text.
 * Returns the problems found; an empty array means the retained byte
 * set can equal the attested byte set.
 */
function auditCfBuildOutputUpload(text) {
	const problems = [];
	const targets = parseUploadSteps(text).filter(
		(step) => typeof step.with.name === 'string' && step.with.name.startsWith(ARTIFACT_NAME_PREFIX),
	);
	if (targets.length === 0) {
		problems.push(
			`no upload step named ${ARTIFACT_NAME_PREFIX}* — the attested bytes would not be retained at all`,
		);
		return problems;
	}
	for (const step of targets) {
		const where = step.stepName ?? step.with.name;
		if (step.with['include-hidden-files'] !== 'true') {
			problems.push(
				`${where}: include-hidden-files is not \`true\` — upload-artifact v4.4+ drops hidden files while the attestation hashes them`,
			);
		}
		const path = firstPath(step);
		if (path !== EXPECTED_PATH) {
			problems.push(
				`${where}: path is \`${path ?? '<missing>'}\`, attestation root is \`${EXPECTED_PATH}\``,
			);
		}
	}
	return problems;
}

/** The exact step shape of `.github/workflows/ci.yml`, as fixture lines. */
function fixtureStep({ includeHiddenFiles, path }) {
	return [
		'      - name: Upload Cloudflare Build Output (attested bytes)',
		"        if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'",
		'        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2',
		'        with:',
		'          name: cf-build-output-${{ github.sha }}',
		`          path: ${path}`,
		...(includeHiddenFiles ? ['          include-hidden-files: true'] : []),
		'          retention-days: 90',
		'          if-no-files-found: error',
		'',
	].join('\n');
}

describe('the shipped workflow keeps the attested bytes (Issue #906)', () => {
	it('has no problem to report for .github/workflows/ci.yml', () => {
		const text = readFileSync(CI_WORKFLOW, 'utf8');
		assert.deepEqual(auditCfBuildOutputUpload(text), []);
	});

	it('finds exactly the one cf-build-output upload step it audited', () => {
		const text = readFileSync(CI_WORKFLOW, 'utf8');
		const targets = parseUploadSteps(text).filter(
			(step) =>
				typeof step.with.name === 'string' && step.with.name.startsWith(ARTIFACT_NAME_PREFIX),
		);
		assert.equal(targets.length, 1);
		assert.equal(firstPath(targets[0]), EXPECTED_PATH);
		assert.equal(targets[0].with['include-hidden-files'], 'true');
	});
});

describe('counter-examples must fail the audit', () => {
	it('fails when include-hidden-files is dropped', () => {
		const problems = auditCfBuildOutputUpload(
			fixtureStep({ includeHiddenFiles: false, path: EXPECTED_PATH }),
		);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /include-hidden-files/);
	});

	it('fails when the path drifts away from the attestation root', () => {
		const problems = auditCfBuildOutputUpload(
			fixtureStep({ includeHiddenFiles: true, path: 'dist-cloudflare/' }),
		);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /path is `dist-cloudflare\/`/);
	});

	it('fails when the upload step is gone entirely', () => {
		const problems = auditCfBuildOutputUpload(
			'jobs:\n  ci:\n    steps:\n      - uses: actions/checkout@abc # v4\n',
		);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /not be retained at all/);
	});
});
