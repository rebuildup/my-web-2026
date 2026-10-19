#!/usr/bin/env node
/**
 * Cloudflare configuration drift — verification report + artefact
 * generator (Issue #480).
 *
 * What is on the page
 * -------------------
 * Every row is produced by RUNNING the gate, through the same
 * `runDriftAudit` the CLI uses, over five recorded single-item mutation
 * recipes in `quality/fixtures/cloudflare-config-drift/` plus the live
 * working tree. Nothing is transcribed by hand, so a number on the page
 * cannot drift away from the decision the gate actually makes — and the
 * page states the case each fixture proves, including the one that makes
 * the acceptance criterion visible: **one** removed binding, red gate.
 *
 * What is NOT on the page
 * -----------------------
 * No credential, no binding value, no account secret. The same leak guard
 * the CLI applies (`assertStatusOnly` with the repository's own
 * credential-shape detector) runs over every rendered case; a token that
 * would not be status-only fails this command instead of reaching the
 * artefact. A text var value that differs from the record appears as
 * `<redacted len=N>` — the redaction rule is part of what the artefact
 * has to demonstrate.
 *
 * The live verdict is included, but a red live verdict does NOT block the
 * artefact: the red rows are the demonstration. The fixture rows, in
 * contrast, must match the expectation each fixture declares, or this
 * command fails — the page is never allowed to show a case the unit test
 * does not believe.
 *
 * Usage:
 *   node scripts/make-cloudflare-config-drift-report.mjs [--out=<path>]
 *
 * Exit codes: 0 = page + WebP written, 1 = a fixture contradicted its own
 * expectation, or the render was not status-only.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DRIFT_DIMENSIONS, DRIFT_VERDICT, assertStatusOnly } from './_cloudflare-drift.mjs';
import { looksLikeCredentialValue } from './_secret-scan.mjs';
import { FIXTURE_DIR, renderAudit, runDriftAudit } from './check-cloudflare-config-drift.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(ROOT, '.tmp', 'cloudflare-config-drift-report.html');
/**
 * Issue #480 names `docs/verification/security/cloudflare-config-drift.png`.
 * The repository ships verification artefacts as WebP, so the same stem is
 * used with the `.webp` extension and the substitution is stated in the PR
 * body.
 */
const WEBP_TARGET = join(ROOT, 'docs/verification/security/cloudflare-config-drift.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 58;
const WEBP_MAX_BYTES = 300 * 1024;

/** Rendered in this order: the live surface first, then the demonstrations. */
const CASES = [
	'one-missing-binding',
	'secret-binding-dropped',
	'text-value-drift',
	'undeclared-development-binding',
	'match',
];

function projectVersion() {
	try {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

function headSha() {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8',
		}).trim();
	} catch {
		return 'unknown';
	}
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Run one case and refuse to render a case that contradicts its own
 * expectation. The fixture declares the verdict it exists to demonstrate,
 * so the page can never drift from the suite.
 */
async function runCase(name) {
	const fixture = JSON.parse(readFileSync(resolve(ROOT, FIXTURE_DIR, `${name}.json`), 'utf8'));
	const audit = await runDriftAudit({ root: ROOT, caseName: name });
	const text = renderAudit(audit);
	// The leak guard is applied to the exact bytes the page will show.
	assertStatusOnly(audit.result, { isCredential: looksLikeCredentialValue });
	const expect = fixture.expect ?? {};
	if (expect.verdict !== undefined && expect.verdict !== audit.result.verdict) {
		throw new Error(
			`fixture ${name} expects ${expect.verdict} but the gate decided ${audit.result.verdict}`,
		);
	}
	if (expect.findings !== undefined && expect.findings !== audit.result.findings.length) {
		throw new Error(
			`fixture ${name} expects ${expect.findings} finding(s) but the gate decided ${audit.result.findings.length}`,
		);
	}
	if (Array.isArray(expect.paths)) {
		const actual = audit.result.findings.map((item) => item.path);
		if (actual.join('|') !== expect.paths.join('|')) {
			throw new Error(
				`fixture ${name} expects findings [${expect.paths.join(', ')}] but the gate decided [${actual.join(', ')}]`,
			);
		}
	}
	return { name, label: fixture.case, note: fixture.note, audit, text, live: false };
}

function verdictClass(verdict) {
	return verdict === DRIFT_VERDICT.match
		? 'ok'
		: verdict === DRIFT_VERDICT.drift
			? 'fail'
			: 'unknown';
}

function renderRow(entry) {
	const { result } = entry.audit;
	const dim = DRIFT_DIMENSIONS.map((dimension) => `${dimension}=${result.counts[dimension]}`).join(
		' ',
	);
	return `<tr>
  <th scope="row">${escapeHtml(entry.label ?? 'live')}</th>
  <td><code>${escapeHtml(entry.name ?? 'working tree')}</code></td>
  <td class="verdict ${verdictClass(result.verdict)}">${escapeHtml(result.verdict)}</td>
  <td><code>${escapeHtml(entry.audit.result.findings.length === 0 ? '0' : '1')}</code></td>
  <td><code>${escapeHtml(dim)}</code></td>
  <td>${escapeHtml(entry.note ?? '')}</td>
</tr>`;
}

function renderOutput(entry) {
	return `<figure>
  <figcaption>${escapeHtml(entry.label ?? 'live')} — status-only 出力</figcaption>
  <pre>${escapeHtml(entry.text.trim())}</pre>
</figure>`;
}

function buildPage({ entries, live, outPath }) {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Cloudflare configuration drift report — Issue #480</title>
<style>
  :root {
    color-scheme: light;
    --ink: #14171a;
    --muted: #5d646b;
    --line: #d9dde1;
    --surface: #ffffff;
    --canvas: #f6f7f8;
    --ok: #14663c;
    --ok-bg: #e8f5ee;
    --fail: #8c1d1d;
    --fail-bg: #fdecec;
    --warn: #7a5a12;
    --warn-bg: #fbf3e0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 44px 56px; background: var(--canvas); color: var(--ink);
    font: 15px/1.65 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: 0.01em; }
  h2 { font-size: 16px; margin: 32px 0 10px; letter-spacing: 0.02em; }
  .meta { color: var(--muted); font-size: 13px; margin: 0; }
  p.lede { margin: 0 0 10px; color: var(--muted); max-width: 78ch; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 13px; }
  th, td { border: 1px solid var(--line); padding: 9px 11px; text-align: left; vertical-align: top; }
  thead th { background: #eef0f2; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  tbody th { font-weight: 600; }
  .verdict { font-weight: 700; }
  .verdict.ok { color: var(--ok); background: var(--ok-bg); }
  .verdict.fail { color: var(--fail); background: var(--fail-bg); }
  .verdict.unknown { color: var(--warn); background: var(--warn-bg); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #eef0f2; padding: 1px 5px; border-radius: 4px; word-break: break-all; }
  pre { background: var(--surface); border: 1px solid var(--line); padding: 12px 14px; overflow-x: auto; }
  figure { margin: 0 0 18px; }
  figcaption { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  ul { max-width: 78ch; }
  footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>Cloudflare 設定 drift レポート</h1>
  <p class="meta">Issue #480 · my-web-2026 ${escapeHtml(projectVersion())} · source ${escapeHtml(headSha())} · 生成: ${escapeHtml(new Date().toISOString())} · ${escapeHtml(outPath)}</p>
</header>

<p class="lede">
  Cloudflare Workers Builds は <code>main</code> への push で production を deploy する。
  それがdeploy する surface は <code>cloudflare.config.ts</code> が production mode で生成する
  binding / route と、この repository が名指しする build・deploy command である。
  本 gate はその surface を<strong>記録された production contract</strong>
  （<code>quality/cloudflare-config-drift.json</code>）と突き合わせ、
  5 dimension（bindings / routes / headers / build_commands / mode）の差分を報告する。
  <strong>1 項目の不一致が 1 finding、1 finding が赤</strong>。tolerance 帯も閾値もない。
</p>

<h2>1. 判定表（実行結果）</h2>
<table>
  <thead><tr><th>ケース</th><th>入力</th><th>verdict</th><th>exit</th><th>内訳</th><th>備考</th></tr></thead>
  <tbody>
${[live, ...entries].map(renderRow).join('\n')}
  </tbody>
</table>

<h2>2. status-only 出力</h2>
${[live, ...entries].map(renderOutput).join('\n')}

<h2>3. 異常時の観測と修復手順</h2>
<ul>
  <li><code>verdict=DRIFT</code>（exit 1）: <code>finding=&lt;path&gt; kind=&lt;kind&gt;</code> を 1 行ずつ読む。<code>kind=missing</code> は binding / route の欠落、<code>kind=mismatch</code> は値の不一致、<code>kind=undeclared_mode_difference</code> は記録にない dev/prod 差分。</li>
  <li>意図的な変更なら<strong>同じ PR で</strong> <code>quality/cloudflare-config-drift.json</code> を更新する。記録は期待値そのものなので、実装だけ変えて記録を残すと次の誰かが同じ差分を踏む。</li>
  <li>production binding の差分は <code>cloudflare.config.ts</code> と <code>scripts/_cloudflare-contract.mjs</code> / <code>scripts/_cloudflare-identity.mjs</code> の 3 者を揃える（SoT は 1 つに保つ）。</li>
  <li>build / deploy command の差分は Cloudflare Dashboard（Workers Builds）側が実体。<code>pnpm run cf:mode-mismatch:check</code> と <code>pnpm run cloudflare:contract:check:build</code> で artifact 側も確認する。</li>
  <li><code>verdict=UNDECIDABLE</code>（exit 2）は「読めなかった」であって「clean」ではない。記録・surface・<code>public/_headers</code> のいずれかが読めない、または記録が契約として成立していない。</li>
</ul>
<p class="lede">
  詳細は <code>docs/runbook/cloudflare-config-drift.md</code>。
  本 gate は本番へ一切触れない（credential 無し / Cloudflare API 呼び出し無し / mutation 無し）。
</p>

<h2>4. この gate が強制しないこと</h2>
<ul>
  <li><strong>Build Output</strong>（実際に deploy される artifact）: <code>pnpm run cloudflare:contract:check:build</code> の責務。</li>
  <li><strong>Cloudflare Dashboard 実体</strong>（Workers Builds の build 変数、API token 権限）: local tool から読めないため、command が <code>package.json</code> script を指し続けることのみを gate する。</li>
  <li><strong>header の値と合成セマンティクス</strong>: <code>pnpm run security:headers:check</code>（Issue #449）の責務。本 gate は production が配信する static asset の namespace が <code>public/_headers</code> で覆われているか（coverage）と nosniff baseline のみを見る。</li>
  <li><strong>runtime secret の値</strong>: Infisical が SoT（ADR-0015）。本 gate は名前集合だけを比較する。</li>
</ul>

<footer>
  status-only 契約: secret binding は名前のみ、記録と一致しない text 値は
  <code>&lt;redacted len=N&gt;</code>。report の各ケースは CLI と同じ leak guard
  （<code>looksLikeCredentialValue</code>）を通しており、credential 形状の token が 1 件でもあれば
  本コマンドは非ゼロ終了します。
</footer>
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
		viewport: { width: 1280, height: 1200 },
		deviceScaleFactor: 1,
	});
	try {
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		// Playwright cannot emit WebP, so the capture stays in memory and
		// sharp re-encodes it; the intermediate PNG is never written.
		const capture = await page.screenshot({ fullPage: true });
		return await sharp(capture)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);
	} finally {
		await browser.close();
	}
}

async function main() {
	const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='));
	const outPath = outArg ? resolve(process.cwd(), outArg.slice('--out='.length)) : DEFAULT_OUT;

	const liveAudit = await runDriftAudit({ root: ROOT });
	const live = {
		name: 'working tree',
		label: `live (${liveAudit.result.verdict})`,
		note: `記録された contract と現在の作業ツリーの比較。${liveAudit.meta.summary ?? ''}`,
		audit: liveAudit,
		text: renderAudit(liveAudit),
	};
	assertStatusOnly(live.audit.result, { isCredential: looksLikeCredentialValue });

	const entries = [];
	for (const name of CASES) entries.push(await runCase(name));

	const page = buildPage({ entries, live, outPath });
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, page);
	process.stdout.write(`[cf-config-drift-report] wrote ${outPath}\n`);

	const info = await shoot(outPath, WEBP_TARGET);
	const sizeOnDisk = statSync(WEBP_TARGET).size;
	if (sizeOnDisk > WEBP_MAX_BYTES) {
		throw new Error(
			`${WEBP_TARGET} is ${Math.round(sizeOnDisk / 1024)} KB — over the ${Math.round(WEBP_MAX_BYTES / 1024)} KB artefact budget`,
		);
	}
	process.stdout.write(
		`[cf-config-drift-report] wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${sizeOnDisk} B, quality ${WEBP_QUALITY})\n`,
	);
	return 0;
}

process.exit(await main());
