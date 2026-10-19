#!/usr/bin/env node

/**
 * Third-party connection scope / retention ledger gate (Issue #464).
 *
 * Why this gate exists
 * --------------------
 * `docs/domain/integrations.md` records three connection candidates
 * (GitHub, Notion, Discord) and promotes none of them. "None" is the
 * dangerous state for a security contract, because it is the state in
 * which nobody has written down what a connection *would* be allowed to
 * hold — and the first thing a promoting ticket does is ask for a token.
 * The questions that decide whether a token may exist at all are:
 *
 *   1. which scopes does this platform need, and which authority must it
 *      never hold?
 *   2. how long may a token live?
 *   3. who revokes it, on what trigger, within what deadline?
 *   4. can a caller tell, in a code it may log and render, that a grant
 *      was over-scoped or needs re-authorization?
 *
 * This gate answers (1)–(3) from
 * `quality/integration-scope.json` and *executes* (4) — it runs every
 * reviewed connection in that ledger through the real adapter
 * (`src/http/integrations/scope-review.ts`, the same function the Vitest
 * suite asserts on) and compares the measured verdict with the verdict
 * the ledger claims. A ledger that says "approved" for an over-scoped
 * connection is a false green and fails here.
 *
 * The failure mode this closes is *automatic publication*: an
 * integration token provisioned in `wrangler*.jsonc`, or a route mounted
 * under `/integrations/*`, while the owner allowlist is still empty.
 * Both are errors here, and `src/http/integrations/boundary.test.ts`
 * pins the same absence from the runtime side.
 *
 * Cheap by construction: a JSON parse, a Markdown table read, a text
 * scan of two Wrangler files, and pure function calls. No Worker, no
 * network, no D1/R2, no secret, no clock read (the ledger states its own
 * `as_of`).
 *
 *   node scripts/check-integration-scope.mjs
 *   pnpm run integration:scope:check
 *
 * Exit codes: 0 = ledger and measured verdicts agree, 1 = at least one
 * error, 2 = unusable input.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPE_REFUSAL_CODE, reviewConnection } from '../src/http/integrations/scope-review.ts';
import { collectSourceFiles, stripComments } from './_source-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'quality/integration-scope.json';
const ROSTER_DOC = 'docs/domain/integrations.md';
const ALLOWLIST_ENTRY_SHAPE = ['id', 'approved_by', 'approved_on', 'reason'];

/**
 * Reasons that mean "the author wrote nothing".
 *
 * Copied from `check-release-gate-coverage.mjs` on purpose: a ledger row
 * that says `tbd` for its revocation owner is not a reviewed row, and a
 * ledger is the only thing standing between "not promoted yet" and "a
 * token exists".
 */
const PLACEHOLDER_REASONS = new Set(['tbd', 'todo', 'n/a', 'na', 'none', 'later', '-']);

/**
 * Material that must never reach a committed artefact.
 *
 * Shape-based, not word-based: a scope ledger legitimately contains the
 * words "token", "secret" and "revoked", so a keyword ban would only
 * force the ledger to stop describing what it governs. These patterns
 * match the shapes a credential actually has, cell-anchored so a cell
 * like `non-Bearer header` cannot trip them.
 */
const SECRET_PATTERNS = [
	/^(gh[pousr]|github_pat)_[A-Za-z0-9_]{10,}$/,
	/^xox[abprs]-[A-Za-z0-9-]{10,}$/,
	/^(secret|ntn)_[A-Za-z0-9]{16,}$/,
	/^(bearer|basic)\s+\S{8,}$/i,
	/^[0-9a-f]{32,}$/i,
	/^[\w.+-]+@[\w-]+\.[\w.]+$/,
];

/** Verdict names, for the structural check on the ledger's expectations. */
const VERDICTS = new Set([
	'approved',
	'unapproved_scope',
	'insufficient_scope',
	'reauth_required',
	'unknown_integration',
]);

/** A real reason is prose, not a placeholder. */
export function isRealReason(value, minimum = 12) {
	return (
		typeof value === 'string' &&
		value.trim().length >= minimum &&
		!PLACEHOLDER_REASONS.has(value.trim().toLowerCase())
	);
}

function readJson(root, relativePath, errors) {
	const path = join(root, relativePath);
	if (!existsSync(path)) {
		errors.push(`${relativePath}: missing — the ledger is the source of truth for every candidate`);
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		errors.push(`${relativePath}: not valid JSON (${error.message})`);
		return null;
	}
}

/**
 * The candidate roster is owned by `docs/domain/integrations.md`, not by
 * this ledger: the domain document is what a reader (and an agent) reads
 * to learn which services are in play. Parsing its Current-state table
 * means a candidate added to the document without a reviewed row here
 * fails the gate, instead of waiting for the token request.
 *
 * @returns {Map<string, string>} candidate id -> status, as written.
 */
export function parseIntegrationRoster(markdown) {
	const roster = new Map();
	const lines = markdown.split('\n');
	for (const line of lines) {
		const cells = line.split('|').map((cell) => cell.trim());
		// | id | Service | **status** | owner | … |
		if (cells.length < 4) continue;
		const id = cells[1].replace(/[`*]/g, '');
		if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) continue;
		const status = cells[3].replace(/[`*]/g, '');
		if (!status || /^(id|---)/i.test(status)) continue;
		roster.set(id, status);
	}
	return roster;
}

/**
 * A mounted `/integrations/*` route, found by text (comments stripped,
 * so the boundary's own documentation cannot be mistaken for a mount).
 * The runtime side of the same claim is `boundary.test.ts`.
 *
 * @returns {string[]} repo-relative files that register such a route.
 */
export function findIntegrationMounts(root) {
	const httpRoot = join(root, 'src/http');
	if (!existsSync(httpRoot)) return [];
	const pattern = /['"`]\/integrations(?:\/|['"`])/;
	return collectSourceFiles(httpRoot)
		.filter((path) => !/\.(test|spec)\.tsx?$/.test(path))
		.filter((path) => pattern.test(stripComments(readFileSync(path, 'utf8'))))
		.map((path) => path.replace(`${root}/`, ''));
}

/**
 * Secret NAMES provisioned for a candidate integration while the
 * candidate is unpublished. Names only, never values: this reads two
 * source-controlled Wrangler files.
 *
 * @returns {string[]} `file: name` findings.
 */
export function findProvisionedIntegrationSecrets(root) {
	const pattern = /(NOTION|DISCORD|GITHUB|INTEGRATION)[A-Z0-9_]*_(TOKEN|SECRET|KEY)\b/;
	const findings = [];
	for (const file of ['wrangler.jsonc', 'wrangler.production.jsonc']) {
		const path = join(root, file);
		if (!existsSync(path)) continue;
		for (const match of readFileSync(path, 'utf8').matchAll(/"([A-Z][A-Z0-9_]{3,})"\s*:/g)) {
			if (pattern.test(match[1])) findings.push(`${file}: ${match[1]}`);
		}
	}
	return findings;
}

/** Project one ledger row into the adapter's requirement shape. */
function toRequirement(row) {
	return {
		id: row.id,
		required: row.least_privilege?.required_scopes ?? [],
		optional: row.least_privilege?.optional_scopes ?? [],
		denied: row.least_privilege?.denied_scopes ?? [],
		maxAgeDays: row.token_retention?.max_age_days ?? 0,
	};
}

/** Cell-anchored credential-shape guard over every string a row renders. */
export function findSecretCell(values) {
	for (const value of values) {
		const cell = String(value ?? '').trim();
		if (cell.length === 0) continue;
		if (SECRET_PATTERNS.some((pattern) => pattern.test(cell))) return cell;
	}
	return null;
}

function checkRow(row, index, root, errors) {
	const label = `integrations[${row?.id ?? index}]`;
	if (typeof row?.id !== 'string' || row.id.length === 0) {
		errors.push(`${label}: missing \`id\``);
		return;
	}
	if (typeof row.service !== 'string' || row.service.trim().length < 2) {
		errors.push(`${label}.service: name the service`);
	}
	if (typeof row.status !== 'string' || row.status.trim().length === 0) {
		errors.push(`${label}.status: the status this candidate has today`);
	}

	// A candidate whose capability does not exist yet is recorded as
	// deferred rather than reviewed. That is a decision, so it must say
	// why — and it can never be used: a grant naming a deferred
	// candidate has no requirement to review against, so the adapter
	// answers `unknown_integration`.
	if (row.review === 'deferred') {
		if (!isRealReason(row.deferred_reason, 30)) {
			errors.push(
				`${label}.deferred_reason: why no scope review is possible yet (the capability does not exist)`,
			);
		}
		if (row.published_surface !== 'none') {
			errors.push(`${label}.published_surface: a deferred candidate must stay "none"`);
		}
		for (const doc of Array.isArray(row.evidence) ? row.evidence : []) {
			if (!existsSync(join(root, doc))) errors.push(`${label}.evidence: "${doc}" does not exist`);
		}
		if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
			errors.push(`${label}.evidence: cite the document that says the capability is not in scope`);
		}
		return;
	}

	if (typeof row.grant !== 'string' || row.grant.trim().length === 0) {
		errors.push(`${label}.grant: say which credential shape this candidate would use`);
	}

	const least = row.least_privilege ?? {};
	if (!Array.isArray(least.required_scopes) || least.required_scopes.length === 0) {
		errors.push(
			`${label}.least_privilege.required_scopes: a candidate with no required scope is not a reviewed candidate`,
		);
	}
	if (!Array.isArray(least.denied_scopes) || least.denied_scopes.length === 0) {
		errors.push(
			`${label}.least_privilege.denied_scopes: record the authority this platform must never hold — an empty denylist is an unreviewed row`,
		);
	}
	if (!isRealReason(least.justification, 40)) {
		errors.push(
			`${label}.least_privilege.justification: state why these scopes and not broader ones`,
		);
	}
	const required = new Set(Array.isArray(least.required_scopes) ? least.required_scopes : []);
	const optional = new Set(Array.isArray(least.optional_scopes) ? least.optional_scopes : []);
	for (const scope of Array.isArray(least.denied_scopes) ? least.denied_scopes : []) {
		if (required.has(scope) || optional.has(scope)) {
			errors.push(`${label}.least_privilege: "${scope}" is both required/optional and denied`);
		}
	}

	const retention = row.token_retention ?? {};
	if (!Number.isInteger(retention.max_age_days) || retention.max_age_days < 1) {
		errors.push(`${label}.token_retention.max_age_days: a positive whole number of days`);
	}
	if (!isRealReason(retention.storage, 20)) {
		errors.push(`${label}.token_retention.storage: name where the value lives (Infisical)`);
	}
	if (!isRealReason(retention.provider_expiry, 20)) {
		errors.push(
			`${label}.token_retention.provider_expiry: record what the provider does about expiry`,
		);
	}

	const revocation = row.revocation ?? {};
	if (!isRealReason(revocation.owner)) {
		errors.push(`${label}.revocation.owner: name the owner who can revoke this grant`);
	}
	const steps = Array.isArray(revocation.procedure) ? revocation.procedure : [];
	if (steps.length < 2 || steps.some((step) => !isRealReason(step, 15))) {
		errors.push(`${label}.revocation.procedure: at least two concrete steps, no placeholders`);
	}
	if (!Number.isFinite(revocation.deadline_hours) || revocation.deadline_hours < 1) {
		errors.push(`${label}.revocation.deadline_hours: how long revocation may take`);
	}
	if (!Array.isArray(revocation.triggers) || revocation.triggers.length === 0) {
		errors.push(`${label}.revocation.triggers: a procedure with no trigger never runs`);
	}

	const reauth = row.reauth ?? {};
	const codes = Array.isArray(reauth.error_codes) ? reauth.error_codes : [];
	for (const code of codes) {
		if (!Object.values(SCOPE_REFUSAL_CODE).includes(code)) {
			errors.push(`${label}.reauth.error_codes: "${code}" is not a code the adapter publishes`);
		}
	}
	if (codes.length === 0) {
		errors.push(
			`${label}.reauth.error_codes: a connection with no re-authorization code has no failure path`,
		);
	}

	if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
		errors.push(`${label}.evidence: cite the documents this row depends on`);
	} else {
		for (const doc of row.evidence) {
			if (!existsSync(join(root, doc))) errors.push(`${label}.evidence: "${doc}" does not exist`);
		}
	}

	const source = row.source ?? {};
	if (typeof source.url !== 'string' || !source.url.startsWith('https://')) {
		errors.push(`${label}.source.url: cite the vendor's own scope / permission reference`);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(source.verified_on))) {
		errors.push(`${label}.source.verified_on: YYYY-MM-DD, the date the reference was read`);
	}

	if (typeof row.published_surface !== 'string') {
		errors.push(`${label}.published_surface: "none" until the owner allowlists this candidate`);
	}

	const leak = findSecretCell([
		row.id,
		row.service,
		...Object.values(least.required_scopes ?? []),
		...Object.values(least.optional_scopes ?? []),
		...Object.values(least.denied_scopes ?? []),
	]);
	if (leak)
		errors.push(
			`${label}: a cell matches credential-shaped material — the ledger stores names, not values`,
		);
}

/**
 * Run every reviewed connection through the real adapter.
 *
 * @returns {{ rows: object[], errors: string[] }}
 */
function checkConnections(manifest, root, errors) {
	const rows = [];
	const requirements = new Map(
		(manifest.integrations ?? []).map((row) => [row.id, toRequirement(row)]),
	);
	const asOfRaw = manifest.as_of;
	const asOf = typeof asOfRaw === 'string' ? Date.parse(asOfRaw) : Number.NaN;
	if (Number.isNaN(asOf)) {
		errors.push('as_of: the ledger states the instant its connections are evaluated at');
		return { rows, errors };
	}

	const connections = Array.isArray(manifest.reviewed_connections)
		? manifest.reviewed_connections
		: [];
	if (connections.length === 0) {
		errors.push(
			'reviewed_connections: at least one connection must be executed, not only described',
		);
	}

	for (const [index, connection] of connections.entries()) {
		const label = `reviewed_connections[${connection?.id ?? index}]`;
		const requirement = requirements.get(connection?.integration) ?? null;
		const grant = {
			integration: connection?.integration,
			scopes: connection?.granted_scopes ?? [],
			issuedAt: connection?.issued_at ?? null,
			expiresAt: connection?.expires_at ?? null,
			revokedAt: connection?.revoked_at ?? null,
		};
		const review = reviewConnection(requirement, grant, new Date(asOf));
		const expectedVerdict = connection?.expected?.verdict;
		const expectedCode = connection?.expected?.code;

		if (!VERDICTS.has(expectedVerdict)) {
			errors.push(
				`${label}.expected.verdict: "${expectedVerdict}" is not a verdict the adapter can return`,
			);
		}
		if (!Object.values(SCOPE_REFUSAL_CODE).includes(expectedCode)) {
			errors.push(`${label}.expected.code: "${expectedCode}" is not a code the adapter publishes`);
		}

		if (expectedVerdict !== review.verdict || expectedCode !== review.code) {
			errors.push(
				`${label}: the ledger claims ${expectedVerdict}/${expectedCode} but the adapter returns ${review.verdict}/${review.code} — a connection is measured, not declared`,
			);
		}

		const leak = findSecretCell([
			connection?.id,
			connection?.integration,
			...Object.values(connection?.granted_scopes ?? []),
			review.code,
			...review.unapproved,
			...review.missing,
			...review.reauth,
		]);
		if (leak) {
			errors.push(`${label}: a rendered cell matches credential-shaped material`);
		}

		rows.push({
			id: connection?.id ?? `connection-${index}`,
			integration: connection?.integration ?? '',
			scenario: connection?.scenario ?? '',
			granted: (connection?.granted_scopes ?? []).join(', '),
			issuedAt: connection?.issued_at ?? '',
			retentionDays: requirement?.maxAgeDays ?? 0,
			ageDays: review.ageDays,
			verdict: review.verdict,
			code: review.code,
			unapproved: review.unapproved,
			missing: review.missing,
			reauth: review.reauth,
			expected: { verdict: expectedVerdict ?? '', code: expectedCode ?? '' },
			matches: expectedVerdict === review.verdict && expectedCode === review.code,
		});
	}

	return { rows, errors };
}

/**
 * The whole gate, as a pure-ish function so the report generator, the
 * tests and the CLI all evaluate the same thing.
 *
 * @returns {{errors: string[], warnings: string[], rows: object[],
 *   connections: object[], manifest: object, summary: object}}
 */
export function checkIntegrationScope({ root = ROOT, manifestPath = MANIFEST, ops = null } = {}) {
	const errors = [];
	const warnings = [];

	let manifest = readJson(root, manifestPath, errors);
	if (!manifest) {
		return { errors, warnings, rows: [], connections: [], manifest: {}, summary: {} };
	}
	if (ops) {
		try {
			manifest = applyOps(manifest, ops);
		} catch (error) {
			errors.push(`probe: ${error.message}`);
			return { errors, warnings, rows: [], connections: [], manifest: {}, summary: {} };
		}
	}

	if (manifest.version !== 1) errors.push('version: must be 1');
	if (!isRealReason(manifest.policy, 40)) errors.push('policy: state what this ledger is for');
	if (!isRealReason(manifest.owner)) errors.push('owner: name who may add an allowlist entry');

	const rows = Array.isArray(manifest.integrations) ? manifest.integrations : [];
	if (rows.length === 0) errors.push('integrations: at least one candidate must be reviewed');

	const seen = new Set();
	rows.forEach((row, index) => {
		if (seen.has(row?.id)) errors.push(`integrations[${index}]: duplicate id "${row?.id}"`);
		seen.add(row?.id);
		checkRow(row, index, root, errors);
	});

	// Roster drift against the domain document.
	const rosterPath = join(root, ROSTER_DOC);
	if (!existsSync(rosterPath)) {
		errors.push(`${ROSTER_DOC}: missing — the candidate roster lives in the domain document`);
	} else {
		const roster = parseIntegrationRoster(readFileSync(rosterPath, 'utf8'));
		for (const row of rows) {
			const documented = roster.get(row?.id);
			if (documented === undefined) {
				errors.push(
					`integrations.${row?.id}: not in the ${ROSTER_DOC} roster — the domain document owns the candidate list`,
				);
				continue;
			}
			if (documented.toLowerCase() !== String(row?.status ?? '').toLowerCase()) {
				errors.push(
					`integrations.${row?.id}.status: ledger says "${row?.status}", ${ROSTER_DOC} says "${documented}"`,
				);
			}
		}
		for (const id of roster.keys()) {
			if (!seen.has(id)) {
				errors.push(`integrations: "${id}" is a candidate in ${ROSTER_DOC} with no reviewed row`);
			}
		}
	}

	// Publication requires an owner allowlist entry. This is the
	// acceptance criterion in mechanical form.
	const allowlist = manifest.allowlist ?? {};
	if (!isRealReason(allowlist.rule, 40)) errors.push('allowlist.rule: state the publication rule');
	const entries = Array.isArray(allowlist.entries) ? allowlist.entries : [];
	if (!Array.isArray(allowlist.entries)) errors.push('allowlist.entries: a list, empty by default');
	const entryIds = new Set();
	for (const [index, entry] of entries.entries()) {
		const label = `allowlist.entries[${index}]`;
		for (const field of ALLOWLIST_ENTRY_SHAPE) {
			if (entry?.[field] === undefined) errors.push(`${label}: missing \`${field}\``);
		}
		if (!isRealReason(entry?.reason, 20)) {
			errors.push(`${label}.reason: why the owner allowed automatic publication`);
		}
		entryIds.add(entry?.id);
	}
	const published = rows.filter((row) => String(row?.published_surface ?? '') !== 'none');
	for (const row of published) {
		if (!entryIds.has(row.id)) {
			errors.push(
				`integrations.${row.id}.published_surface: "${row.published_surface}" is published without an allowlist entry — automatic publication requires the owner's recorded decision`,
			);
		}
	}
	if (entries.length === 0 && published.length === 0) {
		// The correct state today; say so out loud so an empty list is a
		// decision rather than an omission.
		warnings.push(
			'allowlist.entries is empty: no candidate may be published automatically (correct today)',
		);
	}

	const mounts = findIntegrationMounts(root);
	if (mounts.length > 0 && entries.length === 0) {
		errors.push(
			`/integrations/* is mounted in ${mounts.join(', ')} while allowlist.entries is empty — the entry point must not appear before the owner records an entry`,
		);
	}

	for (const finding of findProvisionedIntegrationSecrets(root)) {
		if (entries.length === 0) {
			errors.push(
				`${finding}: a secret name for an unpublished candidate — no integration token may be provisioned before the owner allowlists it`,
			);
		}
	}

	const { rows: connections } = checkConnections(manifest, root, errors);

	const summary = {
		candidates: rows.length,
		approved: connections.filter((row) => row.verdict === 'approved').length,
		refused: connections.filter((row) => row.verdict !== 'approved').length,
		allowlisted: entries.length,
		published: published.length,
		mounts: mounts.length,
	};

	return { errors, warnings, rows, connections, manifest, summary };
}

/**
 * Apply a probe's path operations to the real ledger.
 *
 * A probe is a **patch**, not a copy: `quality/fixtures/integration-scope/*.json`
 * carries `{ note, expect_error, ops }` and the gate evaluates the
 * shipped ledger with that patch applied. A copied fixture would be a
 * second ledger that quietly stops describing this repository; a patch
 * cannot drift, because it *is* the repository's ledger plus one change.
 */
export function applyOps(manifest, ops) {
	const next = structuredClone(manifest);
	for (const op of ops) {
		const segments = String(op.path ?? '')
			.split('.')
			.filter((segment) => segment.length > 0);
		if (segments.length === 0) throw new Error('an op needs a `path`');
		let cursor = next;
		for (const segment of segments.slice(0, -1)) {
			cursor = cursor?.[segment];
			if (cursor === undefined || cursor === null) {
				throw new Error(`path "${op.path}" does not exist in the ledger`);
			}
		}
		const leaf = segments.at(-1);
		if (op.op === 'remove') {
			delete cursor[leaf];
		} else if (op.op === 'set') {
			cursor[leaf] = structuredClone(op.value);
		} else {
			throw new Error(`unknown op "${op.op}" — only "set" and "remove" exist`);
		}
	}
	return next;
}

/**
 * The false-green probes: each fixture is a change to the ledger that
 * must be REFUSED, so "the gate ran" is never the same sentence as "the
 * gate decided".
 */
export const PROBE_FIXTURES = [
	'pass.json',
	'published-without-allowlist.json',
	'missing-revocation.json',
	'false-green-approval.json',
	'roster-drift.json',
];

/**
 * Evaluate one probe fixture. `expect_error` is a substring the error
 * list must contain (absent for the `pass` probe, where the ledger must
 * produce no error at all); a probe whose expected refusal no longer
 * appears has stopped testing what it claims to test.
 */
export function evaluateFixture(root, file) {
	const fixture = readJson(root, `quality/fixtures/integration-scope/${file}`, []);
	if (!fixture) {
		return { file, note: '', expectError: null, errors: ['fixture unreadable'], verdict: 'fail' };
	}
	const expected = fixture.expect_error ?? null;
	const result = checkIntegrationScope({ root, ops: fixture.ops ?? [] });
	const matched =
		expected === null
			? result.errors.length === 0
			: result.errors.some((line) => line.includes(expected));
	return {
		file,
		note: fixture.note ?? '',
		expectError: expected,
		errors: result.errors,
		verdict: matched ? 'pass' : 'fail',
	};
}

function main() {
	const { errors, warnings, rows, connections, summary } = checkIntegrationScope();

	for (const warning of warnings) process.stdout.write(`warn  ${warning}\n`);
	for (const row of rows) {
		if (row.review === 'deferred') {
			process.stdout.write(
				`ok    ${row.id.padEnd(18)} ${String(row.status).padEnd(16)} review deferred — no token may be requested\n`,
			);
			continue;
		}
		process.stdout.write(
			`ok    ${row.id.padEnd(18)} ${String(row.status).padEnd(16)} retention ${row.token_retention.max_age_days}d ` +
				`revoke ≤${row.revocation.deadline_hours}h by ${row.revocation.owner}\n`,
		);
	}
	for (const connection of connections) {
		process.stdout.write(
			`${connection.matches ? 'ok   ' : 'FAIL '} ${connection.id.padEnd(30)} ${connection.verdict} (${connection.code})\n`,
		);
	}

	const probeFailures = PROBE_FIXTURES.filter(
		(probe) => evaluateFixture(ROOT, probe).verdict !== 'pass',
	);
	for (const probe of probeFailures) {
		process.stdout.write(`FAIL  false-green probe ${probe.file} did not fail the gate\n`);
	}

	if (errors.length > 0) {
		for (const error of errors) process.stderr.write(`error ${error}\n`);
		process.stderr.write(`\n${errors.length} problem(s) in the integration scope ledger\n`);
		return 1;
	}
	if (probeFailures.length > 0) return 1;

	process.stdout.write(
		`\nintegration scope ledger: ${summary.candidates} candidate(s), ${summary.approved} approved connection(s), ` +
			`${summary.refused} refused, ${summary.allowlisted} allowlisted, ${summary.mounts} mounted route(s)\n`,
	);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exit(main());
}
