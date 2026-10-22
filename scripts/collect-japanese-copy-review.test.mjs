import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { extractSegments as sharedExtractSegments } from './_copy-japanese-diff.mjs';
import { extractSegments as gateExtractSegments } from './check-copy-editorial-approval.mjs';
import {
	DECLARATION_PATH,
	FIXTURE_DIR,
	analyzeUnit,
	buildReviewTargets,
	claimMarkers,
	classifyReviewFile,
	cleanInlineMarkdown,
	exitCodeFor,
	loadDeclarations,
	markdownProseMask,
	markdownSegments,
	numericTokens,
	renderHtml,
	renderJson,
	renderText,
	secretShape,
	summarize,
	syntheticSecretFixture,
	visibleSegments,
} from './collect-japanese-copy-review.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts/collect-japanese-copy-review.mjs');

/**
 * Tests for the Japanese copy review-target collector (Issue #425).
 *
 * The collector is informational: it lists changed Japanese prose and its
 * original, and it must NOT approve, rewrite or silently drop a change.
 * These tests therefore pin four things:
 *
 *   1. the fixture matrix — every status is reachable, and the article
 *      fixture proves fenced code / link destinations are excluded;
 *   2. the shared extraction rule — the #506 gate and this collector must
 *      resolve "the Japanese text this diff changed" through one function,
 *      never two divergent copies;
 *   3. semantic risk — a number / negation / permission change is
 *      surfaced, including a qualifier (`のみ`) removed from a sentence
 *      that still carries its category marker;
 *   4. the withholding invariant — a credential-shaped line contributes
 *      no text to any renderer, only a path, a line and a detector id.
 */

const { declaration, baseSurfaces } = loadDeclarations();

function loadFixture(name) {
	return JSON.parse(readFileSync(join(REPO_ROOT, FIXTURE_DIR, `${name}.json`), 'utf8'));
}

function runFixture(name) {
	const fixture = loadFixture(name);
	return {
		fixture,
		result: buildReviewTargets(`${fixture.diff.join('\n')}\n`, declaration, baseSurfaces, {
			sourceTexts: fixture.sourceTexts ?? {},
			diffBase: null,
		}),
	};
}

function runCli(args, overrides = {}) {
	// A CI environment may carry a base ref; a test that asserts the
	// "no base" path must not inherit it.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => key !== 'GITHUB_BASE_REF' && key !== 'COPY_REVIEW_BASE',
		),
	);
	Object.assign(env, overrides);
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
			env,
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		return { status: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
	}
}

describe('fixture matrix', () => {
	it('lists every committed fixture and its expected status', () => {
		const names = ['article-markdown', 'meaning-risk', 'modified-ui', 'no-change'];
		for (const name of names) {
			const { fixture, result } = runFixture(name);
			assert.equal(result.status, fixture.expect, `${name}: status`);
		}
	});

	it('pairs a rewritten public UI sentence with its numeric change', () => {
		const { result } = runFixture('modified-ui');
		assert.equal(result.status, 'attention');
		assert.equal(result.targets.length, 1);
		const [target] = result.targets;
		assert.equal(target.scope, 'ui');
		assert.equal(target.kind, 'modified');
		assert.equal(target.before, '無料で始められます');
		assert.equal(target.after, '無料で始められます。3分で完了します');
		assert.deepEqual(target.numbersAdded, ['3']);
		assert.ok(target.risk.includes('number-drift'));
		assert.ok(target.meaningRisk);
	});

	it('collects article prose but not fenced code, inline code or a URL destination', () => {
		const { result } = runFixture('article-markdown');
		assert.equal(result.status, 'review');
		const texts = result.targets.map((target) => target.after ?? target.before);
		assert.ok(texts.includes('はじめに'), 'heading marker stripped');
		assert.ok(texts.includes('これは公開記事の本文です。'), 'prose collected');
		assert.ok(
			texts.some((text) => text.includes('詳細はこちらを参照してください')),
			'link text kept',
		);
		assert.ok(!texts.some((text) => text.includes('これはコードです')), 'fenced code excluded');
		assert.ok(
			!texts.some((text) => text.includes('秘密のページ')),
			'link destination excluded even when it contains Japanese',
		);
		assert.ok(!texts.some((text) => text.includes('```')), 'fence markers never become prose');
	});

	it('surfaces a dropped permission qualifier as permission-drift', () => {
		const { result } = runFixture('meaning-risk');
		assert.equal(result.status, 'attention');
		const [target] = result.targets;
		assert.equal(target.scope, 'about');
		assert.ok(target.risk.includes('permission-drift'));
		assert.deepEqual(target.permissionMarkersRemoved, ['のみ']);
		assert.deepEqual(target.permissionMarkersAdded, []);
	});

	it('reports clear when only English values, comments and identifiers changed', () => {
		const { result } = runFixture('no-change');
		assert.equal(result.status, 'clear');
		assert.deepEqual(result.targets, []);
		assert.deepEqual(result.redactions, []);
	});
});

describe('shared extraction', () => {
	it('uses the same extractSegments function as the Issue #506 gate', () => {
		assert.equal(gateExtractSegments, sharedExtractSegments);
	});

	it('reads the declaration without a second surface definition', () => {
		assert.equal(declaration.version, 1);
		assert.equal(declaration.baseDeclaration, 'quality/copy-editorial-surfaces.json');
		assert.ok(declaration.articleMarkdownGlobs.includes('src/portfolio/seed.ts'));
		assert.ok(Array.isArray(baseSurfaces.publicCopyGlobs));
		assert.ok(DECLARATION_PATH.endsWith('japanese-copy-review-surfaces.json'));
	});

	it('classifies article, About, UI and out-of-scope files explicitly', () => {
		assert.equal(
			classifyReviewFile('src/portfolio/seed.ts', declaration, baseSurfaces).scope,
			'article',
		);
		assert.equal(
			classifyReviewFile('content/articles/hello.md', declaration, baseSurfaces).scope,
			'article',
		);
		assert.equal(
			classifyReviewFile('src/about/index.tsx', declaration, baseSurfaces).scope,
			'about',
		);
		assert.equal(classifyReviewFile('src/home/hero.tsx', declaration, baseSurfaces).scope, 'ui');
		assert.equal(
			classifyReviewFile('src/routes/admin.foo.tsx', declaration, baseSurfaces).scope,
			null,
		);
		assert.equal(classifyReviewFile('docs/development.md', declaration, baseSurfaces).scope, null);
		assert.equal(classifyReviewFile('src/about/x.test.ts', declaration, baseSurfaces).scope, null);
		assert.equal(
			classifyReviewFile('src/portfolio/seed.spec.ts', declaration, baseSurfaces).scope,
			null,
		);
	});
});

describe('markdown extraction', () => {
	it('masks fenced code, indented code and multi-line HTML comments', () => {
		const text = [
			'はじめに',
			'```ts',
			'const message = 1;',
			'```',
			'<!--',
			'内部メモ',
			'-->',
			'本文です',
			'    コード',
		].join('\n');
		assert.deepEqual(markdownProseMask(text), [
			true,
			false,
			false,
			false,
			false,
			false,
			false,
			true,
			false,
		]);
	});

	it('returns null when the full file is unavailable', () => {
		assert.equal(markdownProseMask(null), null);
		assert.equal(markdownProseMask(undefined), null);
	});

	it('closes a fence only on a terminator of the same character and length', () => {
		// A four-backtick block is not closed by three backticks, and a
		// longer run with trailing text is code, not a terminator. The
		// Japanese code after it must not read as article prose.
		const text = ['````md', '```', '`````not-a-close', 'これはコードです', '````', '本文です'].join(
			'\n',
		);
		assert.deepEqual(markdownProseMask(text), [false, false, false, false, false, true]);
		assert.deepEqual(markdownSegments('これはコードです', { inCode: true }), []);
		assert.deepEqual(markdownSegments('本文です', { inCode: false }), ['本文です']);
	});

	it('keeps a tilde fence open for a backtick run and closes it with tildes', () => {
		const text = ['~~~', '```', 'コード', '~~~', '本文'].join('\n');
		assert.deepEqual(markdownProseMask(text), [false, false, false, false, true]);
	});

	it('strips heading, list, quote, emphasis and link syntax from prose', () => {
		assert.deepEqual(markdownSegments('# 見出し'), ['見出し']);
		assert.deepEqual(markdownSegments('- 箇条書き'), ['箇条書き']);
		assert.deepEqual(markdownSegments('> 引用です'), ['引用です']);
		assert.deepEqual(markdownSegments('これは *強調* です'), ['これは 強調 です']);
		assert.deepEqual(markdownSegments('詳細は[こちら](https://example.com/秘密)を参照'), [
			'詳細はこちらを参照',
		]);
		assert.deepEqual(markdownSegments('![代替テキスト](image.png)'), ['代替テキスト']);
		assert.deepEqual(markdownSegments('<strong>強調</strong>'), ['強調']);
	});

	it('never emits code, fence markers or an in-code line', () => {
		assert.deepEqual(markdownSegments('`コード` を含む'), ['を含む']);
		assert.deepEqual(markdownSegments('`コード`'), []);
		assert.deepEqual(markdownSegments('```'), []);
		assert.deepEqual(markdownSegments('日本語', { inCode: true }), []);
		assert.deepEqual(markdownSegments('// コメント'), []);
	});

	it('cleans inline Markdown from an already extracted segment', () => {
		assert.equal(cleanInlineMarkdown('**重要** な `点`'), '重要 な 点');
	});
});

describe('TS/TSX extraction', () => {
	it('keeps visitor text and drops comments and identifier-only declarations', () => {
		assert.deepEqual(visibleSegments("const title = 'はじめに';"), ['はじめに']);
		assert.deepEqual(visibleSegments('// 日本語のコメント'), []);
		assert.deepEqual(visibleSegments('/* 日本語のコメント */'), []);
		assert.deepEqual(visibleSegments('const 見出し = 1;'), []);
		assert.deepEqual(visibleSegments('<p>本文です</p>'), ['本文です']);
	});

	it('collects the JSX text a declaration or return line carries', () => {
		assert.deepEqual(visibleSegments('return <p>古い本文</p>'), ['古い本文']);
		assert.deepEqual(visibleSegments('const node = <span>日本語</span>'), ['日本語']);
		assert.deepEqual(visibleSegments('return <button onClick={() => go()}>押す</button>'), [
			'押す',
		]);
		assert.deepEqual(visibleSegments('return <p>古い本文{value}です</p>'), ['古い本文', 'です']);
	});

	it('reports a rewritten JSX declaration line as a modified target', () => {
		const diff = [
			'diff --git a/src/home/hero.tsx b/src/home/hero.tsx',
			'--- a/src/home/hero.tsx',
			'+++ b/src/home/hero.tsx',
			'@@ -12 +12 @@',
			'-return <p>古い本文</p>',
			'+return <p>新しい本文</p>',
		].join('\n');
		const result = buildReviewTargets(`${diff}\n`, declaration, baseSurfaces);
		assert.equal(result.status, 'review');
		assert.equal(result.targets.length, 1);
		const [target] = result.targets;
		assert.equal(target.kind, 'modified');
		assert.equal(target.before, '古い本文');
		assert.equal(target.after, '新しい本文');
	});

	it('keeps a template interpolation out of the reviewer text', () => {
		assert.deepEqual(visibleSegments('const lead = `ようこそ ${name} さん`;'), [
			'ようこそ {…} さん',
		]);
	});
});

describe('meaning markers', () => {
	it('detects number, negation and permission drift', () => {
		const number = analyzeUnit({
			path: 'x.ts',
			kind: 'modified',
			before: '所要時間は1.5秒です',
			after: '所要時間は1.50秒です',
			line: 1,
		});
		assert.deepEqual(number.numbersRemoved, ['1.5']);
		assert.deepEqual(number.numbersAdded, ['1.50']);
		assert.ok(number.risk.includes('number-drift'));

		const negation = analyzeUnit({
			path: 'x.ts',
			kind: 'modified',
			before: '削除できません',
			after: '削除できます',
			line: 1,
		});
		assert.ok(negation.risk.includes('negation-drift'));

		const permission = analyzeUnit({
			path: 'x.ts',
			kind: 'modified',
			before: '管理者のみが編集できます',
			after: '管理者が編集できます',
			line: 1,
		});
		assert.ok(permission.risk.includes('permission-drift'));
		assert.deepEqual(permission.permissionMarkersRemoved, ['のみ']);
	});

	it('marks a one-sided claim as claim-added / claim-removed', () => {
		const added = analyzeUnit({
			path: 'x.ts',
			kind: 'added',
			before: null,
			after: '3分で完了します',
			line: 1,
		});
		assert.ok(added.risk.includes('claim-added'));
		assert.equal(added.meaningRisk, false);

		const removed = analyzeUnit({
			path: 'x.ts',
			kind: 'removed',
			before: '管理者のみが編集できます',
			after: null,
			line: 1,
		});
		assert.ok(removed.risk.includes('claim-removed'));
	});

	it('reports marker sets and numeric tokens without inventing a claim', () => {
		assert.deepEqual(claimMarkers('特にありません'), {
			numbers: [],
			negation: true,
			permission: false,
			negationMarkers: ['ません'],
			permissionMarkers: [],
		});
		assert.deepEqual(numericTokens('2026年、1,200件、3.14'), ['1,200', '2026', '3.14']);
	});
});

describe('secret-shaped values are withheld', () => {
	const token = `ghp_${'A'.repeat(36)}`;

	it('records a detector id without the text', () => {
		const fixture = syntheticSecretFixture();
		const result = buildReviewTargets(`${fixture.diff.join('\n')}\n`, declaration, baseSurfaces);
		assert.equal(result.status, 'attention');
		assert.equal(result.targets.length, 0);
		assert.equal(result.redactions.length, 1);
		assert.equal(result.redactions[0].detector, 'github-token');
		assert.equal(result.redactions[0].scope, 'ui');
		assert.equal(result.redactions[0].side, 'after');
	});

	it('never renders the value in text, JSON or HTML', () => {
		const fixture = syntheticSecretFixture();
		const result = buildReviewTargets(`${fixture.diff.join('\n')}\n`, declaration, baseSurfaces);
		for (const rendered of [renderText(result), renderJson(result), renderHtml(result)]) {
			assert.ok(!rendered.includes(token), 'the token must not enter a report');
			assert.ok(!rendered.includes('A'.repeat(36)), 'no fragment of the token either');
		}
		assert.match(renderText(result), /github-token/);
		assert.ok(renderJson(result).includes('"secret-shaped-text"'));
	});

	it('detects generic credential shapes without echo', () => {
		assert.equal(secretShape('秘密の値は-------------- です'), null);
		assert.equal(secretShape(`api_key = '${'a1B'.repeat(12)}'`), 'credential-shaped-value');
	});
});

describe('renderers', () => {
	const { result } = runFixture('modified-ui');

	it('renders the text report with the boundary statement', () => {
		const text = renderText(result);
		assert.match(text, /Issue #425/);
		assert.match(text, /status: ATTENTION/);
		assert.match(text, /before: 無料で始められます/);
		assert.match(text, /after: {2}無料で始められます。3分で完了します/);
		assert.match(text, /This report approves nothing/);
		assert.match(text, /copy:i18n:check/);
	});

	it('renders machine-readable JSON', () => {
		const report = JSON.parse(renderJson(result));
		assert.equal(report.schemaVersion, 1);
		assert.equal(report.status, 'attention');
		assert.equal(report.targets.length, 1);
		assert.ok(report.findings.some((finding) => finding.code === 'meaning-risk'));
	});

	it('renders self-contained HTML and escapes changed text', () => {
		const diff = [
			'diff --git a/src/home/x.tsx b/src/home/x.tsx',
			'--- a/src/home/x.tsx',
			'+++ b/src/home/x.tsx',
			'@@ -1 +1 @@',
			"-const x = '安全';",
			"+const x = '<script>危険</script>';",
		].join('\n');
		const xss = buildReviewTargets(`${diff}\n`, declaration, baseSurfaces);
		const html = renderHtml(xss);
		assert.match(html, /^<!doctype html>/);
		assert.ok(!html.includes('<script>'));
		assert.ok(html.includes('&lt;script&gt;'));
	});

	it('renders a labelled worked example and the fixture matrix', () => {
		const demo = {
			name: 'modified-ui',
			status: 'attention',
			targets: result.targets,
			redactions: [],
		};
		const html = renderHtml(result, {
			demo,
			fixtures: [{ name: 'modified-ui', status: 'attention', note: 'number-drift' }],
			sourceSha: 'abc123',
		});
		assert.match(html, /Worked example/);
		assert.match(html, /modified-ui/);
		assert.match(html, /abc123/);
	});

	it('summarizes by scope, kind and risk', () => {
		const summary = summarize(result.targets, [], [], []);
		assert.equal(summary.targets, 1);
		assert.equal(summary.byScope.ui, 1);
		assert.equal(summary.byKind.modified, 1);
		assert.equal(summary.byRisk['number-drift'], 1);
	});
});

describe('CLI contract', () => {
	it('is informational: only --strict escalates attention', () => {
		assert.equal(exitCodeFor({ status: 'clear' }, true), 0);
		assert.equal(exitCodeFor({ status: 'review' }, true), 0);
		assert.equal(exitCodeFor({ status: 'attention' }, false), 0);
		assert.equal(exitCodeFor({ status: 'attention' }, true), 1);
	});

	it('refuses to run without a base ref', () => {
		const run = runCli([]);
		assert.equal(run.status, 2);
		assert.match(run.stderr, /no base ref/);
	});

	it('rejects an unknown option and an unknown format', () => {
		assert.equal(runCli(['--nope']).status, 2);
		assert.equal(runCli(['--base=HEAD', '--format=xml']).status, 2);
	});

	it('produces a clear report for an empty change set', () => {
		const run = runCli(['--base=HEAD']);
		assert.equal(run.status, 0);
		assert.match(run.stdout, /status: CLEAR/);
		assert.match(run.stdout, /NO REVIEW TARGETS/);
	});

	it('writes JSON to --out', () => {
		const directory = mkdtempSync(join(tmpdir(), 'copy-review-'));
		try {
			const out = join(directory, 'report.json');
			const run = runCli(['--base=HEAD', '--format=json', `--out=${out}`]);
			assert.equal(run.status, 0, run.stderr);
			const report = JSON.parse(readFileSync(out, 'utf8'));
			assert.equal(report.status, 'clear');
			assert.equal(report.diffBase.mode, 'merge-base');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
