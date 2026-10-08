#!/usr/bin/env node
/**
 * `cf-build-status.mjs` — repository-owned status-only view of a
 * Cloudflare Workers Builds run (Issue #247).
 *
 * Why this exists
 * ---------------
 * The last release was blocked by several separate Workers Builds
 * failures. Each was diagnosed by reading the build log, and the
 * dashboard was the wrong tool every time: it needs an interactive
 * login, sits behind a bot challenge for automation, and its output
 * cannot be diffed or asserted on.
 *
 * The Builds API is the correct surface. This helper wraps it so that
 * production diagnosis becomes:
 *
 *     repository helper -> Cloudflare Builds API
 *
 * instead of Dashboard / browser automation. It is read-only and
 * status-only: it never prints a secret value, never accepts a
 * credential in argv, and never mutates anything.
 *
 * Usage
 * -----
 *     # from a commit SHA, a PR, or an explicit build UUID
 *     node scripts/cf-build-status.mjs a581a39
 *     node scripts/cf-build-status.mjs 7681b516-d11e-4a39-a351-fce74ac4d5cb
 *     node scripts/cf-build-status.mjs --limits
 *     node scripts/cf-build-status.mjs a581a39 --json
 *
 * Authentication
 * --------------
 * Reads `CLOUDFLARE_API_TOKEN` from the environment. In this repository
 * that credential is managed by Infisical, so the canonical invocation
 * is:
 *
 *     infisical run --env dev --path / -- node scripts/cf-build-status.mjs <sha>
 *
 * The token is only ever read from `process.env` and used as a request
 * header. It is never echoed, never placed in argv, and never written
 * to a file.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_ID } from './_cloudflare-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const INFISICAL_JSON_PATH = join(REPO_ROOT, '.infisical.json');
const INFISICAL_DOMAIN = 'https://secrets.rebuildup.dev';
const INFISICAL_PROJECT_FALLBACK = '89cda9cb-31ab-4ace-afe9-f155024850d1';

const MAX_LOG_PAGES = 200;

/**
 * The Cloudflare account that owns this Worker.
 *
 * Issue #247: imported from `_cloudflare-identity.mjs` rather than
 * regexed out of a config file. The previous reader tried three files
 * in order and silently skipped whichever did not match, so a renamed
 * config or a reworded key produced "account not found" instead of a
 * wrong account — and an env override won outright, so a stray
 * CLOUDFLARE_ACCOUNT_ID pointed every Builds query at another account.
 *
 * An override is now accepted only when it REPEATS the canonical id.
 */
function readAccountId() {
	const override = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (override && override !== ACCOUNT_ID) {
		throw new Error(
			`CLOUDFLARE_ACCOUNT_ID=${override} does not match the canonical account ${ACCOUNT_ID}. This repository owns one account; an override may not retarget Builds diagnosis.`,
		);
	}
	return ACCOUNT_ID;
}

/** Infisical project id for the `--projectId` flag. */
function readProjectId() {
	if (existsSync(INFISICAL_JSON_PATH)) {
		const cfg = JSON.parse(readFileSync(INFISICAL_JSON_PATH, 'utf8'));
		if (typeof cfg.workspaceId === 'string' && cfg.workspaceId.length > 0) return cfg.workspaceId;
	}
	if (process.env.INFISICAL_PROJECT_ID) return process.env.INFISICAL_PROJECT_ID;
	return INFISICAL_PROJECT_FALLBACK;
}

function authHeaders() {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!token) {
		throw new Error(
			'CLOUDFLARE_API_TOKEN is not set. Run under `infisical run --env dev --path / --` ' +
				'so the Infisical-managed credential is injected into the child environment.',
		);
	}
	return { Authorization: `Bearer ${token}` };
}

async function cfGet(path) {
	const res = await fetch(`${CLOUDFLARE_API}${path}`, { headers: authHeaders() });
	const body = await res.json().catch(() => null);
	if (!res.ok || body?.success === false) {
		const msg = JSON.stringify(body?.errors ?? res.status).slice(0, 300);
		throw new Error(`Cloudflare API ${path} failed (HTTP ${res.status}): ${msg}`);
	}
	return body.result;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a commit SHA / branch / PR to a Workers Builds UUID via GitHub. */
export function resolveBuildUuidViaGitHub(ref) {
	const out = execFileSync(
		'gh',
		[
			'api',
			`repos/${repoSlug()}/commits/${ref}/check-runs`,
			'--jq',
			'.check_runs[] | select(.name | test("Workers Builds")) | .output.summary',
		],
		{ encoding: 'utf8', timeout: 60_000 },
	);
	const m = out.match(/builds\/([0-9a-f-]{36})/i);
	if (!m) {
		throw new Error(
			`No Workers Builds check-run found for "${ref}". The commit may not have triggered a build.`,
		);
	}
	return m[1];
}

function repoSlug() {
	return process.env.GITHUB_REPOSITORY ?? 'rebuildup/my-web-2026';
}

export async function getBuildMetadata(accountId, buildUuid) {
	return cfGet(`/accounts/${accountId}/builds/builds/${buildUuid}`);
}

/**
 * Fetch every page of a build's logs. Returns the merged, time-sorted
 * lines plus whether the API ever reported truncation.
 */
export async function getBuildLogs(accountId, buildUuid) {
	const lines = [];
	let cursor = null;
	let pages = 0;
	let sawTruncated = false;
	let repeatedCursor = null;
	let hasMore = true;

	// Termination is explicit: the loop stops when the API stops
	// handing back a fresh cursor, when it echoes the cursor we just
	// used, or at MAX_LOG_PAGES. A repeated cursor means the API is
	// not advancing, and continuing would page forever.
	while (hasMore) {
		const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
		const page = await cfGet(`/accounts/${accountId}/builds/builds/${buildUuid}/logs${qs}`);
		lines.push(...(page?.lines ?? []));
		if (page?.truncated) sawTruncated = true;
		const next = page?.cursor ?? null;
		pages += 1;
		hasMore = Boolean(next) && next !== cursor && next !== repeatedCursor && pages < MAX_LOG_PAGES;
		repeatedCursor = cursor;
		cursor = next;
	}

	lines.sort((a, b) => a[0] - b[0]);
	return { lines, pages, truncated: sawTruncated };
}

export async function getBuildLimits(accountId) {
	return cfGet(`/accounts/${accountId}/builds/account/limits`);
}

/* ── Status-only log analysis ─────────────────────────────────────────── */

/**
 * Reduce a log line to a status-only shape. Anything that looks like a
 * credential is replaced before it can reach stdout, a file, or CI.
 */
export function redactLine(line) {
	return (
		String(line)
			// `KEY=value` / `KEY: value` where KEY names a credential.
			.replace(
				/(\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)[A-Za-z0-9_]*\s*[=:]\s*)(\S+)/gi,
				'$1<redacted>',
			)
			// Authorization headers and bearer tokens.
			.replace(/(Authorization:\s*Bearer\s+)(\S+)/gi, '$1<redacted>')
			.replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/g, 'Bearer <redacted>')
			// Cookies.
			.replace(/(set-cookie:\s*)([^\n]*)/gi, '$1<redacted>')
	);
}

/** Lines that indicate the build gave up. First match is the failure point. */
const FAILURE_PATTERNS = [
	// Observed signatures from a real release window, most specific
	// first so the reported cause is the root, not a downstream symptom.
	{ re: /error occurred while running (build|deploy) command/i, kind: 'command' },
	{ re: /^Failed:?\s/i, kind: 'command' },
	{ re: /\[FAIL\]/i, kind: 'check' },
	{ re: /Command failed with exit code (\d+)/i, kind: 'command' },
	{ re: /\[ELIFECYCLE\] Command failed/i, kind: 'command' },
	{ re: /\bfailed:\s/i, kind: 'command' },
	{ re: /Unhandled Error/i, kind: 'runtime' },
	{ re: /(?:ReferenceError|TypeError|SyntaxError):/i, kind: 'runtime' },
	{ re: /Cannot find module/i, kind: 'runtime' },
	{ re: /^error(?:\[[A-Z0-9]+\])?:/i, kind: 'runtime' },
];

/**
 * Locate the stage that failed, and the first error line inside it.
 * Pure function over `[[ts, message], ...]` so it is unit-testable
 * without any network access.
 */
export function analyseFailure(lines) {
	if (lines.length === 0) {
		return { stage: null, failed: false, firstError: null, exitCode: null, context: [] };
	}
	const t0 = lines[0][0];
	const redacted = lines.map(([ts, msg]) => [ts, redactLine(msg)]);

	// Stage boundaries, in the order the build runs them.
	const stageMarkers = [
		{ name: 'build', re: /Installing project dependencies|Detected the following tools/i },
		{ name: 'deploy', re: /deploy-with-secrets|Running .*deploy command/i },
		{ name: 'test', re: /Running .*test/i },
	];

	let failIdx = -1;
	let kind = null;
	for (let i = 0; i < redacted.length; i++) {
		for (const p of FAILURE_PATTERNS) {
			if (p.re.test(redacted[i][1])) {
				failIdx = i;
				kind = p.kind;
				break;
			}
		}
		if (failIdx !== -1) break;
	}

	if (failIdx === -1) {
		return { stage: null, failed: false, firstError: null, exitCode: null, context: [] };
	}

	let stage = null;
	for (let i = failIdx; i >= 0; i--) {
		for (const m of stageMarkers) {
			if (m.re.test(redacted[i][1])) {
				stage = m.name;
				break;
			}
		}
		if (stage) break;
	}

	const firstError = redacted[failIdx][1];
	const exitMatch = firstError.match(/exit(?:ed)?(?:\s+with)?\s*(?:code[= ])?(\d+)/i);
	const exitCode = exitMatch ? Number(exitMatch[1]) : null;

	const from = Math.max(0, failIdx - 4);
	const context = redacted.slice(from, Math.min(redacted.length, failIdx + 2)).map(([ts, m]) => ({
		at: `+${((ts - t0) / 1000).toFixed(1)}s`,
		line: m,
	}));

	return { stage, failed: true, firstError, exitCode, kind, context };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
	const opts = { json: false, limits: false };
	const positional = [];
	for (const a of argv) {
		if (a === '--json') opts.json = true;
		else if (a === '--limits') opts.limits = true;
		else if (a === '--help' || a === '-h') opts.help = true;
		else positional.push(a);
	}
	opts.ref = positional[0] ?? null;
	return opts;
}

const USAGE = `cf-build-status — read-only Cloudflare Workers Builds status

  node scripts/cf-build-status.mjs <sha|build-uuid>   resolve + report
  node scripts/cf-build-status.mjs --limits           build-minute limits only
  node scripts/cf-build-status.mjs <sha> --json       machine-readable

Requires CLOUDFLARE_API_TOKEN in the environment (Infisical-managed).
Prints status only. Never prints secret values.`;

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help || (!opts.ref && !opts.limits)) {
		console.log(USAGE);
		return;
	}

	const accountId = readAccountId();

	if (opts.limits) {
		const limits = await getBuildLimits(accountId);
		const clean = JSON.parse(redactLine(JSON.stringify(limits)));
		console.log(opts.json ? JSON.stringify(clean, null, 2) : JSON.stringify(clean, null, 2));
		return;
	}

	const buildUuid = UUID_RE.test(opts.ref) ? opts.ref : resolveBuildUuidViaGitHub(opts.ref);

	const meta = await getBuildMetadata(accountId, buildUuid);
	const { lines, pages, truncated } = await getBuildLogs(accountId, buildUuid);
	const analysis = analyseFailure(lines);

	const report = {
		build_uuid: buildUuid,
		status: meta?.status ?? null,
		outcome: meta?.build_outcome ?? null,
		created_on: meta?.created_on ?? null,
		running_on: meta?.running_on ?? null,
		stopped_on: meta?.stopped_on ?? null,
		commit: meta?.build_trigger_metadata?.commit_hash ?? null,
		build_command: meta?.build_trigger_metadata?.build_command ?? null,
		deploy_command: meta?.build_trigger_metadata?.deploy_command ?? null,
		log: { lines: lines.length, pages, truncated },
		failure: {
			failed: analysis.failed,
			stage: analysis.stage,
			exit_code: analysis.exitCode,
			first_error: analysis.firstError,
			context: analysis.context,
		},
	};

	if (opts.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	console.log(`build   ${report.build_uuid}`);
	console.log(`commit  ${(report.commit ?? '').slice(0, 12)}`);
	console.log(`status  ${report.status} / ${report.outcome}`);
	if (report.running_on && report.stopped_on) {
		const secs = (Date.parse(report.stopped_on) - Date.parse(report.running_on)) / 1000;
		console.log(`window  ${secs.toFixed(1)}s (${report.running_on} -> ${report.stopped_on})`);
	}
	console.log(
		`logs    ${report.log.lines} lines / ${report.log.pages} page(s), truncated=${report.log.truncated}`,
	);
	if (report.failure.failed) {
		console.log(
			`\nFAILED at stage: ${report.failure.stage ?? 'unknown'} (${report.failure.kind ?? 'error'})`,
		);
		if (report.failure.exit_code !== null) console.log(`exit code: ${report.failure.exit_code}`);
		console.log(`first error: ${report.failure.first_error}`);
		console.log('\n--- context ---');
		for (const c of report.failure.context) console.log(`  [${c.at}] ${c.line}`);
	} else {
		console.log('\nNo failure signature found in the log.');
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`cf-build-status failed: ${error?.message ?? error}`);
		process.exit(1);
	});
}
