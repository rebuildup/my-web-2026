#!/usr/bin/env node

/**
 * ASVS coverage ledger (Issue #507).
 *
 * What this gate is
 * -----------------
 * The OWASP Application Security Verification Standard is a large
 * catalogue, not a repository roadmap. This ledger selects the ASVS
 * 5.0.0 requirements that touch a surface this platform actually ships,
 * names the control that would satisfy each one, and records the
 * repository evidence that exists today. A requirement with no evidence
 * is reported as **not run** (unverified), never as a pass. A
 * requirement the platform does not implement is **not applicable** with
 * a reason. A claimed evidence path or registered gate that does not
 * exist is **fail**.
 *
 * The four statuses are deliberately distinct:
 *
 *   - `pass`            — every claimed evidence item resolves on disk
 *                         (test/doc) or to a registered, reachable gate.
 *   - `fail`            — the claim is contradicted by the repository
 *                         (missing file, unregistered script, gate not on
 *                         its declared surface, malformed row).
 *   - `not_run`         — the requirement applies, but no evidence exists.
 *                         The row must name the future manual work; it
 *                         is shown as unverified and never counted as a
 *                         pass.
 *   - `not_applicable`  — the surface does not exist, with a real reason.
 *                         Never counted as a pass.
 *
 * What this gate is not
 * ---------------------
 * It is not an ASVS certification, an audit, or a claim that the
 * platform satisfies the whole standard. The manifest says so, and the
 * report renders that sentence next to the summary.
 *
 * Evidence kinds
 * --------------
 * - `test`  — a checked-in test file (Vitest, node:test, or E2E).
 * - `doc`   — an operator/architecture document (supporting evidence).
 * - `gate`  — exactly one `pnpm run <script>`; the script must be
 *             registered in package.json and reachable from every
 *             surface it declares (`fast`, `integration`, `release`,
 *             `ci`).
 *
 * A row with only `doc` evidence would still resolve to `pass` today;
 * the manifest therefore pairs every row with an executable test or
 * gate. The pure evaluator does not enforce that pairing (a historical
 * decision document can be the only honest evidence for a documentation
 * requirement), but the review of this manifest does.
 *
 * Exit codes: 0 = the ledger is internally consistent (including honest
 * `not_run` rows), 1 = a claim is contradicted, 2 = bad input
 * (unreadable manifest).
 *
 * Authority: Issue #507. Paired with `quality/asvs-coverage.json`,
 * `docs/verification/security/asvs-coverage.md`, the fixtures under
 * `quality/fixtures/asvs-coverage/`, and the committed WebP
 * `docs/verification/security/asvs-coverage-matrix.webp`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_MANIFEST_PATH = 'quality/asvs-coverage.json';
export const FIXTURE_DIR = 'quality/fixtures/asvs-coverage';
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
export const CI_JOB = 'validate';
export const STATUSES = ['pass', 'fail', 'not_run', 'not_applicable'];
export const SURFACES = ['fast', 'integration', 'release', 'ci'];
export const SURFACE_ENTRIES = {
	fast: 'validate:fast',
	integration: 'validate:integration',
	release: 'validate:release',
};
export const PROBE_FIXTURES = [
	'pass.json',
	'missing-evidence.json',
	'missing-follow-up.json',
	'unregistered-gate.json',
];

const PLACEHOLDER_TEXT = new Set(['tbd', 'todo', 'n/a', 'na', 'none', 'later', '-']);
const REQ_ID_PATTERN = /^V\d+\.\d+\.\d+$/;
const PNPM_RUN_PATTERN = /pnpm run ([A-Za-z0-9:._-]+)/g;

/** A real sentence, not a placeholder. */
export function isRealText(value, minimum = 12) {
	return (
		typeof value === 'string' &&
		value.trim().length >= minimum &&
		!PLACEHOLDER_TEXT.has(value.trim().toLowerCase())
	);
}

/** A status label used by the report; never conflates not-run with pass. */
export function statusLabel(status) {
	if (status === 'not_run') return 'not run';
	if (status === 'not_applicable') return 'N/A';
	return status;
}

/** `pnpm run secret:scan` -> `secret:scan`; anything else -> null. */
export function scriptNameOfCommand(command) {
	if (typeof command !== 'string') return null;
	if (!/^pnpm run [A-Za-z0-9:._-]+$/.test(command.trim())) return null;
	const names = [...command.matchAll(PNPM_RUN_PATTERN)].map((match) => match[1]);
	return names.length === 1 ? names[0] : null;
}

/** Every `pnpm run` a command body invokes, in order. */
function referencedScriptNames(text) {
	return [...String(text).matchAll(PNPM_RUN_PATTERN)].map((match) => match[1]);
}

/** Transitive `pnpm run` closure of one script. */
export function expandScriptNames(scripts, entry, seen = new Set()) {
	if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) return [];
	seen.add(entry);
	const body = scripts?.[entry];
	if (typeof body !== 'string') return [];
	const out = [entry];
	for (const name of referencedScriptNames(body)) {
		out.push(...expandScriptNames(scripts, name, seen));
	}
	return [...new Set(out)];
}

/** Collect the four surfaces the manifest can declare. */
export function collectSurfaces({ scripts = {}, workflowText = '' } = {}) {
	const surfaces = {};
	for (const surface of ['fast', 'integration', 'release']) {
		surfaces[surface] = new Set(expandScriptNames(scripts, SURFACE_ENTRIES[surface]));
	}
	const ci = new Set();
	for (const name of referencedScriptNames(workflowText)) {
		ci.add(name);
		for (const expanded of expandScriptNames(scripts, name)) ci.add(expanded);
	}
	surfaces.ci = ci;
	return surfaces;
}

/**
 * Evaluate the ledger against one repository description.
 *
 * Pure with respect to the filesystem: scripts, surfaces and fileExists
 * are injected so the on-disk fixtures drive the same code path as the
 * real checkout.
 */
export function evaluateAsvsCoverage({
	manifest,
	scripts = {},
	surfaces = {},
	fileExists = () => true,
}) {
	const errors = [];
	const rows = [];

	if (manifest?.version !== 1) errors.push('manifest: `version` must be 1');
	const standard = manifest?.standard;
	if (!standard || typeof standard !== 'object') {
		errors.push('manifest.standard: an ASVS identity block is required');
	} else {
		if (!isRealText(standard.name, 5)) errors.push('manifest.standard.name: missing');
		if (!isRealText(standard.version, 3)) errors.push('manifest.standard.version: missing');
		if (standard.certification !== false) {
			errors.push(
				'manifest.standard.certification: must be false — this ledger is not an ASVS certification',
			);
		}
		if (!isRealText(standard.note, 20)) {
			errors.push('manifest.standard.note: state what the ledger is and is not');
		}
	}
	if (!isRealText(manifest?.policy, 20)) {
		errors.push('manifest.policy: state how evidence and the four statuses are judged');
	}
	if (!Array.isArray(manifest?.target_levels) || manifest.target_levels.length === 0) {
		errors.push('manifest.target_levels: list the ASVS levels this ledger targets');
	}

	const items = Array.isArray(manifest?.items) ? manifest.items : [];
	if (items.length === 0) errors.push('manifest.items: at least one requirement must be selected');

	const seen = new Set();
	for (const [index, item] of items.entries()) {
		const label = `items[${item?.id ?? index}]`;
		if (typeof item?.id !== 'string' || !REQ_ID_PATTERN.test(item.id)) {
			errors.push(`${label}.id: expected an ASVS id like V3.4.4`);
			continue;
		}
		if (seen.has(item.id)) {
			errors.push(`${label}: duplicate id "${item.id}"`);
			continue;
		}
		seen.add(item.id);

		for (const field of ['chapter', 'section', 'level', 'requirement', 'control']) {
			if (!isRealText(item[field], field === 'level' ? 2 : 5)) {
				errors.push(`${label}.${field}: missing`);
			}
		}
		if (item.applicability !== 'applicable' && item.applicability !== 'not_applicable') {
			errors.push(`${label}.applicability: must be applicable or not_applicable`);
			continue;
		}
		if (!Array.isArray(item.issues)) errors.push(`${label}.issues: must be an array`);
		else if (item.issues.some((issue) => !Number.isInteger(issue) || issue <= 0)) {
			errors.push(`${label}.issues: every entry must be a positive Issue number`);
		}
		const evidence = Array.isArray(item.evidence) ? item.evidence : [];
		if (!Array.isArray(item.evidence)) errors.push(`${label}.evidence: must be an array`);

		const row = {
			id: item.id,
			chapter: item.chapter ?? '',
			section: item.section ?? '',
			level: item.level ?? '',
			requirement: item.requirement ?? '',
			applicability: item.applicability,
			control: item.control ?? '',
			issues: Array.isArray(item.issues) ? item.issues : [],
			evidence,
			evidence_results: [],
			follow_up: item.follow_up ?? null,
			reason: item.reason ?? null,
			note: item.note ?? null,
			status: 'fail',
		};

		if (item.applicability === 'not_applicable') {
			if (!isRealText(item.reason, 20)) {
				errors.push(`${label}.reason: a not_applicable requirement must say why`);
				row.status = 'fail';
			} else if (evidence.length > 0) {
				errors.push(`${label}: a not_applicable requirement carries no evidence`);
				row.status = 'fail';
			} else {
				row.status = 'not_applicable';
			}
			row.note = item.reason ?? row.note;
			rows.push(row);
			continue;
		}

		if (evidence.length === 0) {
			if (!isRealText(item.follow_up, 20)) {
				errors.push(
					`${label}: an applicable requirement with no evidence must record the future manual work in follow_up`,
				);
				row.status = 'fail';
			} else {
				row.status = 'not_run';
				row.note = item.follow_up;
			}
			rows.push(row);
			continue;
		}

		let failed = false;
		for (const [evidenceIndex, entry] of evidence.entries()) {
			const detail = evaluateEvidence(entry, { scripts, surfaces, fileExists });
			row.evidence_results.push(detail);
			if (!detail.ok) {
				failed = true;
				errors.push(`${label}.evidence[${evidenceIndex}]: ${detail.message}`);
			}
		}
		row.status = failed ? 'fail' : 'pass';
		rows.push(row);
	}

	const summary = { pass: 0, fail: 0, not_run: 0, not_applicable: 0 };
	for (const row of rows) summary[row.status] += 1;
	return { errors, rows, summary };
}

function evaluateEvidence(entry, { scripts, surfaces, fileExists }) {
	if (!entry || typeof entry !== 'object') {
		return {
			ok: false,
			kind: 'unknown',
			label: '<invalid>',
			message: 'evidence entry is not an object',
		};
	}
	if (entry.kind === 'test' || entry.kind === 'doc') {
		if (!isRealText(entry.path, 5)) {
			return {
				ok: false,
				kind: entry.kind,
				label: '<missing path>',
				message: `${entry.kind} path is missing`,
			};
		}
		const exists = fileExists(entry.path);
		return {
			ok: exists,
			kind: entry.kind,
			label: entry.path,
			message: exists ? 'exists' : `${entry.kind} file does not exist: ${entry.path}`,
		};
	}
	if (entry.kind === 'gate') {
		const script = scriptNameOfCommand(entry.command);
		if (script === null) {
			return {
				ok: false,
				kind: 'gate',
				label: entry.command ?? '<missing command>',
				message: 'gate evidence must be exactly one `pnpm run <script>`',
			};
		}
		if (typeof scripts?.[script] !== 'string') {
			return {
				ok: false,
				kind: 'gate',
				label: entry.command,
				message: `"${script}" is not registered in package.json#scripts`,
			};
		}
		const declared = Array.isArray(entry.surfaces) ? entry.surfaces : [];
		if (declared.length === 0) {
			return {
				ok: false,
				kind: 'gate',
				label: entry.command,
				message: 'gate evidence must declare at least one surface',
			};
		}
		const missing = declared.filter((surface) => !SURFACES.includes(surface));
		if (missing.length > 0) {
			return {
				ok: false,
				kind: 'gate',
				label: entry.command,
				message: `unknown surface(s): ${missing.join(', ')}`,
			};
		}
		const absent = declared.filter((surface) => !surfaces?.[surface]?.has(script));
		if (absent.length > 0) {
			return {
				ok: false,
				kind: 'gate',
				label: entry.command,
				message: `"${script}" is not reachable from ${absent.join(', ')}`,
			};
		}
		return {
			ok: true,
			kind: 'gate',
			label: entry.command,
			message: `reachable from ${declared.join(', ')}`,
		};
	}
	return {
		ok: false,
		kind: String(entry.kind),
		label: entry.path ?? entry.command ?? '<unknown>',
		message: `unknown evidence kind "${entry.kind}"`,
	};
}

/** Load and evaluate the real checkout. */
export function checkAsvsCoverage({ root = REPO_ROOT, manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'));
	} catch (error) {
		return {
			errors: [`${manifestPath}: ${error.message}`],
			rows: [],
			summary: { pass: 0, fail: 0, not_run: 0, not_applicable: 0 },
			manifest: null,
		};
	}
	const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	const workflowText = existsSync(resolve(root, WORKFLOW_PATH))
		? readFileSync(resolve(root, WORKFLOW_PATH), 'utf8')
		: '';
	const surfaces = collectSurfaces({ scripts: pkg.scripts ?? {}, workflowText });
	return {
		manifest,
		...evaluateAsvsCoverage({
			manifest,
			scripts: pkg.scripts ?? {},
			surfaces,
			fileExists: (path) => existsSync(resolve(root, path)),
		}),
	};
}

/** Load an on-disk fixture: manifest + the world it is evaluated in. */
export function loadFixture(root, name) {
	const fixture = JSON.parse(readFileSync(resolve(root, FIXTURE_DIR, name), 'utf8'));
	return fixture;
}

/** Evaluate a fixture with its own scripts/files, not the real checkout. */
export function evaluateFixture(fixture) {
	const surfaces = collectSurfaces({
		scripts: fixture.scripts ?? {},
		workflowText: fixture.workflowText ?? '',
	});
	const files = new Set(fixture.files ?? []);
	return evaluateAsvsCoverage({
		manifest: fixture.manifest,
		scripts: fixture.scripts ?? {},
		surfaces,
		fileExists: (path) => files.has(path),
	});
}

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function reqSortValue(id) {
	const match = /^V(\d+)\.(\d+)\.(\d+)$/.exec(id);
	return match
		? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3])
		: Number.POSITIVE_INFINITY;
}

function renderEvidence(row) {
	if (row.evidence_results.length === 0) return '<span class="muted">—</span>';
	return row.evidence_results
		.map((entry) => {
			const label = entry.kind === 'gate' ? `gate ${entry.label}` : `${entry.kind} ${entry.label}`;
			return `<span class="evidence ${entry.ok ? 'ok' : 'bad'}">${escapeHtml(label)}</span>`;
		})
		.join('<br>');
}

function renderRow(row) {
	const status = row.status;
	return `<tr class="row-${status}">
		<td class="id">${escapeHtml(row.id)}</td>
		<td class="level">${escapeHtml(row.level)}</td>
		<td class="req">${escapeHtml(row.requirement)}</td>
		<td class="control">${escapeHtml(row.control)}${
			row.issues.length > 0
				? `<br><span class="issues">${row.issues.map((issue) => `#${issue}`).join(' ')}</span>`
				: ''
		}</td>
		<td class="evidence-cell">${renderEvidence(row)}</td>
		<td class="status"><span class="badge badge-${status}">${escapeHtml(statusLabel(status))}</span></td>
	</tr>`;
}

function renderProbe(probe) {
	const result = probe.result;
	const errors = result.errors.length
		? `<ul class="probe-errors">${result.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
		: '<p class="muted">no error</p>';
	return `<div class="probe">
		<h3>${escapeHtml(probe.name)}</h3>
		<p class="muted">${escapeHtml(probe.note ?? '')}</p>
		<p>${STATUSES.map(
			(status) =>
				`<span class="badge badge-${status}">${escapeHtml(statusLabel(status))} ${result.summary[status] ?? 0}</span>`,
		).join(' ')}</p>
		${errors}
	</div>`;
}

/**
 * Render the coverage ledger as a standalone HTML page.
 *
 * The same rows are rendered in source order by ASVS chapter so a
 * reviewer can read the selected standard top-to-bottom; the summary is
 * computed from the evaluator, not from authored text.
 */
export function renderReport({ manifest, result, probes = [], sourceSha = 'unknown' }) {
	const rows = [...result.rows].sort((a, b) => reqSortValue(a.id) - reqSortValue(b.id));
	const unverified = rows.filter((row) => row.status === 'not_run');
	const na = rows.filter((row) => row.status === 'not_applicable');
	const standard = manifest?.standard ?? {};
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>OWASP ASVS 5.0 coverage ledger — my-web-2026</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px; background: #f8fafc; color: #0f172a; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1180px; margin: 0 auto; }
h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: -0.02em; }
h2 { margin: 30px 0 10px; font-size: 18px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; }
h3 { margin: 0 0 4px; font-size: 14px; }
.sub { color: #475569; margin: 0 0 16px; }
.banner { margin: 16px 0; padding: 12px 16px; border-left: 5px solid #b45309; background: #fffbeb; color: #78350f; font-weight: 600; }
.cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 8px; }
.card { min-width: 120px; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; }
.card strong { display: block; font-size: 24px; line-height: 1.1; }
.card span { color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.badge-pass { background: #dcfce7; color: #166534; }
.badge-fail { background: #fee2e2; color: #991b1b; }
.badge-not_run { background: #fef3c7; color: #92400e; }
.badge-not_applicable { background: #e2e8f0; color: #475569; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #cbd5e1; }
th, td { padding: 2px 5px; border-bottom: 1px solid #e2e8f0; vertical-align: top; text-align: left; }
th { position: sticky; top: 0; background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
td { font-size: 9px; line-height: 1.22; }
td.id { font-weight: 700; white-space: nowrap; }
td.level { white-space: nowrap; }
td.req { width: 48%; }
td.control { width: 16%; color: #334155; }
td.evidence-cell { width: 18%; }
td.status { width: 8%; white-space: nowrap; }
.row-fail { background: #fff1f2; }
.row-not_run { background: #fffbeb; }
.row-not_applicable { background: #f8fafc; }
.evidence { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5px; }
.evidence.ok { color: #166534; }
.evidence.bad { color: #991b1b; }
.issues { color: #0369a1; font-size: 10px; }
.muted { color: #64748b; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 10px 0 4px; font-size: 11px; color: #475569; }
.note { padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; margin: 10px 0; }
.note.warn { border-color: #f59e0b; background: #fffbeb; }
.note.info { border-color: #93c5fd; background: #eff6ff; }
.note ul { margin: 6px 0 0 18px; padding: 0; }
.note li { margin-bottom: 5px; }
.probes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.probe { border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 10px 12px; }
.probe-errors { margin: 6px 0 0 18px; padding: 0; color: #991b1b; font-size: 11px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 10.5px; }
pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 11px; }
footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #cbd5e1; color: #64748b; font-size: 11px; }
</style>
</head>
<body>
<main>
<h1>OWASP ASVS 5.0 coverage ledger</h1>
<p class="sub">my-web-2026 · Issue #507 · generated at <code>${escapeHtml(sourceSha)}</code></p>
<div class="banner">NOT AN ASVS CERTIFICATION. This page is a repository coverage ledger for selected ASVS ${escapeHtml(
		standard.version ?? '',
	)} requirements. It is not an audit and does not claim that the platform satisfies the whole standard.</div>
<p class="sub">${escapeHtml(standard.note ?? '')}</p>
<p class="sub">Standard: <a href="${escapeHtml(standard.url ?? '#')}">${escapeHtml(
		standard.name ?? 'OWASP ASVS',
	)} ${escapeHtml(standard.version ?? '')}</a> · target levels ${escapeHtml(
		(manifest?.target_levels ?? []).join(' / '),
	)} · <a href="${escapeHtml(standard.requirements_url ?? '#')}">requirement source</a></p>

<section id="asvs-coverage">
<div class="cards">
	<div class="card"><strong>${result.rows.length}</strong><span>selected requirements</span></div>
	<div class="card"><strong>${result.summary.pass}</strong><span>pass</span></div>
	<div class="card"><strong>${result.summary.fail}</strong><span>fail</span></div>
	<div class="card"><strong>${result.summary.not_run}</strong><span>not run (unverified)</span></div>
	<div class="card"><strong>${result.summary.not_applicable}</strong><span>not applicable</span></div>
</div>
<div class="legend">
	<span><span class="badge badge-pass">pass</span> evidence resolves</span>
	<span><span class="badge badge-fail">fail</span> claim contradicted</span>
	<span><span class="badge badge-not_run">not run</span> applicable, no evidence — never a pass</span>
	<span><span class="badge badge-not_applicable">N/A</span> surface absent, reason recorded</span>
</div>

<h2>Unverified applicable requirements (not run)</h2>
${
	unverified.length === 0
		? '<p class="muted">None. Every applicable row has evidence today.</p>'
		: `<div class="note warn"><strong>${unverified.length} applicable requirement(s) have no repository evidence.</strong> They are shown as unverified and are not counted in the pass total.<ul>${unverified
				.map(
					(row) =>
						`<li><strong>${escapeHtml(row.id)}</strong> — ${escapeHtml(row.follow_up ?? row.note ?? '')}</li>`,
				)
				.join('')}</ul></div>`
}

<h2>Not applicable in this release</h2>
<div class="note info"><ul>${na
		.map(
			(row) => `<li><strong>${escapeHtml(row.id)}</strong> — ${escapeHtml(row.reason ?? '')}</li>`,
		)
		.join('')}</ul></div>

<h2>Coverage matrix</h2>
<table>
<thead><tr><th>ID</th><th>L</th><th>Requirement (ASVS 5.0.0)</th><th>Control / Issue</th><th>Repository evidence</th><th>Status</th></tr></thead>
<tbody>${rows.map(renderRow).join('')}</tbody>
</table>

</section>

<section id="asvs-probes">
<h2>False-green probes</h2>
<p class="sub">The same pure evaluator runs on the on-disk fixtures. A ledger that cannot fail is not evidence.</p>
<div class="probes">${probes.map(renderProbe).join('')}</div>

<h2>Reproduce</h2>
<pre>pnpm run asvs:check
pnpm run asvs:report
pnpm run verify:asvs-coverage-screenshot
node --test scripts/check-asvs-coverage.test.mjs</pre>
<p class="sub">The image is evidence of the ledger; the test and the gate exit code are the authority. This ledger reads the working tree only — no Worker, no network, no D1/R2, no secret.</p>

</section>

<footer>Issue #507 · manifest <code>quality/asvs-coverage.json</code> · ${escapeHtml(
		standard.certification === false ? 'certification: false' : 'certification flag missing',
	)} · generated from <code>${escapeHtml(sourceSha)}</code></footer>
</main>
</body>
</html>
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

function main(argv) {
	const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : REPO_ROOT);
	const manifestPath = parseArg(argv, '--manifest') ?? DEFAULT_MANIFEST_PATH;
	const reportPath = parseArg(argv, '--report');
	const result = checkAsvsCoverage({ root, manifestPath });

	if (reportPath) {
		const probes = [];
		for (const name of PROBE_FIXTURES) {
			try {
				const fixture = loadFixture(root, name);
				probes.push({ name, note: fixture.note, result: evaluateFixture(fixture) });
			} catch (error) {
				probes.push({
					name,
					note: `fixture unreadable: ${error.message}`,
					result: {
						errors: [error.message],
						rows: [],
						summary: { pass: 0, fail: 0, not_run: 0, not_applicable: 0 },
					},
				});
			}
		}
		const target = resolve(root, reportPath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(
			target,
			renderReport({ manifest: result.manifest, result, probes, sourceSha: headSha(root) }),
		);
		process.stdout.write(`wrote ${reportPath}\n`);
	}

	if (result.errors.length === 0) {
		const { pass, fail, not_run, not_applicable } = result.summary;
		process.stdout.write(
			`ASVS coverage ledger OK: ${result.rows.length} selected, ${pass} pass, ${fail} fail, ${not_run} not run (unverified), ${not_applicable} N/A\n`,
		);
		return 0;
	}

	process.stderr.write(
		`ASVS coverage ledger: ${result.errors.length} problem(s) in ${manifestPath}:\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.stderr.write(
		[
			'',
			'An applicable requirement with no evidence must be recorded as not run with follow_up.',
			'Never turn missing evidence into a pass. See docs/verification/security/asvs-coverage.md.',
			'',
		].join('\n'),
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
