/**
 * SEO status verification report — pure HTML rendering (Issue #419).
 *
 * Kept import-free (no filesystem, no browser, no Worker) so the report
 * layout is unit-testable in `capture-seo-status-report.test.mjs` with
 * fixture captures, and so the capture script owns only the I/O: run the
 * suite, boot a local origin, drive chromium, encode the WebP.
 *
 * Everything printed here is either (a) a real captured response — the
 * two failure documents the Issue asks to be photographed — or (b) a row
 * of `scripts/_seo-status-contract.mjs`. Nothing is re-typed here, so a
 * screenshot cannot claim a status the contract does not declare.
 */

/** HTML-escape. Every interpolated value goes through this. */
export function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** One captured response: what the browser got, and what it drew. */
export function captureRows(captures) {
	return captures
		.map((capture) => {
			const violations = capture.violations ?? [];
			const verdict = violations.length === 0 ? 'MATCH' : 'MISMATCH';
			return `<tr class="${verdict === 'MATCH' ? 'ok' : 'bad'}">
      <td><code>${escapeHtml(capture.path)}</code></td>
      <td class="status">${escapeHtml(capture.status)}</td>
      <td>${escapeHtml(capture.surface)}</td>
      <td><code>${escapeHtml(capture.robots)}</code></td>
      <td><code>${escapeHtml(capture.caseId)}</code></td>
      <td>${verdict}${violations.length ? ` — ${escapeHtml(violations.map((v) => v.message).join(' / '))}` : ''}</td>
    </tr>
      <tr class="shot">
        <td colspan="6"><img alt="${escapeHtml(capture.path)} — ${escapeHtml(capture.status)}" src="${escapeHtml(capture.pngDataUri)}" /></td>
      </tr>`;
		})
		.join('\n');
}

/** The declared contract, one row per case. */
export function matrixRows(expectations) {
	return expectations
		.map((entry) => {
			const status = Array.isArray(entry.expect.status)
				? entry.expect.status.join(' / ')
				: String(entry.expect.status);
			const open = entry.openDecision ? 'open decision (§7)' : '—';
			return `<tr>
      <td><code>${escapeHtml(entry.id)}</code></td>
      <td><code>${escapeHtml(entry.route)}</code></td>
      <td>${escapeHtml(status)}</td>
      <td><code>${escapeHtml(entry.expect.robots)}</code></td>
      <td><code>${escapeHtml(entry.expect.surface)}</code></td>
      <td>${escapeHtml(entry.sitemap)}</td>
      <td>${escapeHtml(entry.proves.map((proof) => proof.layer).join(' + '))}</td>
      <td>${escapeHtml(open)}</td>
    </tr>`;
		})
		.join('\n');
}

/**
 * Suite outcome rows, from vitest's JSON reporter.
 *
 * A green run is printed as ONE summary row rather than 30 green rows:
 * the artefact has to stay readable (and small enough to commit), and a
 * list of green test names is the part a reviewer does not read. A red
 * run prints every failing assertion, because that is the part they do.
 */
export function suiteRows(assertions) {
	const failed = assertions.filter((test) => test.status !== 'passed');
	if (failed.length === 0) {
		return `<tr class="passed">
      <td class="status">PASS</td>
      <td>${assertions.length} assertion(s) all passed</td>
      <td class="ms">${Math.round(assertions.reduce((sum, test) => sum + test.ms, 0))} ms</td>
    </tr>`;
	}
	return assertions
		.map(
			(test) => `<tr class="${escapeHtml(test.status)}">
      <td class="status">${test.status === 'passed' ? 'PASS' : escapeHtml(String(test.status).toUpperCase())}</td>
      <td>${escapeHtml(test.title)}</td>
      <td class="ms">${Math.round(test.ms)} ms</td>
    </tr>`,
		)
		.join('\n');
}

/**
 * The full report page.
 *
 * @param {object} input
 * @param {object[]} input.captures    captured failure documents (see `captureRows`)
 * @param {object[]} input.expectations the declared contract rows
 * @param {object[]} input.assertions  suite assertions (`{title,status,ms}`)
 * @param {string} input.suitePath     the suite that produced `assertions`
 * @param {string} input.origin        the local origin the captures came from
 */
export function reportHtml({ captures, expectations, assertions, suitePath, origin }) {
	const passed = assertions.filter((test) => test.status === 'passed').length;
	const failed = assertions.length - passed;
	const matched = captures.filter((capture) => (capture.violations ?? []).length === 0).length;
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>404 / 500 HTTP 契約の検証 — Issue #419</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; background: #fbfbf9; color: #14140f;
         font: 14px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 15px; margin: 28px 0 8px; letter-spacing: 0.02em; text-transform: uppercase; color: #5a5a4e; }
  .sub { color: #5a5a4e; margin: 0 0 20px; font-size: 13px; max-width: 1100px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 150px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .bad { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  tr:last-child td { border-bottom: none; }
  .status { font-weight: 700; width: 70px; }
  tr.passed .status, tr.ok .status { color: #1c6b3a; }
  tr.failed .status, tr.bad .status { color: #a12020; }
  .ms { text-align: right; color: #77776a; width: 80px; }
  tr.shot td { padding: 0; background: #14140f; }
  tr.shot img { display: block; width: 100%; height: auto; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; max-width: 1100px; }
</style>
</head>
<body>
  <h1>404 / 500 / noindex と公開可否の HTTP 契約 — Issue #419</h1>
  <p class="sub">
    宣言された契約は <code>scripts/_seo-status-contract.mjs</code>（${expectations.length} case）、
    判定は同じ evaluator（<code>evaluateObservation</code>）。下の 2 枚は
    <code>${escapeHtml(origin)}</code> に実ブラウザが要求して得た<b>実応答</b>をそのまま撮影したもので、
    status も <code>&lt;meta name="robots"&gt;</code> も実際の応答から読み取ってある。
    スクリーンショットだけでは合格の根拠にはせず、宣言・実測・suite 実行結果の 3 つを並べて提示している。
  </p>

  <div class="cards">
    <div class="card"><div class="k">captures</div><div class="v">${captures.length}</div></div>
    <div class="card"><div class="k">contract match</div><div class="v ${matched === captures.length ? 'ok' : 'bad'}">${matched}/${captures.length}</div></div>
    <div class="card"><div class="k">tests</div><div class="v">${assertions.length}</div></div>
    <div class="card"><div class="k">passed</div><div class="v ok">${passed}</div></div>
    <div class="card"><div class="k">failed</div><div class="v ${failed === 0 ? 'ok' : 'bad'}">${failed}</div></div>
  </div>

  <h2>実ブラウザが受け取った応答（404 / 500）</h2>
  <table>
    <thead><tr><th style="width:300px">path</th><th style="width:70px">status</th><th style="width:150px">surface</th><th style="width:90px">robots</th><th style="width:280px">contract case</th><th>判定</th></tr></thead>
    <tbody>
${captureRows(captures)}
    </tbody>
  </table>

  <h2>宣言された契約（全 case）</h2>
  <table>
    <thead><tr><th style="width:300px">case</th><th style="width:190px">route</th><th style="width:100px">status</th><th style="width:90px">robots</th><th style="width:170px">surface</th><th style="width:120px">sitemap</th><th style="width:120px">proof</th><th style="width:150px">備考</th></tr></thead>
    <tbody>
${matrixRows(expectations)}
    </tbody>
  </table>

  <h2>実行結果（${escapeHtml(suitePath)}）</h2>
  <table>
    <thead><tr><th style="width:70px">result</th><th>test</th><th style="width:80px">time</th></tr></thead>
    <tbody>
${suiteRows(assertions)}
    </tbody>
  </table>

  <footer>my-web-2026 · Issue #419 ·
    宣言: <code>scripts/_seo-status-contract.mjs</code> ·
    gate: <code>pnpm run seo:status:check</code> ·
    実測: <code>${escapeHtml(suitePath)}</code>（workerd）+ <code>e2e/seo-status.spec.ts</code>（実ブラウザ） ·
    撮影: local origin のみ（canonical production origin へはアクセスしていない） ·
    再現: <code>pnpm run build &amp;&amp; pnpm run capture:seo-status &amp;&amp; pnpm exec playwright test e2e/seo-status.spec.ts</code> ·
    値はすべて応答から読み取り済み。committed artefact は WebP（幅 ≤1600, quality 80）。
  </footer>
</body>
</html>
`;
}
