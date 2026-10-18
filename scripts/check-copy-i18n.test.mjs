import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CONTRACT_PATH,
	FIXTURE_CONTRACT_PATH,
	checkMessage,
	fallbackChain,
	loadContract,
	renderCoverageMatrix,
	renderHtml,
	renderJson,
	renderText,
	resolveMessage,
	runChecks,
	validateContract,
} from './check-copy-i18n.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-copy-i18n.mjs');

/**
 * Fixture coverage for the UI copy locale gate (Issue #428).
 *
 * The gate's whole value is failing when it should, so the fixture
 * contract plants one violation of every finding class and the first
 * case asserts each class still fires. The remaining cases pin the
 * fallback semantics (an untranslated key degrades to the author's own
 * text; an undetermined draft is skipped so the walk can still reach a
 * reviewed translation), the structural rules
 * that make a report trustworthy, and the fact that the gate runs
 * clean against the real repository contract — a scanner regression
 * must not be able to turn the gate into a silent no-op.
 */

function codesOf(findings) {
	return new Set(findings.map((item) => item.code));
}

function runCli(args) {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
	}
}

const fixture = loadContract(FIXTURE_CONTRACT_PATH).contract;
const fixtureResult = runChecks(fixture, { repoRoot: REPO_ROOT });

describe('check-copy-i18n — every finding class still fires', () => {
	it('reports each planted violation of the fixture contract', () => {
		const codes = codesOf(fixtureResult.findings);
		for (const code of [
			// coverage: untranslated and unregistered keys
			'missing-key',
			'unregistered-key',
			// fallback: a chain that cannot reach the source locale
			'fallback-undeclared',
			'unknown-locale',
			// contract shape
			'unknown-owner',
			// preservation: meaning, numbers, negation, permissions
			'number-drift',
			'placeholder-drift',
			'negation-drift',
			'permission-drift',
			// publication: undetermined rewording
			'draft-in-published-locale',
			// typography: mechanical, and distinct from prose
			'line-start-prohibited',
			'line-end-prohibited',
			'cjk-residue',
			'space-before-punctuation',
			'double-space',
			'stray-whitespace',
			'no-typography-rules',
			// opt-in is information, not failure
			'locale-not-opted-in',
			// prose is a recorded human claim, not a machine verdict
			'prose-unverified',
		]) {
			assert.ok(codes.has(code), `expected the fixture to plant ${code}`);
		}
		assert.ok(fixtureResult.summary.errors > 0);
	});

	it('keeps prose quality separable from mechanical typography', () => {
		const prose = fixtureResult.findings.filter((item) => item.class === 'prose');
		const typography = fixtureResult.findings.filter((item) => item.class === 'typography');
		assert.ok(prose.length > 0, 'the fixture must contain prose findings');
		assert.ok(typography.length > 0, 'the fixture must contain typography findings');
		for (const item of prose) {
			assert.ok(
				item.code !== 'line-start-prohibited' && item.code !== 'cjk-residue',
				'prose findings must not be mechanical typography findings',
			);
		}
	});

	it('points every finding at one feature / locale / key', () => {
		for (const item of fixtureResult.findings) {
			if (item.class === 'opt-in' || item.code === 'unknown-owner') continue;
			assert.ok(item.feature, `finding ${item.code} has no feature`);
			assert.ok(item.locale, `finding ${item.code} has no locale`);
		}
	});
});

describe('check-copy-i18n — fallback and draft semantics', () => {
	it('serves the source text when a declared locale has no resource', () => {
		const resolved = resolveMessage(fixture, 'contact', 'en', 'contact.reply.window');
		assert.equal(resolved.ok, true);
		assert.equal(resolved.reason, 'missing');
		assert.equal(resolved.resolvedFrom, 'ja');
		assert.equal(resolved.text, '7 日以内に返信します');
	});

	it('never serves a draft and keeps walking the chain for a reviewed text', () => {
		const resolved = resolveMessage(fixture, 'contact', 'en', 'contact.publish.cap');
		assert.equal(resolved.ok, true, 'a skipped draft still resolves to readable text');
		assert.equal(resolved.reason, 'missing', 'nothing reviewed remains in the chain');
		assert.deepEqual(resolved.draftsSkipped, ['en'], 'the draft was skipped, not served');
		assert.equal(resolved.resolvedFrom, 'ja');
		assert.equal(resolved.text, '公開できるプロジェクトは上限 3 つまでです');
	});

	it('resolves past a draft in the requested locale to a reviewed fallback locale', () => {
		const contract = {
			features: [
				{
					id: 'contact',
					owner: 'contact',
					sourceLocale: 'ja',
					locales: {
						ja: { state: 'source' },
						en: { state: 'translating', fallback: 'fr' },
						fr: { state: 'published', fallback: 'ja' },
					},
					keys: [{ key: 'k.title', source: '原文のタイトル' }],
					messages: {
						en: { 'k.title': { text: 'draft title', status: 'draft', prose: 'unverified' } },
						fr: { 'k.title': { text: 'titre verifie', status: 'reviewed', prose: 'verified' } },
					},
				},
			],
		};
		const resolved = resolveMessage(contract, 'contact', 'en', 'k.title');
		assert.equal(resolved.reason, 'fallback');
		assert.equal(resolved.resolvedFrom, 'fr');
		assert.equal(resolved.text, 'titre verifie');
		assert.deepEqual(resolved.draftsSkipped, ['en']);
	});

	it('degrades to the source locale for a locale the feature never opted into', () => {
		const resolved = resolveMessage(fixture, 'contact', 'de', 'contact.reply.window');
		assert.equal(resolved.reason, 'locale-not-declared');
		assert.equal(resolved.text, '7 日以内に返信します');
	});

	it('follows a multi-step chain to the nearest reviewed resource', () => {
		const contract = {
			features: [
				{
					id: 'chain',
					owner: 'home',
					sourceLocale: 'ja',
					locales: {
						ja: { state: 'source' },
						en: { state: 'published', fallback: 'fr' },
						fr: { state: 'translating', fallback: 'ja' },
					},
					keys: [{ key: 'chain.title', source: '原文' }],
					messages: {
						fr: { 'chain.title': { text: 'brouillon', status: 'draft', prose: 'unverified' } },
						en: {
							'chain.title': { text: 'Draft fallback', status: 'reviewed', prose: 'verified' },
						},
					},
				},
			],
		};
		assert.equal(fallbackChain(contract.features[0], 'en').ok, true);
		const resolved = resolveMessage(contract, 'chain', 'en', 'chain.title');
		assert.equal(resolved.reason, 'hit');
		assert.equal(resolved.resolvedFrom, 'en');
	});

	it('reports the structural reasons a chain cannot be trusted', () => {
		const cyclic = {
			id: 'cycle',
			locales: {
				ja: { state: 'source' },
				en: { state: 'published', fallback: 'fr' },
				fr: { state: 'translating', fallback: 'en' },
			},
		};
		assert.equal(fallbackChain(cyclic, 'en').reason, 'fallback-cycle');

		const undeclared = {
			id: 'undeclared',
			locales: { ja: { state: 'source' }, en: { state: 'published', fallback: 'fr' } },
		};
		assert.equal(fallbackChain(undeclared, 'en').reason, 'fallback-undeclared');

		const unterminated = {
			id: 'unterminated',
			locales: { en: { state: 'published', fallback: 'fr' }, fr: { state: 'translating' } },
		};
		assert.equal(fallbackChain(unterminated, 'en').reason, 'fallback-unterminated');
	});

	it('refuses a source locale that declares its own fallback', () => {
		const contract = {
			schemaVersion: 1,
			knownLocales: ['ja', 'en'],
			features: [
				{
					id: 'home',
					owner: 'home',
					sourceLocale: 'ja',
					locales: {
						ja: { state: 'source', fallback: 'en' },
						en: { state: 'published', fallback: 'ja' },
					},
					keys: [],
					messages: {},
				},
			],
		};
		const codes = codesOf(validateContract(contract, { repoRoot: REPO_ROOT }));
		assert.ok(codes.has('fallback-on-source'));
	});
});

describe('check-copy-i18n — mechanical preservation and prose are separate checks', () => {
	const base = {
		feature: 'contact',
		key: 'k',
		locale: 'en',
		state: 'published',
		sourceLocale: 'ja',
		sourceText: '管理者のみ 12 件 {name} は利用できません',
		guarded: true,
	};

	it('does not block a faithful translation', () => {
		const findings = checkMessage({
			...base,
			message: {
				text: 'Only an admin may not use {name} for 12 entries',
				status: 'reviewed',
				prose: 'verified',
			},
		});
		assert.deepEqual(
			findings.filter((item) => item.severity === 'error').map((item) => item.code),
			[],
		);
	});

	it('keeps an unreviewed prose claim visible without inventing a machine verdict', () => {
		const findings = checkMessage({
			...base,
			message: {
				text: 'An admin alone may use {name} for 12 entries',
				status: 'reviewed',
				prose: 'unverified',
			},
		});
		const prose = findings.filter((item) => item.class === 'prose');
		assert.ok(prose.some((item) => item.code === 'prose-unverified'));
		assert.ok(prose.every((item) => item.message.includes('human')));
	});
});

describe('check-copy-i18n — opt-in is never a requirement', () => {
	it('accepts a feature that serves only the source locale', () => {
		const contract = {
			schemaVersion: 1,
			knownLocales: ['ja', 'en', 'de', 'fr'],
			features: [
				{
					id: 'home',
					owner: 'home',
					sourceLocale: 'ja',
					locales: { ja: { state: 'source' } },
					keys: [],
					messages: {},
				},
			],
		};
		const result = runChecks(contract, { repoRoot: REPO_ROOT });
		assert.equal(result.summary.errors, 0);
		assert.equal(result.summary.info, 3, 'one information finding per unopted locale');
		assert.ok(result.findings.every((item) => item.severity === 'info'));
	});

	it('never asks a feature to declare a locale it did not opt into', () => {
		const result = runChecks(fixture, { repoRoot: REPO_ROOT });
		for (const item of result.findings) {
			if (item.code === 'locale-not-opted-in') {
				assert.equal(item.severity, 'info');
				assert.equal(item.class, 'opt-in');
			}
		}
	});
});

describe('check-copy-i18n — the gate as CI runs it', () => {
	it('passes on the repository contract', () => {
		const result = runCli([]);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /repository contract \(copy\/resources\.json\)/);
	});

	it('fails the repository contract if one is supplied by hand', () => {
		// A gate that cannot fail is a gate nobody reads: the shipped
		// contract is clean, so the failing run below is what proves
		// the CLI wiring, not only the pure functions.
		const result = runCli([`--contract=${FIXTURE_CONTRACT_PATH}`, '--strict']);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /missing-key coverage/);
	});

	it('never lets demonstration fixture data gate the run', () => {
		const result = runCli(['--include-fixture']);
		assert.equal(result.status, 0, 'fixture findings are demonstration data');
		assert.match(result.stdout, /fixture \(demonstration\)/);
	});

	it('rejects an unreadable or unknown input instead of reporting success', () => {
		assert.equal(runCli(['--contract=test/fixtures/i18n/does-not-exist.json']).status, 2);
		assert.equal(runCli(['--format=nope']).status, 2);
		assert.equal(runCli(['--unknown-flag']).status, 2);
	});

	it('reports a malformed features field instead of crashing on it', () => {
		const result = runChecks(
			{ schemaVersion: 1, knownLocales: ['ja'], features: {} },
			{ repoRoot: REPO_ROOT },
		);
		assert.ok(codesOf(result.findings).has('no-features'));
		assert.equal(result.summary.features, 0);
	});

	it('renders every format from the same findings', () => {
		const runs = [
			{
				label: 'fixture',
				path: FIXTURE_CONTRACT_PATH,
				contract: fixture,
				findings: fixtureResult.findings,
				summary: fixtureResult.summary,
			},
		];
		const text = renderText(runs);
		assert.match(text, /\[error\] missing-key coverage/);
		assert.match(text, /Prose quality \(not decidable here\)/);
		assert.match(text, /locale opt-in \(— = not opted in, never a failure\)/);

		const json = JSON.parse(renderJson(runs));
		assert.equal(json.runs[0].findings.length, fixtureResult.findings.length);

		const html = renderHtml(runs);
		assert.match(html, /<table>/);
		assert.match(html, /class="badge error"/);
		assert.match(html, /class="matrix"/);
		assert.match(html, /How to read this report/);
	});

	it('shows the uneven opt-in shape instead of only its failures', () => {
		const matrix = renderCoverageMatrix(fixture);
		assert.deepEqual(matrix.head, ['feature', 'owner', 'ja', 'en', 'de']);
		const contact = matrix.rows.find((row) => row[0] === 'contact');
		assert.deepEqual(contact, ['contact', 'contact', 'source', 'published', '—']);
		assert.equal(renderCoverageMatrix(null), null);
	});

	it('reports an empty run instead of printing silence', () => {
		const text = renderText([
			{ label: 'clean', path: CONTRACT_PATH, findings: [], summary: runChecks(fixture).summary },
		]);
		assert.match(text, /OK: every declared locale is complete/);
	});
});

describe('check-copy-i18n — the shipped repository contract', () => {
	it('registers only source obligations that exist and passes cleanly', () => {
		const contract = JSON.parse(readFileSync(join(REPO_ROOT, CONTRACT_PATH), 'utf8'));
		const result = runChecks(contract, { repoRoot: REPO_ROOT });
		assert.deepEqual(
			result.findings.filter((item) => item.severity === 'error'),
			[],
			JSON.stringify(
				result.findings.filter((item) => item.severity === 'error'),
				null,
				2,
			),
		);
		assert.ok(contract.features.length > 0);
		for (const feature of contract.features) {
			assert.ok(
				readFileSync(join(REPO_ROOT, 'src', feature.owner, 'public.ts'), 'utf8').length > 0,
				`${feature.owner} must be a live source obligation`,
			);
		}
	});

	it('pins the single-locale shape the repository contract declares today', () => {
		// The shipped contract records `ja` for every feature. `/tools`
		// and `/contact` ship bilingual / English-authored copy, so
		// whether their `sourceLocale` should be `en` is an owner copy
		// decision (recorded in `copy/README.md`), not something this
		// gate may settle. This test pins the shape as it is, so the
		// decision shows up as a diff when it is taken.
		const contract = JSON.parse(readFileSync(join(REPO_ROOT, CONTRACT_PATH), 'utf8'));
		assert.deepEqual(contract.knownLocales, ['ja']);
		for (const feature of contract.features) {
			assert.equal(feature.sourceLocale, 'ja');
			assert.deepEqual(Object.keys(feature.locales), ['ja']);
			assert.equal(feature.locales.ja.state, 'source');
		}
	});
});
