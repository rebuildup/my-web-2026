import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	buildReportHtml,
	decodeEntities,
	escapeHtml,
	evaluateContract,
	markupIsInert,
	stripMarkdownMarkers,
	visibleTextOf,
} from './_markdown-format-report.mjs';

/**
 * Tests for the pure half of the Markdown format report (Issue #435).
 *
 * The report generator consumes hostile fixture text by design, so the
 * security-relevant behaviour lives here: escaping, the inert-markup
 * guard, and the fact that a rendered regression is REPORTED rather than
 * executed by whoever opens the artefact.
 *
 * Wired into `pnpm run test` (see `check-test-wiring.mjs`).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(REPO_ROOT, 'src/portfolio/fixtures/markdown');

const SAFE_SOURCE = '# 見出し\n\n本文 `a < b`。\n';
const SAFE_HTML =
	'<div><h3 class="c"><span>見出し</span></h3><p class="p"><span>本文 </span><code>a &lt; b</code><span>。</span></p></div>';
const HOSTILE_HTML =
	'<div><p><span>&lt;script&gt;alert(1)&lt;/script&gt;</span></p><a href="#" target="_blank" rel="noopener noreferrer">link</a></div>';

test('escapeHtml neutralises the five markup-active characters', () => {
	assert.equal(
		escapeHtml('<a href="x" onclick=\'y\'>&</a>'),
		'&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
	);
	assert.equal(escapeHtml(undefined), '');
});

test('decodeEntities reverses React text escaping', () => {
	assert.equal(decodeEntities('&lt;script&gt; &amp; &#x27;'), "<script> & '");
});

test('visibleTextOf folds block tags into line breaks and keeps inline text', () => {
	assert.equal(visibleTextOf('<p><strong>a</strong>b</p><p>c</p>'), 'ab c');
});

test('stripMarkdownMarkers removes markers and nothing else', () => {
	assert.equal(stripMarkdownMarkers('**強調**と`コード`'), '強調とコード');
	assert.equal(stripMarkdownMarkers('- [Decision 3](/portfolio)'), 'Decision 3');
	assert.equal(stripMarkdownMarkers('> 引用'), '引用');
	assert.equal(stripMarkdownMarkers('```ts'), '');
});

test('markupIsInert rejects executable markup and accepts escaped markup', () => {
	assert.equal(markupIsInert(HOSTILE_HTML), true);
	assert.equal(markupIsInert('<div><script>alert(1)</script></div>'), false);
	assert.equal(markupIsInert('<p><img src=x onerror="alert(1)"></p>'), false);
	assert.equal(markupIsInert('<div><p onclick="alert(1)">text</p></div>'), false);
});

test('markupIsInert rejects a dangerous href scheme, not only tags', () => {
	// The report injects rendered markup verbatim, so a live anchor is as
	// much a payload as a <script>. The rule is the same one the
	// `href-scheme` contract check applies.
	assert.equal(markupIsInert('<a href="javascript:alert(1)">x</a>'), false);
	assert.equal(markupIsInert("<a href='javascript:alert(1)'>x</a>"), false);
	assert.equal(markupIsInert('<a href="data:text/html,<script>alert(1)</script>">x</a>'), false);
	assert.equal(markupIsInert('<a href="vbscript:msgbox(1)">x</a>'), false);
});

test('markupIsInert rejects media and interactive elements', () => {
	assert.equal(markupIsInert('<p><img src=x alt=y></p>'), false);
	assert.equal(markupIsInert('<svg width="10"><circle /></svg>'), false);
	assert.equal(markupIsInert('<video src="movie.mp4" autoplay></video>'), false);
	assert.equal(markupIsInert('<audio src="a.mp3"></audio>'), false);
	assert.equal(markupIsInert('<form action="/x"><input name="y"></form>'), false);
});

test('markupIsInert still accepts the shapes the renderer actually emits', () => {
	assert.equal(
		markupIsInert('<p><a href="#" target="_blank" rel="noopener noreferrer">a</a></p>'),
		true,
	);
	assert.equal(markupIsInert('<p><a href="/portfolio" target="_self" rel="">b</a></p>'), true);
	assert.equal(
		markupIsInert(
			'<p><a href="https://example.com/x" target="_blank" rel="noopener noreferrer">c</a></p>',
		),
		true,
	);
});

test('evaluateContract passes a clean render and explains each verdict', () => {
	const checks = evaluateContract({ source: SAFE_SOURCE, html: SAFE_HTML });
	assert.deepEqual(
		checks.map((check) => check.status),
		['pass', 'pass', 'pass', 'pass', 'pass'],
	);
	assert.equal(checks.find((check) => check.id === 'no-dropped-line').detail, '2 行すべて保持');
});

test('evaluateContract fails the render that drops a line or injects markup', () => {
	const checks = evaluateContract({
		source: '# 見出し\n\n本文 `a < b`。\n',
		html: '<div><script>alert(1)</script><p>見出し</p></div>',
	});
	const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
	assert.equal(byId['inert-markup'].status, 'fail');
	assert.equal(byId['no-dropped-line'].status, 'fail');
	assert.equal(byId['inert-markup'].detail.includes('<script'), true);
});

test('evaluateContract flags a locale attribute and an invented character', () => {
	const checks = evaluateContract({
		source: '本文です。\n',
		html: '<div lang="ja"><p>本文“です”。</p></div>',
	});
	const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
	assert.equal(byId['locale-free'].status, 'fail');
	assert.equal(byId['no-typography-substitution'].status, 'fail');
	assert.equal(byId['no-typography-substitution'].detail, '導入: “ ”');
});

test('evaluateContract rejects a non-http href scheme', () => {
	const checks = evaluateContract({
		source: '[x](javascript:alert(1))\n',
		html: '<div><p><a href="javascript:alert(1)">x</a></p></div>',
	});
	const href = checks.find((check) => check.id === 'href-scheme');
	assert.equal(href.status, 'fail');
	assert.equal(href.detail.includes('javascript:'), true);
	// The artefact half of the guard must agree with the verdict table:
	// the same markup that FAILs `href-scheme` is never injected verbatim.
	assert.equal(markupIsInert('<div><p><a href="javascript:alert(1)">x</a></p></div>'), false);
});

test('buildReportHtml escapes fixture text and keeps inert markup verbatim', () => {
	const report = buildReportHtml({
		heading: '見出し & <b>',
		lede: 'lede',
		css: '.report {}',
		fixtures: [
			{
				title: 'hostile',
				note: 'note',
				source: '<script>alert(1)</script>',
				html: HOSTILE_HTML,
				checks: evaluateContract({ source: 'x\n', html: HOSTILE_HTML }),
			},
		],
	});
	assert.equal(report.includes('<b>'), false);
	assert.equal(report.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
	assert.equal(report.includes('href="#" target="_blank"'), true);
	assert.equal(report.startsWith('<!doctype html>'), true);
	// The page's own prose is Japanese; declaring `lang="en"` on the
	// artefact that demonstrates the locale-free contract would be its
	// own small lie.
	assert.equal(report.includes('<html lang="ja">'), true);
});

test('buildReportHtml escapes a render that turned out not to be inert', () => {
	const report = buildReportHtml({
		heading: 'h',
		lede: 'l',
		fixtures: [
			{
				title: 'regression',
				note: 'n',
				source: 'x',
				html: '<div><img src=x onerror="alert(1)"></div>',
				checks: [],
			},
		],
	});
	assert.equal(report.includes('<img src=x onerror='), false);
	assert.equal(report.includes('Rendered markup was NOT inert'), true);
});

test('the committed fixtures are the ones this report describes', () => {
	const article = readFileSync(join(FIXTURE_DIR, 'technical-article.md'), 'utf8');
	const hostile = readFileSync(join(FIXTURE_DIR, 'hostile.md'), 'utf8');
	// The report is only evidence if it renders the same two files the
	// Vitest suite and the Storybook stories read.
	assert.equal(article.startsWith('# '), true);
	assert.equal(article.includes('未対応の構文は文字として残る'), true);
	assert.equal(hostile.includes('<script>alert(1)</script>'), true);
	assert.equal(hostile.includes('javascript:alert(1)'), true);
});
