#!/usr/bin/env node

/**
 * ssrf-url-adapter-report — regenerate the Issue #453 verification
 * screenshot from the shipped outbound adapter itself.
 *
 * What it measures
 * ----------------
 * Every row is produced by running the real `fetchExternalUrl`
 * (`src/http/outbound-fetch.ts`) against the real
 * `classifyOutboundUrl` (`src/http/outbound.ts`), with an injected
 * transport. The status / verdict / reason columns in the report are the
 * returned values of the shipped code, not a hand-written table.
 *
 * The report is also a *safety* artefact: the refused URLs are strings
 * that are never requested. The transport is a local table — there is no
 * outbound network request of any kind, no credential is used, and the
 * only process that opens anything is the Playwright Chromium that
 * renders the local HTML.
 *
 * Usage:
 *   node scripts/capture-ssrf-url-adapter-report.mjs [outFile] [--html dumpPath]
 *
 * Default outFile: docs/verification/security/ssrf-url-adapter.webp
 *
 * The artefact is WebP (width ≤ 1600, quality ~72, under 300 KiB)
 * rather than the PNG the Issue names: a full-page PNG of this table is
 * ~1.2 MiB of mostly flat colour, and the repository keeps verification
 * artefacts in its history forever.
 *
 * `--html` additionally writes the markup the image renders, which is
 * what to review when a row is hard to read. The run fails if a row's
 * measured outcome contradicts the outcome its label claims, if any row
 * is neither `fetched` nor a recognised refusal, if a row that is
 * evidence about a policy rule instead measured a transport outcome,
 * if the page overflows horizontally (a clipped column would make the
 * image misleading), or if a rendered row looks like it carries a
 * credential.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

/**
 * `src/http/outbound-fetch.ts` imports its sibling with the
 * bundler-style extensionless specifier the Worker build uses
 * (`./outbound`). Node's ESM resolver wants the extension, so it is
 * filled in here rather than by changing the source to a specifier only
 * this script needs. `registerHooks` (Node >= 22.15, satisfied by the
 * repo's `engines.node`) keeps this in the same thread.
 */
registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
				return nextResolve(`${specifier}.ts`, context);
			}
			throw error;
		}
	},
});

const { fetchExternalUrl } = await import('../src/http/outbound-fetch.ts');
const { MAX_OUTBOUND_URL_LENGTH } = await import('../src/http/outbound.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const htmlFlagIndex = argv.indexOf('--html');
const htmlDump =
	htmlFlagIndex === -1
		? null
		: resolve(ROOT, argv[htmlFlagIndex + 1] ?? '.tmp/ssrf-url-adapter.html');

/**
 * The committed artefact path, optionally overridden by the first
 * positional argument.
 *
 * `--html <path>` must be removed before the positional lookup, but only
 * when the flag is actually present: filtering by `htmlFlagIndex` when it
 * is `-1` would drop argv[0] and silently fall back to the committed
 * path, overwriting the artefact a caller only meant to read.
 */
export function resolveOutFile(args) {
	const flagIndex = args.indexOf('--html');
	const positional =
		flagIndex === -1
			? args
			: args.filter((value, index) => index !== flagIndex && index !== flagIndex + 1);
	return resolve(ROOT, positional[0] ?? 'docs/verification/security/ssrf-url-adapter.webp');
}

const OUT = resolveOutFile(argv);

/**
 * Anything matching these must never reach a committed artefact.
 *
 * These target *values*, not header names: a row is allowed to say
 * `credential_header_refused` and `header "authorization" is never
 * sent`, because naming the header is the refusal itself. What must
 * never appear is a header *assigned* a value, a bearer token, a home
 * API key, a JWT, or a long hex/base64 blob.
 */
const SECRET_PATTERNS = [
	/\bbearer\s+\S/i,
	/\bmk_[a-z0-9_]+/i,
	/\b(?:authorization|cookie|proxy-authorization|set-cookie)\s*[:=]\s*\S/i,
	/\beyJ[A-Za-z0-9_-]{8,}/,
	/\b[a-f0-9]{32,}\b/i,
];

/**
 * The row that would leak a credential into the artefact, if any.
 * Exported so the guard is unit-tested rather than only observable by
 * running the whole capture.
 */
export function findSecretRow(rows) {
	return rows.find((row) => SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(row))));
}

/** Failure codes this report knows how to render. An unknown one is a bug. */
export const KNOWN_CODES = new Set([
	'invalid_url',
	'url_too_long',
	'protocol_not_allowed',
	'credentials_in_url',
	'host_not_allowed',
	'private_address',
	'ip_literal_not_allowed',
	'port_not_allowed',
	'credential_header_refused',
	'too_many_redirects',
	'timeout',
	'aborted',
	'response_too_large',
	'http_error',
	'fetch_failed',
]);

/**
 * Groups whose rows are evidence about `src/http/outbound.ts` rules.
 * A refused URL is never requested, so a transport outcome in one of
 * these rows means the matrix itself is wrong: it asked for something
 * the policy allowed, and the fixture table had no answer.
 */
const POLICY_GROUPS = new Set([
	'protocol',
	'ループバック / private',
	'internal ゾーン',
	'authority / port',
	'形',
	'redirect hop',
]);

/**
 * Codes that describe the transport rather than a policy rule.
 * `fetch_failed` in particular means the fixture transport was asked
 * for a URL its table does not contain — a defect in this file.
 */
export const TRANSPORT_OUTCOME_CODES = new Set(['fetch_failed', 'http_error']);

/**
 * The row that would present a harness outcome as policy evidence, if
 * any. Exported so the guard is unit-tested rather than only observable
 * by running the whole capture.
 */
export function findUnprovenPolicyRow(rows) {
	return rows.find((row) => row.policyRow === true && TRANSPORT_OUTCOME_CODES.has(row.code));
}

const escapeHtml = (value) =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

/** Visible stand-ins for characters that would otherwise be invisible. */
function showValue(value) {
	return value
		.replaceAll('\u0000', '<nul>')
		.replaceAll('\u2028', '<ls>')
		.replaceAll('\u2029', '<ps>')
		.replaceAll('\u3000', '<ideo>')
		.replaceAll('\ufeff', '<bom>')
		.replaceAll('\n', '<lf>')
		.replaceAll('\r', '<cr>')
		.replaceAll('\t', '<tab>');
}

/* ------------------------------------------------------------------ */
/* The matrix                                                          */
/* ------------------------------------------------------------------ */

/**
 * `{ group, label, url, transport, expectCode }`.
 *
 * `transport` names the row in the local transport table below; a row
 * that is refused never consults it.
 *
 * `expectCode` is the outcome the row is evidence *for*, and
 * {@link measure} refuses to produce a table when the measurement
 * disagrees. A row's `label` is prose; without this the two drift
 * apart silently — a row that reads "length limit" while measuring a
 * fixture error renders, looks plausible, and is read as proof of a
 * rule that nothing exercised.
 */
export const CASES = [
	// --- accepted ---------------------------------------------------------
	{
		group: '取得できた',
		label: '公開 https origin（GitHub API）',
		url: 'https://api.github.com/repos/rebuildup/my-web-2026',
		transport: 'api.github.com/repos/rebuildup/my-web-2026',
		expectCode: 'HTTP 200',
	},
	{
		group: '取得できた',
		label: '公開 origin へのリダイレクトを追跡（hop 1）',
		url: 'https://example.org/download',
		transport: 'example.org/download',
		expectCode: 'HTTP 200',
	},
	{
		group: '取得できた',
		label: 'リダイレクトの連鎖（hop 2、budget 内）',
		url: 'https://example.org/start',
		transport: 'example.org/start',
		expectCode: 'HTTP 200',
	},

	// --- protocol ---------------------------------------------------------
	{
		group: 'protocol',
		label: 'file スキーム',
		url: 'file:///etc/passwd',
		expectCode: 'protocol_not_allowed',
	},
	{
		group: 'protocol',
		label: 'gopher スキーム',
		url: 'gopher://example.org/1',
		expectCode: 'protocol_not_allowed',
	},
	{
		group: 'protocol',
		label: 'data スキーム',
		url: 'data:text/html,<h1>x</h1>',
		expectCode: 'protocol_not_allowed',
	},
	{
		group: 'protocol',
		label: 'javascript スキーム',
		url: 'javascript:alert(1)',
		expectCode: 'protocol_not_allowed',
	},

	// --- loopback / private ----------------------------------------------
	{
		group: 'ループバック / private',
		label: 'IPv4 loopback',
		url: 'http://127.0.0.1:8787/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'loopback 範囲の上端',
		url: 'http://127.255.255.254/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'localhost 名前',
		url: 'http://localhost:8787/',
		// A name, not an address: the single-label rule refuses it
		// before any address reasoning, which is the earlier refusal.
		expectCode: 'host_not_allowed',
	},
	{
		group: 'ループバック / private',
		label: 'RFC1918 10/8',
		url: 'http://10.0.0.1/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'RFC1918 172.16/12',
		url: 'http://172.16.0.5/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'RFC1918 192.168/16',
		url: 'http://192.168.1.1/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'CGNAT 100.64/10',
		url: 'http://100.64.0.1/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'link-local（cloud metadata）',
		url: 'http://169.254.169.254/latest/meta-data/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'IPv6 loopback',
		url: 'http://[::1]/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'IPv4-mapped loopback',
		url: 'http://[::ffff:127.0.0.1]/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'NAT64 で埋め込まれた loopback',
		url: 'https://[64:ff9b::7f00:1]/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: '6to4 で埋め込まれた loopback',
		url: 'https://[2002:7f00:1::]/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: 'IPv6 unique local',
		url: 'http://[fd00::1]/',
		expectCode: 'private_address',
	},
	{
		group: 'ループバック / private',
		label: '公開 IP リテラル（方針はホスト名必須）',
		url: 'https://8.8.8.8/resolve',
		expectCode: 'ip_literal_not_allowed',
	},

	// --- internal names ---------------------------------------------------
	{
		group: 'internal ゾーン',
		label: '.internal',
		url: 'https://db.internal/secrets',
		expectCode: 'host_not_allowed',
	},
	{
		group: 'internal ゾーン',
		label: '.local (mDNS)',
		url: 'http://printer.local/status',
		expectCode: 'host_not_allowed',
	},
	{
		group: 'internal ゾーン',
		label: '.home.arpa',
		url: 'http://nas.home.arpa/',
		expectCode: 'host_not_allowed',
	},
	{
		group: 'internal ゾーン',
		label: 'GCP metadata ホスト名',
		url: 'http://metadata.google.internal/computeMetadata/v1/',
		expectCode: 'host_not_allowed',
	},
	{
		group: 'internal ゾーン',
		label: '単一ラベル',
		url: 'http://intranet/admin',
		expectCode: 'host_not_allowed',
	},

	// --- authority / port -------------------------------------------------
	{
		group: 'authority / port',
		label: 'userinfo による origin 取り違え',
		url: 'https://api.github.com@169.254.169.254/latest/meta-data/',
		expectCode: 'credentials_in_url',
	},
	{
		group: 'authority / port',
		label: '非 default port',
		url: 'https://api.github.com:8443/x',
		expectCode: 'port_not_allowed',
	},
	{
		group: 'authority / port',
		label: '絶対パスではなく相対パス',
		url: '/admin',
		expectCode: 'invalid_url',
	},

	// --- shape ------------------------------------------------------------
	{
		group: '形',
		label: '制御文字（parser が除去するもの）',
		url: 'https://api.github.com\n@169.254.169.254/',
		expectCode: 'invalid_url',
	},
	{
		group: '形',
		// The limit is imported, not written out, and the URL is built
		// to be *over* it: an earlier version of this row was 346
		// characters short of the cap, so it was accepted, requested,
		// and reported as a fixture error rather than as the rule.
		// The filler is `x` rather than `a`/`0`/`f` so the row is not
		// itself refused by the secret-shaped-value guard below.
		label: `長さ上限超過（${MAX_OUTBOUND_URL_LENGTH} 文字）`,
		url: `https://api.github.com/${'x'.repeat(MAX_OUTBOUND_URL_LENGTH + 1)}`,
		expectCode: 'url_too_long',
	},

	// --- redirect hops ----------------------------------------------------
	{
		group: 'redirect hop',
		label: 'hop が loopback を指す',
		url: 'https://example.org/redirect-loopback',
		transport: 'example.org/redirect-loopback',
		expectCode: 'private_address',
	},
	{
		group: 'redirect hop',
		label: 'hop が file スキームを指す',
		url: 'https://example.org/redirect-file',
		transport: 'example.org/redirect-file',
		expectCode: 'protocol_not_allowed',
	},
	{
		group: 'redirect hop',
		label: 'hop が非 default port を指す',
		url: 'https://example.org/redirect-port',
		transport: 'example.org/redirect-port',
		expectCode: 'port_not_allowed',
	},
	{
		group: 'redirect hop',
		label: 'hop budget 超過（3 段目）',
		url: 'https://example.org/hop-0',
		transport: 'example.org/hop-0',
		expectCode: 'too_many_redirects',
	},

	// --- response limits --------------------------------------------------
	{
		group: '応答の上限',
		label: 'body が上限超過（宣言より小さく騙る）',
		url: 'https://example.org/oversize',
		transport: 'example.org/oversize',
		maxBytes: 512,
		expectCode: 'response_too_large',
	},
	{
		group: '応答の上限',
		label: 'deadline を超過',
		url: 'https://example.org/slow',
		transport: 'example.org/slow',
		timeoutMs: 25,
		expectCode: 'timeout',
	},
	{
		group: '応答の上限',
		label: 'credential ヘッダの送出要求',
		url: 'https://api.github.com/user',
		headers: { Authorization: 'Bearer not-a-real-value' },
		expectCode: 'credential_header_refused',
	},
];

/**
 * The local transport table. Everything a row can reach is here; a URL
 * that is not in the table is never requested, because the adapter
 * refuses it before opening a connection.
 */
function localTransport() {
	const requested = [];
	const bodies = {
		'https://api.github.com/repos/rebuildup/my-web-2026': () =>
			Response.json({ full_name: 'rebuildup/my-web-2026', stargazers_count: 0 }),
		'https://example.org/download': () =>
			new Response(null, { status: 302, headers: { location: '/files/report.pdf' } }),
		'https://example.org/files/report.pdf': () =>
			new Response('%PDF-1.7 (fixture)', {
				headers: { 'content-type': 'application/pdf' },
			}),
		'https://example.org/start': () =>
			new Response(null, { status: 301, headers: { location: '/middle' } }),
		'https://example.org/middle': () =>
			new Response(null, { status: 307, headers: { location: 'https://files.example.org/end' } }),
		'https://files.example.org/end': () =>
			new Response('done', { headers: { 'content-type': 'text/plain' } }),
		'https://example.org/redirect-loopback': () =>
			new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8787/admin' } }),
		'https://example.org/redirect-file': () =>
			new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }),
		'https://example.org/redirect-port': () =>
			new Response(null, {
				status: 302,
				headers: { location: 'https://codeload.example.org:8443/a' },
			}),
		'https://example.org/oversize': () =>
			new Response('x'.repeat(4096), { headers: { 'content-length': '16' } }),
		'https://example.org/slow': (_url, init) =>
			// Never settles on its own; the adapter's AbortController is
			// the only thing that ends this request, exactly as the
			// runtime `fetch` behaves. (The adapter also races its own
			// timer, so the row would still be a `timeout` — but it
			// would take the fixture's 5 s to get there, and the row
			// would be measuring the fixture rather than the deadline.)
			new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(new Error('the deadline fired')), {
					once: true,
				});
			}),
	};
	for (let hop = 0; hop < 8; hop += 1) {
		bodies[`https://example.org/hop-${hop}`] = () =>
			new Response(null, { status: 302, headers: { location: `/hop-${hop + 1}` } });
	}

	return {
		requested,
		transport: async (url, init) => {
			requested.push(url);
			const factory = bodies[url];
			if (!factory) throw new Error(`unexpected request to ${url}`);
			return factory(url, init);
		},
	};
}

/** Run every case through the shipped adapter and collect the verdicts. */
export async function measure(cases, { transport } = {}) {
	const rows = [];
	for (const entry of cases) {
		const result = await fetchExternalUrl(entry.url, {
			transport,
			...(entry.maxBytes === undefined ? {} : { maxBytes: entry.maxBytes }),
			...(entry.timeoutMs === undefined ? {} : { timeoutMs: entry.timeoutMs }),
			...(entry.headers === undefined ? {} : { headers: entry.headers }),
		});
		const code = result.ok ? `HTTP ${result.status}` : result.code;
		if (entry.expectCode !== undefined && code !== entry.expectCode) {
			throw new Error(
				`row "${entry.label}" measured "${code}" but is declared as evidence for "${entry.expectCode}"`,
			);
		}
		rows.push({
			group: entry.group,
			label: entry.label,
			input: showValue(entry.url.length > 56 ? `${entry.url.slice(0, 55)}…` : entry.url),
			outcome: result.ok ? 'fetched' : 'refused',
			code,
			reason: result.ok
				? `${result.redirectChain.length} hop / ${result.bytes.byteLength} B`
				: result.reason,
			hops: String(result.redirectChain.length),
			policyRow: POLICY_GROUPS.has(entry.group),
		});
	}
	return rows;
}

export function renderHtml(rows) {
	const groups = [...new Set(rows.map((row) => row.group))];
	const accepted = rows.filter((row) => row.outcome === 'fetched').length;

	const body = groups
		.map((group) => {
			const cells = rows
				.filter((row) => row.group === group)
				.map((row) => {
					const ok = row.outcome === 'fetched';
					return `<tr class="${ok ? 'ok' : 'reject'}">
					<td class="num">${escapeHtml(rows.indexOf(row) + 1)}</td>
					<td>${escapeHtml(row.label)}</td>
					<td class="url"><code>${escapeHtml(row.input)}</code></td>
					<td class="verdict">${escapeHtml(row.code)}</td>
					<td>${escapeHtml(row.reason)}</td>
					<td class="num">${escapeHtml(row.hops)}</td>
				</tr>`;
				})
				.join('\n');
			return `<tr class="group"><td colspan="6">${escapeHtml(group)}</td></tr>\n${cells}`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>外部URL取得 SSRF/リダイレクト境界 検証レポート — Issue #453</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.55 "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
         margin: 0; padding: 28px 30px; background: #ffffff; color: #111111; }
  h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: 0.01em; }
  p.lede { margin: 0 0 16px; color: #444444; max-width: 150ch; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: fixed; }
  caption { text-align: left; padding-bottom: 8px; color: #444444; }
  th, td { border-bottom: 1px solid #dcdcdc; padding: 5px 8px; text-align: left;
           vertical-align: top; word-break: break-word; }
  th { background: #f3f3f3; font-weight: 600; }
  tr.group td { background: #e9e9e9; font-weight: 700; letter-spacing: 0.04em;
                 padding: 6px 8px; text-transform: uppercase; font-size: 11px; }
  td.num { width: 30px; color: #666666; text-align: right; }
  td.verdict { width: 160px; font-weight: 600; }
  td.url { width: 330px; }
  code { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
  tr.ok .verdict { color: #0a6b2d; }
  tr.reject .verdict { color: #8a3d00; }
  .legend { margin-top: 18px; border: 1px solid #dcdcdc; padding: 12px 14px; max-width: 152ch; }
  .legend h2 { font-size: 13px; margin: 0 0 6px; }
  .legend ul { margin: 0; padding-left: 18px; }
  .legend li { margin-bottom: 2px; }
  footer { margin-top: 14px; color: #666666; font-size: 11px; }
</style>
</head>
<body>
  <h1>外部URL取得 SSRF/リダイレクト境界 検証レポート — Issue #453</h1>
  <p class="lede">各行は <code>fetchExternalUrl</code>（<code>src/http/outbound-fetch.ts</code>）が
  <code>classifyOutboundUrl</code>（<code>src/http/outbound.ts</code>）に返した実測結果である。
  transport はローカル table に差し替えており、<strong>このレポートは外部ネットワークへ 1 も接続していない</strong>。
  拒否行の URL は文字列としてのみ存在し、DNS 解決も socket 確立も行われていない。</p>
  <table>
    <caption>${rows.length} ケース（取得成功 ${accepted} / 拒否 ${rows.length - accepted}）</caption>
    <thead><tr>
      <th>#</th><th>入力</th><th>URL</th><th>結果 / code</th><th>理由</th><th>hop</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
  </table>
  <div class="legend">
    <h2>この表の読み方</h2>
    <ul>
      <li><strong>fetched</strong> — 許可された URL の取得に成功。hop 列は追従したリダイレクト数、
          理由列は応答サイズ。hop 先も毎回同じ判定を通っている。</li>
      <li><strong>invalid_url</strong> — 絶対 URL として解析できない（相対パス）、または tab / CR / LF などの
          制御文字・空白を含む。parser は tab / CR / LF を黙って除去するため、その値のまま拒否する。</li>
      <li><strong>url_too_long</strong> — ${MAX_OUTBOUND_URL_LENGTH} 文字を超えている URL。
          <code>fetch()</code> とログに届く文字列の上限であり、この report の行は実際にその長さを超えている。</li>
      <li><strong>protocol_not_allowed</strong> — <code>http:</code> / <code>https:</code> 以外
          （<code>file:</code> / <code>gopher:</code> / <code>data:</code> / <code>javascript:</code>）。</li>
      <li><strong>private_address</strong> — loopback / RFC1918 / link-local（<code>169.254.169.254</code> の
          cloud instance metadata を含む）/ CGNAT / multicast / IPv6 ULA・link-local。
          IPv4-mapped・NAT64・6to4 で IPv4 を埋め込んだ形も<b>埋め込んだ先</b>で判定する。</li>
      <li><strong>ip_literal_not_allowed</strong> — 公開 IP リテラル。方針が「ホスト名必須」なので
          <code>8.8.8.8</code> も拒否する。DNS と照合できないため。</li>
      <li><strong>host_not_allowed</strong> — 予約 / internal ゾーン（<code>.internal</code> /
          <code>.local</code> / <code>.home.arpa</code> など）および単一ラベル。
          ラベル境界で判定するので <code>evil-internal.example.org</code> は通る。</li>
      <li><strong>port_not_allowed</strong> — <code>80</code> / <code>443</code> 以外の port
          （行内の理由列が実際の port 番号を示す）。非 default port は別サービスへの入口になりうるため、
          URL の形だけで拒否する。</li>
      <li><strong>credentials_in_url</strong> — <code>https://api.github.com@169.254.169.254/</code> は
          「安全なホストを userinfo に重ねて内側へ誘う」古典的な手口。接続前に拒否される。</li>
      <li><strong>redirect hop の行</strong> — 1 段目は通るが <code>Location</code> の先で拒否されたもの。
          hop は必ず同じ判定を通すので、転送先が方針の迂回手段にはならない。</li>
      <li><strong>応答の上限の行</strong> — <code>response_too_large</code>（宣言 16 B に対して 4096 B を流す）/
          <code>timeout</code>（25 ms の deadline 内に結果が返らない）/
          <code>credential_header_refused</code>。いずれも拒否であり、その行の URL は
          成功した取得ではない。</li>
      <li><strong>credential_header_refused</strong> — 第三 origin へ credential ヘッダを送ろうとした要求は
          <em>除去ではなく拒否</em>される。</li>
      <li>本レポートに credential・cookie・秘密値・本番識別子は含まれない（描画するのは入力文字列と結果 code のみ）。</li>
    </ul>
  </div>
  <footer>再生成: <code>pnpm run security:ssrf:report</code> ／ 運用契約:
  <code>docs/security/outbound-fetch.md</code></footer>
</body>
</html>
`;
}

/**
 * Rendered width cap and encoder settings.
 *
 * Width 1500 (under the 1600 cap) at quality 72 keeps the committed
 * artefact comfortably under 300 KiB. The table is flat colour and 12 px text,
 * which is exactly the shape WebP compresses well; at the full 1560 px
 * / quality 80 the same page is ~309 KiB for no legibility gain.
 */
const MAX_WIDTH = 1500;
const WEBP_QUALITY = 72;

async function main() {
	const { transport, requested } = localTransport();
	let rows;
	try {
		rows = await measure(CASES, { transport });
	} catch (error) {
		// A row whose measurement contradicts its own label must not
		// reach the artefact: the image would be read as proof of a
		// rule that nothing exercised.
		process.stderr.write(
			`[ssrf-report] ${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 1;
	}

	const unknown = rows.filter((row) => row.outcome === 'refused' && !KNOWN_CODES.has(row.code));
	if (unknown.length > 0) {
		process.stderr.write(
			`[ssrf-report] unknown refusal code(s): ${unknown.map((row) => row.code).join(', ')}\n`,
		);
		return 1;
	}
	const unproven = findUnprovenPolicyRow(rows);
	if (unproven) {
		process.stderr.write(
			`[ssrf-report] "${unproven.label}" is policy evidence but measured ${unproven.code}\n`,
		);
		return 1;
	}
	if (rows.length === 0) {
		process.stderr.write('[ssrf-report] the matrix is empty\n');
		return 1;
	}
	const leak = findSecretRow(rows);
	if (leak) {
		process.stderr.write(
			`[ssrf-report] refusing to render a row that looks like a secret: ${leak.label}\n`,
		);
		return 1;
	}

	const html = renderHtml(rows);
	if (htmlDump) {
		await mkdir(dirname(htmlDump), { recursive: true });
		await writeFile(htmlDump, html, 'utf8');
	}

	await mkdir(dirname(OUT), { recursive: true });
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
		await page.setContent(html, { waitUntil: 'load' });
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		);
		if (overflow > 1) {
			process.stderr.write(`[ssrf-report] the report overflows by ${overflow}px\n`);
			return 1;
		}
		const png = await page.screenshot({ fullPage: true });
		await sharp(png)
			.resize({ width: MAX_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(OUT);
	} finally {
		await browser.close();
	}

	const accepted = rows.filter((row) => row.outcome === 'fetched').length;
	process.stdout.write(
		`[ssrf-report] wrote ${OUT} (${rows.length} cases: ${accepted} fetched / ${
			rows.length - accepted
		} refused, ${requested.length} transport calls, all local)\n`,
	);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exit(await main());
}
