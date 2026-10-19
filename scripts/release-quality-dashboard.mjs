#!/usr/bin/env node

/**
 * Release quality dashboard (Issue #493).
 *
 * What this is
 * ------------
 * A single HTML page that aggregates the **valid outputs this checkout
 * already has** for every quality signal the repository claims, and
 * says plainly — per signal — whether that output exists, what its
 * verdict was, and under which conditions it was produced.
 *
 * What this is deliberately NOT
 * -----------------------------
 * It is not a gate, not a benchmark, and not a visualisation of
 * numbers it invented. Nothing here runs a quality check, re-implements
 * a check, or converts "no output" into a number. The verdict always
 * comes from someone else's exit code or from an artefact somebody else
 * wrote; the dashboard only decides whether that output is *present*,
 * *current* and *parseable enough to quote*.
 *
 * The four states (and why "missing" can never read as PASS)
 * ----------------------------------------------------------
 *   PASS          a run record exists for this source SHA, the signal's
 *                 command exited 0, and every artefact the roster
 *                 declares as evidence is present on disk.
 *   FAIL          a run record exists for this source SHA and the
 *                 command exited non-zero. The exit code is printed;
 *                 the stdout is NOT (it can carry a secret value).
 *   NOT RUN       no valid output for this signal in this checkout:
 *                 no run record, a record from a different source SHA,
 *                 the signal was skipped (it needs a build / network /
 *                 browser), or the declared report is missing. Each of
 *                 those prints which one it was.
 *   N/A           the signal has no runner yet (`state: planned` in
 *                 `quality/route-coverage.json`). An unimplemented
 *                 measurement is not a pass, so it is never counted in
 *                 the PASS column and never blocks anything.
 *
 * The "no false PASS" property is the acceptance criterion, so it is
 * structural rather than incidental: `classifySignal` is a pure
 * function, every branch that lacks a positive signal returns
 * `not_run`, and the renderer can only print the status it is given.
 * A missing report has no branch that reaches `pass`.
 *
 * Reproduction conditions (AGENTS.md §5 / Issue #493 acceptance)
 * -------------------------------------------------------------
 * The page carries an environment block — browser engine, network,
 * CPU model / core count, Node, platform, runner (local vs CI), and
 * the source SHA the verdicts belong to. Those are the conditions a
 * reviewer needs to reproduce or to refuse the comparison; a verdict
 * recorded against another SHA is reported NOT RUN for exactly that
 * reason.
 *
 * Inputs (read-only; nothing is fetched, no Worker is started, no
 * secret is read):
 *   - `quality/release-dashboard.json`      — the signal roster
 *   - `quality/route-coverage.json`         — implemented / planned state
 *   - `quality/release-gate.json`           — the release-gate ledger (#508)
 *   - `.tmp/release-quality-runs.json`      — the run record
 *                                             (`pnpm run quality:dashboard:record`)
 *
 * Usage:
 *   node scripts/release-quality-dashboard.mjs
 *   node scripts/release-quality-dashboard.mjs --report=.tmp/release-quality-dashboard.html
 *
 * Exit codes: 0 = roster is well-formed (regardless of how many signals
 * are NOT RUN — absence is a fact, not a failure), 1 = malformed roster
 * / unreadable input, 2 = bad CLI input.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_ROSTER_PATH = 'quality/release-dashboard.json';
export const DEFAULT_FAMILIES_PATH = 'quality/route-coverage.json';
export const DEFAULT_RUN_RECORD_PATH = '.tmp/release-quality-runs.json';
export const DEFAULT_RELEASE_GATE_PATH = 'quality/release-gate.json';

/** Status vocabulary. Nothing outside this set may reach the renderer. */
export const STATUS = {
	PASS: 'pass',
	FAIL: 'fail',
	NOT_RUN: 'not_run',
	NOT_APPLICABLE: 'not_applicable',
};

const STATUS_LABELS = {
	[STATUS.PASS]: 'PASS',
	[STATUS.FAIL]: 'FAIL',
	[STATUS.NOT_RUN]: 'NOT RUN',
	[STATUS.NOT_APPLICABLE]: 'N/A (未実装)',
};

const REQUIREMENTS = new Set(['build', 'network', 'browser', 'worker']);
const EVIDENCE_KINDS = new Set(['exit_code', 'artefact']);

/**
 * Read + validate the roster and the family ledger.
 *
 * The roster is a reviewable contract, so a malformed one fails loudly
 * instead of rendering an empty dashboard that looks calm.
 *
 * @returns {{ errors: string[], roster: object|null, families: object|null }}
 */
export function loadRoster({
	root = REPO_ROOT,
	rosterPath = DEFAULT_ROSTER_PATH,
	familiesPath = DEFAULT_FAMILIES_PATH,
	releaseGatePath = DEFAULT_RELEASE_GATE_PATH,
} = {}) {
	const errors = [];
	const roster = readJson(resolve(root, rosterPath), rosterPath, errors);
	const families = readJson(resolve(root, familiesPath), familiesPath, errors);
	const releaseGate = roster?.release_gate_ledger
		? readJson(resolve(root, roster.release_gate_ledger), roster.release_gate_ledger, errors)
		: null;
	if (roster) errors.push(...validateRoster(roster, families, releaseGate));
	return { errors, roster, families, releaseGate };
}

function readJson(path, label, errors) {
	if (!existsSync(path)) {
		errors.push(`${label} does not exist`);
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		errors.push(`${label} is not valid JSON (${error.message})`);
		return null;
	}
}

/**
 * Structural rules for `quality/release-dashboard.json`.
 *
 * Kept small on purpose: the dashboard reads declarations, it does not
 * decide them. What it must refuse is a declaration it could not
 * evaluate honestly (an unknown group, an implemented row with no
 * command, an evidence kind it does not know, a family that disagrees
 * with the ledger).
 */
export function validateRoster(roster, families, releaseGate = null) {
	const errors = [];
	errors.push(...validateLedgerAlignment(roster, releaseGate));
	if (roster?.version !== 1) errors.push(`roster: version must be 1, got ${roster?.version}`);
	if (!Array.isArray(roster?.signals) || roster.signals.length === 0) {
		errors.push('roster: signals must be a non-empty array');
		return errors;
	}
	const groups = new Set((roster.groups ?? []).map((group) => group?.id));
	const familyState = new Map(
		(families?.gate_families ?? []).map((family) => [family?.id, family]),
	);
	const seen = new Set();

	for (const signal of roster.signals) {
		const id = signal?.id ?? '<no id>';
		if (typeof signal?.id !== 'string' || signal.id.length === 0) {
			errors.push('roster: a signal has no id');
			continue;
		}
		if (seen.has(signal.id)) errors.push(`roster: duplicate signal id "${signal.id}"`);
		seen.add(signal.id);
		if (!groups.has(signal.group)) {
			errors.push(`roster: signal "${id}" has undeclared group "${signal.group}"`);
		}
		if (typeof signal.label !== 'string' || signal.label.length === 0) {
			errors.push(`roster: signal "${id}" has no label`);
		}

		let state = signal.state ?? null;
		if (signal.family) {
			const family = familyState.get(signal.family);
			if (!family) {
				errors.push(`roster: signal "${id}" references unknown family "${signal.family}"`);
			} else if (state && state !== family.state) {
				errors.push(
					`roster: signal "${id}" declares state "${state}" but family "${signal.family}" is "${family.state}"`,
				);
			} else {
				state = family.state;
			}
		}
		if (state !== 'implemented' && state !== 'planned') {
			errors.push(`roster: signal "${id}" must resolve to state implemented | planned`);
			continue;
		}

		for (const requirement of signal.requirements ?? []) {
			if (!REQUIREMENTS.has(requirement)) {
				errors.push(
					`roster: signal "${id}" has unknown requirement "${requirement}" (${[...REQUIREMENTS].join(' / ')})`,
				);
			}
		}

		if (state === 'implemented') {
			if (typeof signal.command !== 'string' || signal.command.length === 0) {
				errors.push(`roster: implemented signal "${id}" has no command`);
			}
			const evidence = signal.evidence;
			if (!evidence || !EVIDENCE_KINDS.has(evidence.kind)) {
				errors.push(`roster: implemented signal "${id}" needs evidence.kind exit_code | artefact`);
			} else if (evidence.kind === 'artefact') {
				const paths = evidence.paths;
				if (!Array.isArray(paths) || paths.length === 0) {
					errors.push(`roster: signal "${id}" declares artefact evidence with no path`);
				}
				for (const path of paths ?? []) {
					if (typeof path !== 'string' || path.length === 0) {
						errors.push(`roster: signal "${id}" has an empty evidence path`);
					} else if (path.startsWith('/')) {
						errors.push(`roster: signal "${id}" evidence path must be repo-relative: ${path}`);
					}
				}
			}
		} else if (signal.command || signal.evidence) {
			errors.push(`roster: planned signal "${id}" must not declare a command or evidence`);
		}
	}
	return errors;
}

/**
 * Two ledgers must not drift apart silently.
 *
 * Issue #508's `quality/release-gate.json` answers "does the release
 * chain execute this check"; this roster answers "does this checkout
 * have a valid output for it". They legitimately overlap, so the roster
 * has to name, for every release-gate row, either the signal that shows
 * it here or the reason it is not shown. A new #508 row with no decision
 * fails this validator, so the overlap stays a reviewable statement
 * instead of two drifting lists.
 */
export function validateLedgerAlignment(roster, releaseGate) {
	const alignment = roster?.ledger_alignment;
	if (!releaseGate) return [];
	if (!alignment)
		return ['roster: ledger_alignment is missing while a release_gate_ledger is declared'];
	const errors = [];
	const signalIds = new Set((roster.signals ?? []).map((signal) => signal?.id));
	const ledgerIds = (releaseGate.checks ?? []).map((check) => check?.id);
	const declared = new Set([
		...Object.keys(alignment.as_signal ?? {}),
		...Object.keys(alignment.not_listed ?? {}),
	]);

	for (const id of ledgerIds) {
		if (declared.has(id)) continue;
		errors.push(`roster: ledger_alignment has no decision for release-gate check "${id}"`);
	}
	for (const id of declared) {
		if (!ledgerIds.includes(id)) {
			errors.push(`roster: ledger_alignment mentions "${id}", which is not a release-gate check`);
		}
	}
	for (const [id, signalId] of Object.entries(alignment.as_signal ?? {})) {
		if (!signalIds.has(signalId)) {
			errors.push(`roster: ledger_alignment maps "${id}" to unknown signal "${signalId}"`);
		}
	}
	for (const [id, entry] of Object.entries(alignment.not_listed ?? {})) {
		if (entry?.signal) {
			errors.push(`roster: ledger_alignment.not_listed["${id}"] must have a null signal`);
			continue;
		}
		if (typeof entry?.reason !== 'string' || entry.reason.length === 0) {
			errors.push(`roster: ledger_alignment.not_listed["${id}"] has no reason`);
		}
	}
	return errors;
}

/**
 * The rows the dashboard renders: roster order, with the state and
 * contract resolved from `quality/route-coverage.json` where the row
 * points at a family.
 */
export function resolveSignals({ roster, families }) {
	const familyById = new Map((families?.gate_families ?? []).map((family) => [family.id, family]));
	return (roster?.signals ?? []).map((signal) => {
		const family = signal.family ? familyById.get(signal.family) : null;
		return {
			...signal,
			state: family ? family.state : signal.state,
			contract: signal.contract ?? family?.contract ?? '',
			familyStateSource: family ? DEFAULT_FAMILIES_PATH : null,
		};
	});
}

/**
 * Decide one row. Pure: the filesystem is reached through the injected
 * `artefactExists` seam so the four states can be fixture-tested
 * without touching a checkout.
 *
 * Every branch that has no positive evidence returns `not_run`; there
 * is no path from a missing report to `pass`.
 */
export function classifySignal({ signal, runRecord, currentSha, artefactExists }) {
	const evidence = signal.evidence ?? null;

	if (signal.state !== 'implemented') {
		return verdict(STATUS.NOT_APPLICABLE, `未実装（family ${signal.family} は planned）`, {
			decidedBy: null,
		});
	}

	if (!runRecord) {
		return verdict(STATUS.NOT_RUN, 'run record なし（この signal の有効な出力が存在しない）', {
			decidedBy: signal.command,
		});
	}
	if (runRecord.source_sha && currentSha && runRecord.source_sha !== currentSha) {
		return verdict(
			STATUS.NOT_RUN,
			`run record は別の source SHA (${runRecord.source_sha}) のもの`,
			{ decidedBy: signal.command },
		);
	}

	const run = (runRecord.runs ?? []).find((entry) => entry.id === signal.id);
	if (!run) {
		return verdict(STATUS.NOT_RUN, 'この run record に信号の記録が無い', {
			decidedBy: signal.command,
		});
	}
	if (run.skipped) {
		return verdict(STATUS.NOT_RUN, `未実行: ${run.reason ?? '理由未記録'}`, {
			decidedBy: signal.command,
		});
	}
	if (run.exit_code !== 0) {
		return verdict(STATUS.FAIL, `exit code ${run.exit_code} (${signal.command})`, {
			decidedBy: signal.command,
			durationMs: run.duration_ms,
		});
	}

	if (evidence?.kind === 'artefact') {
		const missing = evidence.paths.filter((path) => !artefactExists(path));
		if (missing.length > 0) {
			return verdict(STATUS.NOT_RUN, `report missing: ${missing.join(', ')}`, {
				decidedBy: signal.command,
			});
		}
	}

	return verdict(STATUS.PASS, `exit code 0 (${signal.command})`, {
		decidedBy: signal.command,
		durationMs: run.duration_ms,
		artifacts: evidence?.kind === 'artefact' ? evidence.paths : [],
	});
}

function verdict(status, reason, extra) {
	return { status, label: STATUS_LABELS[status], reason, ...extra };
}

/** Short source SHA of the checkout the verdicts are compared against. */
export function headSha(root = REPO_ROOT) {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
	} catch {
		return null;
	}
}

/** Browser engine actually used for a capture, or "not used". */
export function describeBrowser(root = REPO_ROOT) {
	const revisionFile = resolve(
		root,
		'node_modules/playwright-core/.local-browsers/.chromium-revision',
	);
	if (!existsSync(revisionFile)) return 'not used (静的 HTML — ブラウザもネットワークも不要)';
	try {
		const revision = readFileSync(revisionFile, 'utf8').trim();
		return `chromium ${revision.slice(0, 12)} (playwright-core ローカルバンドル)`;
	} catch {
		return 'chromium (revision unknown)';
	}
}

/** Machine description of where a verdict was produced. */
export function describeEnvironment({ root = REPO_ROOT, runRecord = null, sha = null } = {}) {
	const recorded = runRecord?.environment ?? null;
	const cpus = os.cpus();
	return {
		// The SHA and the capture time belong to the record root, not to
		// its `environment` block: they describe WHEN the verdicts were
		// produced, while `environment` describes the machine.
		sourceSha: runRecord?.source_sha ?? sha ?? headSha(root),
		runner: recorded?.runner ?? (process.env.CI ? 'ci' : 'local'),
		capturedAt: runRecord?.captured_at ?? null,
		node: recorded?.node ?? process.version,
		platform: `${os.platform()} ${os.arch()} (${os.release()})`,
		cpu: recorded?.cpu ?? {
			model: cpus[0]?.model ?? 'unknown',
			cores: cpus.length,
		},
		browser: recorded?.browser ?? describeBrowser(root),
		network: recorded?.network ?? 'unknown (run record なし)',
	};
}

/**
 * Build the whole dashboard model: rows, counts, environment.
 *
 * A missing or unreadable run record is NOT an error — "no output" is
 * one of the states the page exists to report. A malformed roster is.
 */
export function buildDashboard({ root = REPO_ROOT, runRecordPath = DEFAULT_RUN_RECORD_PATH } = {}) {
	const { errors, roster, families } = loadRoster({ root });
	if (errors.length > 0) {
		return { errors, rows: [], summary: emptySummary(), environment: null, sourceSha: null };
	}
	const sha = headSha(root);
	const recordAbsolute = resolve(root, runRecordPath);
	const recordErrors = [];
	const runRecord = readJson(recordAbsolute, runRecordPath, recordErrors);
	const signals = resolveSignals({ roster, families });
	const rows = signals.map((signal) => ({
		signal,
		result: classifySignal({
			signal,
			runRecord,
			currentSha: sha,
			artefactExists: (path) => existsSync(resolve(root, path)),
		}),
	}));

	return {
		errors: [],
		roster,
		rows,
		summary: summarize(rows),
		environment: describeEnvironment({ root, runRecord, sha }),
		sourceSha: sha,
		runRecordPath,
		runRecord,
	};
}

function emptySummary() {
	return { pass: 0, fail: 0, notRun: 0, notApplicable: 0, total: 0 };
}

export function summarize(rows) {
	const summary = emptySummary();
	for (const { result } of rows) {
		summary.total += 1;
		if (result.status === STATUS.PASS) summary.pass += 1;
		else if (result.status === STATUS.FAIL) summary.fail += 1;
		else if (result.status === STATUS.NOT_RUN) summary.notRun += 1;
		else if (result.status === STATUS.NOT_APPLICABLE) summary.notApplicable += 1;
	}
	return summary;
}

/**
 * The relationship with Issue #508's release-gate ledger, rendered as the
 * decision list it is: every release-gate row either has a signal here or
 * a recorded reason why it does not.
 */
function renderLedgerAlignment(roster) {
	const alignment = roster?.ledger_alignment;
	if (!alignment) return '';
	const asSignal = Object.entries(alignment.as_signal ?? {});
	const notListed = Object.entries(alignment.not_listed ?? {});
	const mapped = asSignal
		.map(
			([id, signalId]) =>
				`<tr><td><code>${escapeHtml(id)}</code></td><td><code>${escapeHtml(signalId)}</code></td></tr>`,
		)
		.join('\n');
	const omitted = notListed
		.map(
			([id, entry]) =>
				`<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(entry?.reason ?? '')}</td></tr>`,
		)
		.join('\n');
	return `  <h2>release-gate ledger（Issue #508）との対応</h2>
  <p class="sub">
    #508 の ledger は「release がその検査を実行するか」を判定し、この dashboard は
    「このチェックアウトに有効な出力が有るか」を判定します。問いが違うので ledger は
    2 本に増やしませんが、<code>quality/release-gate.json</code> の全 id について
    「どの signal として表示する / 表示しない理由」を roster が宣言しており、
    未宣言の id が出たら <code>quality:dashboard:check</code> が fail します。
  </p>
  <details>
    <summary><strong>${asSignal.length}</strong> 件を signal として表示 / <strong>${notListed.length}</strong> 件を表示しない（理由つき）</summary>
    <table>
      <thead><tr><th style="width:260px">release-gate check</th><th style="width:220px">この dashboard の signal</th></tr></thead>
      <tbody>
${mapped}
      </tbody>
    </table>
    <table>
      <thead><tr><th style="width:260px">release-gate check</th><th>表示しない理由</th></tr></thead>
      <tbody>
${omitted}
      </tbody>
    </table>
  </details>`;
}

function escapeHtml(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

function formatBytes(bytes) {
	if (typeof bytes !== 'number') return '';
	if (bytes < 1024) return `${bytes} B`;
	return `${Math.round(bytes / 1024)} KB`;
}

/** Repo-relative artefact size, or null when it is not on disk. */
function artefactSize(root, path) {
	try {
		return statSync(resolve(root, path)).size;
	} catch {
		return null;
	}
}

/**
 * Render the dashboard as a static HTML page.
 *
 * Deterministic apart from the two fields that describe the capture
 * itself (source SHA and capture timestamp), so the committed
 * screenshot can be regenerated from a clean checkout without a browser
 * or a network.
 */
export function renderDashboardHtml({ dashboard, root = REPO_ROOT }) {
	const { rows, summary, environment } = dashboard;
	const groups = dashboard.roster.groups ?? [];
	const byGroup = groups.map((group) => ({
		...group,
		rows: rows.filter((row) => row.signal.group === group.id),
	}));
	const alignmentHtml = renderLedgerAlignment(dashboard.roster);

	const cards = [
		{ k: 'PASS', v: summary.pass, cls: 'ok' },
		{ k: 'FAIL', v: summary.fail, cls: 'ng' },
		{ k: 'NOT RUN', v: summary.notRun, cls: 'na' },
		{ k: 'N/A (未実装)', v: summary.notApplicable, cls: 'planned' },
		{ k: 'signals', v: summary.total, cls: '' },
	].map(
		(card) =>
			`<div class="card"><div class="k">${escapeHtml(card.k)}</div><div class="v ${card.cls}">${card.v}</div></div>`,
	);

	const groupSections = byGroup
		.map((group) => {
			const body = group.rows
				.map((row) => {
					const { signal, result } = row;
					const artefacts = (result.artifacts ?? [])
						.map((path) => {
							const size = artefactSize(root, path);
							return `<code>${escapeHtml(path)}</code>${
								size === null ? '' : `<span class="dim"> (${escapeHtml(formatBytes(size))})</span>`
							}`;
						})
						.join('<br />');
					return `      <tr>
        <td><span class="mark ${result.status}">${escapeHtml(result.label)}</span></td>
        <td class="name"><code>${escapeHtml(signal.id)}</code><div class="label">${escapeHtml(signal.label)}</div></td>
        <td class="why">${escapeHtml(result.reason)}${artefacts ? `<div class="dim">${artefacts}</div>` : ''}</td>
        <td class="owner"><code>${escapeHtml(signal.owner ?? '—')}</code></td>
      </tr>`;
				})
				.join('\n');
			return `  <h2>${escapeHtml(group.label)}</h2>
  <table>
    <thead><tr><th style="width:120px">status</th><th style="width:250px">signal</th><th>なぜこの状態か</th><th style="width:190px">owner</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>`;
		})
		.join('\n');

	const env = environment ?? {};
	const cpu = env.cpu ?? {};
	const environmentRows = [
		['source sha', env.sourceSha ?? 'unknown'],
		['runner (local / CI)', env.runner ?? 'unknown'],
		['captured at', env.capturedAt ?? '— (run record なし)'],
		['node', env.node ?? 'unknown'],
		['platform', env.platform ?? 'unknown'],
		['CPU', `${cpu.model ?? 'unknown'} · ${cpu.cores ?? '?'} core`],
		['browser', env.browser ?? 'unknown'],
		['network', env.network ?? 'unknown'],
	]
		.map(
			([key, value]) =>
				`<tr><th>${escapeHtml(key)}</th><td><code>${escapeHtml(value)}</code></td></tr>`,
		)
		.join('\n');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>release quality dashboard — Issue #493</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #fbfbf9; color: #14140f;
         font: 13px/1.55 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 13px; margin: 20px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  .sub { margin: 0 0 16px; font-size: 12.5px; color: #3d3d33; max-width: 1080px; }
  .cards { display: flex; gap: 12px; margin-bottom: 16px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 10px 18px; min-width: 120px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .v.ok { color: #1c6b3a; } .v.ng { color: #a12020; } .v.na { color: #8a6d1f; } .v.planned { color: #77776a; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  thead th { background: #f3f1e8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .mark { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
  .mark.pass { color: #1c6b3a; } .mark.fail { color: #a12020; }
  .mark.not_run { color: #8a6d1f; } .mark.not_applicable { color: #77776a; }
  td.name .label { font-size: 11.5px; color: #3d3d33; margin-top: 2px; }
  td.why { color: #3d3d33; }
  .dim { color: #77776a; font-size: 11.5px; }
  ul.legend { margin: 6px 0 0; padding-left: 18px; color: #3d3d33; }
  ul.legend li { margin-bottom: 3px; }
  details { background: #fff; border: 1px solid #dedcd2; padding: 10px 14px; }
  details summary { cursor: pointer; color: #3d3d33; }
  details table { margin-top: 10px; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>release quality dashboard</h1>
  <p class="sub">
    この作業は「<strong>有効な出力がこのチェックアウトに存在するか</strong>」だけを判定します。
    品質チェックは一切実行せず、数値も作りません。verdict は
    <code>quality/release-dashboard.json</code> が宣言する各コマンドの終了コード、または
    同 manifest が宣言する report の存在から判定します。実装が無く runner が無い signal は
    <strong>N/A</strong>、出力が無い signal は <strong>NOT RUN</strong> と表示され、
    どちらも PASS には数えません。<strong>可視化でありゲートではありません。</strong>
  </p>

  <div class="cards">
${cards.join('\n')}
  </div>

  <h2>status の語彙</h2>
  <ul class="legend">
    <li><strong>PASS</strong> — この source SHA の run record があり、command が exit 0、かつ宣言された report が全て存在。</li>
    <li><strong>FAIL</strong> — この source SHA の run record があり、command が非 0 で終了。</li>
    <li><strong>NOT RUN</strong> — run record 無し / 別 SHA の record / 未実行（要 build・network・browser）/ report missing。</li>
    <li><strong>N/A (未実装)</strong> — <code>quality/route-coverage.json</code> で <code>planned</code> の family。測定器がまだ無いので合格でも不合格でもない。</li>
  </ul>

${groupSections}
${alignmentHtml}

  <h2>再現条件 (environment)</h2>
  <table>
    <thead><tr><th style="width:220px">項目</th><th>値</th></tr></thead>
    <tbody>
${environmentRows}
    </tbody>
  </table>

  <footer>
    my-web-2026 · Issue #493 · roster <code>${DEFAULT_ROSTER_PATH}</code> ·
    run record <code>${escapeHtml(dashboard.runRecordPath ?? DEFAULT_RUN_RECORD_PATH)}</code> ·
    regenerate with <code>pnpm run quality:dashboard:report</code> ·
    rendered from the working tree only (no browser, no network, no Worker, no secret) ·
    committed as <code>docs/verification/quality/release-quality-dashboard.webp</code>.
  </footer>
</body>
</html>
`;
}

function parseArg(argv, name) {
	for (const arg of argv) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

function main(argv) {
	const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : REPO_ROOT);
	if (!root) {
		process.stderr.write('--root requires a directory argument\n');
		return 2;
	}
	const reportPath = parseArg(argv, '--report');
	const dashboard = buildDashboard({ root });

	if (dashboard.errors.length > 0) {
		process.stderr.write(`release quality dashboard: ${dashboard.errors.length} problem(s):\n`);
		for (const error of dashboard.errors) process.stderr.write(`  - ${error}\n`);
		return 1;
	}

	if (reportPath) {
		const target = resolve(root, reportPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, renderDashboardHtml({ dashboard, root }));
		process.stdout.write(`wrote ${reportPath}\n`);
	}

	const { summary } = dashboard;
	process.stdout.write(
		`release quality dashboard: ${summary.pass} PASS / ${summary.fail} FAIL / ${summary.notRun} NOT RUN / ${summary.notApplicable} N/A of ${summary.total} signal(s) @ ${dashboard.sourceSha}\n`,
	);
	return 0;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
