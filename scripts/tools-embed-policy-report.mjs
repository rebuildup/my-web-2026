#!/usr/bin/env node
/**
 * Tool embed policy — verification report (Issue #465).
 *
 * Usage:
 *   node scripts/tools-embed-policy-report.mjs [--out=<path>] [--manifest=<path>]
 *
 * Renders a self-contained HTML report of the host's iframe /
 * `postMessage` contract against the CURRENT registry, so the state
 * that the PR screenshot shows can be regenerated at any time instead
 * of being a one-off image nobody can reproduce.
 *
 * Three sections:
 *
 *   1. Verdict per manifest entry — delivery kind, resolved frame
 *      origin, sandbox tokens, referrer policy, message contract, and
 *      every policy violation. This is `evaluateToolEmbedPolicy()`,
 *      the same function `pnpm run tools:check` and the
 *      `/tools/<slug>` route run.
 *   2. Sandbox token classes — which tokens are free, conditional, or
 *      always denied.
 *   3. Hostile message matrix — what the runtime guard does with each
 *      injected `MessageEvent`. The fixtures are object literals; the
 *      Tool window is a plain object, so nothing here reaches a Tool
 *      repository, a Cloudflare resource, or the network.
 *
 * Output defaults to `.tmp/tool-iframe-sandbox.html`. The report is a
 * generated artefact (AGENTS.md §9): it is not committed, only
 * screenshotted into the PR.
 *
 * The assertions behind sections 2 and 3 live in
 * `src/tools/embed-policy.test.ts`; this script only renders them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SANDBOX_TOKENS_CONDITIONAL,
	SANDBOX_TOKENS_FORBIDDEN,
	createToolMessageGuard,
	evaluateToolEmbedPolicy,
	resolveToolFrameSrc,
	toEmbedSubject,
} from '../src/tools/embed-policy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const manifestPath = argOf('--manifest') ?? resolve(root, 'src/tools/manifest.json');
const outPath = argOf('--out') ?? resolve(root, '.tmp/tool-iframe-sandbox.html');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/* ------------------------------------------------------------------ *
 * 1. per-entry verdict
 * ------------------------------------------------------------------ */
const rows = manifest.tools.map((tool) => {
	const subject = toEmbedSubject(tool.slug, tool.delivery);
	return {
		slug: tool.slug,
		kind: tool.delivery.kind,
		frameSrc: resolveToolFrameSrc(tool.delivery) || '—',
		frameOrigin: subject.frame_origin,
		sandbox: tool.delivery.iframe?.sandbox ?? '—',
		referrer: tool.delivery.iframe?.referrer_policy ?? '—',
		message: tool.delivery.host_message
			? `${tool.delivery.host_message.expected_origin} / ${(tool.delivery.host_message.allowed_types ?? []).join(', ')}`
			: 'none (no listener attached)',
		violations: evaluateToolEmbedPolicy(subject),
	};
});

const embedded = rows.filter(
	(r) => r.kind === 'same_origin_static' || r.kind === 'external_exception',
);
const clean = embedded.filter((r) => r.violations.length === 0);

/* ------------------------------------------------------------------ *
 * 2 + 3. token classes and hostile-message matrix
 * ------------------------------------------------------------------ */
const HOST_ORIGIN = 'https://host.invalid'; // fixture host, never contacted
const TOOL_WINDOW = { id: 'tool-iframe-contentWindow' };
const FIXTURE_CONTRACT = {
	expected_origin: 'self',
	allowed_types: ['tool:ready', 'tool:resize'],
};

const dispatched = [];
const guard = createToolMessageGuard({
	slug: 'fixture',
	declaration: FIXTURE_CONTRACT,
	hostOrigin: HOST_ORIGIN,
	toolWindow: TOOL_WINDOW,
	dispatch: (message) => dispatched.push(message),
});

const hostileEvents = [
	{
		label: 'allowlisted type, exact origin, Tool frame window',
		origin: HOST_ORIGIN,
		source: TOOL_WINDOW,
		data: { type: 'tool:ready', payload: { version: 1 } },
		expect: 'accepted',
	},
	{
		label: 'foreign origin, allowlisted type',
		origin: 'https://evil.example',
		source: TOOL_WINDOW,
		data: { type: 'tool:ready' },
		expect: 'rejected',
	},
	{
		label: 'origin that merely starts with the host origin',
		origin: `${HOST_ORIGIN}.evil.example`,
		source: TOOL_WINDOW,
		data: { type: 'tool:ready' },
		expect: 'rejected',
	},
	{
		// NOT a hostile origin: a frame sandboxed WITHOUT
		// `allow-same-origin` (which this policy always denies) runs in
		// an opaque origin and reports "null" — so this is the origin a
		// COMPLIANT same-origin Tool frame actually sends. It is refused
		// precisely because an exact-origin contract cannot be satisfied
		// that way; see `docs/tools/embed-policy.md` §5.
		label: 'opaque origin ("null") — the origin a compliant same-origin Tool frame reports',
		origin: 'null',
		source: TOOL_WINDOW,
		data: { type: 'tool:ready' },
		expect: 'rejected',
	},
	{
		label: 'host origin, but a window that is not the Tool frame',
		origin: HOST_ORIGIN,
		source: { id: 'some-other-window' },
		data: { type: 'tool:ready' },
		expect: 'rejected',
	},
	{
		label: 'host origin, Tool frame, type outside allowed_types',
		origin: HOST_ORIGIN,
		source: TOOL_WINDOW,
		data: { type: 'tool:exfiltrate' },
		expect: 'rejected',
	},
	{
		label: 'host origin, Tool frame, string payload',
		origin: HOST_ORIGIN,
		source: TOOL_WINDOW,
		data: 'tool:ready',
		expect: 'rejected',
	},
	{
		label: 'host origin, Tool frame, array payload',
		origin: HOST_ORIGIN,
		source: TOOL_WINDOW,
		data: ['tool:ready'],
		expect: 'rejected',
	},
];

const matrix = hostileEvents.map((event) => {
	const before = dispatched.length;
	const verdict = guard ? guard(event) : { accepted: false, reason: 'no-guard' };
	const accepted = verdict.accepted === true;
	return {
		...event,
		accepted,
		reason: accepted ? '—' : verdict.reason,
		dispatched: dispatched.length - before,
	};
});

/* ------------------------------------------------------------------ *
 * render
 * ------------------------------------------------------------------ */
const esc = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const verdict = (ok, okText, badText) =>
	`<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? esc(okText) : esc(badText)}</span>`;

const tag = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;

const entryRows = rows
	.map(
		(row) => `<tr>
			<td class="slug">${esc(row.slug)}</td>
			<td>${esc(row.kind)}</td>
			<td><code>${esc(row.frameSrc)}</code><br /><span class="dim">${esc(row.frameOrigin)}</span></td>
			<td><code>${esc(row.sandbox)}</code></td>
			<td><code>${esc(row.referrer)}</code></td>
			<td><span class="dim">${esc(row.message)}</span></td>
			<td>${
				row.kind === 'host_disabled'
					? '<span class="dim">not framed</span>'
					: verdict(
							row.violations.length === 0,
							'allowed',
							row.violations.map((v) => v.code).join(', '),
						)
			}</td>
		</tr>`,
	)
	.join('\n');

const tokenRows = [...SANDBOX_TOKENS_FORBIDDEN, ...SANDBOX_TOKENS_CONDITIONAL, 'allow-scripts']
	.map((token) => {
		const [kind, note] = SANDBOX_TOKENS_FORBIDDEN.has(token)
			? ['bad', 'always rejected — the manifest cannot declare it']
			: SANDBOX_TOKENS_CONDITIONAL.has(token)
				? ['conditional', 'requires iframe.allow + iframe.sandbox_rationale']
				: ['ok', 'declared by every served Tool'];
		return `<tr>
			<td><code>${esc(token)}</code></td>
			<td>${
				kind === 'bad'
					? tag('bad', 'rejected')
					: kind === 'conditional'
						? tag('conditional', 'conditional')
						: tag('ok', 'declared')
			}</td>
			<td><span class="dim">${esc(note)}</span></td>
		</tr>`;
	})
	.join('\n');

const matrixRows = matrix
	.map(
		(row) => `<tr>
			<td>${esc(row.label)}</td>
			<td><code>${esc(row.origin)}</code></td>
			<td><code>${esc(JSON.stringify(row.data))}</code></td>
			<td>${row.accepted ? tag('ok', 'ACCEPTED') : tag('neutral', 'REFUSED')}</td>
			<td>${
				row.reason === '—' ? '<span class="dim">—</span>' : `<code>${esc(row.reason)}</code>`
			}</td>
			<td>${row.dispatched === 0 ? '<span class="dim">0</span>' : tag('ok', String(row.dispatched))}</td>
		</tr>`,
	)
	.join('\n');

const acceptedCount = matrix.filter((r) => r.accepted).length;
const rejectedCount = matrix.length - acceptedCount;

// The report is also a self-check: a fixture whose verdict drifts from
// its expectation means the guard changed behaviour, and a screenshot
// that quietly showed the new behaviour would be a lie. Fail loudly
// instead.
const drifted = matrix.filter((r) => r.accepted !== (r.expect === 'accepted'));
const leaked = matrix.filter((r) => !r.accepted && r.dispatched > 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Tool embed policy — verification report (Issue #465)</title>
<style>
	:root {
		color-scheme: light;
		--ink: #14171f;
		--dim: #6b7280;
		--line: #e2e5ea;
		--ok-bg: #e7f6ec;
		--ok-ink: #136c3a;
		--bad-bg: #fdeaea;
		--bad-ink: #a3161b;
		--warn-bg: #fdf3e2;
		--warn-ink: #8a5a06;
	}
	* { box-sizing: border-box; }
	body {
		margin: 0;
		padding: 40px 44px 56px;
		background: #fff;
		color: var(--ink);
		font: 14px/1.55 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, "Noto Sans JP", sans-serif;
	}
	h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -0.01em; }
	h2 { font-size: 15px; margin: 32px 0 10px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--dim); }
	p.sub { margin: 0 0 4px; color: var(--dim); max-width: 900px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
	.dim { color: var(--dim); font-size: 12px; }
	table { border-collapse: collapse; width: 100%; margin-top: 8px; }
	th, td { border-bottom: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
	th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); font-weight: 600; }
	td.slug { font-weight: 600; white-space: nowrap; }
	.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
	.badge.ok { background: var(--ok-bg); color: var(--ok-ink); }
	.badge.bad { background: var(--bad-bg); color: var(--bad-ink); }
	.badge.neutral { background: #eef0f3; color: #414a5a; }
	.badge.conditional { background: var(--warn-bg); color: var(--warn-ink); }
	.stats { display: flex; gap: 28px; margin: 18px 0 4px; }
	.stat { border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; min-width: 150px; }
	.stat .n { font-size: 22px; font-weight: 700; }
	.stat .l { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
	footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--dim); font-size: 12px; }
</style>
</head>
<body>
<h1>Tool embed policy — verification report</h1>
<p class="sub">
	Generated by <code>scripts/tools-embed-policy-report.mjs</code> from
	<code>src/tools/manifest.json</code> and
	<code>src/tools/embed-policy.ts</code>. The same policy function gates
	<code>pnpm run tools:check</code> at build time and the
	<code>/tools/&lt;slug&gt;</code> route per request; this report renders the
	current verdict of both. No Tool repository, Cloudflare resource, or network
	endpoint is contacted.
</p>

<div class="stats">
	<div class="stat"><div class="n">${manifest.tools.length}</div><div class="l">manifest entries</div></div>
	<div class="stat"><div class="n">${embedded.length}</div><div class="l">embeddable (framed)</div></div>
	<div class="stat"><div class="n">${clean.length}</div><div class="l">policy-clean</div></div>
	<div class="stat"><div class="n">${acceptedCount} / ${rejectedCount}</div><div class="l">message fixture accepted / rejected</div></div>
</div>

<h2>1 · Per-entry verdict</h2>
<table>
	<thead><tr><th>slug</th><th>delivery.kind</th><th>frame src / origin</th><th>sandbox</th><th>referrerpolicy</th><th>host_message</th><th>verdict</th></tr></thead>
	<tbody>
${entryRows}
	</tbody>
</table>

<h2>2 · Sandbox token classes</h2>
<table>
	<thead><tr><th>token</th><th>verdict</th><th>requirement</th></tr></thead>
	<tbody>
${tokenRows}
	</tbody>
</table>

<h2>3 · Hostile message matrix (contract fixture, no live Tool declares it)</h2>
<p class="sub">
	Each row is an injected <code>MessageEvent</code> delivered to
	<code>createToolMessageGuard()</code> with
	<code>expected_origin: "self"</code>, allowed types
	<code>tool:ready</code> / <code>tool:resize</code>. “Host dispatch” counts how
	many times the host action ran. Today no manifest Tool declares
	<code>host_message</code>, so the production host attaches <strong>no</strong>
	listener at all and every row here is refused a fortiori.
</p>
<p class="sub">
	Note the <code>"null"</code> row: this policy always denies
	<code>allow-same-origin</code>, so a same-origin Tool frame is
	<em>opaque-origin</em> and reports <code>event.origin === "null"</code>. That
	row is therefore the compliant frame's own origin, not a hostile one —
	and it is why a <code>"self"</code> contract cannot be satisfied by a
	<code>same_origin_static</code> Tool. Changing that needs an ADR decision
	(<code>docs/tools/embed-policy.md</code> §5).
</p>
<table>
	<thead><tr><th>injected event</th><th>event.origin</th><th>event.data</th><th>verdict</th><th>reason</th><th>host dispatch</th></tr></thead>
	<tbody>
${matrixRows}
	</tbody>
</table>

<footer>
	Contract: <code>src/tools/embed-policy.ts</code> · Tests:
	<code>src/tools/embed-policy.test.ts</code>,
	<code>scripts/check-tools-manifest.test.mjs</code> · Build gate:
	<code>pnpm run tools:check</code> · Issue #465
</footer>
</body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
process.stdout.write(
	`[tools-embed-policy-report] ${manifest.tools.length} entries, ${clean.length}/${embedded.length} embeddable entries policy-clean, ${acceptedCount} accepted / ${rejectedCount} rejected message fixtures\n[tools-embed-policy-report] wrote ${outPath}\n`,
);

if (drifted.length > 0 || leaked.length > 0) {
	process.stderr.write(
		`[tools-embed-policy-report] ${drifted.length} fixture(s) drifted from their expected verdict and ${leaked.length} rejected message(s) reached the host action.\n`,
	);
	for (const row of drifted) {
		process.stderr.write(`  expected ${row.expect}: ${row.label}\n`);
	}
	process.exit(1);
}

function argOf(name) {
	for (const a of args) {
		if (a.startsWith(`${name}=`)) return resolve(root, a.slice(name.length + 1));
	}
	return null;
}
