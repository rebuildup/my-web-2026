import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `log-redaction-report.mjs` self-tests (Issue #467, review fix).
 *
 * The report is the artefact a reviewer looks at instead of
 * re-running the audit, and its verdict is a *claim*: "no canary
 * survived on any surface". That claim was never asserted, and it
 * shipped with one sample unguarded: the guard list was maintained
 * by hand next to the sample list, one entry had drifted
 * (`…Ws5e0` guarding a `…Ws5Yh0Ju3Ee` value), and the report still
 * printed PASS — including in the screenshot committed to the PR.
 *
 * So the generator is exercised end-to-end against isolated fixture
 * trees, exactly like `check-log-redaction.test.mjs` does for the
 * gate: the real script is copied into a temp repo and run against
 * (a) a redactor that redacts nothing, (b) one whose blob layer
 * alone is neutered, (c) tampered sample guards, and (d) the
 * repository's own redactor. A claim that cannot fail is not a
 * claim.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SCRIPT_SOURCE = readFileSync(resolve(HERE, 'log-redaction-report.mjs'), 'utf8');
const REDACT_SOURCE = readFileSync(resolve(REPO_ROOT, 'src/logging/redact.ts'), 'utf8');

/**
 * A redactor that redacts nothing. Nothing may reach the report as
 * a clean verdict while every layer is disabled.
 */
const NO_REDACTION = `export function redactLogText(text) {
\treturn text;
}
export function redactLogValue(value) {
\treturn value;
}
`;

/**
 * Only the opaque-blob layer is broken: the threshold that hides an
 * unbounded run of token-ish characters is raised past any real
 * value, every other layer still works. This is the shape of the
 * bug the review found — a PASS printed from a partially working
 * redactor.
 */
const BLIND_TO_BLOBS = REDACT_SOURCE.replace(
	'[A-Za-z0-9._~+/=-]{24,}',
	'[A-Za-z0-9._~+/=-]{4096,}',
);

/** Run the copied generator inside a fixture repo and report the result. */
function runReport({ redactSource = REDACT_SOURCE, scriptSource = SCRIPT_SOURCE } = {}) {
	const repo = mkdtempSync(join(tmpdir(), 'log-redaction-report-'));
	try {
		const scriptPath = join(repo, 'scripts', 'log-redaction-report.mjs');
		mkdirSync(dirname(scriptPath), { recursive: true });
		writeFileSync(scriptPath, scriptSource);
		mkdirSync(join(repo, 'src', 'logging'), { recursive: true });
		writeFileSync(join(repo, 'src', 'logging', 'redact.ts'), redactSource);
		// No version on purpose: `version:check` forbids release-shaped
		// literals in `scripts/**`, and the meta line only needs to
		// read whatever the package says.
		writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`);
		const out = join(repo, '.tmp', 'log-redaction-report.html');
		let result;
		try {
			const stdout = execFileSync(process.execPath, [scriptPath], {
				cwd: repo,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			result = { status: 0, stdout, stderr: '' };
		} catch (error) {
			result = {
				status: typeof error.status === 'number' ? error.status : 1,
				stdout: error.stdout ?? '',
				stderr: error.stderr ?? '',
			};
		}
		// Read the artefact before the temp tree is removed: whether a
		// page was written is part of the contract under test.
		return existsSync(out)
			? { ...result, wrotePage: true, page: readFileSync(out, 'utf8') }
			: { ...result, wrotePage: false, page: '' };
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

/** Sample labels as declared in the generator source. */
const SAMPLE_LABELS = [...SCRIPT_SOURCE.matchAll(/\n\t+label: '([^']+)'/g)].map(
	(match) => match[1],
);

/** Every canary string declared in the generator source, deduplicated. */
const DECLARED_CANARIES = [
	...new Set(
		[...SCRIPT_SOURCE.matchAll(/canaries: \[([^\]]*)\]/g)].flatMap((match) =>
			match[1]
				.split(',')
				.map((canary) => canary.trim().replace(/^'|'$/g, ''))
				.filter(Boolean),
		),
	),
];

describe('log-redaction-report.mjs — the verdict is fail-closed', () => {
	it('reports PASS and writes the page when the real redactor removes every canary', () => {
		const result = runReport();
		assert.equal(result.status, 0);
		assert.match(result.stdout, /PASS — no canary survived on any surface/);
		assert.ok(result.wrotePage, 'the report page should be written on a clean run');
	});

	it('fails and writes no page when redaction stops working at all', () => {
		const result = runReport({ redactSource: NO_REDACTION });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /FAIL — \d+ canary survived redaction/);
		assert.equal(result.wrotePage, false, 'a failing run must not leave a screenshot-able page');
	});

	it('fails when a single layer regresses, naming the sample it stopped covering', () => {
		assert.notEqual(
			BLIND_TO_BLOBS,
			REDACT_SOURCE,
			'the fixture must actually disable the blob layer',
		);
		const result = runReport({ redactSource: BLIND_TO_BLOBS });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /FAIL — \d+ canary survived redaction/);
		assert.match(result.stderr, /Opaque credential/);
		assert.equal(result.wrotePage, false);
	});
});

describe('log-redaction-report.mjs — every sample is guarded', () => {
	it('refuses to generate a report when a canary does not occur in its own sample', () => {
		// The exact typo the review found: a guard string that is not a
		// substring of the value it guards can never fire.
		const tampered = SCRIPT_SOURCE.replace(
			"'K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5Yh0Ju3Ee'],",
			"'K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5e0'],",
		);
		assert.notEqual(tampered, SCRIPT_SOURCE, 'the fixture must actually tamper with the canary');
		const result = runReport({ scriptSource: tampered });
		assert.equal(result.status, 2);
		assert.match(result.stderr, /unguarded sample/);
		assert.match(result.stderr, /does not occur in the sample it guards/);
		assert.equal(result.wrotePage, false);
	});

	it('refuses to generate a report when a sample declares no canary at all', () => {
		const unguarded = SCRIPT_SOURCE.replace(
			"\t\tcanaries: ['K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5Yh0Ju3Ee'],\n",
			'',
		);
		assert.notEqual(unguarded, SCRIPT_SOURCE, 'the fixture must actually drop a canary');
		const result = runReport({ scriptSource: unguarded });
		assert.equal(result.status, 2);
		assert.match(result.stderr, /declares no canary/);
		assert.equal(result.wrotePage, false);
	});

	it('renders every declared sample and counts every declared canary on the page', () => {
		assert.ok(
			SAMPLE_LABELS.length >= 6,
			`expected a sample per log shape, found ${SAMPLE_LABELS.length}`,
		);
		assert.ok(
			DECLARED_CANARIES.length >= SAMPLE_LABELS.length,
			'every sample must declare at least one canary',
		);
		const page = runReport().page;
		for (const label of SAMPLE_LABELS) {
			assert.ok(page.includes(label), `sample row missing from the page: ${label}`);
		}
		assert.match(
			page,
			new RegExp(`${SAMPLE_LABELS.length} サンプル / ${DECLARED_CANARIES.length} canary`),
		);
	});
});
