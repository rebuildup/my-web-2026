import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	ARTEFACT,
	CJK_LOCALE_IDS,
	KINSHOKU,
	MODES,
	ROUTE,
	WIDTHS,
	assertLossless,
	auditFixtureSources,
	auditTypographySources,
	judgeLines,
	rulesForLocale,
} from './cjk-line-break-measure.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * These tests are the CI-side half of Issue #431. The browser half
 * (`scripts/cjk-line-break-measure.mjs`, which needs Playwright and a
 * Storybook build) measures real line boxes; what runs here is
 * everything that must hold *before* a browser is worth launching —
 * and the guard that the measurement still refers to the typography
 * contract it was written against.
 */

/* ------------------------------------------------------------------ *
 * The character tables
 * ------------------------------------------------------------------ */

test('kinsoku tables are non-empty and free of duplicates', () => {
	for (const [name, table] of Object.entries(KINSHOKU)) {
		const chars = [...table];
		assert.ok(chars.length > 0, `${name} must not be empty`);
		assert.equal(new Set(chars).size, chars.length, `${name} contains duplicates`);
	}
});

test('line-head and line-tail tables are disjoint', () => {
	const head = new Set(KINSHOKU.headForbidden);
	const tail = new Set(KINSHOKU.tailForbidden);
	for (const char of tail) {
		assert.ok(!head.has(char), `${char} is both a line-head and a line-tail prohibition`);
	}
});

test('starter-sensitive characters are not also line-head prohibitions', () => {
	const head = new Set(KINSHOKU.headForbidden);
	for (const char of KINSHOKU.starterSensitive) {
		assert.ok(!head.has(char), `${char} is both a starter and a line-head prohibition`);
	}
});

test('no kinsoku table can fire on ordinary latin prose', () => {
	// A stray latin letter or digit in a table would turn every English
	// paragraph on the platform into a "violation", which is the
	// failure mode that makes a harness like this get switched off.
	// The ASCII `([{$` in the tail table are intentional: UAX #14
	// classes OP and PR may not end a line in any CJK prose either.
	const tables = [KINSHOKU.headForbidden, KINSHOKU.tailForbidden, KINSHOKU.starterSensitive];
	for (const table of tables) {
		for (const char of table) {
			assert.ok(!/[0-9A-Za-z]/.test(char), `${char} is a latin letter or digit`);
		}
	}
});

test('starter-sensitive characters stay inside the Japanese script ranges', () => {
	for (const char of KINSHOKU.starterSensitive) {
		assert.match(char, /[ぁ-ヿㇰ-ㇿｦ-ﾟ]/u, `${char} is not a Japanese-script character`);
	}
});

test('rulesForLocale maps each supported locale and rejects the rest', () => {
	assert.equal(rulesForLocale('ja').starter, KINSHOKU.starterSensitive);
	assert.equal(rulesForLocale('zh-Hans').starter, '');
	assert.equal(rulesForLocale('zh-Hant').starter, '');
	assert.equal(rulesForLocale('ko').starter, '');
	assert.equal(rulesForLocale('zh-Hant').head, rulesForLocale('zh-Hans').head);
	assert.throws(() => rulesForLocale('fr'), /unknown locale/);
});

/* ------------------------------------------------------------------ *
 * The rule engine
 * ------------------------------------------------------------------ */

test('judgeLines accepts a well-behaved Japanese break set', () => {
	const { violations, observations, locale } = judgeLines({
		text: 'これは検証用の文章です。改行は規則に従います。',
		lines: ['これは検証用の文章です。', '改行は規則に従います。'],
		lineBreak: 'auto',
	});
	assert.equal(locale, 'ja');
	assert.deepEqual(violations, []);
	assert.deepEqual(observations, []);
});

test('judgeLines catches a closing punctuation at a line head (R1)', () => {
	const clean = judgeLines({
		text: '改行位置の検証です。次の行。',
		lines: ['改行位置の検証です。', '次の行。'],
		lineBreak: 'auto',
	});
	assert.deepEqual(clean.violations, []);

	const broken = judgeLines({
		text: '検証用の文章、句読点、そして次。と続く行。',
		lines: ['検証用の文章、句読点、そして次', '。と続く行。'],
		lineBreak: 'auto',
	});
	assert.equal(broken.violations.length, 1);
	assert.equal(broken.violations[0].rule, 'R1-line-head');
	assert.equal(broken.violations[0].line, 1);
});

test('judgeLines catches a closing bracket at a line head (R1)', () => {
	const { violations } = judgeLines({
		text: '引用「これは検証用の文章です」の例。',
		lines: ['引用「これは検証用の文章です', '」の例。'],
		lineBreak: 'auto',
	});
	assert.equal(violations[0].rule, 'R1-line-head');
	assert.equal(violations[0].line, 1);
});

test('judgeLines catches an opening bracket at a line tail (R3)', () => {
	const { violations } = judgeLines({
		text: '検証用の文章「次の行で閉じます」。',
		lines: ['検証用の文章「', '次の行で閉じます」。'],
		lineBreak: 'auto',
	});
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'R3-line-tail');
	assert.equal(violations[0].line, 0);
});

test('judgeLines catches an ideographic space opening a line (R2)', () => {
	const { violations } = judgeLines({
		text: '検証用の文章\u3000次の行',
		lines: ['検証用の文章', '\u3000次の行'],
		lineBreak: 'auto',
	});
	assert.equal(violations[0].rule, 'R2-ideographic-space');
	assert.equal(violations[0].detail, 'opens with U+3000');
});

test('a collapsible break-space is not a violation', () => {
	// Korean wraps at every space, so most lines begin at one. CSS Text
	// removes the space at a break, so judging it would flag every
	// space-delimited locale on every width — the harness has to stay
	// quiet on this or it gets switched off.
	const { violations } = judgeLines({
		text: '한국어 문장은 띄어쓰기 단위로 줄이 바뀝니다.',
		lines: ['한국어 문장은 ', '띄어쓰기 단위로 줄이 ', '바뀝니다.'],
		lineBreak: 'auto',
	});
	assert.deepEqual(violations, []);
});

test('judgeLines catches an opening bracket at a line tail (R3)', () => {
	const { violations } = judgeLines({
		text: '検証用の文章「次の行で閉じます」。',
		lines: ['検証用の文章「', '次の行で閉じます」。'],
		lineBreak: 'auto',
	});
	assert.equal(violations.length, 1);
	assert.equal(violations[0].rule, 'R3-line-tail');
	assert.equal(violations[0].line, 0);
});

test('a conditional Japanese starter is observed under auto and forbidden under strict', () => {
	const input = {
		text: 'サンプル用のー表記確認',
		lines: ['サンプル用の', 'ー表記確認'],
	};
	const relaxed = judgeLines({ ...input, lineBreak: 'auto' });
	assert.deepEqual(relaxed.violations, []);
	assert.equal(relaxed.observations[0].rule, 'R4-starter');

	const strict = judgeLines({ ...input, lineBreak: 'strict' });
	assert.equal(strict.violations[0].rule, 'R4-starter');
});

test('the katakana middle dot may not close a line (R3) and iteration marks may not open one (R1)', () => {
	const middle = judgeLines({
		text: '区切り・表現の確認。',
		lines: ['区切り・', '表現の確認。'],
		lineBreak: 'auto',
	});
	assert.ok(middle.violations.some((v) => v.rule === 'R3-line-tail'));

	const iteration = judgeLines({
		text: '表記は今日々日の表現。',
		lines: ['表記は今日', '々日の表現。'],
		lineBreak: 'auto',
	});
	assert.ok(iteration.violations.some((v) => v.rule === 'R1-line-head'));
});

test('judgeLines flags an interior blank line', () => {
	const { violations } = judgeLines({
		text: 'あいうえお   ',
		lines: ['あいうえお', '   '],
		lineBreak: 'auto',
	});
	assert.equal(violations[0].rule, 'R3-blank-line');
});

test('Korean space-delimited wrapping produces no violations', () => {
	const { violations, locale } = judgeLines({
		text: '한국어 단락은 띄어쓰기 단위로 줄이 바뀝니다.',
		lines: ['한국어 단락은 띄어쓰기 단위로', '줄이 바뀝니다.'],
		lineBreak: 'auto',
	});
	assert.equal(locale, 'ko');
	assert.deepEqual(violations, []);
});

/* ------------------------------------------------------------------ *
 * Losslessness
 * ------------------------------------------------------------------ */

test('assertLossless proves the measurement kept every character', () => {
	const source = '件数は 1,024 件です。';
	assert.deepEqual(assertLossless(source, ['件数は 1,024 ', '件です。']), { ok: true });

	const dropped = assertLossless(source, ['件数は 1,02', '件です。']);
	assert.equal(dropped.ok, false);
	assert.match(dropped.detail, /diverges at index 8/);
	assert.match(dropped.detail, /"4 件です。"/);
});

test('assertLossless catches a dropped negation, not just a dropped digit', () => {
	const source = 'この設定は適用されません。';
	const withoutNegation = assertLossless(source, ['この設定は適用され', 'ます。']);
	assert.equal(withoutNegation.ok, false);
	assert.match(withoutNegation.detail, /diverges/);
});

/* ------------------------------------------------------------------ *
 * The contract the measurement is a measurement of
 * ------------------------------------------------------------------ */

test('auditTypographySources passes on the shipped base rules', () => {
	assert.deepEqual(auditTypographySources(), []);
});

test('auditTypographySources fails when a base rule is removed', () => {
	const styles = readFileSync(join(REPO_ROOT, 'src/styles.css'), 'utf8');
	const heading = readFileSync(
		join(REPO_ROOT, 'src/editorial/primitives/SectionHeading.tsx'),
		'utf8',
	);

	const stripped = styles.replace('word-break: auto-phrase;', '');
	const problems = auditTypographySources({ styles: stripped, heading });
	assert.equal(problems.length, 1);
	assert.match(problems[0], /Issue #300 phrase-based word-break/);

	const unbalanced = heading.replace("textWrap: 'balance'", "textWrap: 'wrap'");
	const titleProblems = auditTypographySources({ styles, heading: unbalanced });
	assert.equal(titleProblems.length, 1);
	assert.match(titleProblems[0], /SectionHeading titles/);
});

test('auditFixtureSources passes on the mounted fixture', () => {
	assert.deepEqual(auditFixtureSources(), []);
});

test('auditFixtureSources fails when the /design-system section stops rendering the showcase', () => {
	const page = readFileSync(
		join(REPO_ROOT, 'src/routes/design-system/DesignSystemPage.tsx'),
		'utf8',
	);
	assert.ok(page.includes('<CjkSection />'));
	assert.ok(!page.replace('<CjkSection />', '').includes('<CjkSection />'));
});

test('the modes, locales, viewports and route match what the Issue asks for', () => {
	assert.deepEqual(
		MODES.map((entry) => entry.mode),
		['default', 'locale', 'locale-typography'],
	);
	assert.deepEqual(CJK_LOCALE_IDS, ['ja', 'zh-Hans', 'zh-Hant', 'ko']);
	assert.deepEqual(WIDTHS, [320, 375, 768]);
	assert.equal(ROUTE, '/design-system');
});

test('the artefact path is the Issue path, with the WebP substitution', () => {
	assert.equal(ARTEFACT, 'docs/verification/i18n/cjk-line-break.webp');
});
