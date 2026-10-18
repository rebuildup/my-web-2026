/**
 * Structured-data verification report renderer (Issue #422).
 *
 * Pure rendering + pure classification, no IO — so the report can be
 * unit-tested with `node --test` without a browser, a Worker, or a
 * Vitest run. `scripts/make-seo-structured-data-report.mjs` owns the
 * IO: it runs the suite, calls `renderReportHtml`, and screenshots
 * the result.
 *
 * The report exists because a green check nobody can inspect is a
 * claim, not evidence. It shows four things a reviewer can read:
 *
 *   1. the coverage matrix, INCLUDING routes that emit nothing (a
 *      hidden "not implemented" is the failure mode the Issue calls
 *      out — the report refuses to render those as a pass), and
 *   2. the exact JSON-LD the SSR pipeline emits for the two surfaces
 *      that emit Person / CreativeWork, and
 *   3. every validation error found (expected: none), and
 *   4. the negative controls — mutations that MUST be rejected — with
 *      their individual results.
 *
 * The node bodies come from
 * `test/integration/fixtures/structured-data-snapshot.json`, which the
 * integration suite asserts with `toEqual` against real SSR HTML. The
 * screenshot therefore cannot describe a document that CI did not
 * verify: change the node and the suite fails before the report can
 * be regenerated.
 */

const STATUS_LABEL = {
	implemented: 'EMITTED',
	'not-implemented': 'NOT IMPLEMENTED',
	'out-of-scope': 'OUT OF SCOPE',
};

export function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function code(value) {
	return `<code>${escapeHtml(value)}</code>`;
}

function summarise(report) {
	const files = (report.testResults ?? []).map((file) => {
		const assertions = (file.assertionResults ?? []).map((test) => ({
			title: test.fullName ?? test.title ?? '',
			status: test.status ?? 'unknown',
			ms: test.duration ?? 0,
		}));
		return {
			name: file.name ?? '(unknown file)',
			assertions,
			passed: assertions.filter((a) => a.status === 'passed').length,
			failed: assertions.filter((a) => a.status === 'failed').length,
			skipped: assertions.filter((a) => a.status === 'pending' || a.status === 'skipped').length,
			durationMs: Math.round((file.endTime ?? 0) - (file.startTime ?? 0)),
		};
	});
	const assertions = files.flatMap((file) => file.assertions);
	return {
		files,
		assertions,
		passed: assertions.filter((a) => a.status === 'passed').length,
		failed: assertions.filter((a) => a.status === 'failed').length,
		skipped: assertions.filter((a) => a.status === 'pending' || a.status === 'skipped').length,
		durationMs: files.reduce((sum, file) => sum + file.durationMs, 0),
	};
}

/** Split test titles into negative controls and everything else. */
function isNegativeControl(title) {
	return title.includes('negative control');
}

/** Test titles that assert the declared route coverage against real HTML. */
function isRouteAssertion(title) {
	return title.includes('emits exactly') || title.includes('emits zero JSON-LD');
}

function shortenPath(name) {
	const match = /^(?:.*\/)?([^/]+\.(?:test|spec)\.tsx?)$/.exec(name);
	return match ? match[1] : name;
}

function assertionRows(assertions, label) {
	return assertions
		.map(
			(a) => `<tr class="${escapeHtml(a.status)}">
  <td class="status">${a.status === 'passed' ? label : escapeHtml(a.status.toUpperCase())}</td>
  <td>${escapeHtml(a.title)}</td>
  <td class="ms">${Math.round(a.ms)} ms</td>
</tr>`,
		)
		.join('\n');
}

export function renderReportHtml({ report, registry, snapshot, environment, reproduction }) {
	const { files, assertions, passed, failed, skipped, durationMs } = summarise(report);
	const routes = registry.routes;
	const publicRoutes = routes.filter((route) => route.public);
	const withheld = registry.person.unapprovedProperties;

	const coverageRows = publicRoutes
		.map((route) => {
			const sampled = route.samplePath
				? code(route.samplePath)
				: '<span class="muted">未 sample</span>';
			const types =
				route.expectedTypes.length > 0
					? route.expectedTypes.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join(' ')
					: '<span class="muted">—</span>';
			return `<tr class="status-${escapeHtml(route.status)}">
  <td>${code(route.path)}</td>
  <td>${types}</td>
  <td><span class="verdict verdict-${escapeHtml(route.status)}">${STATUS_LABEL[route.status]}</span></td>
  <td>${sampled}</td>
  <td class="note">${escapeHtml(route.note)}</td>
</tr>`;
		})
		.join('\n');

	const withheldRows = withheld
		.map(
			(entry) => `<tr>
  <td>${code(`Person.${entry.property}`)}</td>
  <td class="note">${escapeHtml(entry.reason)}</td>
</tr>`,
		)
		.join('\n');

	const nonPublicNote = routes
		.filter((route) => !route.public)
		.map((route) => `${route.path} — ${route.note}`)
		.join('<br />');

	const controls = assertions.filter((a) => isNegativeControl(a.title));
	const routeAssertions = assertions.filter(
		(a) => !isNegativeControl(a.title) && isRouteAssertion(a.title),
	);

	const controlRows = controls
		.map((a) =>
			assertionRows([a], 'REJECTED').replace(
				escapeHtml(a.title),
				escapeHtml(a.title.replace(' — negative control (no silent pass)', '')),
			),
		)
		.join('\n');

	const fileRows = files
		.map(
			(file) => `<tr class="${file.failed > 0 ? 'failed' : 'passed'}">
  <td>${escapeHtml(shortenPath(file.name))}</td>
  <td class="ms">${file.assertions.length}</td>
  <td class="ms ${file.failed > 0 ? 'bad' : 'ok'}">${file.failed}</td>
  <td class="ms">${file.skipped}</td>
  <td class="ms">${file.durationMs} ms</td>
</tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Structured data 検証レポート — Issue #422</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px 32px; background: #fbfbf9; color: #14140f;
         font: 13.5px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 14px; margin: 26px 0 6px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 18px; font-size: 12.5px; }
  .cards { display: flex; gap: 10px; margin-bottom: 4px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 10px 14px; min-width: 118px; }
  .card .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 22px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .bad { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 5px 9px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  pre { background: #fff; border: 1px solid #dedcd2; padding: 10px 12px; overflow-x: auto; margin: 0; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 88px; }
  tr.passed .status { color: #1c6b3a; }
  tr.failed .status { color: #a12020; }
  .ms { text-align: right; color: #77776a; width: 74px; }
  .note { color: #3d3d33; font-size: 12px; }
  .muted { color: #77776a; }
  .pill { display: inline-block; border: 1px solid #cfd8e6; background: #eef2f8; color: #24405f;
          border-radius: 3px; padding: 1px 6px; margin-right: 3px; font-size: 11.5px; }
  .verdict { font-size: 10.5px; letter-spacing: 0.06em; font-weight: 700; padding: 2px 6px; border-radius: 3px; }
  .verdict-implemented { background: #e3f1e8; color: #1c6b3a; }
  .verdict-not-implemented { background: #f6ead8; color: #8a5a12; }
  .verdict-out-of-scope { background: #eceae3; color: #5a5a4e; }
  .legend { margin-top: 8px; color: #3d3d33; font-size: 12.5px; }
  .legend b { color: #14140f; }
  footer { margin-top: 22px; color: #77776a; font-size: 11.5px; }
</style>
</head>
<body>
  <h1>Schema.org 構造化データ検証レポート (Issue #422)</h1>
  <p class="sub">
    実行環境: ${escapeHtml(environment.node)} / ${escapeHtml(environment.platform)} ·
    Vitest ${escapeHtml(environment.vitest)} · workerd pool ·
    secret 非参照・production D1/R2 未接続
  </p>

  <div class="cards">
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v ${failed > 0 ? 'bad' : 'ok'}">${failed}</div></div>
    <div class="card"><div class="k">skipped</div><div class="v">${skipped}</div></div>
    <div class="card"><div class="k">duration</div><div class="v">${durationMs}<span style="font-size:12px"> ms</span></div></div>
  </div>

  <h2>1. route coverage matrix（未実装 route は「合格」表示にしない）</h2>
  <table>
    <thead><tr><th style="width:160px">route</th><th style="width:200px">@type</th><th style="width:142px">状態</th><th style="width:160px">検証 URL</th><th>根拠</th></tr></thead>
    <tbody>
${coverageRows}
    </tbody>
  </table>
  <p class="legend">
    <b>NOT IMPLEMENTED</b> は合格ではなく「未着手」の明示です。この行は integration suite が実際に fetch し、
    JSON-LD が 0 件であることまで確認します（0 件でなくなれば FAIL になります）。
    非 public surface: ${nonPublicNote}
  </p>

  <h2>2. 出力される Person ノード（/about、実 SSR HTML）</h2>
  <pre>${escapeHtml(JSON.stringify(snapshot.about.person, null, 2))}</pre>

  <h2>3. 出力される CreativeWork ノード（/portfolio/aulymo、実 SSR HTML）</h2>
  <pre>${escapeHtml(JSON.stringify(snapshot.portfolio.creativeWork, null, 2))}</pre>

  <h2>4. 意図的に出力しない Person プロパティ</h2>
  <table>
    <thead><tr><th style="width:180px">property</th><th>出力しない理由（承認済み record が無い / 表示専用文字列）</th></tr></thead>
    <tbody>
${withheldRows}
    </tbody>
  </table>

  <h2>5. negative control（誤検知を防ぐための「拒否されるべき payload」）</h2>
  <table>
    <thead><tr><th style="width:88px">結果</th><th>payload</th><th style="width:74px">time</th></tr></thead>
    <tbody>
${controlRows}
    </tbody>
  </table>
  <p class="legend">
    ここに 1 件でも <b>ACCEPTED</b>  있다면、validator が何も検証していない疑いがある状態です。
  </p>

  <h2>6. route 出力の実測（実 SSR HTML と両方向で照合）</h2>
  <table>
    <thead><tr><th style="width:88px">result</th><th>assertion</th><th style="width:74px">time</th></tr></thead>
    <tbody>
${assertionRows(routeAssertions, 'PASS')}
    </tbody>
  </table>

  <h2>7. スイート別実行結果（Vitest JSON reporter）</h2>
  <table>
    <thead><tr><th>suite</th><th style="width:74px">tests</th><th style="width:74px">failed</th><th style="width:74px">skipped</th><th style="width:74px">time</th></tr></thead>
    <tbody>
${fileRows}
    </tbody>
  </table>

  <h2>8. 再現手順</h2>
  <pre>${escapeHtml(reproduction)}</pre>
  <p class="legend">
    <b>schema validity と Google Rich Results は別系統です。</b>
    このレポートはリポジトリが宣言した契約に対する検証結果であり、Google の対応種別・表示要件・品質ルールを判定したものではありません。
    Rich Results 対応として主張できるものは、このレポートからは読み取れません。
  </p>

  <footer>
    my-web-2026 · Issue #422 ·
    report generated locally from the workerd test pool by scripts/make-seo-structured-data-report.mjs ·
    committed as docs/verification/seo/structured-data-report.webp
  </footer>
</body>
</html>
`;
}
