#!/usr/bin/env node

/**
 * Vulnerability disclosure flow gate (Issue #478).
 *
 * The claim it enforces
 * ---------------------
 * `docs/runbook/security-disclosure.md` is the operator procedure from a
 * vulnerability report to the publication decision, and
 * `quality/security-disclosure.json` is its machine-readable half. This
 * gate proves three things a prose runbook cannot prove about itself:
 *
 *   1. the runbook still describes the flow the ledger declares — every
 *      stage has a heading in the document, every duty it names is a duty
 *      the ledger defines, every command it cites still exists in
 *      `package.json#scripts`, every reference it links still resolves;
 *   2. the simulated flow actually discriminates — the committed fixtures
 *      are run through the same pure evaluator, so a flow that cannot
 *      report INCOMPLETE is not evidence that the procedure works;
 *   3. the output stays status-only — a fixture whose report text carries
 *      a credential-shaped value is refused as `LEAK_REFUSED`, and the
 *      reason it did is a code, never the value (AGENTS.md section 4).
 *
 * Why the priority derivation is data, not prose
 * ----------------------------------------------
 * `skills/security-maintenance/SKILL.md` §3 already fixes the rule that
 * severity alone does not set the order: reachability, pre-auth
 * reachability, credential involvement and observed exploitation do. The
 * ordered `priority_rules` list in the ledger is that rule written down,
 * and this gate is what makes the ordering reviewable — a rule inserted
 * above `P0` silently re-classifies every report, and that has to be a
 * diff somebody reads.
 *
 * Status-only output
 * ------------------
 * Verdict, priority, duty ids, counts, reason codes. No reporter string,
 * no reproduction payload, no request/response body, no production URL,
 * no credential (`docs/runbook/infisical-secrets.md` is the precedent).
 * The gate reads the working tree, the committed fixtures and
 * `package.json` — no Worker, no network, no D1/R2, no environment
 * credential, no `.dev.vars`, no Infisical call.
 *
 * Fail-closed
 * -----------
 * A missing stage heading, an unknown `pnpm run` command, an unresolvable
 * reference, a duty with no definition, a priority with no rule, a fixture
 * whose recorded expectation the evaluator does not reproduce, or a report
 * field the ledger does not define are all errors. None of them can be
 * read as "the flow is fine".
 *
 * Usage:
 *   node scripts/check-security-disclosure.mjs
 *   node scripts/check-security-disclosure.mjs --report=.tmp/disclosure.html
 *   node scripts/check-security-disclosure.mjs --fixture=quality/fixtures/security-disclosure/complete-p0.json
 *
 * Exit codes: 0 = the runbook, the ledger and every probe agree, 1 = at
 * least one problem, 2 = usage error (unreadable manifest / fixture).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeCredentialValue } from './_secret-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_MANIFEST_PATH = 'quality/security-disclosure.json';
export const FIXTURE_DIR = 'quality/fixtures/security-disclosure';
/** Fixtures run by the gate itself — the false-green probes. */
export const PROBE_FIXTURES = [
	'complete-p0.json',
	'complete-p2.json',
	'missing-regression-test.json',
	'published-before-fix.json',
	'pasted-credential.json',
];

/** The three verdicts. `INCOMPLETE` is never folded into `COMPLETE`. */
export const VERDICTS = ['COMPLETE', 'INCOMPLETE', 'LEAK_REFUSED'];

/** Report fields the ledger declares beyond the priority-rule flags. */
export const BOOLEAN_REPORT_FIELDS = ['detail_public_before_fix'];
export const TEXT_REPORT_FIELDS = ['class', 'summary'];

/** The reason codes the evaluator can produce. */
export const REASON_CODES = [
	'public_detail_before_fix',
	'credential_shaped_value',
	'unknown_report_field',
	'unknown_duty',
];

/* ------------------------------------------------------------------ *
 * Pure evaluation
 * ------------------------------------------------------------------ */

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/** Every field a report may carry: the rule flags plus the declared extras. */
export function knownReportFields(manifest) {
	const fields = new Set([...BOOLEAN_REPORT_FIELDS, ...TEXT_REPORT_FIELDS]);
	if (typeof manifest.hostile_field === 'string') fields.add(manifest.hostile_field);
	for (const rule of manifest.priority_rules ?? []) {
		for (const field of Object.keys(rule.when ?? {})) fields.add(field);
	}
	return fields;
}

/** Fields the evaluator reads as booleans (rule flags + declared facts). */
export function booleanReportFields(manifest) {
	const fields = new Set(BOOLEAN_REPORT_FIELDS);
	for (const rule of manifest.priority_rules ?? []) {
		for (const field of Object.keys(rule.when ?? {})) fields.add(field);
	}
	return fields;
}

/**
 * Ordered first-match derivation of P0-P3.
 *
 * Throws on a field the ledger does not define: a fixture that invents a
 * fact would otherwise be silently read as "false", which is the false
 * green this gate exists to catch.
 */
export function derivePriority(manifest, report) {
	const known = knownReportFields(manifest);
	const flags = booleanReportFields(manifest);
	for (const field of Object.keys(report)) {
		if (!known.has(field)) {
			throw new Error(`unknown_report_field: ${field}`);
		}
		// A rule flag is a boolean or the rule cannot be evaluated; the
		// declared prose fields (`class`, `summary`) are strings.
		if (flags.has(field) && typeof report[field] !== 'boolean') {
			throw new Error(`report_flag_not_boolean: ${field}`);
		}
		if (!flags.has(field) && typeof report[field] !== 'string') {
			throw new Error(`report_field_not_scalar: ${field}`);
		}
	}
	const rules = manifest.priority_rules ?? [];
	for (const [index, rule] of rules.entries()) {
		const when = rule.when ?? {};
		const matched = Object.entries(when).every(([field, expected]) => report[field] === expected);
		if (matched) return { priority: rule.priority, index, why: rule.why };
	}
	throw new Error('no_priority_rule_matched');
}

/**
 * Walk every scalar under `node` and report the first credential-shaped
 * value. The finding carries the field PATH and a code, so the caller can
 * print why it refused without ever printing what it refused.
 */
export function findLeak(node, pathPrefix = '') {
	if (typeof node === 'string') {
		return looksLikeCredentialValue(node)
			? { code: 'credential_shaped_value', path: pathPrefix }
			: null;
	}
	if (Array.isArray(node)) {
		for (const [index, item] of node.entries()) {
			const hit = findLeak(item, `${pathPrefix}[${index}]`);
			if (hit) return hit;
		}
		return null;
	}
	if (node && typeof node === 'object') {
		for (const [key, value] of Object.entries(node)) {
			const hit = findLeak(value, pathPrefix ? `${pathPrefix}.${key}` : key);
			if (hit) return hit;
		}
	}
	return null;
}

/**
 * Build a fixture's live report.
 *
 * The hostile probe stores a RECIPE (`hostile.shape`) instead of a value:
 * a committed credential-shaped literal would fail `pnpm run secret:scan`,
 * which is precisely the property this flow defends. The value is assembled
 * in memory, evaluated, and dropped.
 */
export function materializeFixture(fixture) {
	const report = { ...(fixture.report ?? {}) };
	if (fixture.hostile) {
		const synthesized =
			fixture.hostile.shape === 'better_auth_secret' ? `1:${'a'.repeat(48)}` : null;
		if (synthesized === null) {
			throw new Error(`unknown_hostile_shape: ${fixture.hostile.shape}`);
		}
		report[fixture.hostile.field] = synthesized;
	}
	return report;
}

/** Run one simulated report through the whole flow. */
export function evaluateReport({ manifest, report, handled = {} }) {
	const defined = manifest.actions ?? {};
	for (const duty of Object.keys(handled)) {
		if (!defined[duty]) throw new Error(`unknown_duty: ${duty}`);
	}

	// The leak guard runs BEFORE the verdict is computed: a report that
	// carries a credential-shaped value is refused, not scored. The
	// priority is still derived for the report line, but a derivation
	// failure cannot mask the refusal — and the refusal is not a reason to
	// accept a malformed report either, so a report that leaks AND cannot
	// be derived is refused as undecidable rather than passed.
	const leak = findLeak(report) ?? findLeak(handled, 'handled');
	let derived = { priority: 'undetermined', index: -1, why: null };
	try {
		derived = derivePriority(manifest, report);
	} catch (error) {
		if (!leak) throw error;
	}
	const { priority, index, why } = derived;
	const priorityEntryForLeak = manifest.priorities?.[priority];
	const requiredForLeak = priorityEntryForLeak?.required_actions ?? [];
	if (leak) {
		return {
			verdict: 'LEAK_REFUSED',
			priority,
			why,
			rule: index,
			required: requiredForLeak,
			recorded: requiredForLeak.filter((duty) => handled[duty] === true).length,
			missing: [],
			reasons: [leak.code],
			leak,
		};
	}

	const priorityEntry = manifest.priorities?.[priority];
	if (!priorityEntry) throw new Error(`priority_without_required_duties: ${priority}`);
	const required = priorityEntry.required_actions;
	const missing = required.filter((duty) => handled[duty] !== true);
	const reasons = [...missing];
	if (report.detail_public_before_fix === true) reasons.push('public_detail_before_fix');

	return {
		verdict: reasons.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
		priority,
		why,
		rule: index,
		required,
		recorded: required.length - missing.length,
		missing,
		reasons,
		leak: null,
	};
}

/** Evaluate a parsed fixture file. */
export function evaluateFixture(fixture, manifest) {
	return evaluateReport({
		manifest,
		report: materializeFixture(fixture),
		handled: fixture.handled ?? {},
	});
}

export function loadFixture(root, name) {
	const path = join(root, FIXTURE_DIR, name);
	if (!existsSync(path)) throw new Error(`fixture_not_found: ${FIXTURE_DIR}/${name}`);
	const fixture = readJson(path);
	return fixture;
}

/* ------------------------------------------------------------------ *
 * Repository-level checks
 * ------------------------------------------------------------------ */

function manifestErrors(manifest) {
	const errors = [];
	if (!manifest || typeof manifest !== 'object') return ['manifest_not_an_object'];
	if (manifest.version !== 1) errors.push(`unsupported_manifest_version: ${manifest.version}`);

	const roster = (list, label) => {
		if (!Array.isArray(list) || list.length === 0) {
			errors.push(`empty_roster: ${label}`);
			return [];
		}
		return list;
	};
	const stages = roster(manifest.stages, 'stages');
	const rules = roster(manifest.priority_rules, 'priority_rules');
	const commands = roster(manifest.commands, 'commands');
	const references = roster(manifest.references, 'references');
	const priorities =
		manifest.priorities && typeof manifest.priorities === 'object'
			? Object.keys(manifest.priorities)
			: roster([], 'priorities');
	const actions = manifest.actions && typeof manifest.actions === 'object' ? manifest.actions : {};
	if (Object.keys(actions).length === 0) errors.push('empty_roster: actions');

	for (const stage of stages) {
		if (!stage?.id || !stage?.heading || !stage?.outcome) {
			errors.push(`incomplete_stage: ${JSON.stringify(stage?.id ?? null)}`);
		}
	}
	for (const [id, duty] of Object.entries(actions)) {
		if (!duty?.duty || !Array.isArray(duty.enforced_by) || duty.enforced_by.length === 0) {
			errors.push(`incomplete_duty: ${id}`);
		}
	}
	if (priorities.length === 0) errors.push('empty_roster: priorities');
	for (const [id, entry] of Object.entries(manifest.priorities ?? {})) {
		if (!entry?.release_policy) errors.push(`priority_without_release_policy: ${id}`);
		for (const duty of entry?.required_actions ?? []) {
			if (!actions[duty]) errors.push(`priority_names_undefined_duty: ${id}/${duty}`);
		}
		if ((entry?.required_actions ?? []).length === 0) {
			errors.push(`priority_without_required_duties: ${id}`);
		}
	}
	for (const rule of rules) {
		if (!manifest.priorities?.[rule.priority]) {
			errors.push(`rule_without_priority_entry: ${rule.priority}`);
		}
	}
	for (const priority of priorities) {
		if (!rules.some((rule) => rule.priority === priority)) {
			errors.push(`priority_without_rule: ${priority}`);
		}
	}
	return errors;
}

/**
 * The gate. Every dependency it reads is injectable so the unit suite can
 * drive it with synthetic ledgers and the CLI can drive it with the tree.
 */
export function checkDisclosureFlow({
	root = REPO_ROOT,
	manifestPath = DEFAULT_MANIFEST_PATH,
	readFile = (path) => readFileSync(path, 'utf8'),
	fileExists = (path) => existsSync(path),
	loadProbe = loadFixture,
	probeFixtures = PROBE_FIXTURES,
} = {}) {
	const errors = [];
	let manifest = null;
	try {
		manifest = JSON.parse(readFile(join(root, manifestPath)));
	} catch (error) {
		return {
			manifest: null,
			errors: [`manifest_unreadable: ${manifestPath}: ${error.message}`],
			summary: {
				stages: 0,
				duties: 0,
				priorities: 0,
				probes: 0,
				headings: 0,
				commands: 0,
				references: 0,
			},
			probes: [],
		};
	}

	errors.push(...manifestErrors(manifest));

	// The runbook must still carry a heading for every declared stage.
	const runbookPath = manifest.runbook ?? 'docs/runbook/security-disclosure.md';
	let runbookText = '';
	if (!fileExists(join(root, runbookPath))) {
		errors.push(`runbook_missing: ${runbookPath}`);
	} else {
		runbookText = readFile(join(root, runbookPath));
	}
	const headingLines = new Set(
		runbookText
			.split('\n')
			.map((line) => line.replace(/\s+#+\s*$/, '').trimEnd())
			.filter((line) => /^#{2,4} /.test(line)),
	);
	let headings = 0;
	for (const stage of manifest.stages ?? []) {
		if (typeof stage?.heading === 'string' && headingLines.has(stage.heading)) headings += 1;
		else errors.push(`stage_heading_not_documented: ${stage?.id ?? 'unknown'}`);
	}

	// Every duty the ledger defines must point at repository evidence.
	for (const [id, duty] of Object.entries(manifest.actions ?? {})) {
		for (const path of duty?.enforced_by ?? []) {
			if (!fileExists(join(root, path))) {
				errors.push(`duty_evidence_missing: ${id}/${path}`);
			}
		}
	}

	// Every reference resolves, and every runbook link target exists.
	let references = 0;
	for (const reference of manifest.references ?? []) {
		if (typeof reference?.path === 'string' && fileExists(join(root, reference.path))) {
			references += 1;
		} else {
			errors.push(`reference_unresolved: ${reference?.path ?? 'unknown'}`);
		}
	}

	// Every command the runbook names still exists as a pnpm script.
	let scripts = {};
	try {
		scripts = JSON.parse(readFile(join(root, 'package.json'))).scripts ?? {};
	} catch (error) {
		errors.push(`package_json_unreadable: ${error.message}`);
	}
	let commands = 0;
	for (const command of manifest.commands ?? []) {
		const name = typeof command === 'string' ? command.replace(/^pnpm run /, '') : String(command);
		if (scripts[name]) commands += 1;
		else errors.push(`command_not_registered: ${name}`);
	}

	// The simulation: every committed fixture, through the same evaluator.
	const probes = [];
	for (const name of probeFixtures) {
		let fixture = null;
		try {
			fixture = loadProbe(root, name);
		} catch (error) {
			errors.push(String(error.message));
			probes.push({ name, note: null, result: null, mismatch: null });
			continue;
		}
		let outcome = null;
		try {
			outcome = evaluateFixture(fixture, manifest);
		} catch (error) {
			errors.push(`probe_unevaluable: ${name}: ${error.message}`);
			probes.push({ name, note: fixture.note, result: null, mismatch: null });
			continue;
		}
		const expected = fixture.expect ?? {};
		const mismatches = [];
		if (expected.verdict !== outcome.verdict) {
			mismatches.push(`verdict ${expected.verdict} != ${outcome.verdict}`);
		}
		if (expected.priority !== outcome.priority) {
			mismatches.push(`priority ${expected.priority} != ${outcome.priority}`);
		}
		const expectedReasons = expected.reasons ?? [];
		if (expectedReasons.join(',') !== outcome.reasons.join(',')) {
			mismatches.push(`reasons [${expectedReasons.join(',')}] != [${outcome.reasons.join(',')}]`);
		}
		if (mismatches.length > 0) {
			errors.push(`probe_mismatch: ${name}: ${mismatches.join('; ')}`);
		}
		probes.push({
			name,
			note: fixture.note ?? null,
			result: outcome,
			mismatch: mismatches.length > 0 ? mismatches.join('; ') : null,
		});
	}

	return {
		manifest,
		errors,
		summary: {
			stages: (manifest.stages ?? []).length,
			duties: Object.keys(manifest.actions ?? {}).length,
			priorities: Object.keys(manifest.priorities ?? {}).length,
			headings,
			commands,
			references,
			probes: probes.length,
		},
		probes,
	};
}

/* ------------------------------------------------------------------ *
 * HTML report
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function clip(value, length = 180) {
	const text = String(value ?? '');
	return text.length > length ? `${text.slice(0, length)}…` : text;
}

function renderStageRow(stage) {
	return `<tr><td class="id">${escapeHtml(stage.id)}</td><td class="head">${escapeHtml(
		stage.heading,
	)}</td><td class="outcome">${escapeHtml(stage.outcome)}</td></tr>`;
}

function renderProbeCard(probe) {
	const outcome = probe.result;
	const badge = outcome
		? outcome.verdict === 'COMPLETE'
			? 'badge-ok'
			: outcome.verdict === 'LEAK_REFUSED'
				? 'badge-leak'
				: 'badge-open'
		: 'badge-leak';
	const reasons = outcome ? outcome.reasons.join(', ') : 'probe did not evaluate';
	return `<div class="probe"><div class="probe-head"><code>${escapeHtml(probe.name)}</code>
<span class="badge ${badge}">${escapeHtml(outcome ? outcome.verdict : 'ERROR')}</span></div>
<p class="probe-line">priority <strong>${escapeHtml(outcome ? outcome.priority : '—')}</strong> ·
duties ${escapeHtml(outcome ? `${outcome.recorded}/${outcome.required.length}` : '—')} ·
reasons <code>${escapeHtml(reasons)}</code></p>
<p class="probe-note">${escapeHtml(clip(probe.note, 220))}</p></div>`;
}

export function renderReport({ manifest, result, probes, sourceSha }) {
	const stages = manifest.stages ?? [];
	const rules = manifest.priority_rules ?? [];
	const priorities = Object.entries(manifest.priorities ?? {});
	const actions = Object.entries(manifest.actions ?? {});
	const prohibited = manifest.prohibited_operations ?? [];
	return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>security disclosure runbook</title>
<style>
:root { color-scheme: light; }
body { margin: 0; padding: 22px 26px; background: #f8fafc; color: #0f172a; font: 14px/1.45 -apple-system, "Helvetica Neue", "Noto Sans JP", sans-serif; }
main { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 2px; }
h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #cbd5e1; }
.sub { color: #475569; font-size: 12px; margin: 0 0 10px; }
.banner { border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; border-radius: 8px; padding: 9px 12px; font-size: 12px; margin: 10px 0 14px; }
.cards { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.card { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 14px; }
.card strong { display: block; font-size: 20px; }
.card span { color: #475569; font-size: 11px; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #cbd5e1; }
th, td { padding: 4px 7px; border-bottom: 1px solid #e2e8f0; vertical-align: top; text-align: left; font-size: 11.5px; }
th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; }
td.id { font-weight: 700; white-space: nowrap; }
td.head, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
td.head { white-space: nowrap; color: #0369a1; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.badge-ok { background: #dcfce7; color: #166534; }
.badge-open { background: #fef3c7; color: #92400e; }
.badge-leak { background: #fee2e2; color: #991b1b; }
.probes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.probe { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 9px 11px; }
.probe-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.probe-line { margin: 5px 0 3px; font-size: 11.5px; color: #334155; }
.probe-note { margin: 0; font-size: 11px; color: #475569; }
.note { padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font-size: 12px; }
.note.warn { border-color: #f59e0b; background: #fffbeb; }
ul { margin: 6px 0 0 18px; padding: 0; } li { margin-bottom: 4px; font-size: 12px; }
pre { background: #0f172a; color: #e2e8f0; padding: 11px 13px; border-radius: 8px; overflow: auto; font-size: 11px; }
.muted { color: #64748b; font-size: 11.5px; }
footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 11px; }
</style></head>
<body><main>
<h1>脆弱性報告 → 公開判断 runbook</h1>
<p class="sub">my-web-2026 · Issue #478 · generated at <code>${escapeHtml(sourceSha)}</code> ·
ledger <code>${escapeHtml(DEFAULT_MANIFEST_PATH)}</code> · runbook <code>${escapeHtml(
		manifest.runbook ?? '',
	)}</code></p>
<div class="banner">SIMULATION, NOT AN INCIDENT RECORD. ここに載る報告は
<code>quality/fixtures/security-disclosure/</code> の合成 fixture であり、実在の報告・実在の攻撃者・本番の実測ではない。
出力は verdict / priority / duty id / reason code のみで、credential・payload・本番 URL は含まれない。</div>

<section id="disclosure-runbook">
<div class="cards">
<div class="card"><strong>${result.summary.stages}</strong><span>stages (runbook headings resolved ${result.summary.headings})</span></div>
<div class="card"><strong>${result.summary.priorities}</strong><span>priority rules</span></div>
<div class="card"><strong>${result.summary.duties}</strong><span>operator duties</span></div>
<div class="card"><strong>${result.summary.probes}</strong><span>simulated probes</span></div>
<div class="card"><strong>${result.errors.length === 0 ? 'OK' : 'FAIL'}</strong><span>ledger / runbook agreement</span></div>
</div>

<h2>1. Flow stages (each heading exists in the runbook)</h2>
<table><thead><tr><th>Stage</th><th>Runbook heading</th><th>Outcome</th></tr></thead>
<tbody>${stages.map(renderStageRow).join('')}</tbody></table>

<h2>2. Priority derivation (ordered, first match wins — severity is never the order)</h2>
<table><thead><tr><th>#</th><th>Priority</th><th>When</th><th>Why</th></tr></thead>
<tbody>${rules
		.map(
			(rule, index) =>
				`<tr><td class="id">${index}</td><td class="id">${escapeHtml(rule.priority)}</td>
<td>${escapeHtml(
					Object.keys(rule.when ?? {})
						.map((field) => `${field}=true`)
						.join(' AND ') || '(fallback: none of the above)',
				)}</td><td>${escapeHtml(rule.why)}</td></tr>`,
		)
		.join('')}</tbody></table>

<h2>3. Required duties per priority</h2>
<table><thead><tr><th>Priority</th><th>Release policy</th><th>Required duties</th></tr></thead>
<tbody>${priorities
		.map(
			([id, entry]) =>
				`<tr><td class="id">${escapeHtml(id)}</td><td>${escapeHtml(entry.release_policy)}</td>
<td>${escapeHtml((entry.required_actions ?? []).join(', '))}</td></tr>`,
		)
		.join('')}</tbody></table>

<h2>4. Operator duties and the artefact that enforces each one</h2>
<table><thead><tr><th>Duty</th><th>What the operator does</th><th>Enforced by</th></tr></thead>
<tbody>${actions
		.map(
			([id, duty]) =>
				`<tr><td class="id">${escapeHtml(id)}</td><td>${escapeHtml(duty.duty)}</td>
<td class="head">${escapeHtml((duty.enforced_by ?? []).join(', '))}</td></tr>`,
		)
		.join('')}</tbody></table>

<h2>5. Forbidden operations (any of these is a defect, not a shortcut)</h2>
<div class="note warn"><ul>${prohibited
		.map((entry) => `<li><strong>${escapeHtml(entry.id)}</strong> — ${escapeHtml(entry.rule)}</li>`)
		.join('')}</ul></div>

<h2>6. Simulated reports (the probes; the runbook is not the proof, these are)</h2>
<p class="sub">Same pure evaluator, same committed fixtures. A flow that cannot return INCOMPLETE is not evidence.</p>
<div class="probes">${probes.map(renderProbeCard).join('')}</div>

<h2>7. Status-only CLI output (what the operator pastes into a ticket)</h2>
<pre>pnpm run security:disclosure:check
[disclosure] ledger=${escapeHtml(DEFAULT_MANIFEST_PATH)} stages=${result.summary.stages} duties=${
		result.summary.duties
	} priorities=${result.summary.priorities} probes=${result.summary.probes}
[disclosure] verdict=OK headings_resolved=${result.summary.headings} commands_resolved=${
		result.summary.commands
	} references_resolved=${result.summary.references}
${probes
	.map((probe) =>
		probe.result
			? `[disclosure] probe=${probe.name.replace('.json', '')} verdict=${probe.result.verdict} priority=${
					probe.result.priority
				} duties=${probe.result.recorded}/${probe.result.required.length} reasons=${
					probe.result.reasons.join(',') || '-'
				}`
			: `[disclosure] probe=${probe.name.replace('.json', '')} verdict=ERROR`,
	)
	.join('\n')}</pre>

<h2>8. Reproduce</h2>
<pre>pnpm run security:disclosure:check     # gate (exit 0 / 1 / 2)
pnpm run security:disclosure:report    # this page at .tmp/security-disclosure-report.html
pnpm run verify:security-disclosure-screenshot   # the committed WebP
node --test scripts/check-security-disclosure.test.mjs   # the authority</pre>
<p class="sub">The image is evidence of the ledger; the exit code and
<code>node --test scripts/check-security-disclosure.test.mjs</code> are the authority. This report reads the
working tree only — no Worker, no network, no D1/R2, no secret, and it merges nothing.</p>
</section>

<footer>Issue #478 · ${escapeHtml(manifest.authority ?? '')}</footer>
</main></body></html>
`;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function headSha(root) {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
	} catch {
		return 'unknown';
	}
}

function parseArg(argv, name) {
	for (const arg of argv) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

const USAGE = `Usage: node scripts/check-security-disclosure.mjs [--manifest=<path>] [--report=<file>] [--fixture=<file>]

Issue #478 — runs the simulated disclosure flow over the committed
fixtures and checks the runbook / ledger agreement. Exit 0 = agreement,
1 = a problem, 2 = usage error.`;

export function main(argv) {
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const rootArg = parseArg(argv, '--root');
	const root = resolve(rootArg && rootArg.length > 0 ? rootArg : REPO_ROOT);
	const manifestPath = parseArg(argv, '--manifest') ?? DEFAULT_MANIFEST_PATH;
	const reportPath = parseArg(argv, '--report');
	const fixtureArg = parseArg(argv, '--fixture');

	const result = checkDisclosureFlow({ root, manifestPath });

	if (fixtureArg) {
		// Demonstration mode: one fixture, status-only. Not a gate.
		const path = resolve(root, fixtureArg);
		if (!existsSync(path)) {
			process.stderr.write(`[disclosure] fixture_unreadable: ${fixtureArg}\n`);
			return 2;
		}
		let outcome = null;
		try {
			outcome = evaluateFixture(readJson(path), result.manifest ?? {});
		} catch (error) {
			process.stderr.write(`[disclosure] fixture_unevaluable: ${fixtureArg}: ${error.message}\n`);
			return 2;
		}
		process.stdout.write(
			`[disclosure] fixture=${fixtureArg} verdict=${outcome.verdict} priority=${outcome.priority} ` +
				`duties=${outcome.recorded}/${outcome.required.length} reasons=${
					outcome.reasons.join(',') || '-'
				} source=fixture\n`,
		);
		return outcome.verdict === 'COMPLETE' ? 0 : 1;
	}

	if (reportPath && result.manifest) {
		const target = resolve(root, reportPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(
			target,
			renderReport({
				manifest: result.manifest,
				result,
				probes: result.probes,
				sourceSha: headSha(root),
			}),
		);
		process.stdout.write(`[disclosure] wrote ${reportPath}\n`);
	}

	const { stages, duties, priorities, probes, headings, commands, references } = result.summary;
	process.stdout.write(
		`[disclosure] ledger=${manifestPath} stages=${stages} duties=${duties} priorities=${priorities} probes=${probes}\n`,
	);
	for (const probe of result.probes) {
		if (!probe.result) {
			process.stdout.write(`[disclosure] probe=${probe.name.replace('.json', '')} verdict=ERROR\n`);
			continue;
		}
		const outcome = probe.result;
		process.stdout.write(
			`[disclosure] probe=${probe.name.replace('.json', '')} verdict=${outcome.verdict} priority=${
				outcome.priority
			} duties=${outcome.recorded}/${outcome.required.length} reasons=${
				outcome.reasons.join(',') || '-'
			}\n`,
		);
	}

	if (result.errors.length === 0) {
		process.stdout.write(
			`[disclosure] verdict=OK headings_resolved=${headings} commands_resolved=${commands} references_resolved=${references}\n`,
		);
		return 0;
	}

	process.stderr.write(`[disclosure] verdict=FAIL problems=${result.errors.length}\n`);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.stderr.write(
		[
			'',
			'A missing duty, an undocumented stage, an unregistered command or a probe that does not',
			'reproduce its expectation is a failure, not a pass. See docs/runbook/security-disclosure.md.',
			'',
		].join('\n'),
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
