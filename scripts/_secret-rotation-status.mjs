/**
 * Pure seam for the secret drift / rotation-deadline status (Issue #477).
 *
 * The obligation this file owns
 * -----------------------------
 * Two facts about a runtime secret are invisible in a CI log today.
 *
 *   1. **Drift** — the Infisical inventory is a runtime fact. The only
 *      status-only outputs about it are printed by
 *      `scripts/check-cf-secrets.mjs --execute` (and the static
 *      `scripts/check-infisical-coverage.mjs`), so a reviewer sees a
 *      verdict in one transcript and nothing in the next.
 *   2. **Deadline** — `docs/runbook/infisical-secrets.md` §2.1 records a
 *      cadence per name ("quarterly review", "on suspected compromise"),
 *      but nothing computes how close each name is to it. "Expires" is a
 *      claim no one can check.
 *
 * So both are projected here as pure functions over **status-only**
 * inputs: a rotation ledger (names, cadences, recorded rotation dates —
 * never values) and an optional recorded drift observation (the name
 * lists an operator already captured from an existing status-only
 * script). The I/O wrappers are `scripts/check-secret-rotation-status.mjs`
 * (verdict) and `scripts/make-secret-rotation-status-report.mjs`
 * (dashboard); neither adds a fact of its own.
 *
 * What this module never does
 * ---------------------------
 * It never accepts, returns, formats or logs a secret value. Three
 * independent mechanisms enforce that, because one would be a promise:
 *
 *   - **Name grammar.** An observation entry must match the naming
 *     convention `docs/runbook/infisical-secrets.md` §3.2 defines
 *     (`{PRODUCT_OR_LIB}_{ROLE}`, UPPER_SNAKE, at least one underscore,
 *     ≤ 64 chars). A recorded listing that carries a 40-character
 *     base64 token instead of a name is a parse failure — fail closed —
 *     so it can never reach a report line.
 *   - **Strict ledger schema.** Unknown keys are rejected, so the
 *     committed ledger structurally cannot grow a `value` field: a new
 *     key must be a reviewed schema change, not a quiet place to park a
 *     credential.
 *   - **Leak guard.** `assertNoValueInText` refuses to emit text that
 *     contains a token the caller supplied as a non-name, and the CLI
 *     runs its own output through it before writing.
 *
 * Contract injection, never re-declaration
 * ---------------------------------------
 * The runtime secret roster is NOT declared here. `evaluateSecretStatus`
 * takes the contract's `required` / `auditOnly` lists from
 * `scripts/_cloudflare-contract.mjs`, the same module the deploy path
 * reads, so a copy here could not drift away from the thing that is
 * actually uploaded. The ledger is required to cover exactly that
 * roster: a name with no ledger row (`MISSING_ROW`) or a row for a name
 * the contract does not own (`EXTRA_ROW`) is drift, and both are
 * fail-closed — a second, quieter copy of the inventory is precisely
 * the failure this Issue is about.
 *
 * Severity policy (deliberate, and the reason this is not just a
 * linter)
 * ------------------------------------------------------------------
 *   DRIFT / OVERDUE   → verdict `DRIFT` / `OVERDUE`, exit 1.
 *   UNDECIDABLE       → exit 2. A malformed ledger, an unreadable or
 *                       malformed observation and an unusable clock all
 *                       fail closed; "could not read" never prints as
 *                       "fine".
 *   advisory only     → exit 0 with a printed warning: an `UNEXPECTED`
 *                       name (an environment legitimately holds names
 *                       this Worker does not bind — deleting it is the
 *                       operator's call, not this tool's), an
 *                       `UNRECORDED` rotation date, a `DUE_SOON`
 *                       deadline, and `NOT_OBSERVED` when no
 *                       observation was supplied at all.
 *
 * The advisory bucket is what makes the OFFLINE CI run honest: with no
 * observation file, the drift half of this tool cannot be decided, and
 * it says so on every row instead of reporting a match nobody made.
 */

/** Verdict vocabulary. `OK` is the only pass. */
export const VERDICT = Object.freeze({
	ok: 'OK',
	drift: 'DRIFT',
	overdue: 'OVERDUE',
	undecidable: 'UNDECIDABLE',
});

/**
 * Drift status of one name. These are four different facts, and
 * collapsing them is how a status report starts lying:
 *
 *   `MATCH`         — the observation lists it where it is expected.
 *   `MISSING`       — the observation says the environment does not
 *                     have it. Fail.
 *   `UNEXPECTED`    — the observation lists a name the contract does not
 *                     own. Advisory: environments hold deploy-time and
 *                     tooling names by design (ADR-0015 §1.4).
 *   `NOT_OBSERVED`  — no observation was supplied. Advisory, and never
 *                     spelled `MATCH`.
 *   `MISSING_ROW` / `EXTRA_ROW` — the ledger does not cover exactly the
 *                     contract roster. Fail; both are pure repository
 *                     facts, so CI can decide them offline.
 */
export const DRIFT_STATUS = Object.freeze({
	match: 'MATCH',
	missing: 'MISSING',
	unexpected: 'UNEXPECTED',
	notObserved: 'NOT_OBSERVED',
	missingRow: 'MISSING_ROW',
	extraRow: 'EXTRA_ROW',
});

/** Rotation-deadline status of one name. */
export const DEADLINE_STATUS = Object.freeze({
	within: 'WITHIN_CADENCE',
	dueSoon: 'DUE_SOON',
	overdue: 'OVERDUE',
	unrecorded: 'UNRECORDED',
	eventDriven: 'EVENT_DRIVEN',
});

/** Why the tool could not decide. A code, never a raw error message. */
export const UNDECIDABLE_REASON = Object.freeze({
	ledgerUnreadable: 'ledger_unreadable',
	ledgerMalformed: 'ledger_malformed',
	observationUnreadable: 'observation_unreadable',
	observationMalformed: 'observation_malformed',
	clockInvalid: 'clock_invalid',
});

/** Cadence kinds. Only `calendar` can expire. */
export const CADENCE_KIND = Object.freeze({
	calendar: 'calendar',
	eventDriven: 'event_driven',
});

/** Tiers, read from the contract rather than declared by the ledger. */
export const TIER = Object.freeze({
	required: 'runtime_required',
	auditOnly: 'audit_only',
});

/**
 * The naming convention of `docs/runbook/infisical-secrets.md` §3.2,
 * used as the *parse* grammar for anything that claims to be a secret
 * name. An entry that fails it is not a name, and an observation that
 * carries one is refused rather than printed.
 */
export const NAME_GRAMMAR = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** §3.2: "Length ≤ 64 chars (Wrangler secret name limit)". */
export const MAX_NAME_LENGTH = 64;

/** Days before the deadline at which a name is reported as DUE_SOON. */
export const DEFAULT_DUE_SOON_DAYS = 14;

/** Accepted keys of one ledger row. Anything else is malformed. */
const LEDGER_ROW_KEYS = new Set(['name', 'cadence', 'last_rotated_at', 'driver', 'runbook']);
const LEDGER_ROOT_KEYS = new Set(['version', 'policy', 'secrets']);
const CADENCE_KEYS = new Set(['kind', 'days', 'label']);

/** Accepted keys of one structured observation. */
const OBSERVATION_KEYS = new Set(['environment', 'captured_at', 'missing', 'extra']);
const OBSERVATION_ENVIRONMENTS = new Set(['dev', 'prod']);

const DAY_MS = 86_400_000;

/** @typedef {'OK' | 'DRIFT' | 'OVERDUE' | 'UNDECIDABLE'} Verdict */
/** @typedef {'MATCH' | 'MISSING' | 'UNEXPECTED' | 'NOT_OBSERVED' | 'MISSING_ROW' | 'EXTRA_ROW'} DriftStatus */
/** @typedef {'WITHIN_CADENCE' | 'DUE_SOON' | 'OVERDUE' | 'UNRECORDED' | 'EVENT_DRIVEN'} DeadlineStatus */

/**
 * True when `value` is a secret NAME this repository could bind, and
 * therefore the only shape an observation entry is allowed to have.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isContractName(value) {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_NAME_LENGTH &&
		NAME_GRAMMAR.test(value)
	);
}

/** Parse a `YYYY-MM-DD` (or full ISO) timestamp into UTC midnight. */
function utcMidnight(value) {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
	}
	if (typeof value !== 'string') return null;
	const text = value.trim();
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
	if (!match) return null;
	const [, year, month, day] = match;
	const millis = Date.UTC(Number(year), Number(month) - 1, Number(day));
	const parsed = new Date(millis);
	// Reject a calendar date that does not exist (e.g. 2026-02-30), which
	// `Date.UTC` would silently roll over into the next month.
	if (
		parsed.getUTCFullYear() !== Number(year) ||
		parsed.getUTCMonth() !== Number(month) - 1 ||
		parsed.getUTCDate() !== Number(day)
	) {
		return null;
	}
	return millis;
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
function daysBetween(from, to) {
	return Math.round((to - from) / DAY_MS);
}

/** `YYYY-MM-DD` for a UTC-midnight millisecond value. */
function isoDate(millis) {
	return new Date(millis).toISOString().slice(0, 10);
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate one ledger row. Returns the normalized row or a list of
 * human-readable problems (no values, no rows echoed back).
 */
function validateLedgerRow(row, index, errors) {
	if (!isPlainObject(row)) {
		errors.push(`row ${index} is not an object`);
		return null;
	}
	for (const key of Object.keys(row)) {
		if (!LEDGER_ROW_KEYS.has(key)) {
			// A `value` / `secret` / `token` key is the failure this
			// schema exists to prevent, so it is named explicitly in the
			// reason the reviewer reads.
			errors.push(
				`row ${index} carries unknown key "${key}" (a ledger row holds rotation policy only; a secret value is never a legal field)`,
			);
		}
	}
	if (!isContractName(row.name)) errors.push(`row ${index} has a name outside the §3.2 grammar`);

	const cadence = row.cadence;
	if (!isPlainObject(cadence)) {
		errors.push(`row ${index} has no cadence object`);
	} else {
		for (const key of Object.keys(cadence)) {
			if (!CADENCE_KEYS.has(key)) errors.push(`row ${index} cadence carries unknown key "${key}"`);
		}
		if (!Object.values(CADENCE_KIND).includes(cadence.kind)) {
			errors.push(`row ${index} cadence kind must be calendar or event_driven`);
		}
		if (cadence.kind === CADENCE_KIND.calendar) {
			if (!Number.isInteger(cadence.days) || cadence.days < 1 || cadence.days > 3650) {
				errors.push(`row ${index} calendar cadence needs an integer days in 1..3650`);
			}
		} else if (cadence.days !== undefined) {
			errors.push(`row ${index} event_driven cadence must not carry days`);
		}
		if (typeof cadence.label !== 'string' || cadence.label.trim().length === 0) {
			errors.push(`row ${index} cadence needs a non-empty label`);
		}
	}

	if (row.last_rotated_at !== null && utcMidnight(row.last_rotated_at) === null) {
		errors.push(`row ${index} last_rotated_at must be null or a YYYY-MM-DD date`);
	}
	if (typeof row.driver !== 'string' || row.driver.trim().length === 0) {
		errors.push(`row ${index} needs a driver script path`);
	}
	if (typeof row.runbook !== 'string' || row.runbook.trim().length === 0) {
		errors.push(`row ${index} needs a runbook path`);
	}
	return errors.length === 0
		? {
				name: row.name,
				cadence: {
					kind: cadence?.kind,
					days: cadence?.days,
					label: cadence?.label,
				},
				lastRotatedAt: row.last_rotated_at ?? null,
				driver: row.driver,
				runbook: row.runbook,
			}
		: null;
}

/**
 * Parse and validate the rotation ledger.
 *
 * @param {unknown} input JSON text or an already-parsed object.
 * @returns {{ ok: true, ledger: object } | { ok: false, reason: string, errors: string[] }}
 */
export function parseLedger(input) {
	let parsed = input;
	if (typeof input === 'string') {
		try {
			parsed = JSON.parse(input);
		} catch {
			return { ok: false, reason: UNDECIDABLE_REASON.ledgerUnreadable, errors: ['not JSON'] };
		}
	}
	if (!isPlainObject(parsed)) {
		return {
			ok: false,
			reason: UNDECIDABLE_REASON.ledgerUnreadable,
			errors: ['ledger is not an object'],
		};
	}

	const errors = [];
	for (const key of Object.keys(parsed)) {
		if (!LEDGER_ROOT_KEYS.has(key)) {
			errors.push(`ledger carries unknown top-level key "${key}"`);
		}
	}
	if (parsed.version !== 1) errors.push('ledger version must be 1');
	if (!Array.isArray(parsed.secrets) || parsed.secrets.length === 0) {
		errors.push('ledger secrets must be a non-empty array');
		return { ok: false, reason: UNDECIDABLE_REASON.ledgerMalformed, errors };
	}

	const rows = [];
	parsed.secrets.forEach((row, index) => {
		const normalized = validateLedgerRow(row, index, errors);
		if (normalized) rows.push(normalized);
	});

	const duplicates = rows
		.map((row) => row.name)
		.filter((name, index, all) => all.indexOf(name) !== index);
	if (duplicates.length > 0) {
		errors.push(`ledger has ${duplicates.length} duplicate row(s)`);
	}

	if (errors.length > 0) {
		return { ok: false, reason: UNDECIDABLE_REASON.ledgerMalformed, errors };
	}
	return {
		ok: true,
		ledger: {
			version: parsed.version,
			policy: typeof parsed.policy === 'string' ? parsed.policy : '',
			secrets: rows,
		},
	};
}

/**
 * A token the leak guard may compare against: long enough that a match
 * would not be an accident, and not one of the shapes a status-only
 * record legitimately contains.
 */
const MIN_GUARD_TOKEN_LENGTH = 8;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** String leaves of a parsed observation. Keys are NOT values. */
function stringValues(node, into) {
	if (typeof node === 'string') into.push(node);
	else if (Array.isArray(node)) for (const item of node) stringValues(item, into);
	else if (isPlainObject(node)) for (const value of Object.values(node)) stringValues(value, into);
	return into;
}

/**
 * Collect the tokens of a recorded observation that are NOT secret
 * names, dates or environments — the only thing in an operator-recorded
 * file that could be a value. They are returned so the caller can run
 * the leak guard against its own output; nothing else reads them.
 *
 * Values only. A key named `missing` is not a credential, and treating
 * one as a candidate would make the guard fire on the report's own
 * vocabulary.
 *
 * @param {unknown} input
 * @returns {string[]}
 */
export function collectNonNameTokens(input) {
	let tokens = [];
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (trimmed.startsWith('{')) {
			try {
				tokens = stringValues(JSON.parse(trimmed), []);
			} catch {
				return [];
			}
		} else {
			// A recorded transcript: only the `missing:` / `extra:` lists
			// carry names, so only they can carry a value either.
			for (const line of trimmed.split('\n')) {
				const match = /^\s*(?:missing|extra):\s*(.*)$/.exec(line);
				if (match) tokens.push(...match[1].split(','));
			}
		}
	} else {
		tokens = stringValues(input, []);
	}
	return tokens
		.map((token) => token.trim())
		.filter(
			(token) =>
				token.length >= MIN_GUARD_TOKEN_LENGTH &&
				!isContractName(token) &&
				!ISO_DATE.test(token) &&
				!OBSERVATION_ENVIRONMENTS.has(token),
		);
}

/**
 * Parse an observation, in either accepted shape.
 *
 *   1. a structured record `{ environment, captured_at, missing, extra }`
 *      (what an operator records by hand from a status-only run), and
 *   2. a recorded transcript of `scripts/check-cf-secrets.mjs
 *      --execute`, whose `missing:` / `extra:` lines are the same facts
 *      in the form the script already prints them.
 *
 * @param {unknown} input
 * @returns {{ ok: true, observation: object } | { ok: false, reason: string, errors: string[] }}
 */
export function parseObservation(input) {
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (trimmed.startsWith('{')) {
			try {
				return parseObservation(JSON.parse(trimmed));
			} catch {
				return {
					ok: false,
					reason: UNDECIDABLE_REASON.observationUnreadable,
					errors: ['not JSON'],
				};
			}
		}
		return parseTranscript(trimmed);
	}

	if (!isPlainObject(input)) {
		return {
			ok: false,
			reason: UNDECIDABLE_REASON.observationMalformed,
			errors: ['observation is not an object'],
		};
	}

	const errors = [];
	for (const key of Object.keys(input)) {
		if (!OBSERVATION_KEYS.has(key)) errors.push(`observation carries unknown key "${key}"`);
	}
	if (!OBSERVATION_ENVIRONMENTS.has(input.environment)) {
		errors.push('observation environment must be dev or prod');
	}
	if (input.captured_at !== null && utcMidnight(input.captured_at) === null) {
		errors.push('observation captured_at must be null or a YYYY-MM-DD date');
	}

	const names = {};
	for (const field of ['missing', 'extra']) {
		const list = input[field];
		if (!Array.isArray(list)) {
			errors.push(`observation ${field} must be an array`);
			names[field] = [];
			continue;
		}
		const accepted = [];
		for (const entry of list) {
			if (!isContractName(entry)) {
				// The fail-closed branch: a recorded listing that carries
				// anything other than a NAME is refused, and the token
				// itself is never echoed into the reason.
				errors.push(`observation ${field} holds an entry that is not a §3.2 secret name`);
				continue;
			}
			accepted.push(entry);
		}
		names[field] = accepted;
	}

	if (errors.length > 0) {
		return { ok: false, reason: UNDECIDABLE_REASON.observationMalformed, errors };
	}
	return {
		ok: true,
		observation: {
			environment: input.environment,
			capturedAt: input.captured_at ?? null,
			missing: names.missing,
			extra: names.extra,
		},
	};
}

/**
 * Read a recorded `check-cf-secrets.mjs` transcript.
 *
 * The transcript is status-only by construction (that script prints
 * names, verdicts and reason codes — never a value), so accepting it
 * directly is what lets this tool visualise the output operators
 * already produce without asking them to re-type anything.
 */
function parseTranscript(text) {
	const errors = [];
	const readNames = (field) => {
		const names = [];
		for (const line of text.split('\n')) {
			const match = new RegExp(`^\\s*${field}:\\s*(.*)$`).exec(line);
			if (!match) continue;
			for (const token of match[1].split(',')) {
				const name = token.trim();
				if (name.length === 0) continue;
				if (!isContractName(name)) {
					errors.push(
						`recorded transcript carries a ${field} entry that is not a §3.2 secret name`,
					);
					continue;
				}
				names.push(name);
			}
		}
		return names;
	};

	const missing = readNames('missing');
	const extra = readNames('extra');
	const environment = /^\[check-cf-secrets\]\s+environment=(\w+)/m.exec(text)?.[1] ?? null;
	const capturedAt = /^\[check-cf-secrets\]\s+captured_at=(\S+)/m.exec(text)?.[1] ?? null;
	const hasVerdictLine = /^\[(?:OK|FAIL)\]/m.test(text);

	if (!hasVerdictLine && missing.length === 0 && extra.length === 0) {
		errors.push('recorded transcript has no verdict line and no missing/extra list');
	}
	if (environment !== null && !OBSERVATION_ENVIRONMENTS.has(environment)) {
		errors.push('recorded transcript names an environment other than dev or prod');
	}
	if (capturedAt !== null && utcMidnight(capturedAt) === null) {
		errors.push('recorded transcript carries an unreadable captured_at');
	}

	if (errors.length > 0) {
		return { ok: false, reason: UNDECIDABLE_REASON.observationMalformed, errors };
	}
	return {
		ok: true,
		observation: {
			environment: environment ?? 'prod',
			capturedAt: capturedAt ?? null,
			missing,
			extra,
		},
	};
}

/**
 * Classify one name's deadline.
 *
 * @param {{ cadence: object, lastRotatedAt: string | null }} row
 * @param {number} nowMillis UTC midnight of "now".
 * @param {number} dueSoonDays
 * @returns {{ status: DeadlineStatus, due: string | null, remainingDays: number | null }}
 */
export function classifyDeadline(row, nowMillis, dueSoonDays = DEFAULT_DUE_SOON_DAYS) {
	if (row.cadence.kind === CADENCE_KIND.eventDriven) {
		return { status: DEADLINE_STATUS.eventDriven, due: null, remainingDays: null };
	}
	if (row.lastRotatedAt === null) {
		return { status: DEADLINE_STATUS.unrecorded, due: null, remainingDays: null };
	}
	const rotated = utcMidnight(row.lastRotatedAt);
	const due = rotated + row.cadence.days * DAY_MS;
	const remainingDays = daysBetween(nowMillis, due);
	const status =
		remainingDays < 0
			? DEADLINE_STATUS.overdue
			: remainingDays <= dueSoonDays
				? DEADLINE_STATUS.dueSoon
				: DEADLINE_STATUS.within;
	return { status, due: isoDate(due), remainingDays };
}

/**
 * Decide the whole status report.
 *
 * @param {{
 *   ledger: object,
 *   contract: { required: string[], auditOnly: string[] },
 *   observation?: object | null,
 *   now: Date | string,
 *   dueSoonDays?: number,
 * }} input
 * @returns {object}
 */
export function evaluateSecretStatus({ ledger, contract, observation = null, now, dueSoonDays }) {
	const nowMillis = utcMidnight(now);
	if (nowMillis === null) {
		return undecidableReport(UNDECIDABLE_REASON.clockInvalid, '--');
	}

	const rowsByName = new Map(ledger.secrets.map((row) => [row.name, row]));
	const roster = [
		...contract.required.map((name) => ({ name, tier: TIER.required })),
		...contract.auditOnly.map((name) => ({ name, tier: TIER.auditOnly })),
	];
	const missingNames = new Set(observation?.missing ?? []);
	const extraNames = new Set(observation?.extra ?? []);
	const observed = observation !== null;

	const rows = [];
	for (const entry of roster) {
		const row = rowsByName.get(entry.name);
		const drift = !row
			? DRIFT_STATUS.missingRow
			: !observed
				? DRIFT_STATUS.notObserved
				: missingNames.has(entry.name)
					? DRIFT_STATUS.missing
					: DRIFT_STATUS.match;
		const deadline = row
			? classifyDeadline(row, nowMillis, dueSoonDays)
			: { status: DEADLINE_STATUS.unrecorded, due: null, remainingDays: null };
		rows.push({
			name: entry.name,
			tier: entry.tier,
			drift,
			deadline: deadline.status,
			cadence: row ? describeCadence(row.cadence) : 'unrecorded',
			due: deadline.due,
			remainingDays: deadline.remainingDays,
			driver: row?.driver ?? null,
			runbook: row?.runbook ?? null,
		});
	}

	// A ledger row for a name the contract does not own is the quiet
	// second-inventory failure, so it is reported as a row of its own
	// rather than folded into a count.
	for (const row of ledger.secrets) {
		if (roster.some((entry) => entry.name === row.name)) continue;
		const deadline = classifyDeadline(row, nowMillis, dueSoonDays);
		rows.push({
			name: row.name,
			tier: 'unowned',
			drift: DRIFT_STATUS.extraRow,
			deadline: deadline.status,
			cadence: describeCadence(row.cadence),
			due: deadline.due,
			remainingDays: deadline.remainingDays,
			driver: row.driver,
			runbook: row.runbook,
		});
	}

	// An unexpected name is advisory, and it is listed so the operator
	// can see what the environment holds that the Worker does not bind.
	for (const name of extraNames) {
		if (roster.some((entry) => entry.name === name)) continue;
		rows.push({
			name,
			tier: 'unowned',
			drift: DRIFT_STATUS.unexpected,
			deadline: DEADLINE_STATUS.eventDriven,
			cadence: 'n/a',
			due: null,
			remainingDays: null,
			driver: null,
			runbook: null,
		});
	}

	rows.sort((a, b) => a.name.localeCompare(b.name));

	const warnings = rows
		.filter((row) => ADVISORY_DRIFT.has(row.drift) || ADVISORY_DEADLINE.has(row.deadline))
		.map((row) => ({
			code: row.drift !== DRIFT_STATUS.match ? row.drift : row.deadline,
			name: row.name,
			detail: describeAdvisory(row),
		}));

	const driftFindings = rows.filter((row) => FAILING_DRIFT.has(row.drift));
	const overdueRows = rows.filter((row) => row.deadline === DEADLINE_STATUS.overdue);

	const verdict =
		driftFindings.length > 0
			? VERDICT.drift
			: overdueRows.length > 0
				? VERDICT.overdue
				: VERDICT.ok;

	return {
		verdict,
		reason: '-',
		now: isoDate(nowMillis),
		observed: observed,
		observation: observation
			? {
					environment: observation.environment,
					capturedAt: observation.capturedAt ?? '-',
				}
			: null,
		counts: {
			rows: rows.length,
			required: contract.required.length,
			auditOnly: contract.auditOnly.length,
			driftFailures: driftFindings.length,
			overdue: overdueRows.length,
			advisory: warnings.length,
		},
		rows,
		warnings,
	};
}

const ADVISORY_DRIFT = new Set([DRIFT_STATUS.unexpected, DRIFT_STATUS.notObserved]);
const ADVISORY_DEADLINE = new Set([DEADLINE_STATUS.dueSoon, DEADLINE_STATUS.unrecorded]);
const FAILING_DRIFT = new Set([
	DRIFT_STATUS.missing,
	DRIFT_STATUS.missingRow,
	DRIFT_STATUS.extraRow,
]);

function describeCadence(cadence) {
	return cadence.kind === CADENCE_KIND.calendar ? `calendar:${cadence.days}d` : 'event_driven';
}

/** One sentence the operator can act on, per advisory row. */
function describeAdvisory(row) {
	if (row.drift === DRIFT_STATUS.missingRow) return 'contract name has no ledger row';
	if (row.drift === DRIFT_STATUS.extraRow) return 'ledger row for a name the contract does not own';
	if (row.drift === DRIFT_STATUS.missing) return 'the recorded observation reports it absent';
	if (row.drift === DRIFT_STATUS.unexpected)
		return 'observed in the environment, not bound by the contract';
	if (row.drift === DRIFT_STATUS.notObserved) return 'no status-only observation was supplied';
	if (row.deadline === DEADLINE_STATUS.unrecorded) {
		return 'no rotation date recorded; the owner records it with the rotation';
	}
	if (row.deadline === DEADLINE_STATUS.dueSoon) {
		return `cadence ends ${row.due} (${row.remainingDays} day(s))`;
	}
	return '';
}

function undecidableReport(reason, now) {
	return {
		verdict: VERDICT.undecidable,
		reason,
		now,
		observed: false,
		observation: null,
		counts: {
			rows: 0,
			required: 0,
			auditOnly: 0,
			driftFailures: 0,
			overdue: 0,
			advisory: 0,
		},
		rows: [],
		warnings: [],
	};
}

/**
 * The report for an input this tool could not read or understand. The
 * counts are `0` only because no row could be evaluated — `verdict` is
 * what the exit code follows, and it is never `OK`.
 *
 * @param {string} reason
 * @param {string} [now]
 * @returns {object}
 */
export function undecidableStatus(reason, now = '-') {
	return undecidableReport(reason, now);
}

/**
 * Exit code for a report. `OK` is 0; drift and overdue are 1;
 * undecidable is 2, so "could not read" is never the same signal to a
 * pipeline as "read and fine".
 *
 * @param {object} report
 * @returns {0 | 1 | 2}
 */
export function exitCodeForReport(report) {
	if (report.verdict === VERDICT.ok) return 0;
	if (report.verdict === VERDICT.undecidable) return 2;
	return 1;
}

/**
 * Render the status-only report.
 *
 * Every line is a name, a verdict, a status, a count or a date. No
 * value, no value fragment and no raw error text.
 *
 * @param {object} report
 * @param {{ source: string, ledger: string, contract: string }} meta
 * @returns {string}
 */
export function formatStatusReport(report, meta) {
	const observed = report.observation;
	const lines = [
		`[secret-status] source=${meta.source} ledger=${meta.ledger} contract=${meta.contract}`,
		`[secret-status] verdict=${report.verdict} reason=${report.reason}`,
		`[secret-status] now=${report.now}`,
		`[secret-status] observation=${
			report.observed
				? `observed environment=${observed.environment} captured_at=${observed.capturedAt}`
				: 'not_observed (the environment half is undecided; rows say NOT_OBSERVED)'
		}`,
		`[secret-status] counts rows=${report.counts.rows} required=${report.counts.required} audit_only=${report.counts.auditOnly} drift_failures=${report.counts.driftFailures} overdue=${report.counts.overdue} advisory=${report.counts.advisory}`,
	];
	for (const row of report.rows) {
		lines.push(
			`[secret-status] row=${row.name} tier=${row.tier} drift=${row.drift} deadline=${row.deadline} cadence=${row.cadence} due=${row.due ?? '-'} remaining_days=${row.remainingDays ?? '-'}`,
		);
	}
	for (const warning of report.warnings) {
		lines.push(
			`[secret-status] warn=${warning.code} name=${warning.name} detail=${warning.detail}`,
		);
	}
	lines.push(
		'[secret-status] printed=status only (names, verdicts, counts, dates). No secret value is read, fetched, stored or printed; see AGENTS.md section 4',
	);
	return `${lines.join('\n')}\n`;
}

/**
 * Mechanical enforcement of the status-only contract: refuse to emit
 * text that contains a token the caller flagged as a possible value.
 * Run on this repository's own output before it is written anywhere.
 *
 * @param {string} text
 * @param {Iterable<string>} candidates
 * @returns {void}
 */
export function assertNoValueInText(text, candidates) {
	for (const candidate of candidates) {
		if (typeof candidate !== 'string' || candidate.length < 8) continue;
		if (text.includes(candidate)) {
			throw new Error(
				'refusing to emit a status report that contains a possible secret value; the status-only contract is not negotiable (Issue #477).',
			);
		}
	}
}
