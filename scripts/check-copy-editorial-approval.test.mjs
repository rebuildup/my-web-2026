import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DECISIONS,
	DIMENSIONS,
	LEDGER_PATH,
	SURFACES_PATH,
	VERDICTS,
	buildChangeSet,
	classifyFile,
	evaluateApproval,
	extractSegments,
	fingerprintUnits,
	globToRegExp,
	matchesGlob,
	parseDiff,
	renderHtml,
	renderJson,
	renderText,
} from './check-copy-editorial-approval.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-copy-editorial-approval.mjs');
const FIXTURE_DIR = join(REPO_ROOT, 'test/fixtures/copy/editorial-approval');

/**
 * Fixture coverage for the public Japanese copy editorial approval gate
 * (Issue #506).
 *
 * The gate's whole value is that an unreviewed change of public copy
 * cannot pass, so the committed fixtures resolve to the four states the
 * report distinguishes: `pass`, `fail`, `not run` (NEEDS REVIEW) and
 * `not applicable`. A scanner regression must not be able to collapse
 * two of them into one — the test asserts the verdict AND the three
 * review dimensions of every fixture.
 *
 * The remaining cases pin the extraction rules (a Japanese string
 * literal is the unit; a comment is not copy; an admin surface is not
 * public copy) and the CLI contract (a base ref is required; a missing
 * one is an input error, never a silent pass).
 */

const surfaces = JSON.parse(readFileSync(join(REPO_ROOT, SURFACES_PATH), 'utf8'));
const ledger = JSON.parse(readFileSync(join(REPO_ROOT, LEDGER_PATH), 'utf8'));

function loadFixture(name) {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

function runFixture(name) {
	const fixture = loadFixture(name);
	const changeSet = buildChangeSet(`${fixture.diff.join('\n')}\n`, surfaces);
	const result = evaluateApproval({
		units: changeSet.units,
		ledger: fixture.ledger,
		pr: fixture.pr ?? null,
	});
	return { fixture, changeSet, result };
}

function runCli(args, env = {}) {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
			env: { ...process.env, ...env },
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
	}
}

const FIXTURE_NAMES = readdirSync(FIXTURE_DIR)
	.filter((name) => name.endsWith('.json'))
	.map((name) => name.replace(/\.json$/, ''))
	.sort();

describe('check-copy-editorial-approval — the four verdicts stay distinct', () => {
	it('every committed fixture resolves to its expected verdict', () => {
		for (const name of FIXTURE_NAMES) {
			const { fixture, result } = runFixture(name);
			assert.equal(
				result.verdict,
				fixture.expect,
				`fixture ${name} resolved to "${result.verdict}", expected "${fixture.expect}"`,
			);
		}
	});

	it('the fixtures cover every verdict the report can print', () => {
		const seen = new Set(FIXTURE_NAMES.map((name) => runFixture(name).result.verdict));
		for (const verdict of VERDICTS) {
			assert.ok(seen.has(verdict), `no fixture resolves to "${verdict}"`);
		}
	});
});

describe('check-copy-editorial-approval — an approved change set', () => {
	it('resolves all three review dimensions to pass', () => {
		const { result } = runFixture('approved');
		for (const dimension of DIMENSIONS) {
			assert.equal(result.dimensions[dimension], 'pass');
		}
		assert.deepEqual(result.findings, []);
	});

	it('extracts only the changed Japanese segment, with its original', () => {
		const { changeSet } = runFixture('approved');
		assert.equal(changeSet.units.length, 1);
		const unit = changeSet.units[0];
		assert.equal(unit.path, 'src/home/hero.tsx');
		assert.equal(unit.kind, 'modified');
		assert.equal(
			unit.after,
			'開発・制作・活動をまとめる次の Personal Web Platform の移行を進めています。',
		);
		assert.equal(
			unit.before,
			'開発・制作・活動をまとめる次の Personal Web Platform を構築しています。',
		);
	});

	it('binds the approval to the fingerprint of the change set', () => {
		const { fixture, changeSet, result } = runFixture('approved');
		assert.equal(fingerprintUnits(changeSet.units), fixture.ledger.records[0].fingerprint);
		assert.equal(result.fingerprint, fixture.ledger.records[0].fingerprint);
	});
});

describe('check-copy-editorial-approval — an unreviewed change set', () => {
	it('is NEEDS REVIEW, never a pass', () => {
		const { result } = runFixture('needs-review');
		assert.equal(result.verdict, 'not run');
		for (const dimension of DIMENSIONS) {
			assert.equal(result.dimensions[dimension], 'not run');
		}
		assert.ok(result.findings.some((item) => item.code === 'no-approval-record'));
	});

	it('reports a stale approval for the same pull request as a failure', () => {
		const { result } = runFixture('stale-approval');
		assert.equal(result.verdict, 'fail');
		assert.ok(result.findings.some((item) => item.code === 'stale-approval'));
	});
});

describe('check-copy-editorial-approval — a rejected change set', () => {
	it('is a fail, and the approval dimension is the one that fails', () => {
		const { result } = runFixture('rejected');
		assert.equal(result.verdict, 'fail');
		assert.equal(result.dimensions.approval, 'fail');
		assert.ok(result.findings.some((item) => item.code === 'approval-rejected'));
	});
});

describe('check-copy-editorial-approval — a change set that changes no public copy', () => {
	it('is not applicable and owes no review', () => {
		const { changeSet, result } = runFixture('not-applicable');
		assert.equal(changeSet.units.length, 0);
		assert.equal(result.verdict, 'not applicable');
		for (const dimension of DIMENSIONS) {
			assert.equal(result.dimensions[dimension], 'not applicable');
		}
		assert.deepEqual(result.findings, []);
	});

	it('lists the changed files it did not gate, with the reason', () => {
		const { changeSet } = runFixture('not-applicable');
		const paths = changeSet.otherFiles.map((file) => file.path);
		assert.deepEqual(paths, ['src/routes/admin.login.tsx']);
		for (const file of changeSet.otherFiles) {
			assert.ok(file.reason.length > 0);
		}
		// The public file changed, but not its Japanese text: it is a
		// public copy surface with nothing to review.
		assert.deepEqual(
			changeSet.publicFiles.map((file) => file.path),
			['src/home/hero.tsx'],
		);
	});
});

describe('check-copy-editorial-approval — the extraction rules', () => {
	it('takes a Japanese string literal as the unit', () => {
		const segments = extractSegments('\t\t\tlede="移行を進めています。"');
		assert.deepEqual(segments, ['移行を進めています。']);
	});

	it('falls back to the whole line when there is no literal', () => {
		const segments = extractSegments('\t\t\t<p>本文へスキップ</p>');
		assert.deepEqual(segments, ['<p>本文へスキップ</p>']);
	});

	it('ignores a Japanese comment — a comment is not copy', () => {
		assert.deepEqual(extractSegments('\t// 5 分前のように、単位との間に空白を入れる'), []);
		assert.deepEqual(extractSegments('\t * 「今」の語形はロケールごとに違う'), []);
	});

	it('ignores a line without Japanese', () => {
		assert.deepEqual(extractSegments('\t\t\tdata-testid="hero-lede"'), []);
	});

	it('pairs a replaced sentence with its original', () => {
		const diff = [
			'diff --git a/src/home/hero.tsx b/src/home/hero.tsx',
			'--- a/src/home/hero.tsx',
			'+++ b/src/home/hero.tsx',
			'@@ -12,1 +12,1 @@',
			'-\t\t\tlede="構築しています。"',
			'+\t\t\tlede="移行を進めています。"',
		].join('\n');
		const files = parseDiff(diff);
		assert.equal(files.length, 1);
		assert.equal(files[0].path, 'src/home/hero.tsx');
		const changeSet = buildChangeSet(diff, surfaces);
		assert.equal(changeSet.units.length, 1);
		assert.equal(changeSet.units[0].kind, 'modified');
	});

	it('reads a new file as an addition, not a modification', () => {
		const diff = [
			'diff --git a/src/home/new.tsx b/src/home/new.tsx',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/src/home/new.tsx',
			'@@ -0,0 +1,1 @@',
			'+\t\t\tlede="新しい見出し。"',
		].join('\n');
		const changeSet = buildChangeSet(diff, surfaces);
		assert.equal(changeSet.units.length, 1);
		assert.equal(changeSet.units[0].kind, 'added');
		assert.equal(changeSet.units[0].before, null);
	});
});

describe('check-copy-editorial-approval — the public copy surfaces', () => {
	it('gates a visitor-facing file', () => {
		assert.equal(classifyFile('src/home/hero.tsx', surfaces).public, true);
		assert.equal(classifyFile('copy/resources.json', surfaces).public, true);
	});

	it('does not gate an internal, admin, sample or fixture file', () => {
		for (const path of [
			'src/routes/admin.login.tsx',
			'src/home/composer.stories.tsx',
			'src/home/hero.test.tsx',
			'src/home/brief.md',
			'src/portfolio/fixtures/markdown/technical-article.md',
			'src/routes/design-system/DesignSystemPage.tsx',
		]) {
			assert.equal(classifyFile(path, surfaces).public, false, `${path} must not be gated`);
		}
	});

	it('matches globs the way the declaration uses them', () => {
		assert.ok(matchesGlob('src/home/**', 'src/home/status/tiles.tsx'));
		assert.ok(matchesGlob('src/routes/**', 'src/routes/portfolio/index.tsx'));
		assert.ok(matchesGlob('**/*.md', 'src/home/brief.md'));
		assert.ok(matchesGlob('src/routes/admin.*', 'src/routes/admin.login.tsx'));
		assert.ok(!matchesGlob('src/routes/admin.*', 'src/routes/index.tsx'));
		assert.ok(!matchesGlob('src/home/**', 'src/portfolio/seed.ts'));
		assert.ok(globToRegExp('src/routes/tools.$slug.tsx').test('src/routes/tools.$slug.tsx'));
	});
});

describe('check-copy-editorial-approval — the repository declarations', () => {
	it('the surface declaration is a versioned opt-in list', () => {
		assert.equal(surfaces.version, 1);
		assert.ok(Array.isArray(surfaces.publicCopyGlobs) && surfaces.publicCopyGlobs.length > 0);
		assert.ok(Array.isArray(surfaces.excludeGlobs));
	});

	it('the approval ledger is a versioned record list', () => {
		assert.equal(ledger.version, 1);
		assert.ok(Array.isArray(ledger.records));
		for (const record of ledger.records) {
			assert.ok(DECISIONS.includes(record.decision));
			assert.ok(typeof record.fingerprint === 'string' && record.fingerprint.startsWith('sha256:'));
		}
	});
});

describe('check-copy-editorial-approval — the command line contract', () => {
	it('prints the verdict and exits 0 when nothing public changed', () => {
		const result = runCli(['--base=HEAD', '--head=HEAD']);
		assert.equal(result.status, 0);
		assert.match(result.stdout, /NOT APPLICABLE/);
	});

	it('prints the fingerprint of the current change set', () => {
		const result = runCli(['--base=HEAD', '--head=HEAD', '--print-fingerprint']);
		assert.equal(result.status, 0);
		assert.match(result.stdout.trim(), /^sha256:[0-9a-f]{64}$/);
	});

	it('reads the base ref from the environment', () => {
		const result = runCli(['--head=HEAD', '--format=json'], { COPY_APPROVAL_BASE: 'HEAD' });
		assert.equal(result.status, 0);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.verdict, 'not applicable');
	});

	it('refuses to judge a change set it cannot see', () => {
		const result = runCli(['--base=refs/heads/does-not-exist', '--head=HEAD'], {
			COPY_APPROVAL_BASE: '',
			GITHUB_BASE_REF: '',
		});
		assert.equal(result.status, 2);
		assert.match(result.stderr, /no base ref/);
	});

	it('renders text, json and html reports of the same verdict', () => {
		const text = runCli(['--base=HEAD', '--head=HEAD']);
		const json = runCli(['--base=HEAD', '--head=HEAD', '--format=json']);
		const html = runCli(['--base=HEAD', '--head=HEAD', '--format=html']);
		assert.match(text.stdout, /verdict: NOT APPLICABLE/);
		assert.equal(JSON.parse(json.stdout).verdict, 'not applicable');
		assert.match(html.stdout, /Public Japanese copy — editorial approval gate/);
	});
});

describe('check-copy-editorial-approval — the report helpers', () => {
	it('renders a verdict, the dimensions and the change set as text', () => {
		const { result } = runFixture('needs-review');
		const text = renderText(result);
		assert.match(text, /verdict: NEEDS REVIEW/);
		assert.match(text, /proposal=not run/);
		assert.match(text, /src\/home\/hero\.tsx/);
	});

	it('renders the same verdict as json', () => {
		const { result } = runFixture('approved');
		const parsed = JSON.parse(renderJson(result));
		assert.equal(parsed.verdict, 'pass');
		assert.equal(parsed.dimensions.approval, 'pass');
	});

	it('renders the four verdicts and the out-of-scope list as html', () => {
		const { result } = runFixture('rejected');
		const html = renderHtml(result, { fixtures: [] });
		assert.match(html, /Public Japanese copy — editorial approval gate/);
		assert.match(html, /Out of scope/);
		assert.match(html, /not applicable/);
	});
});
