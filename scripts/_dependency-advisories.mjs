/**
 * Dependency advisory gate logic (Issue #470).
 *
 * This module owns the *decision*, and nothing else: how a registry
 * advisory document is normalised, how the reviewed gate declaration is
 * validated, and how the two are combined into one verdict. It performs
 * no I/O, spawns nothing, and reads no environment value, so every
 * branch in it is reachable from a fixture.
 *
 * Why the decision is separated from the acquisition
 * --------------------------------------------------
 * The gate has one failure mode that must never be silent: a registry
 * that cannot be reached, rate-limits the audit endpoint, or answers
 * with an error document. A tool that treats "no document" as "no
 * advisories" reports a green gate for a dependency tree nobody
 * inspected. So the verdict carries an explicit `dataStatus`, and a
 * result with unavailable data can never evaluate to `pass` — there is
 * no code path from an empty finding list to `pass` that skips the data
 * status check.
 *
 * Severity policy, exceptions and expiry
 * --------------------------------------
 * Which severities stop the build, which are only reported, and which
 * advisory may be tolerated until when are *declared* in
 * `quality/dependency-advisory-gate.json`, not hard-coded here. An
 * exception is a reviewed record with a reason, an approver, a tracking
 * issue and an expiry date; an expired record stops being an exception
 * and becomes an ordinary blocking finding, so an exception cannot
 * silently become permanent by being left in the file.
 *
 * Secret posture (AGENTS.md section 4)
 * -----------------------------------
 * Nothing in this module reads a credential, `.dev.vars`, Infisical or
 * a Worker secret. The inputs are one advisory document (package names,
 * versions, advisory ids, public URLs) and one reviewed policy file.
 * See docs/runbook/dependency-advisories.md.
 */

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export const SEVERITY_RANK = Object.freeze({
	info: 0,
	low: 1,
	moderate: 2,
	high: 3,
	critical: 4,
});

export const ENFORCEMENT_MODES = Object.freeze(['audit', 'block']);

export const DATA_UNAVAILABLE_POLICIES = Object.freeze(['fail']);

/** Verdict statuses. Every one of them is printable and testable. */
export const STATUS = Object.freeze({
	/** Data available, no blocking finding outstanding. */
	PASS: 'pass',
	/** Data available, blocking findings outstanding, enforcement `block`. */
	FAIL: 'fail',
	/**
	 * Data available, blocking findings outstanding, enforcement `audit`.
	 * Recorded, not blocking — never rendered as "clean".
	 */
	AUDIT_FINDINGS: 'audit-findings',
	/** The advisory document could not be obtained or understood. */
	DATA_UNAVAILABLE: 'data-unavailable',
});

const GATE_KEYS = new Set([
	'schemaVersion',
	'gate',
	'issue',
	'enforcement',
	'blockingSeverities',
	'reportedSeverities',
	'dataUnavailable',
	'advisorySource',
	'note',
	'exceptions',
]);

const EXCEPTION_KEYS = new Set([
	'advisoryId',
	'package',
	'severity',
	'reason',
	'approvedBy',
	'trackingIssue',
	'expiresOn',
]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Raised for a malformed advisory document or a malformed gate declaration. */
export class GateDefinitionError extends Error {
	constructor(message) {
		super(message);
		this.name = 'GateDefinitionError';
	}
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value, label, { allowEmpty = false } = {}) {
	if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
		throw new GateDefinitionError(`${label} must be a non-empty string`);
	}
	return value;
}

function uniqueSorted(values) {
	return [...new Set(values)].sort();
}

/**
 * Stable identity for one advisory.
 *
 * GHSA ids are the identity a reviewer reads and the identity an
 * exception is written against, so they win when present. A registry
 * document without one (an npm-audit-only advisory) falls back to
 * `npm:<id>` and finally to the advisory URL, which keeps the identity
 * stable across runs instead of depending on object key order. The
 * reported case is preserved — an operator copy-pastes this string into
 * the GitHub advisory database — and case-insensitive matching is the
 * caller's job.
 */
export function advisoryIdentity(severityKey, raw) {
	const ghsa = typeof raw?.github_advisory_id === 'string' ? raw.github_advisory_id.trim() : '';
	if (ghsa.length > 0) return ghsa;
	const id = raw?.id;
	if (id !== undefined && id !== null && `${id}`.trim().length > 0) return `npm:${`${id}`.trim()}`;
	const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
	if (url.length > 0) return url;
	throw new GateDefinitionError(`advisory ${severityKey} has no id, github_advisory_id or url`);
}

function normaliseSeverity(value, label) {
	if (typeof value !== 'string') {
		throw new GateDefinitionError(`${label} has no severity`);
	}
	const severity = value.trim().toLowerCase();
	if (!SEVERITIES.includes(severity)) {
		// An unknown severity is NOT downgraded to `low`. A future
		// registry severity that this gate does not know must stop the
		// build until a human decides where it ranks.
		throw new GateDefinitionError(
			`${label} has unknown severity "${value}" (known: ${SEVERITIES.join(', ')})`,
		);
	}
	return severity;
}

function normaliseFindingEntries(raw, label) {
	if (raw.findings === undefined || raw.findings === null) return [];
	if (!Array.isArray(raw.findings)) {
		throw new GateDefinitionError(`${label}.findings must be an array when present`);
	}
	const paths = [];
	const versions = [];
	let entries = 0;
	let devEntries = 0;
	for (const entry of raw.findings) {
		if (!isPlainObject(entry)) {
			throw new GateDefinitionError(`${label}.findings entries must be objects`);
		}
		entries += 1;
		if (entry.dev === true) devEntries += 1;
		if (typeof entry.version === 'string') versions.push(entry.version);
		if (Array.isArray(entry.paths)) {
			for (const path of entry.paths) if (typeof path === 'string') paths.push(path);
		}
	}
	return {
		paths: uniqueSorted(paths),
		versions: uniqueSorted(versions),
		devOnly: entries > 0 && entries === devEntries,
	};
}

/**
 * Normalise a `pnpm audit --json` document into findings.
 *
 * The document shape is `{ advisories: { <id>: {...} }, metadata: {...} }`.
 * Anything else — including an error document such as
 * `{ "error": { ... } }` — is rejected rather than normalised to an empty
 * list, because an empty list is indistinguishable from "clean" at the
 * call site.
 */
export function parseAdvisoryPayload(payload) {
	if (!isPlainObject(payload)) {
		throw new GateDefinitionError('advisory payload is not a JSON object');
	}
	if (!isPlainObject(payload.advisories)) {
		const keys = Object.keys(payload).join(', ') || '(none)';
		throw new GateDefinitionError(
			`advisory payload has no "advisories" object (top-level keys: ${keys})`,
		);
	}
	const findings = [];
	for (const [key, raw] of Object.entries(payload.advisories)) {
		const label = `advisories[${key}]`;
		if (!isPlainObject(raw)) throw new GateDefinitionError(`${label} must be an object`);
		const severity = normaliseSeverity(raw.severity, label);
		const pkg = requireString(raw.module_name, `${label}.module_name`);
		const entry = normaliseFindingEntries(raw, label);
		findings.push({
			id: advisoryIdentity(key, raw),
			registryId: `${raw.id ?? key}`,
			package: pkg,
			severity,
			title: typeof raw.title === 'string' ? raw.title : '(untitled advisory)',
			url: typeof raw.url === 'string' ? raw.url : '',
			vulnerableVersions:
				typeof raw.vulnerable_versions === 'string' ? raw.vulnerable_versions : '',
			patchedVersions: typeof raw.patched_versions === 'string' ? raw.patched_versions : '',
			paths: entry.paths,
			versions: entry.versions,
			devOnly: entry.devOnly,
		});
	}
	findings.sort((a, b) => {
		const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
		if (bySeverity !== 0) return bySeverity;
		if (a.package !== b.package) return a.package < b.package ? -1 : 1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
	return findings;
}

function normaliseException(raw, index) {
	const label = `exceptions[${index}]`;
	if (!isPlainObject(raw)) throw new GateDefinitionError(`${label} must be an object`);
	for (const key of Object.keys(raw)) {
		if (!EXCEPTION_KEYS.has(key)) {
			throw new GateDefinitionError(`${label} has unknown key "${key}"`);
		}
	}
	const expiresOn = requireString(raw.expiresOn, `${label}.expiresOn`);
	if (!DATE_ONLY.test(expiresOn)) {
		throw new GateDefinitionError(`${label}.expiresOn must be a YYYY-MM-DD date`);
	}
	const trackingIssue = raw.trackingIssue;
	if (
		typeof trackingIssue !== 'number' &&
		!(typeof trackingIssue === 'string' && trackingIssue.trim().length > 0)
	) {
		throw new GateDefinitionError(`${label}.trackingIssue must be an Issue number or reference`);
	}
	return {
		advisoryId: requireString(raw.advisoryId, `${label}.advisoryId`),
		package: requireString(raw.package, `${label}.package`),
		severity: normaliseSeverity(raw.severity, label),
		reason: requireString(raw.reason, `${label}.reason`),
		approvedBy: requireString(raw.approvedBy, `${label}.approvedBy`),
		trackingIssue,
		expiresOn,
	};
}

/**
 * Validate the reviewed gate declaration.
 *
 * Unknown keys are rejected rather than ignored: a typo such as
 * `blockingSeverity` would otherwise leave the gate with an empty
 * blocking set and a silent pass, which is exactly the false green this
 * gate exists to prevent.
 */
export function parseGateDeclaration(declaration) {
	if (!isPlainObject(declaration)) {
		throw new GateDefinitionError('gate declaration is not a JSON object');
	}
	for (const key of Object.keys(declaration)) {
		if (!GATE_KEYS.has(key))
			throw new GateDefinitionError(`gate declaration has unknown key "${key}"`);
	}
	if (declaration.schemaVersion !== 1) {
		throw new GateDefinitionError(
			`unsupported gate schemaVersion ${JSON.stringify(declaration.schemaVersion)} (supported: 1)`,
		);
	}
	if (!ENFORCEMENT_MODES.includes(declaration.enforcement)) {
		throw new GateDefinitionError(
			`enforcement must be one of ${ENFORCEMENT_MODES.join(', ')} (got ${JSON.stringify(declaration.enforcement)})`,
		);
	}
	if (!DATA_UNAVAILABLE_POLICIES.includes(declaration.dataUnavailable)) {
		throw new GateDefinitionError(
			`dataUnavailable must be one of ${DATA_UNAVAILABLE_POLICIES.join(', ')} (got ${JSON.stringify(declaration.dataUnavailable)}) — an advisory scan that cannot read its data source must not be reported as clean`,
		);
	}
	const readSeverities = (value, label) => {
		if (!Array.isArray(value)) throw new GateDefinitionError(`${label} must be an array`);
		const out = value.map((entry, index) => normaliseSeverity(entry, `${label}[${index}]`));
		if (new Set(out).size !== out.length) {
			throw new GateDefinitionError(`${label} contains duplicates`);
		}
		return out;
	};
	const blockingSeverities = readSeverities(declaration.blockingSeverities, 'blockingSeverities');
	if (blockingSeverities.length === 0) {
		throw new GateDefinitionError('blockingSeverities must name at least one severity');
	}
	const reportedSeverities = readSeverities(
		declaration.reportedSeverities ?? [],
		'reportedSeverities',
	);
	for (const severity of reportedSeverities) {
		if (blockingSeverities.includes(severity)) {
			throw new GateDefinitionError(
				`severity "${severity}" is both blocking and reported; a severity has one meaning`,
			);
		}
	}
	const rawExceptions = declaration.exceptions ?? [];
	if (!Array.isArray(rawExceptions)) throw new GateDefinitionError('exceptions must be an array');
	const exceptions = rawExceptions.map(normaliseException);
	const seen = new Set();
	for (const exception of exceptions) {
		const key = exception.advisoryId.toUpperCase();
		if (seen.has(key)) {
			throw new GateDefinitionError(`duplicate exception for advisory ${exception.advisoryId}`);
		}
		seen.add(key);
	}
	return {
		schemaVersion: 1,
		gate: typeof declaration.gate === 'string' ? declaration.gate : 'dependency-advisory',
		issue: typeof declaration.issue === 'string' ? declaration.issue : '',
		enforcement: declaration.enforcement,
		blockingSeverities,
		reportedSeverities,
		dataUnavailable: declaration.dataUnavailable,
		advisorySource: isPlainObject(declaration.advisorySource) ? declaration.advisorySource : {},
		note: typeof declaration.note === 'string' ? declaration.note : '',
		exceptions,
	};
}

/** `YYYY-MM-DD` for the evaluation date, in UTC. */
function toDateOnly(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new GateDefinitionError(`evaluation date ${JSON.stringify(value)} is not a date`);
	}
	return date.toISOString().slice(0, 10);
}

/** Whole days from `from` (inclusive) to `expiresOn` (inclusive). */
export function daysUntilExpiry(expiresOn, from) {
	const start = Date.parse(`${toDateOnly(from)}T00:00:00Z`);
	const end = Date.parse(`${expiresOn}T00:00:00Z`);
	return Math.round((end - start) / 86_400_000);
}

/**
 * Combine normalised findings with the reviewed gate declaration.
 *
 * `findings` is the parsed advisory document; `now` is the evaluation
 * date (defaults to the current UTC date) so expiry behaviour is
 * testable without freezing the clock.
 */
export function evaluateAdvisories({ findings, gate, now = new Date() }) {
	const today = toDateOnly(now);
	const exceptionsByAdvisory = new Map(
		gate.exceptions.map((exception) => [exception.advisoryId.toUpperCase(), exception]),
	);
	const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
	const blocking = [];
	const excepted = [];
	const expired = [];
	const reported = [];
	const unusedExceptions = new Set(exceptionsByAdvisory.keys());

	for (const finding of findings) {
		counts[finding.severity] += 1;
		const key = finding.id.toUpperCase();
		const exception = exceptionsByAdvisory.get(key);
		if (!gate.blockingSeverities.includes(finding.severity)) {
			reported.push(finding);
			continue;
		}
		if (!exception) {
			blocking.push({ finding, reason: null });
			continue;
		}
		unusedExceptions.delete(key);
		const daysRemaining = daysUntilExpiry(exception.expiresOn, today);
		const record = { finding, exception, daysRemaining };
		// An expired record is not an exception any more. It is reported
		// separately so the reviewer sees both the finding and the
		// decision that used to cover it.
		if (daysRemaining < 0) {
			expired.push(record);
			blocking.push({ finding, reason: `exception expired on ${exception.expiresOn}` });
			continue;
		}
		if (exception.package !== finding.package || exception.severity !== finding.severity) {
			throw new GateDefinitionError(
				`exception for ${finding.id} declares ${exception.package}/${exception.severity} but the advisory is ${finding.package}/${finding.severity}`,
			);
		}
		excepted.push(record);
	}

	const staleExceptions = gate.exceptions
		.filter((exception) => unusedExceptions.has(exception.advisoryId.toUpperCase()))
		.map((exception) => ({
			exception,
			daysRemaining: daysUntilExpiry(exception.expiresOn, today),
		}));

	const blockingCount = blocking.length;
	const status =
		blockingCount === 0
			? STATUS.PASS
			: gate.enforcement === 'block'
				? STATUS.FAIL
				: STATUS.AUDIT_FINDINGS;

	return {
		gate,
		evaluatedOn: today,
		dataStatus: 'available',
		dataDetail: null,
		status,
		enforcement: gate.enforcement,
		blockingSeverities: [...gate.blockingSeverities],
		reportedSeverities: [...gate.reportedSeverities],
		counts,
		total: findings.length,
		blocking,
		excepted,
		expired,
		reported,
		staleExceptions,
		blockingCount,
	};
}

/**
 * The verdict for "the advisory document could not be read".
 *
 * There is deliberately no `findings` argument: a caller that could not
 * obtain data must not be able to reach `pass`, and it must not be able
 * to render a severity count either. Every number in this result is
 * `null`, so a report built from it cannot claim zero findings.
 */
export function evaluateUnavailableData({ gate, now = new Date(), reason }) {
	return {
		gate,
		evaluatedOn: toDateOnly(now),
		dataStatus: 'unavailable',
		dataDetail: requireString(reason, 'reason'),
		status: STATUS.DATA_UNAVAILABLE,
		enforcement: gate.enforcement,
		blockingSeverities: [...gate.blockingSeverities],
		reportedSeverities: [...gate.reportedSeverities],
		counts: Object.fromEntries(SEVERITIES.map((severity) => [severity, null])),
		total: null,
		blocking: [],
		excepted: [],
		expired: [],
		reported: [],
		staleExceptions: [],
		blockingCount: null,
	};
}

/**
 * Human / CI text. Status-only by construction: it prints advisory ids,
 * package names, versions, public advisory URLs and the reviewed
 * exception record — never a credential, because no credential is ever
 * an input to this module.
 */
export function renderText(result, { source, gatePath } = {}) {
	const lines = [];
	const heading =
		result.status === STATUS.PASS
			? 'dependency advisory gate: PASS'
			: result.status === STATUS.FAIL
				? 'dependency advisory gate: FAIL'
				: result.status === STATUS.AUDIT_FINDINGS
					? 'dependency advisory gate: FINDINGS RECORDED (enforcement: audit)'
					: 'dependency advisory gate: DATA UNAVAILABLE';
	lines.push(heading);
	lines.push(`  source:              ${source ?? 'unknown'}`);
	lines.push(`  gate declaration:    ${gatePath ?? 'unknown'}`);
	lines.push(`  evaluated on:        ${result.evaluatedOn}`);
	lines.push(`  blocking severities: ${result.blockingSeverities.join(', ')}`);
	if (result.dataStatus === 'unavailable') {
		lines.push('  advisory data:       UNAVAILABLE');
		lines.push(`  reason:              ${result.dataDetail}`);
		lines.push('  note:                the registry advisory document was not read, so the');
		lines.push('                        advisory count is UNKNOWN, not zero. This gate fails');
		lines.push('                        closed instead of reporting a clean tree.');
		return `${lines.join('\n')}\n`;
	}
	lines.push(`  enforcement:         ${result.enforcement}`);
	lines.push(`  advisories reported: ${result.total}`);
	lines.push(
		`  by severity:          ${
			SEVERITIES.filter((severity) => result.counts[severity] > 0)
				.map((severity) => `${severity}=${result.counts[severity]}`)
				.join(' ') || '(none)'
		}`,
	);
	lines.push(
		`  blocking after exceptions: ${result.blockingCount}${
			result.enforcement === 'audit' && result.blockingCount > 0
				? ' (enforcement is audit: recorded, not blocking)'
				: ''
		}`,
	);

	if (result.blocking.length > 0) {
		lines.push('');
		lines.push(`blocking advisories (${result.blocking.length}):`);
		for (const { finding, reason } of result.blocking) {
			lines.push(
				`  - [${finding.severity}] ${finding.id} ${finding.package} (installed: ${
					finding.versions.join(', ') || 'unknown'
				}; patched: ${finding.patchedVersions || 'not published'})`,
			);
			if (reason) lines.push(`      ${reason}`);
			if (finding.devOnly) lines.push('      dev-dependency path only');
			if (finding.url) lines.push(`      ${finding.url}`);
		}
	}
	if (result.excepted.length > 0) {
		lines.push('');
		lines.push(`approved exceptions in force (${result.excepted.length}):`);
		for (const { finding, exception, daysRemaining } of result.excepted) {
			lines.push(
				`  - [${finding.severity}] ${finding.id} ${finding.package} — approved by ${exception.approvedBy} until ${exception.expiresOn} (${daysRemaining} day(s) left)`,
			);
			lines.push(`      reason: ${exception.reason}`);
			lines.push(`      tracking: ${exception.trackingIssue}`);
		}
	}
	if (result.expired.length > 0) {
		lines.push('');
		lines.push(`expired exceptions treated as blocking (${result.expired.length}):`);
		for (const { finding, exception, daysRemaining } of result.expired) {
			lines.push(
				`  - [${finding.severity}] ${finding.id} ${finding.package} — exception expired ${exception.expiresOn} (${Math.abs(daysRemaining)} day(s) ago); renew or remediate`,
			);
		}
	}
	if (result.staleExceptions.length > 0) {
		lines.push('');
		lines.push(`exception records with no matching advisory (${result.staleExceptions.length}):`);
		for (const { exception, daysRemaining } of result.staleExceptions) {
			lines.push(
				`  - ${exception.advisoryId} ${exception.package} — no advisory in this document; remove the record (${daysRemaining} day(s) to expiry)`,
			);
		}
	}
	if (result.reported.length > 0) {
		lines.push('');
		lines.push(`non-blocking advisories (${result.reported.length}):`);
		for (const finding of result.reported) {
			lines.push(`  - [${finding.severity}] ${finding.id} ${finding.package}`);
		}
	}
	lines.push('');
	lines.push('remediation: docs/runbook/dependency-advisories.md');
	return `${lines.join('\n')}\n`;
}
