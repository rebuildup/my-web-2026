/**
 * Dependency advisory gate — inspection report (Issue #470).
 *
 * Renders the verdict of `scripts/check-dependency-advisories.mjs` as a
 * single self-contained HTML document: no script tag, no external asset
 * reference, no network fetch. That is a hard requirement rather than a
 * style choice — the report is committed as a PR screenshot source and
 * uploaded as a CI artifact, so it has to open identically offline, and
 * a document that could execute would make the artifact untrustworthy.
 *
 * The report is also where "data unavailable" becomes visible to a human:
 * a scan that could not read the registry renders its severity table with
 * an explicit `unknown`, never with a zero. Rendering zero here would
 * undo the fail-closed rule the gate enforces in code.
 */

import { SEVERITIES, STATUS } from './_dependency-advisories.mjs';

/** Escape every interpolated value. Advisory titles come from the network. */
export function escapeHtml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const STATUS_STYLE = {
	[STATUS.PASS]: { label: 'PASS', colour: '#1f6f43', note: 'no blocking advisory outstanding' },
	[STATUS.FAIL]: {
		label: 'FAIL',
		colour: '#a01b1b',
		note: 'blocking advisories are outstanding and enforcement is block',
	},
	[STATUS.AUDIT_FINDINGS]: {
		label: 'FINDINGS RECORDED',
		colour: '#8a5a00',
		note: 'blocking advisories are outstanding; enforcement is audit, so they are recorded rather than stopping the build',
	},
	[STATUS.DATA_UNAVAILABLE]: {
		label: 'DATA UNAVAILABLE',
		colour: '#a01b1b',
		note: 'the advisory document was not read; the advisory count is unknown, not zero',
	},
};

/**
 * Flatten a verdict into the shape the template renders.
 *
 * Kept separate from the template so the numbers in the screenshot can
 * be asserted directly, without parsing HTML.
 */
export function buildReportModel(result, meta = {}) {
	const counts = Object.fromEntries(
		SEVERITIES.map((severity) => [
			severity,
			result.dataStatus === 'available' ? result.counts[severity] : 'unknown',
		]),
	);
	return {
		title: 'my-web-2026 dependency advisory gate',
		status: result.status,
		statusLabel: STATUS_STYLE[result.status]?.label ?? result.status,
		statusColour: STATUS_STYLE[result.status]?.colour ?? '#333333',
		statusNote: STATUS_STYLE[result.status]?.note ?? '',
		source: meta.source ?? 'unknown',
		gatePath: meta.gatePath ?? 'unknown',
		generatedAt: meta.generatedAt ?? result.evaluatedOn,
		evaluatedOn: result.evaluatedOn,
		issue: result.gate.issue || '(unrecorded)',
		enforcement: result.enforcement,
		blockingSeverities: result.blockingSeverities,
		reportedSeverities: result.reportedSeverities,
		dataStatus: result.dataStatus,
		dataDetail: result.dataDetail,
		counts,
		total: result.total === null ? 'unknown' : result.total,
		blockingCount: result.blockingCount === null ? 'unknown' : result.blockingCount,
		blocking: result.blocking.map(({ finding, reason }) => ({
			id: finding.id,
			package: finding.package,
			severity: finding.severity,
			title: finding.title,
			versions: finding.versions.join(', ') || 'unknown',
			patchedVersions: finding.patchedVersions || 'not published',
			vulnerableVersions: finding.vulnerableVersions || 'unrecorded',
			url: finding.url,
			devOnly: finding.devOnly,
			path: finding.paths[0] ?? '(no dependency path recorded)',
			reason,
		})),
		excepted: result.excepted.map(({ finding, exception, daysRemaining }) => ({
			id: finding.id,
			package: finding.package,
			severity: finding.severity,
			reason: exception.reason,
			approvedBy: exception.approvedBy,
			trackingIssue: `${exception.trackingIssue}`,
			expiresOn: exception.expiresOn,
			daysRemaining,
			url: finding.url,
		})),
		expired: result.expired.map(({ finding, exception, daysRemaining }) => ({
			id: finding.id,
			package: finding.package,
			severity: finding.severity,
			expiresOn: exception.expiresOn,
			daysRemaining,
			approvedBy: exception.approvedBy,
			trackingIssue: `${exception.trackingIssue}`,
		})),
		stale: result.staleExceptions.map(({ exception, daysRemaining }) => ({
			id: exception.advisoryId,
			package: exception.package,
			severity: exception.severity,
			expiresOn: exception.expiresOn,
			daysRemaining,
		})),
		reported: result.reported.map((finding) => ({
			id: finding.id,
			package: finding.package,
			severity: finding.severity,
			patchedVersions: finding.patchedVersions || 'not published',
		})),
	};
}

function cell(value, className) {
	const cls = className ? ` class="${className}"` : '';
	return `<td${cls}>${escapeHtml(value)}</td>`;
}

function table(headings, rows) {
	if (rows.length === 0) {
		return `<p class="empty">none</p>`;
	}
	const head = headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join('');
	const body = rows.map((row) => `<tr>${row.map((value) => cell(value)).join('')}</tr>`).join('\n');
	return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 40px 44px 56px;
  background: #ffffff;
  color: #16161a;
  font-family: "Helvetica Neue", Helvetica, Arial, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  font-size: 14px;
  line-height: 1.55;
}
header { border-bottom: 3px solid #16161a; padding-bottom: 14px; }
h1 { font-size: 22px; letter-spacing: 0.01em; margin: 0 0 6px; }
.subtitle { color: #5b5b66; font-size: 13px; margin: 0; }
.banner {
  margin: 22px 0 8px;
  padding: 16px 18px;
  border: 2px solid currentColor;
  color: inherit;
}
.banner .label { font-size: 20px; font-weight: 700; letter-spacing: 0.06em; }
.banner .note { margin-top: 6px; font-size: 13px; color: #3a3a44; }
h2 { font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; margin: 30px 0 8px; }
table { border-collapse: collapse; width: 100%; margin: 4px 0 6px; }
th, td { border: 1px solid #d3d3dc; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f4f4f7; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; }
td { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
dl { display: grid; grid-template-columns: 210px 1fr; gap: 4px 14px; margin: 0; }
dt { color: #5b5b66; }
dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.counts { display: flex; gap: 10px; flex-wrap: wrap; }
.counts div { border: 1px solid #d3d3dc; padding: 8px 12px; min-width: 108px; }
.counts .k { display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b5b66; }
.counts .v { display: block; font-size: 20px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.empty { margin: 2px 0; color: #5b5b66; font-size: 13px; }
.sev-critical { color: #a01b1b; font-weight: 700; }
.sev-high { color: #a01b1b; font-weight: 700; }
.sev-moderate { color: #8a5a00; }
.sev-low, .sev-info { color: #3a3a44; }
footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #d3d3dc; color: #5b5b66; font-size: 12px; }
`;

const FOOTER =
	'Rendered from a verdict produced by scripts/check-dependency-advisories.mjs. ' +
	'Advisory ids, package names and public advisory URLs only — no credential, ' +
	'environment value or Worker secret is an input to this report.';

/** Render the self-contained HTML document. */
export function renderReport(result, model = buildReportModel(result)) {
	const counts = SEVERITIES.map((severity) => {
		const value = model.counts[severity];
		const rendered = value === 'unknown' ? 'unknown' : escapeHtml(value);
		return `<div><span class="k">${escapeHtml(severity)}</span><span class="v ${value === 'unknown' ? '' : `sev-${severity}`}">${rendered}</span></div>`;
	}).join('\n');

	const dataRow =
		model.dataStatus === 'available'
			? '<dt>advisory data</dt><dd>read from the source above</dd>'
			: `<dt>advisory data</dt><dd>UNAVAILABLE — ${escapeHtml(model.dataDetail ?? 'no detail recorded')}</dd>`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(model.title)}</h1>
<p class="subtitle">Issue ${escapeHtml(model.issue)} &middot; fail-closed lockfile advisory gate</p>
</header>

<section class="banner" style="color: ${escapeHtml(model.statusColour)}">
<div class="label">${escapeHtml(model.statusLabel)}</div>
<div class="note">${escapeHtml(model.statusNote)}</div>
</section>

<h2>Run identity</h2>
<dl>
<dt>source</dt><dd>${escapeHtml(model.source)}</dd>
<dt>gate declaration</dt><dd>${escapeHtml(model.gatePath)}</dd>
<dt>evaluated on</dt><dd>${escapeHtml(model.evaluatedOn)}</dd>
<dt>report generated</dt><dd>${escapeHtml(model.generatedAt)}</dd>
<dt>enforcement</dt><dd>${escapeHtml(model.enforcement)}</dd>
<dt>blocking severities</dt><dd>${escapeHtml(model.blockingSeverities.join(', '))}</dd>
<dt>reported severities</dt><dd>${escapeHtml(model.reportedSeverities.join(', ') || '(none)')}</dd>
${dataRow}
</dl>

<h2>Advisories by severity</h2>
<div class="counts">
${counts}
</div>

<h2>Blocking (${escapeHtml(model.blockingCount)})</h2>
${table(
	['advisory id', 'severity', 'package', 'installed', 'patched in', 'dependency path', 'why'],
	model.blocking.map((row) => [
		row.id,
		row.severity,
		row.package,
		row.versions,
		row.patchedVersions,
		row.devOnly ? `${row.path} (dev dependency path)` : row.path,
		row.reason ?? 'no approved exception on file',
	]),
)}

<h2>Approved exceptions in force (${model.excepted.length})</h2>
${table(
	[
		'advisory id',
		'severity',
		'package',
		'reason',
		'approved by',
		'tracking',
		'expires',
		'days left',
	],
	model.excepted.map((row) => [
		row.id,
		row.severity,
		row.package,
		row.reason,
		row.approvedBy,
		row.trackingIssue,
		row.expiresOn,
		`${row.daysRemaining}`,
	]),
)}

<h2>Expired exceptions (${model.expired.length})</h2>
${table(
	['advisory id', 'severity', 'package', 'approved by', 'tracking', 'expired on', 'days past'],
	model.expired.map((row) => [
		row.id,
		row.severity,
		row.package,
		row.approvedBy,
		row.trackingIssue,
		row.expiresOn,
		`${Math.abs(row.daysRemaining)}`,
	]),
)}

<h2>Exception records without a matching advisory (${model.stale.length})</h2>
${table(
	['advisory id', 'severity', 'package', 'expires', 'days left'],
	model.stale.map((row) => [
		row.id,
		row.severity,
		row.package,
		row.expiresOn,
		`${row.daysRemaining}`,
	]),
)}

<h2>Non-blocking advisories (${model.reported.length})</h2>
${table(
	['advisory id', 'severity', 'package', 'patched in'],
	model.reported.map((row) => [row.id, row.severity, row.package, row.patchedVersions]),
)}

<footer>${escapeHtml(FOOTER)}</footer>
</body>
</html>
`;
}
