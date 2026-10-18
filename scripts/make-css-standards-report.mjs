#!/usr/bin/env node
/**
 * Verification report generator for Issue #413.
 *
 * The CSS gate (`scripts/check-css-syntax.mjs`) is machine-readable, but a
 * gate that is only readable by running it is hard to review. This script
 * renders the same result as a static HTML "CI report" and screenshots it
 * with the Playwright chromium already installed for the E2E suite into
 * `docs/verification/standards/css-validated.webp` — the path Issue #413
 * requires in the PR body, with the `.webp` extension substituted for the
 * Issue's literal `.png` (PNG bloats the repository; the exact encoded size
 * is reported per commit in the PR body rather than hard-coded here, so this
 * comment cannot drift on regeneration).
 *
 * The report is not a screenshot of a green run: it also executes two
 * synthetic fixtures through the same checker so a reader can see the
 * failing path, not only the passing one.
 *
 *   fixture A — an intentional syntax error + an unknown property + an
 *               enumerated keyword outside its grammar → FAIL (exit 1)
 *   fixture B — the same sheet written correctly (vendor prefix with a
 *               spec-defined counterpart, a custom property, a
 *               `@font-face` descriptor, an @layer statement) → pass
 *
 * That pair is the Issue's acceptance condition in both directions: an
 * intentional mistake must fail, and the notation the specification allows
 * (and the allowlist waives) must not false-fail.
 *
 * Screenshot output: Playwright can only encode PNG/JPEG, so the capture is
 * taken into a Buffer and re-encoded with the existing `sharp`
 * devDependency as `resize({ width: WEBP_WIDTH, withoutEnlargement: true })`
 * followed by `webp({ quality: WEBP_QUALITY })` — both constants are
 * declared below and printed in the report footer, so this comment cannot
 * drift from the encoder settings. No intermediate PNG is written to disk,
 * and the target extension is asserted to be `.webp` so a PNG can never
 * drift back into `docs/`. `sharp` stays a devDependency and is never
 * imported by the Worker / SSR.
 *
 *   node scripts/make-css-standards-report.mjs
 *   pnpm run verify:css-screenshot   # same thing
 *
 * Intermediate artefacts stay in `.tmp/` (gitignored); only the WebP is
 * committed. Chromium must be present — `pnpm run e2e:install`. The
 * generator reads no secret and touches no network, no D1 and no R2.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCheck } from './check-css-syntax.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const HTML_REPORT = join(TMP, 'css-standards-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/standards/css-validated.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 62;

const REPRODUCTION = [
	'pnpm run prepare                                   # panda codegen (the gate reads the generated sheet)',
	'pnpm run css:check                                 # the gate itself (exit 0)',
	'node --test scripts/check-css-syntax.test.mjs      # the fixture suite behind this report',
	'pnpm run verify:css-screenshot                     # regenerate this report + WebP',
	'node scripts/check-css-syntax.mjs --json           # machine-readable result',
	'node scripts/check-css-syntax.mjs --artifact dist/client/assets/*.css  # validate a built stylesheet',
];

/* ------------------------------------------------------------------ *
 * fixture scenarios — the failing path and the accepted notation
 * ------------------------------------------------------------------ */

/**
 * Lay out a synthetic repository around the shipped manifest, with the
 * Panda surface replaced by one `files` surface over a two-line sheet, so a
 * fixture exercises the same walk → parse → validate path the real CSS
 * does. Each fixture declares only the allowlist its own CSS needs.
 */
function runFixture({ id, title, css, allowlist = {}, minDeclarations = 0 }) {
	const root = mkdtempSync(join(tmpdir(), `css-standards-${id}-`));
	try {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'quality/css-standards.json'), 'utf8'));
		manifest.surfaces = [
			{
				id: 'fixture',
				kind: 'files',
				root: 'src/surface',
				extensions: ['.css'],
				role: 'fixture stylesheet',
				min_declarations: minDeclarations,
			},
		];
		manifest.coverage = { root: 'src', extensions: ['.css'] };
		manifest.policy.min_declarations = minDeclarations;
		manifest.allowlist = {
			vendor_prefixes: [],
			properties: [],
			functions: [],
			at_rules: [],
			...allowlist,
		};
		mkdirSync(join(root, 'quality'), { recursive: true });
		mkdirSync(join(root, 'src/surface'), { recursive: true });
		writeFileSync(
			join(root, 'quality/css-standards.json'),
			`${JSON.stringify(manifest, null, '\t')}\n`,
		);
		writeFileSync(join(root, 'src/surface/fixture.css'), css);
		const result = runCheck({ root, manifestPath: 'quality/css-standards.json' });
		return {
			id,
			title,
			css,
			exitCode: result.ok ? 0 : 1,
			messages: result.errors.map((entry) => `${entry.rule}: ${entry.message}`),
			warnings: result.warnings.map((entry) => `${entry.rule}: ${entry.message}`),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const PREFIX_RULE = {
	id: 'standard-vendor-prefix',
	prefixes: ['-webkit-', '-moz-', '-ms-', '-o-'],
	surfaces: ['fixture'],
	require_known_unprefixed: true,
	reason:
		'fixture: the same counterparty rule the shipped manifest uses — a vendor prefix is accepted only when the unprefixed property is in the vocabulary',
	basis: 'https://www.w3.org/TR/css-variables-1/#vendor-prefixes',
};

const BROKEN_CSS = [
	'@layer base {',
	'  .card {',
	'    colr: var(--colors-text-default);',
	'    position: fixedd;',
	'    transform: transl8te(4px);',
	'    width: 40rem',
	'    background-color: #ffffff;',
	'  }',
	'}',
	'',
].join('\n');

const FIXED_CSS = [
	'@layer reset, base, tokens, recipes, utilities;',
	'',
	'@layer base {',
	'  :root {',
	'    --card-bg: #ffffff;',
	'  }',
	'',
	'  .card {',
	'    color: var(--colors-text-default);',
	'    position: fixed;',
	'    transform: translateY(4px);',
	'    width: 40rem;',
	'    -webkit-text-size-adjust: 100%;',
	'    background-color: var(--card-bg);',
	'  }',
	'}',
	'',
	'@font-face {',
	'  font-family: "Fixture Fallback";',
	'  src: local("Fixture W3");',
	'  font-weight: 400;',
	'  size-adjust: 94%;',
	'}',
	'',
].join('\n');

const FIXTURES = [
	runFixture({
		id: 'A',
		title: 'A — 意図的な構文誤りと未定義の名前（fail になる）',
		css: BROKEN_CSS,
	}),
	runFixture({
		id: 'B',
		title: 'B — 同じ意図を仕様どおりに書いた場合（誤failしない）',
		css: FIXED_CSS,
		allowlist: { vendor_prefixes: [PREFIX_RULE] },
	}),
];

/* ------------------------------------------------------------------ *
 * HTML rendering
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const code = (value) => `<code>${escapeHtml(value)}</code>`;

function render(result) {
	const { stats, vocabulary, manifest, surfaceRows, allowRows } = result;

	const surfaceCards = surfaceRows
		.map(
			(row) => `<tr>
    <td class="status ${row.errors === 0 ? 'ok' : 'fail'}">${row.errors === 0 ? 'OK' : 'FAIL'}</td>
    <td>${escapeHtml(row.id)}<div class="sub">${escapeHtml(row.role)}</div></td>
    <td class="num">${row.files}</td>
    <td class="num">${row.declarations}</td>
    <td class="num">${(row.bytes / 1024).toFixed(1)} KiB</td>
  </tr>`,
		)
		.join('\n');

	const allowCards = allowRows
		.map(
			(row) => `<tr>
    <td class="status ${row.uses.length === 0 ? 'fail' : 'ok'}">${row.uses.length === 0 ? 'DEAD' : 'OK'}</td>
    <td>${escapeHtml(row.id)}<div class="sub">${escapeHtml(row.kind ?? row.category)}</div></td>
    <td>${escapeHtml(row.reason ?? row.basis)}</td>
    <td class="num">${row.uses.length}</td>
    <td class="uses">${escapeHtml(
			row.uses
				.slice(0, 5)
				.map((use) => `${use.property ?? use.name}${use.base ? ` → ${use.base}` : ''}`)
				.join('\n'),
		)}</td>
  </tr>`,
		)
		.join('\n');

	const fixtureCards = FIXTURES.map(
		(fixture) => `<div class="fixture ${fixture.exitCode === 0 ? 'ok' : 'fail'}">
  <div class="fixture-head">
    <span class="pill ${fixture.exitCode === 0 ? 'ok' : 'fail'}">exit ${fixture.exitCode}</span>
    <b>${escapeHtml(fixture.title)}</b>
  </div>
  <pre>${escapeHtml(fixture.css)}</pre>
  <div class="fixture-out">
    ${
			fixture.messages.length > 0
				? fixture.messages
						.map((message) => `<div class="fail">${escapeHtml(message)}</div>`)
						.join('')
				: '<div class="none">(no errors)</div>'
		}
    ${fixture.warnings.map((message) => `<div class="warn">${escapeHtml(message)}</div>`).join('')}
  </div>
</div>`,
	).join('\n');

	const moduleRows = Object.entries(manifest.vocabulary.properties)
		.map(
			([moduleUrl, names]) =>
				`<tr><td class="module">${escapeHtml(moduleUrl)}</td><td class="num">${names.length}</td></tr>`,
		)
		.join('\n');

	const enumRows = Object.entries(manifest.vocabulary.enum_values)
		.map(
			([property, keywords]) =>
				`<tr><td>${code(property)}</td><td>${escapeHtml(
					keywords.map((keyword) => (keyword === '*' ? '<list>' : keyword)).join(' | '),
				)}</td></tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>CSS 構文・語彙ゲート (Issue #413)</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #77776a; font-size: 12.5px; }
  .lead { color: #3d3d33; font-size: 13px; margin: 0 0 20px; max-width: 1200px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .warnc { color: #8a5a12; }
  .failc { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  pre { background: #f3f1e8; border: 1px solid #dedcd2; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 68px; white-space: nowrap; }
  tr.ok .status { color: #1c6b3a; }
  tr.fail .status { color: #a12020; }
  .num { text-align: right; width: 78px; white-space: nowrap; }
  .uses { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre-line; }
  .module { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .fixture { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; margin-bottom: 12px; }
  .fixture.fail { border-left: 4px solid #a12020; }
  .fixture.ok { border-left: 4px solid #1c6b3a; }
  .fixture-head { display: flex; align-items: center; gap: 10px; }
  .pill { font-weight: 700; font-size: 12px; padding: 1px 8px; border: 1px solid currentColor; }
  .pill.ok { color: #1c6b3a; }
  .pill.fail { color: #a12020; }
  .fixture-out .fail { color: #a12020; }
  .fixture-out .warn { color: #8a5a12; }
  .fixture-out .none { color: #77776a; }
  .cols { display: flex; gap: 18px; align-items: flex-start; }
  .cols > div { flex: 1; min-width: 0; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>CSS 構文・語彙ゲート — Panda 生成 CSS と手書き CSS の静的検証 (Issue #413)</h1>
  <p class="lead">
    W3C CSS validator と等価な問いを、<b>ネットワークに到達せずに</b>オフラインで答える gate。
    CSS Syntax tokenizer + parser が「parsable か」を、レビュー済み vocabulary が「その名前が存在するか」を、
    列挙 keyword の閉集合が「その値がそのプロパティの文法か」を判定する。
    vendor prefix は <b>prefix 無し側が仕様定義済みであるときだけ</b>、
    engine 固有プロパティは <b>名前・理由・basis URL・surface スコープを持つ allowlist エントリ</b>だけを受け付ける。
    何も抑止していない allowlist エントリは fail する（陳腐化した免除は穴であり、誤検知の免除ではない）。
  </p>

  <div class="cards">
    <div class="card"><div class="k">stylesheets</div><div class="v">${stats.files}</div></div>
    <div class="card"><div class="k">declarations</div><div class="v">${stats.declarations}</div></div>
    <div class="card"><div class="k">rules</div><div class="v">${stats.rules}</div></div>
    <div class="card"><div class="k">at-rules</div><div class="v">${stats.atRules}</div></div>
    <div class="card"><div class="k">custom properties</div><div class="v">${stats.customProperties}</div></div>
    <div class="card"><div class="k">errors</div><div class="v ${result.errors.length === 0 ? 'ok' : 'failc'}">${result.errors.length}</div></div>
    <div class="card"><div class="k">warnings</div><div class="v warnc">${result.warnings.length}</div></div>
  </div>

  <h2>検証面</h2>
  <table>
    <thead><tr><th style="width:68px">gate</th><th>surface</th><th style="width:78px">files</th><th style="width:78px">decls</th><th style="width:78px">size</th></tr></thead>
    <tbody>
${surfaceCards}
    </tbody>
  </table>

  <h2>allowlist（vendor prefix と仕様上許される拡張）</h2>
  <table>
    <thead><tr><th style="width:68px">gate</th><th style="width:230px">entry</th><th>reason</th><th style="width:78px">uses</th><th style="width:260px">waived names</th></tr></thead>
    <tbody>
${allowCards}
    </tbody>
  </table>

  <h2>fixture — 意図的な誤りが fail になる場合と、許容された記法が通る場合</h2>
  <p class="sub">
    下の 2 例は同じ checker（<code>runCheck</code>）を合成 repository に通して得た実結果。
    fixture A は Issue の受け入れ条件「意図的な構文誤りで CI が失敗する」側、
    fixture B は「許容された記法は誤failしない」側。
  </p>
${fixtureCards}

  <div class="cols">
    <div>
      <h2>vocabulary — spec module → properties（${vocabulary.modules} modules / ${vocabulary.properties} properties）</h2>
      <table>
        <thead><tr><th>spec module</th><th style="width:78px">props</th></tr></thead>
        <tbody>
${moduleRows}
        </tbody>
      </table>
    </div>
    <div>
      <h2>列挙 keyword の閉集合（${vocabulary.enumValues} 個）</h2>
      <table>
        <thead><tr><th style="width:190px">property</th><th>values</th></tr></thead>
        <tbody>
${enumRows}
        </tbody>
      </table>
      <p class="sub">
        CSS-wide keyword と <code>var()</code> は静的解決できないので対象外（validator と同じ扱い）。
        <code>&lt;list&gt;</code> は複数 keyword を許す（例: <code>light dark</code>）。
      </p>
    </div>
  </div>

  <h2>再現コマンド</h2>
  <pre>${REPRODUCTION.map((line) => escapeHtml(line)).join('\n')}</pre>
  <p class="sub">
    期待結果: 上記コマンドはすべて exit 0。fixture A を実行した場合のみ
    <code>css:check</code> は exit 1 になる。
  </p>

  <footer>my-web-2026 · Issue #413 · report generated locally by scripts/make-css-standards-report.mjs
  (offline, no secret, no production D1/R2) · committed as docs/verification/standards/css-validated.webp
  (width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</footer>
</body>
</html>
`;
}

async function shoot(htmlPath, target) {
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	const { chromium } = await import('@playwright/test');
	const { default: sharp } = await import('sharp');
	mkdirSync(dirname(target), { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1320, height: 1400 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so capture into a Buffer (never a file)
		// and re-encode with sharp. The PNG bytes stay in memory only.
		const capture = await page.screenshot({ fullPage: true });
		const info = await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
		return info;
	} catch (error) {
		throw new Error(
			`chromium capture failed (${error.message}). Install it once with \`pnpm run e2e:install\`; the gate itself does not need a browser.`,
		);
	} finally {
		await browser.close();
	}
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const result = runCheck();
if (result.errors.length > 0) {
	process.stderr.write(
		`refusing to render a verification report for a failing gate (${result.errors.length} error(s)):\n${result.errors
			.map((entry) => `  - ${entry.rule}: ${entry.message}`)
			.join('\n')}\n`,
	);
	process.exit(1);
}

const byId = Object.fromEntries(FIXTURES.map((fixture) => [fixture.id, fixture]));
if (byId.A?.exitCode !== 1 || byId.B?.exitCode !== 0) {
	process.stderr.write(
		`fixture expectations changed: fixture A must fail and fixture B must pass, got ${FIXTURES.map(
			(fixture) => `${fixture.id}=${fixture.exitCode}`,
		).join(', ')}\n`,
	);
	process.exit(1);
}

mkdirSync(TMP, { recursive: true });
writeFileSync(HTML_REPORT, render(result));
process.stdout.write(`wrote ${HTML_REPORT}\n`);
process.stdout.write(
	`gate: ${result.stats.declarations} declarations / ${result.vocabulary.properties} properties / ${result.allowRows.length} allowlist entries / ${result.errors.length} errors\n`,
);
for (const fixture of FIXTURES) {
	process.stdout.write(`fixture ${fixture.id}: exit ${fixture.exitCode} (${fixture.title})\n`);
}
const info = await shoot(HTML_REPORT, WEBP_TARGET);
process.stdout.write(
	`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
);
