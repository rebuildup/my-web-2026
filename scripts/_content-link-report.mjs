/**
 * Link-check report renderer — pure library (Issue #434).
 *
 * Split from `content-link-report.mjs` so the HTML can be asserted with
 * `node --test` (no browser, no Vite, no Worker). The report is a
 * verification artefact, so it is generated from the SAME pure
 * functions the gate uses; a passing row and a failing row cannot drift
 * away from the code that classifies them.
 *
 * Every value that comes from a scanned document is escaped on the way
 * in. A broken link target is untrusted text, and a report that renders
 * it as markup would be a second bug, not evidence about the first.
 */

import { redactTarget } from './_content-links.mjs';

/** Escape the five characters that can start markup in HTML text and attributes. */
export function escapeHtml(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

/** One severity badge. */
function severityBadge(severity) {
	return `<span class="badge ${severity}">${escapeHtml(severity)}</span>`;
}

/** One table row for a finding group. */
function findingRow(item) {
	const location = item.line > 0 ? `${item.sourcePath}:${item.line}` : item.sourcePath || '(n/a)';
	const count = item.count > 1 ? ` <span class="count">×${item.count}</span>` : '';
	return `<tr>
		<td>${severityBadge(item.severity)}</td>
		<td class="mono">${escapeHtml(item.code)}</td>
		<td class="mono">${escapeHtml(location)}</td>
		<td class="target">${escapeHtml(redactTarget(item.target) || '(none)')}${count}</td>
		<td>${escapeHtml(item.message)}</td>
	</tr>`;
}

/** One table row for a counterfactual fixture. */
function fixtureRow(fixture) {
	const status = fixture.summary.verdict === 'fail' ? 'FAIL (release)' : 'PASS (warning only)';
	return `<tr>
		<td><strong>${escapeHtml(fixture.id)}</strong><br><span class="muted">${escapeHtml(fixture.note)}</span></td>
		<td><pre>${escapeHtml(fixture.input)}</pre></td>
		<td>${fixture.findings
			.map(
				(item) =>
					`<div>${severityBadge(item.severity)} <span class="mono">${escapeHtml(item.code)}</span><br>${escapeHtml(item.message)}</div>`,
			)
			.join('')}</td>
		<td class="${fixture.summary.verdict === 'fail' ? 'fail' : 'pass'}">${escapeHtml(status)}<br><span class="muted">errors=${fixture.summary.error} warnings=${fixture.summary.warning}</span></td>
	</tr>`;
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 40px; background: #f4f1ea; color: #191712; font-family: "Helvetica Neue", Arial, "Noto Sans JP", sans-serif; line-height: 1.6; }
main { max-width: 1240px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 30px; letter-spacing: -0.01em; }
h2 { margin: 40px 0 10px; font-size: 17px; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 2px solid #191712; padding-bottom: 6px; }
p.lede { margin: 0 0 24px; max-width: 900px; color: #4a443a; }
table { width: 100%; border-collapse: collapse; background: #fffdf8; font-size: 13px; }
th, td { text-align: left; vertical-align: top; padding: 9px 10px; border-bottom: 1px solid #ddd5c5; }
th { background: #e9e2d2; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
td.mono, .mono { font-family: "SFMono-Regular", Menlo, monospace; font-size: 12px; }
td.target { max-width: 340px; word-break: break-all; }
td.fail { color: #8d1c12; font-weight: 700; }
td.pass { color: #205a2a; font-weight: 700; }
.muted { color: #6d6557; font-size: 11px; font-weight: 400; }
.count { color: #6d6557; font-size: 11px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: "SFMono-Regular", Menlo, monospace; font-size: 11px; }
.badge { display: inline-block; min-width: 58px; padding: 1px 6px; border-radius: 999px; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-align: center; }
.badge.error { background: #8d1c12; }
.badge.warning { background: #9a620a; }
.badge.info { background: #3f5b78; }
.cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 18px 0; }
.card { background: #fffdf8; border: 1px solid #ddd5c5; padding: 12px 14px; }
.card b { display: block; font-size: 26px; line-height: 1.2; }
.card span { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #6d6557; }
.verdict { margin: 20px 0 0; padding: 14px 18px; border: 2px solid #205a2a; background: #eaf2e8; font-weight: 700; }
.verdict.fail { border-color: #8d1c12; background: #f7e7e4; color: #8d1c12; }
.footnote { margin-top: 28px; color: #6d6557; font-size: 12px; }
`;

/**
 * Build the standalone report page.
 *
 * `scan`: `{ summary, findings, sources, references, externalMode }`
 * `fixtures`: counterfactual cases produced by the same validators.
 */
export function buildReportHtml({ scan, fixtures }) {
	const findings = scan.findings ?? [];
	const fixtureRows = fixtures.map(fixtureRow).join('\n');
	const findingRows =
		findings.length > 0
			? findings.map(findingRow).join('\n')
			: '<tr><td colspan="5">No findings.</td></tr>';
	const verdictClass = scan.summary.verdict === 'fail' ? 'verdict fail' : 'verdict';

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Content link check report (Issue #434)</title>
<style>${STYLE}</style>
</head>
<body>
<main>
	<h1>Content link check — 公開前リンク・画像レポート</h1>
	<p class="lede">
		Issue #434 の検証成果物。リポジトリの公開コンテンツ（<code>public 配下の HTML</code> と
		Portfolio Markdown）を <code>scripts/check-content-links.mjs</code> と同じ純粋関数で走査した結果である。
		内部リンクの 404 は <strong>error = release fail</strong>、外部リンクの timeout / 到達不能 / HTTP エラーは
		<strong>warning</strong> に区分する。本文は書き換えない。
	</p>
	<div class="cards">
		<div class="card"><span>sources</span><b>${scan.sources}</b></div>
		<div class="card"><span>references</span><b>${scan.references}</b></div>
		<div class="card"><span>errors</span><b>${scan.summary.error}</b></div>
		<div class="card"><span>warnings</span><b>${scan.summary.warning}</b></div>
		<div class="card"><span>info</span><b>${scan.summary.info}</b></div>
	</div>
	<p class="${verdictClass}">Verdict: ${scan.summary.verdict.toUpperCase()} — internal 404 / unsafe target / missing image alt は release を止める。外部失敗は warning のみ。外部 dereference: ${scan.externalMode ? 'enabled (--external)' : 'disabled (offline; CI default)'}。</p>

	<h2>Counterfactual fixtures — error と warning の境界</h2>
	<table>
		<thead><tr><th style="width:24%">case</th><th style="width:30%">input</th><th style="width:30%">findings</th><th style="width:16%">verdict</th></tr></thead>
		<tbody>${fixtureRows}</tbody>
	</table>

	<h2>Repository scan — findings</h2>
	<table>
		<thead><tr><th style="width:8%">severity</th><th style="width:15%">code</th><th style="width:22%">location</th><th style="width:22%">target</th><th>message</th></tr></thead>
		<tbody>${findingRows}</tbody>
	</table>

	<p class="footnote">
		生成: <code>node --experimental-strip-types scripts/content-link-report.mjs --capture</code>。
		画像は WebP（Issue の <code>.png</code> 指定を <code>.webp</code> に置換）。
		secret は含まない。外部リンクの live 検査は明示的な <code>--external</code> でのみ実行し、CI では network を触らない。
	</p>
</main>
</body>
</html>
`;
}

/** Markdown summary for a reviewer who reads the PR rather than the image. */
export function renderMarkdownSummary({ scan, fixtures }) {
	const lines = [
		'# Content link check report (Issue #434)',
		'',
		`- sources: ${scan.sources}`,
		`- references: ${scan.references}`,
		`- errors: ${scan.summary.error}`,
		`- warnings: ${scan.summary.warning}`,
		`- info: ${scan.summary.info}`,
		`- verdict: **${scan.summary.verdict.toUpperCase()}**`,
		`- external dereference: ${scan.externalMode ? 'enabled' : 'disabled (offline)'}`,
		'',
		'## Counterfactual fixtures',
		'',
		'| case | errors | warnings | verdict |',
		'| --- | --- | --- | --- |',
		...fixtures.map(
			(fixture) =>
				`| ${fixture.id} | ${fixture.summary.error} | ${fixture.summary.warning} | ${fixture.summary.verdict} |`,
		),
		'',
		'## Findings',
		'',
	];
	if (scan.findings.length === 0) {
		lines.push('(none)');
	} else {
		lines.push(
			'| severity | code | location | target | message |',
			'| --- | --- | --- | --- | --- |',
		);
		for (const item of scan.findings) {
			lines.push(
				`| ${item.severity} | ${item.code} | ${item.sourcePath}:${item.line} | ${redactTarget(item.target)}${item.count > 1 ? ` (×${item.count})` : ''} | ${item.message} |`,
			);
		}
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}
