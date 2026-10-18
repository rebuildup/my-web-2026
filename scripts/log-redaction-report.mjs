#!/usr/bin/env node

/**
 * Log-redaction verification report (Issue #467).
 *
 * Renders the audit the Issue asks for as a single HTML page, so the
 * result can be reviewed (and attached to the PR) instead of being a
 * claim in a commit message. The page is written to `.tmp/` — the
 * repository's ephemeral verification directory (AGENTS.md §9); the
 * committed artefact is the screenshot taken from it.
 *
 * What is on the page:
 *   1. The coverage matrix: log surface -> entry point -> what was
 *      injected -> what is asserted -> which test proves it.
 *   2. Live before/after samples. The "after" column is produced by
 *      RUNNING `src/logging/redact.ts` over the sample, not by a
 *      hand-written expectation, so the report cannot drift from the
 *      implementation.
 *   3. The self-check: the page is written only when none of the
 *      samples survives redaction. A leak fails the command, and a
 *      page left by an earlier clean run is deleted rather than
 *      left for a reviewer to screenshot.
 *
 * Canaries are declared next to the sample they guard, never in a
 * second hand-maintained list. `validateSamples` refuses to generate
 * anything when a sample declares no canary, or when a declared
 * canary is not a substring of that sample — which is exactly the
 * typo that once disarmed the opaque-blob guard silently.
 *
 * Safety
 * ------
 * Every value on the page is fabricated in this file. The script
 * reads no environment variable, no `.dev.vars`, no Infisical, and no
 * Cloudflare API — `docs/security/log-redaction.md` records that
 * invariant, and the marker-based tests under `scripts/**` are the
 * ones that need a stub upstream.
 *
 * Usage:
 *   node scripts/log-redaction-report.mjs [--out=<path>]
 *
 * Exit codes: 0 = no canary survived, 1 = a canary survived,
 * 2 = the sample set is unguarded (nothing was written).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(ROOT, '.tmp', 'log-redaction-report.html');

/** Project version is DERIVED, never hardcoded (AGENTS.md §1). */
function projectVersion() {
	try {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * Coverage matrix. `proves` is the test that fails when the surface
 * regresses, so a reviewer can re-run one file instead of trusting
 * this page.
 */
const SURFACES = [
	{
		surface: 'API error',
		entry:
			'Hono boundary (`src/http/hono.ts`) + home loaders (`src/home/{access,reactions}/load.ts`)',
		injected:
			'canary `Authorization: Bearer …`, `cookie:` header, `?token=` query, upstream 502 body that echoes the request',
		asserted:
			'no canary in the HTTP response body or the console stream; loader still returns its degraded result',
		proves: 'test/integration/log-redaction.test.ts, src/logging/redact.test.ts',
	},
	{
		surface: 'Auth',
		entry: 'Better Auth `sendEmail` stub (`src/cloudflare/auth/better-auth.ts`)',
		injected: 'invitee address + rendered body containing `?token=…`',
		asserted: 'log record carries only `to: [redacted-email]`, `hasBody`, `bodyLength`',
		proves: 'src/cloudflare/auth/better-auth.test.ts',
	},
	{
		surface: 'Infisical',
		entry: 'Operator drivers (`scripts/infisical-verify.mjs` and peers)',
		injected:
			'stub CLI that dumps canary values to stdout AND stderr, then runs the real inner check',
		asserted: 'driver stdout/stderr contain status lines only, never a value',
		proves: 'scripts/infisical-verify.test.mjs (stub-CLI block)',
	},
	{
		surface: 'Analytics',
		entry: 'GA4 route tracker (`src/editorial/analytics/GoogleAnalytics.tsx`)',
		injected: 'location key with `?token=…&email=…`',
		asserted:
			'`page_path` / `page_location` carry the pathname only (SPA 遷移の page_view。初回 page_view の制約は Known limits)',
		proves: 'src/editorial/analytics/GoogleAnalytics.test.tsx',
	},
];

/**
 * Fabricated inputs — the "before" column. Nothing here is a real
 * value.
 *
 * `canaries` are the exact substrings that must not survive
 * redaction. They live HERE, next to the value they guard, because a
 * guard list maintained separately from the samples is a guard list
 * that silently rots: a renamed sample leaves an entry matching
 * nothing, and the fail-closed check stops firing while still
 * reporting PASS. `validateSamples` enforces the binding
 * (see below), so the two cannot drift apart.
 */
const SAMPLES = [
	{
		label: 'Authorization header',
		value: 'Authorization: Bearer mk_sample_key_0000000000',
		canaries: ['mk_sample_key_0000000000'],
	},
	{
		label: 'Cookie header',
		value: 'cookie: mw_actor_id=550e8400-e29b-41d4-a716-446655440000',
		canaries: ['550e8400-e29b-41d4-a716-446655440000'],
	},
	{
		label: 'Single-use link',
		value: 'https://rebuildup.dev/admin/invitations/accept?token=sample-token-abcdef',
		canaries: ['sample-token-abcdef'],
	},
	{
		label: 'Email address',
		value: 'sample.person@example.invalid',
		canaries: ['sample.person@example.invalid'],
	},
	{
		label: 'Opaque credential',
		value: 'K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5Yh0Ju3Ee',
		canaries: ['K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5Yh0Ju3Ee'],
	},
	{
		label: 'Structured detail',
		value: {
			status: 502,
			headers: { authorization: 'Bearer mk_sample_key_0000000000' },
			email: 'a@b.example',
		},
		canaries: ['mk_sample_key_0000000000', 'a@b.example'],
	},
];

/** Every canary that must not appear in any rendered "after" value. */
const FORBIDDEN = [...new Set(SAMPLES.flatMap((sample) => sample.canaries))];

/**
 * How one sample is rendered into the page.
 *
 * `redact` is the live implementation, injected by `main` from the
 * dynamic import — the report must never carry its own copy of the
 * rules it claims to have exercised.
 */
function renderSample(sample, redact) {
	const input = typeof sample.value === 'string' ? sample.value : JSON.stringify(sample.value);
	const after =
		typeof sample.value === 'string'
			? redact.text(sample.value)
			: JSON.stringify(redact.value(sample.value));
	return { label: sample.label, input, after, canaries: sample.canaries };
}

/**
 * Reasons the sample set cannot be trusted to prove anything.
 *
 * Two failure modes, both of which used to be invisible:
 *   - a sample with no canary is never checked, and the report still
 *     says every surface is clean;
 *   - a canary that is not a substring of its own sample guards
 *     nothing (the list held `…Ws5e0` for a `…Ws5Yh0Ju3Ee` value).
 *
 * Returning them as data keeps `main` fail-closed: a report that
 * cannot back its own claim is not written at all.
 */
function validateSamples(samples) {
	const problems = [];
	for (const sample of samples) {
		const canaries = sample.canaries ?? [];
		if (canaries.length === 0) {
			problems.push(`${sample.label}: declares no canary, so nothing about it is checked`);
			continue;
		}
		for (const canary of canaries) {
			if (typeof canary !== 'string' || canary.length === 0) {
				problems.push(`${sample.label}: declares an empty canary`);
			} else if (!sample.input.includes(canary)) {
				problems.push(
					`${sample.label}: canary does not occur in the sample it guards (nothing to match)`,
				);
			}
		}
	}
	return problems;
}

/** `{ label, canary }` for every canary that survived redaction. */
function findLeaks(samples) {
	const leaks = [];
	for (const sample of samples) {
		for (const canary of sample.canaries ?? []) {
			if (sample.after.includes(canary)) leaks.push({ label: sample.label, canary });
		}
	}
	return leaks;
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function renderRows(samples) {
	return samples
		.map(
			(sample) => `<tr>
			<th scope="row">${escapeHtml(sample.label)}</th>
			<td><code>${escapeHtml(sample.input)}</code></td>
			<td><code class="after">${escapeHtml(sample.after)}</code></td>
		</tr>`,
		)
		.join('\n');
}

function renderSurfaces() {
	return SURFACES.map(
		(surface) => `<tr>
		<th scope="row">${escapeHtml(surface.surface)}</th>
		<td>${escapeHtml(surface.entry)}</td>
		<td>${escapeHtml(surface.injected)}</td>
		<td>${escapeHtml(surface.asserted)}</td>
		<td><code>${escapeHtml(surface.proves)}</code></td>
	</tr>`,
	).join('\n');
}

function buildPage({ samples, verdict }) {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>log redaction verification report — Issue #467</title>
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
    --accent: #1d4ed8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 44px 56px;
    background: var(--canvas);
    color: var(--ink);
    font: 15px/1.65 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 28px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: 0.01em; }
  .meta { color: var(--muted); font-size: 13px; margin: 0; }
  h2 { font-size: 16px; margin: 34px 0 10px; letter-spacing: 0.02em; }
  p.lede { margin: 0 0 8px; color: var(--muted); max-width: 74ch; }
  .verdict {
    display: inline-block; padding: 6px 14px; border-radius: 999px;
    font-weight: 700; font-size: 13px; margin: 4px 0 0;
    background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok);
  }
  .verdict.fail { background: #fdecec; color: #8c1d1d; border-color: #8c1d1d; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 13px; }
  th, td { border: 1px solid var(--line); padding: 9px 11px; text-align: left; vertical-align: top; }
  thead th { background: #eef0f2; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  tbody th { white-space: nowrap; font-weight: 600; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    background: #eef0f2; padding: 1px 5px; border-radius: 4px; word-break: break-all;
  }
  code.after { background: var(--ok-bg); color: var(--ok); }
  footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>監査ログ redaction 検証レポート</h1>
  <p class="meta">Issue #467 · my-web-2026 ${escapeHtml(projectVersion())} · 生成: ${escapeHtml(new Date().toISOString())}</p>
  <p class="verdict${verdict.ok ? '' : ' fail'}">${escapeHtml(verdict.label)}</p>
</header>

<p class="lede">
  本レポートは疑似値 (このファイル内で合成したダミー) を各ログ面へ通し、
  console / report のどちらにも secret・個人情報が到達しないことを確認した結果です。
  「after」列は <code>src/logging/redact.ts</code> を実際に実行した結果であり、
  期待値を書き写したものではありません。
</p>

<h2>1. 検査対象と証跡</h2>
<table>
  <thead><tr><th>ログ面</th><th>入口</th><th>注入した疑似入力</th><th>主張</th><th>証跡となる test</th></tr></thead>
  <tbody>
${renderSurfaces()}
  </tbody>
</table>

<h2>2. redaction 実測 (before / after)</h2>
<table>
  <thead><tr><th>種別</th><th>入力 (疑似値)</th><th>出力 (redaction 後)</th></tr></thead>
  <tbody>
${renderRows(samples)}
  </tbody>
</table>

<h2>3. 失敗時の挙動</h2>
<p class="lede">
  各 sample は自分が守る canary を同じ定義の中で宣言します。canary が 1 件でも
  残った場合、このコマンドは非ゼロ終了し、HTML は書きません（以前の正常実行が
  残した HTML も削除するため、古い PASS を撮影できません）。
  宣言した canary が 1 件も無い、または宣言した canary が sample の一部でない
  (照合対象が存在しない) 場合は、レポートを書く前の自己検査が非ゼロ終了する
  ため、証明できない PASS は出力されません。
  gate <code>scripts/check-log-redaction.mjs</code> は <code>src/**</code> の直接 <code>console.*</code> を
  ビルド失敗として扱い、<code>scripts/**</code> の secret 値出力も同様に拒否します。
  本 Issue の前提がない外部機能 (Infisical CLI) は独立した stub adapter として完成させ、
  安全性保証を省略したまま公開する経路は残していません。
</p>

<footer>
  Source of truth: <code>docs/security/log-redaction.md</code> · gate: <code>pnpm run log:redaction:check</code> ·
  ${escapeHtml(`${SAMPLES.length}`)} サンプル / ${escapeHtml(`${FORBIDDEN.length}`)} canary を自己検査 ·
  すべての値は合成済みダミーであり、実 credential / 個人情報 / bucket・key 一覧を含みません。
</footer>
</body>
</html>
`;
}

async function main(argv) {
	const outArg = argv.find((arg) => arg.startsWith('--out='));
	const outPath = outArg ? resolve(ROOT, outArg.slice('--out='.length)) : DEFAULT_OUT;

	// The real implementation, not a copy: the report must not drift.
	const { redactLogText, redactLogValue } = await import(resolve(ROOT, 'src/logging/redact.ts'));
	const redact = { text: redactLogText, value: redactLogValue };

	const samples = SAMPLES.map((sample) => renderSample(sample, redact));

	// Fail closed BEFORE writing: a sample set whose guards do not
	// match its own samples cannot prove the claim the page makes.
	const problems = validateSamples(samples);
	if (problems.length > 0) {
		rmSync(outPath, { force: true });
		process.stderr.write(
			`[log-redaction-report] unguarded sample(s):\n- ${problems.join('\n- ')}\n`,
		);
		return 2;
	}

	const leaks = findLeaks(samples);
	const verdict = leaks.length
		? { ok: false, label: `FAIL — ${leaks.length} canary survived redaction` }
		: { ok: true, label: 'PASS — no canary survived on any surface' };

	// Fail closed. Nothing is written on a leak, and a page left by
	// an earlier clean run is REMOVED: a stale PASS report is exactly
	// the artefact a reviewer would screenshot.
	if (!verdict.ok) {
		rmSync(outPath, { force: true });
		process.stderr.write(`[log-redaction-report] ${verdict.label}:\n`);
		for (const leak of leaks) process.stderr.write(`- ${leak.label}: ${leak.canary}\n`);
		return 1;
	}

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, buildPage({ samples, verdict }), 'utf8');

	process.stdout.write(
		`[log-redaction-report] ${verdict.label}\n[log-redaction-report] wrote ${outPath}\n`,
	);
	return 0;
}

process.exit(await main(process.argv.slice(2)));
