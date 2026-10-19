/**
 * Pure seam for the operator MFA confirmation audit (Issue #469).
 *
 * The obligation this file owns
 * -----------------------------
 * Issue #469 asks for the MFA / Passkey confirmation procedure of the
 * four control-plane accounts this project depends on — GitHub, Cloudflare,
 * Infisical and the registrar — to be written down, and for the result to
 * be visible as a `pass / fail / unconfirmed` audit report.
 *
 * None of those four account states is observable from this repository.
 * There is no API the Worker may call, no binding that carries an
 * enrolment list, and reading one out of a provider console would mean
 * holding a credential this repository refuses to hold (AGENTS.md §4).
 * So the honest projection is the thing the repository *can* decide:
 * whether the **operator-declared ledger** is complete, self-consistent
 * and current — never whether an account actually has two factors
 * enrolled. That projection is this module: classify a ledger, render a
 * status-only verdict, and refuse to guess.
 *
 * What makes it anonymous by construction
 * --------------------------------------
 * The ledger schema has no field in which an account identifier can be
 * written. A row is `{ service, confirmed_at, factors[{ kind, confirmed_at }] }`
 * and nothing else: no handle, no e-mail, no team, no note, no URL. An
 * unknown key is `UNDECIDABLE`, and the identifier-shaped keys
 * (`FORBIDDEN_LEDGER_KEYS`) get their own reason code so the failure says
 * *why* the file was rejected without printing the value. Prose cannot
 * be smuggled through either, which is why there is no `note` field.
 *
 * Nothing here returns, formats or logs a secret: the vocabulary is a
 * service id, a factor kind, an ISO date and a reason code.
 * `assertNoSensitiveInText` is the mechanical guard applied to this
 * repository's own output before it is printed or written.
 *
 * Fail-closed
 * -----------
 * `unconfirmed` is never `pass`. A ledger the tool cannot read, cannot
 * reconcile, or cannot date produces `UNDECIDABLE` for the whole ledger
 * (exit 2), because a partially-understood ledger rendered as "mostly
 * fine" is the false green this module exists to refuse. The same rule
 * applies to a *self-inconsistent* record (a row whose declared
 * confirmation date is older than one of its own factors) and to a
 * confirmation date in the future: both are claims the tool cannot
 * stand behind, not confirmations.
 *
 * The clock is injected
 * ---------------------
 * `auditLedger(raw, { now })` takes the clock so a recorded fixture run
 * keeps the verdict it had on the day it was recorded. A fixture declares
 * its own `now`; the operator ledger does not, and the CLI passes the
 * real clock. Nothing in this module reads `Date.now()` implicitly.
 */

/** The control-plane accounts whose MFA state the runbook tracks. */
/**
 * A vocabulary is a **null-prototype** object and membership is always
 * tested with `Object.hasOwn`. Both halves matter: a ledger is
 * operator-supplied JSON, so `{"kind": "toString"}` and
 * `{"service": "constructor"}` are strings this seam must refuse, and a
 * plain `VOCAB[key]` test would answer them from `Object.prototype` and
 * call a one-factor row `confirmed`. The enum holds exactly the keys
 * written below, and nothing else can reach it.
 *
 * @template {Record<string, unknown>} T
 * @param {Record<string, T>} entries
 * @returns {Readonly<Record<string, T>>}
 */
function vocabulary(entries) {
	return Object.freeze(Object.assign(Object.create(null), entries));
}

/** Own-property membership: never `key in dict`, never `dict[key]` as a test. */
function isEnumMember(dict, key) {
	return typeof key === 'string' && Object.hasOwn(dict, key);
}

/** The control-plane accounts whose MFA state the runbook tracks. */
export const SERVICE = vocabulary({
	github: { id: 'github', label: 'GitHub', labelJa: 'GitHub' },
	cloudflare: { id: 'cloudflare', label: 'Cloudflare', labelJa: 'Cloudflare' },
	infisical: { id: 'infisical', label: 'Infisical', labelJa: 'Infisical' },
	registrar: { id: 'registrar', label: 'Registrar', labelJa: 'ドメイン管理（registrar）' },
});

/**
 * Every service must have a row. A missing row is `missing`, not a
 * neutral: an account nobody wrote a line for is exactly the account
 * nobody checked.
 */
export const REQUIRED_SERVICES = Object.freeze(Object.keys(SERVICE));

/** Enrolled factor kinds. `sms` is listed so a ledger that says "SMS only" is decidable. */
export const FACTOR_KIND = vocabulary({
	passkey: 'passkey',
	security_key: 'security_key',
	totp_app: 'totp_app',
	otp_sms: 'otp_sms',
});

/**
 * Kinds that survive a phishing page. The policy decides whether one of
 * them is REQUIRED (`policy.require_phishing_resistant`); the seam only
 * states which kinds qualify, so a policy change never re-opens the
 * classification code.
 */
export const PHISHING_RESISTANT_KINDS = Object.freeze(['passkey', 'security_key']);

/** Per-service state. Only `confirmed` is a pass. */
export const STATE = Object.freeze({
	confirmed: 'confirmed',
	unconfirmed: 'unconfirmed',
	missing: 'missing',
	stale: 'stale',
});

/** Whole-ledger verdict. `OK` is the only pass. */
export const VERDICT = Object.freeze({
	ok: 'OK',
	outstanding: 'OUTSTANDING',
	undecidable: 'UNDECIDABLE',
});

/** Why a row is not confirmed. A code, never a sentence about a person. */
export const REASON = Object.freeze({
	confirmationDateMissing: 'confirmation_date_missing',
	factorsMissing: 'factors_missing',
	factorsBelowMinimum: 'factors_below_minimum',
	factorKindMissing: 'factor_kind_missing',
	factorDateMissing: 'factor_date_missing',
	phishingResistantMissing: 'phishing_resistant_missing',
	confirmationStale: 'confirmation_stale',
	serviceMissing: 'service_missing',
});

/**
 * Why the ledger itself could not be decided. Every one of these is a
 * **whole-ledger** failure: the tool refuses to report a partial
 * reading as if it were a complete one.
 */
export const UNDECIDABLE_REASON = Object.freeze({
	ledgerUnreadable: 'ledger_unreadable',
	ledgerUnparseable: 'ledger_unparseable',
	ledgerShapeInvalid: 'ledger_shape_invalid',
	ledgerVersionUnsupported: 'ledger_version_unsupported',
	unknownField: 'unknown_field',
	forbiddenField: 'ledger_forbidden_field',
	policyInvalid: 'policy_invalid',
	serviceUnknown: 'service_unknown',
	serviceDuplicated: 'service_duplicated',
	factorKindUnknown: 'factor_kind_unknown',
	confirmationDateInvalid: 'confirmation_date_invalid',
	confirmationDateInFuture: 'confirmation_date_in_future',
	confirmationDateInconsistent: 'confirmation_date_inconsistent',
	clockInvalid: 'clock_invalid',
	/** A recorded fixture must declare the clock its run was recorded with. */
	fixtureClockMissing: 'fixture_clock_missing',
});

/**
 * Keys that would make the ledger identify an account. They are rejected
 * by name, with their own reason code, because "this file tried to hold
 * a login" is a message the operator must see — while the value itself
 * never reaches the transcript.
 */
export const FORBIDDEN_LEDGER_KEYS = Object.freeze([
	'account',
	'account_id',
	'accountId',
	'email',
	'handle',
	'login',
	'note',
	'notes',
	'owner',
	'phone',
	'recovery_codes',
	'secret',
	'totp_seed',
	'user',
	'user_id',
	'username',
]);

/** The whole schema. Anything outside it is `unknown_field`. */
export const LEDGER_KEYS = Object.freeze(['version', 'policy', 'services']);
export const POLICY_KEYS = Object.freeze([
	'status',
	'min_factors',
	'require_phishing_resistant',
	'max_confirmation_age_days',
]);
export const POLICY_STATUS = vocabulary({ proposed: 'proposed', ratified: 'ratified' });
export const SERVICE_ROW_KEYS = Object.freeze(['service', 'confirmed_at', 'factors']);
export const FACTOR_KEYS = Object.freeze(['kind', 'confirmed_at']);
export const LEDGER_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Patterns that must never appear in this repository's rendered MFA
 * output. The ledger schema already makes most of them unrepresentable;
 * the guard is the second line, because a future field or a copy-pasted
 * console line would not have to go through the schema to reach the page.
 */
export const SENSITIVE_PATTERNS = Object.freeze([
	{ id: 'email-address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
	{ id: 'otpauth-uri', re: /otpauth:\/\//i },
	{ id: 'base32-secret', re: /\b[A-Z2-7]{16,}\b/ },
	{ id: 'long-digit-run', re: /\b\d{9,}\b/ },
	{ id: 'bearer-token', re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{8,}/ },
	{ id: 'url-embedded-credential', re: /:\/\/[^\s/:@]+:[^\s/@]+@/ },
	{ id: 'private-key-block', re: /BEGIN [A-Z ]*PRIVATE KEY/ },
	{ id: 'provider-token', re: /\b(gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|xox[abprs]-)/ },
]);

/**
 * @typedef {object} Policy
 * @property {'proposed' | 'ratified'} status
 * @property {number} minFactors
 * @property {boolean} requirePhishingResistant
 * @property {number} maxAgeDays
 */

/**
 * @typedef {object} Row
 * @property {string} service
 * @property {string} label
 * @property {string} labelJa
 * @property {'confirmed' | 'unconfirmed' | 'missing' | 'stale'} state
 * @property {string | null} confirmedAt
 * @property {string[]} factors      factor kinds, in ledger order
 * @property {string} reason         `-` when confirmed
 */

/**
 * @typedef {object} Audit
 * @property {string} verdict
 * @property {string} reason         `-` unless the verdict is UNDECIDABLE
 * @property {Policy | null} policy
 * @property {boolean} policyRatified
 * @property {Row[]} rows
 * @property {{confirmed: number, unconfirmed: number, stale: number, missing: number}} counts
 * @property {string} clock          the ISO date the ageing was computed against
 * @property {string[]} notes        operator-readable, value-free warnings
 */

/**
 * A whole-ledger failure. No row exists: a half-read ledger has no rows
 * to show. Exported so the I/O wrapper can render the same object the
 * classifier would have produced for an unreadable file.
 *
 * @param {string} reason
 * @param {{clock?: string, notes?: string[]}} [options]
 * @returns {Audit}
 */
export function undecidableAudit(reason, { clock = '-', notes = [] } = {}) {
	return {
		verdict: VERDICT.undecidable,
		reason,
		policy: null,
		policyRatified: false,
		rows: [],
		counts: { confirmed: 0, unconfirmed: 0, stale: 0, missing: 0 },
		clock,
		notes,
	};
}

/** Parse the ledger's ISO date to UTC ms, or `null` when it is not a real calendar day. */
function parseIsoDate(value) {
	if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
	const time = Date.parse(`${value}T00:00:00Z`);
	if (Number.isNaN(time)) return null;
	// `2026-02-30` parses to March 2nd in JavaScript; a date the operator
	// cannot have written down is not a date.
	if (new Date(time).toISOString().slice(0, 10) !== value) return null;
	return time;
}

/** Normalise the injected clock to an ISO date string, or `null` when unusable. */
function normalizeClock(clock) {
	const now = clock === undefined ? new Date() : clock;
	if (now instanceof Date) {
		return Number.isNaN(now.getTime()) ? null : now.toISOString().slice(0, 10);
	}
	if (typeof now === 'string') return parseIsoDate(now) === null ? null : now;
	if (typeof now === 'number' && Number.isFinite(now)) {
		return new Date(now).toISOString().slice(0, 10);
	}
	return null;
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(keys, allowed) {
	return keys.filter((key) => !allowed.includes(key));
}

/** Read the policy block, or return the reason the ledger is undecidable. */
function readPolicy(raw) {
	if (!isPlainObject(raw.policy)) return { reason: UNDECIDABLE_REASON.policyInvalid };
	const extra = unknownKeys(Object.keys(raw.policy), POLICY_KEYS);
	if (extra.length > 0) {
		if (extra.some((key) => FORBIDDEN_LEDGER_KEYS.includes(key))) {
			return { reason: UNDECIDABLE_REASON.forbiddenField };
		}
		return { reason: UNDECIDABLE_REASON.unknownField };
	}
	const missing = POLICY_KEYS.filter((key) => raw.policy[key] === undefined);
	if (missing.length > 0) return { reason: UNDECIDABLE_REASON.policyInvalid };
	const { status, min_factors: minFactors, require_phishing_resistant: phishing } = raw.policy;
	if (status !== POLICY_STATUS.proposed && status !== POLICY_STATUS.ratified) {
		return { reason: UNDECIDABLE_REASON.policyInvalid };
	}
	if (!Number.isInteger(minFactors) || minFactors < 1) {
		return { reason: UNDECIDABLE_REASON.policyInvalid };
	}
	if (typeof phishing !== 'boolean') return { reason: UNDECIDABLE_REASON.policyInvalid };
	const maxAgeDays = raw.policy.max_confirmation_age_days;
	if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) {
		return { reason: UNDECIDABLE_REASON.policyInvalid };
	}
	return {
		policy: {
			status,
			minFactors,
			requirePhishingResistant: phishing,
			maxAgeDays,
		},
	};
}

/**
 * Structural read of the ledger. Returns `{ ledger }` or `{ reason }`;
 * it never throws, so a caller cannot accidentally turn a malformed file
 * into a stack trace that quotes the file.
 *
 * @param {string | object} input
 * @returns {{ledger?: object, reason?: string, clock?: string}}
 */
export function readLedger(input) {
	/** @type {unknown} */
	let raw = input;
	if (typeof input === 'string') {
		try {
			raw = JSON.parse(input);
		} catch {
			return { reason: UNDECIDABLE_REASON.ledgerUnparseable };
		}
	}
	if (!isPlainObject(raw)) return { reason: UNDECIDABLE_REASON.ledgerShapeInvalid };
	const extra = unknownKeys(Object.keys(raw), LEDGER_KEYS);
	if (extra.length > 0) {
		return {
			reason: extra.some((key) => FORBIDDEN_LEDGER_KEYS.includes(key))
				? UNDECIDABLE_REASON.forbiddenField
				: UNDECIDABLE_REASON.unknownField,
		};
	}
	if (raw.version !== LEDGER_VERSION) {
		return { reason: UNDECIDABLE_REASON.ledgerVersionUnsupported };
	}
	const policyRead = readPolicy(raw);
	if ('reason' in policyRead) return policyRead;
	if (!Array.isArray(raw.services) || raw.services.length === 0) {
		return { reason: UNDECIDABLE_REASON.ledgerShapeInvalid };
	}
	return { ledger: { policy: policyRead.policy, services: raw.services } };
}

/** Classify one row against the policy. Assumes the row passed the schema read. */
function classifyRow(service, entry, policy, nowMs) {
	const meta = SERVICE[service];
	const base = {
		service,
		label: meta.label,
		labelJa: meta.labelJa,
		confirmedAt: entry.confirmed_at ?? null,
		factors: entry.factors.map((factor) => factor.kind),
	};
	const row = (state, reason) => ({ ...base, state, reason });

	if (entry.confirmed_at === null) return row(STATE.unconfirmed, REASON.confirmationDateMissing);
	const confirmedMs = parseIsoDate(entry.confirmed_at);
	if (confirmedMs === null) {
		return { fatal: UNDECIDABLE_REASON.confirmationDateInvalid };
	}
	if (confirmedMs > nowMs) return { fatal: UNDECIDABLE_REASON.confirmationDateInFuture };

	const kinds = [];
	for (const factor of entry.factors) {
		if (!isEnumMember(FACTOR_KIND, factor.kind)) {
			return { fatal: UNDECIDABLE_REASON.factorKindUnknown };
		}
		if (factor.confirmed_at === null) return row(STATE.unconfirmed, REASON.factorDateMissing);
		const factorMs = parseIsoDate(factor.confirmed_at);
		if (factorMs === null) return { fatal: UNDECIDABLE_REASON.confirmationDateInvalid };
		if (factorMs > nowMs) return { fatal: UNDECIDABLE_REASON.confirmationDateInFuture };
		kinds.push({ kind: factor.kind, at: factorMs });
	}

	// A row whose own date is older than a factor it lists cannot be
	// reconciled, so it is not a confirmation — it is a contradiction.
	const latestFactor = kinds.reduce((max, factor) => Math.max(max, factor.at), 0);
	if (kinds.length > 0 && confirmedMs < latestFactor) {
		return { fatal: UNDECIDABLE_REASON.confirmationDateInconsistent };
	}

	if (kinds.length === 0) return row(STATE.unconfirmed, REASON.factorsMissing);
	if (kinds.length < policy.minFactors) {
		return row(STATE.unconfirmed, REASON.factorsBelowMinimum);
	}
	if (
		policy.requirePhishingResistant &&
		!kinds.some((factor) => PHISHING_RESISTANT_KINDS.includes(factor.kind))
	) {
		return row(STATE.unconfirmed, REASON.phishingResistantMissing);
	}
	const ageDays = Math.floor((nowMs - confirmedMs) / DAY_MS);
	if (ageDays > policy.maxAgeDays) return row(STATE.stale, REASON.confirmationStale);
	return row(STATE.confirmed, '-');
}

/** Validate one service row's shape; returns a reason code when it fails. */
function readServiceRow(entry, seen) {
	if (!isPlainObject(entry)) return UNDECIDABLE_REASON.ledgerShapeInvalid;
	const extra = unknownKeys(Object.keys(entry), SERVICE_ROW_KEYS);
	if (extra.length > 0) {
		return extra.some((key) => FORBIDDEN_LEDGER_KEYS.includes(key))
			? UNDECIDABLE_REASON.forbiddenField
			: UNDECIDABLE_REASON.unknownField;
	}
	if (!isEnumMember(SERVICE, entry.service)) {
		return UNDECIDABLE_REASON.serviceUnknown;
	}
	if (seen.has(entry.service)) return UNDECIDABLE_REASON.serviceDuplicated;
	if (entry.confirmed_at !== null && typeof entry.confirmed_at !== 'string') {
		return UNDECIDABLE_REASON.confirmationDateInvalid;
	}
	if (!Array.isArray(entry.factors)) return UNDECIDABLE_REASON.ledgerShapeInvalid;
	for (const factor of entry.factors) {
		if (!isPlainObject(factor)) return UNDECIDABLE_REASON.ledgerShapeInvalid;
		const factorExtra = unknownKeys(Object.keys(factor), FACTOR_KEYS);
		if (factorExtra.length > 0) {
			return factorExtra.some((key) => FORBIDDEN_LEDGER_KEYS.includes(key))
				? UNDECIDABLE_REASON.forbiddenField
				: UNDECIDABLE_REASON.unknownField;
		}
		if (typeof factor.kind !== 'string') return UNDECIDABLE_REASON.factorKindUnknown;
		if (factor.confirmed_at !== null && typeof factor.confirmed_at !== 'string') {
			return UNDECIDABLE_REASON.confirmationDateInvalid;
		}
	}
	return null;
}

/** One operator-facing sentence per reason code, with no value in it. */
const READ_REASON_NOTE = Object.freeze({
	[UNDECIDABLE_REASON.ledgerUnreadable]: 'the ledger file could not be read',
	[UNDECIDABLE_REASON.ledgerUnparseable]: 'the ledger is not valid JSON',
	[UNDECIDABLE_REASON.ledgerShapeInvalid]:
		'the ledger is missing version / policy / a non-empty services array',
	[UNDECIDABLE_REASON.ledgerVersionUnsupported]: `only ledger version ${LEDGER_VERSION} is understood`,
	[UNDECIDABLE_REASON.unknownField]:
		'the ledger carries a field the schema does not define (no free-text field exists)',
	[UNDECIDABLE_REASON.forbiddenField]:
		'the ledger carries an account-identifier key; this file is anonymous by schema and must stay so',
	[UNDECIDABLE_REASON.policyInvalid]:
		'the policy block is missing or invalid (status / min_factors / require_phishing_resistant / max_confirmation_age_days)',
	[UNDECIDABLE_REASON.serviceUnknown]: 'a row names a service outside the four required accounts',
	[UNDECIDABLE_REASON.serviceDuplicated]: 'a service appears twice; the two rows cannot be merged',
	[UNDECIDABLE_REASON.factorKindUnknown]: 'a factor names a kind outside the supported enum',
	[UNDECIDABLE_REASON.confirmationDateInvalid]:
		'a confirmation date is not an ISO calendar day (YYYY-MM-DD)',
	[UNDECIDABLE_REASON.confirmationDateInFuture]:
		'a confirmation date is in the future, which is not a confirmation',
	[UNDECIDABLE_REASON.confirmationDateInconsistent]:
		'a row is dated older than one of its own factors, so the record contradicts itself',
	[UNDECIDABLE_REASON.clockInvalid]: 'the clock could not be read, so no ageing was computed',
	[UNDECIDABLE_REASON.fixtureClockMissing]:
		'a recorded fixture did not declare `now`, so its verdict would drift with the wall clock',
});

/**
 * Audit a ledger and return the verdict. Never throws; an unreadable,
 * unreconcilable or undatable ledger is `UNDECIDABLE` with a reason code
 * and no rows.
 *
 * @param {string | object} input raw JSON text or an already-parsed object
 * @param {{now?: string | number | Date}} [options] the clock the ageing uses
 * @returns {Audit}
 */
export function auditLedger(input, options = {}) {
	const clock = normalizeClock(options.now);
	if (clock === null) {
		return undecidableAudit(UNDECIDABLE_REASON.clockInvalid, {
			notes: ['the clock could not be read, so no ageing was computed'],
		});
	}
	const read = readLedger(input);
	if ('reason' in read) {
		return undecidableAudit(read.reason, { clock, notes: [READ_REASON_NOTE[read.reason] ?? '-'] });
	}

	const nowMs = Date.parse(`${clock}T00:00:00Z`);
	const policy = read.ledger.policy;
	/** @type {Row[]} */
	const rows = [];
	const seen = new Set();

	for (const entry of read.ledger.services) {
		const shapeReason = readServiceRow(entry, seen);
		if (shapeReason !== null) return undecidableAudit(shapeReason, { clock });
		seen.add(entry.service);
		const classified = classifyRow(entry.service, entry, policy, nowMs);
		if ('fatal' in classified) {
			return undecidableAudit(classified.fatal, {
				clock,
				notes: [READ_REASON_NOTE[classified.fatal] ?? '-'],
			});
		}
		rows.push(classified);
	}

	for (const service of REQUIRED_SERVICES) {
		if (seen.has(service)) continue;
		const meta = SERVICE[service];
		rows.push({
			service,
			label: meta.label,
			labelJa: meta.labelJa,
			confirmedAt: null,
			factors: [],
			state: STATE.missing,
			reason: REASON.serviceMissing,
		});
	}
	rows.sort((a, b) => REQUIRED_SERVICES.indexOf(a.service) - REQUIRED_SERVICES.indexOf(b.service));

	const counts = { confirmed: 0, unconfirmed: 0, stale: 0, missing: 0 };
	for (const row of rows) counts[row.state] += 1;

	const notes = [];
	if (policy.status === POLICY_STATUS.proposed) {
		notes.push(
			'policy_status=proposed: the criteria are Issue #469 defaults and are not owner-ratified yet',
		);
	}

	const outstanding = counts.unconfirmed + counts.stale + counts.missing;
	const verdict = outstanding === 0 ? VERDICT.ok : VERDICT.outstanding;
	return {
		verdict,
		reason: '-',
		policy: {
			status: policy.status,
			minFactors: policy.minFactors,
			requirePhishingResistant: policy.requirePhishingResistant,
			maxAgeDays: policy.maxAgeDays,
		},
		policyRatified: policy.status === POLICY_STATUS.ratified,
		rows,
		counts,
		clock,
		notes,
	};
}

/**
 * A recorded fixture is an envelope around a ledger: the clock the run
 * was recorded with, a case name, an operator-facing note, the ledger
 * itself and the verdict the suite asserts. The clock lives in the
 * fixture so a recorded verdict stays the verdict it had on the day it
 * was recorded — a fixture that aged into `STALE` would silently stop
 * testing what it was written for.
 */
export const FIXTURE_KEYS = Object.freeze(['case', 'now', 'note', 'ledger', 'expect']);

/**
 * Read a fixture envelope. Returns `{ fixture }` or `{ reason }`.
 *
 * @param {string | object} input
 * @returns {{fixture?: object, reason?: string}}
 */
export function readFixture(input) {
	/** @type {unknown} */
	let raw = input;
	if (typeof input === 'string') {
		try {
			raw = JSON.parse(input);
		} catch {
			return { reason: UNDECIDABLE_REASON.ledgerUnparseable };
		}
	}
	if (!isPlainObject(raw)) return { reason: UNDECIDABLE_REASON.ledgerShapeInvalid };
	const extra = unknownKeys(Object.keys(raw), FIXTURE_KEYS);
	if (extra.length > 0) return { reason: UNDECIDABLE_REASON.unknownField };
	if (typeof raw.case !== 'string' || raw.case.length === 0) {
		return { reason: UNDECIDABLE_REASON.ledgerShapeInvalid };
	}
	if (!isPlainObject(raw.expect) || typeof raw.expect.verdict !== 'string') {
		return { reason: UNDECIDABLE_REASON.ledgerShapeInvalid };
	}
	// `now` is required, not optional: a fixture without it would fall
	// back to the wall clock, so the verdict it asserts would silently
	// drift with the day it runs on — the opposite of what a recorded
	// fixture exists for.
	if (typeof raw.now !== 'string') return { reason: UNDECIDABLE_REASON.fixtureClockMissing };
	const ledgerRead = readLedger(raw.ledger);
	if ('reason' in ledgerRead) return ledgerRead;
	return {
		fixture: {
			case: raw.case,
			now: raw.now,
			note: typeof raw.note === 'string' ? raw.note : '',
			ledger: raw.ledger,
			expect: raw.expect,
		},
	};
}

/** Process exit code for a verdict. `UNDECIDABLE` is never a pass. */
export function exitCodeFor(audit) {
	if (audit.verdict === VERDICT.ok) return 0;
	if (audit.verdict === VERDICT.outstanding) return 1;
	return 2;
}

function pad(text, width) {
	const value = String(text);
	return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * Render the status-only text an operator pastes into a PR or an Issue.
 *
 * The output carries a service id, a state, an ISO date, factor kinds and
 * a reason code — and nothing else. It is run through the same
 * anonymization guard as the HTML report, and a leak throws here rather
 * than reaching stdout.
 *
 * @param {Audit} audit
 * @param {{source?: string, note?: string}} [context]
 * @returns {string}
 */
export function formatAuditReport(audit, context = {}) {
	const lines = [];
	lines.push('operator MFA confirmation audit (Issue #469)');
	lines.push(`source: ${context.source ?? 'unknown'}`);
	lines.push(`clock: ${audit.clock}`);
	if (audit.policy) {
		lines.push(
			`policy: status=${audit.policy.status} min_factors=${audit.policy.minFactors} ` +
				`require_phishing_resistant=${audit.policy.requirePhishingResistant} ` +
				`max_confirmation_age_days=${audit.policy.maxAgeDays}`,
		);
	} else {
		lines.push('policy: - (the ledger could not be read)');
	}
	lines.push('');
	lines.push(
		`${pad('service', 12)}${pad('state', 12)}${pad('confirmed_at', 14)}${pad('factors', 26)}reason`,
	);
	for (const row of audit.rows) {
		lines.push(
			`${pad(row.service, 12)}${pad(row.state, 12)}${pad(row.confirmedAt ?? '-', 14)}` +
				`${pad(row.factors.length > 0 ? row.factors.join(',') : '-', 26)}${row.reason}`,
		);
	}
	if (audit.rows.length === 0) {
		lines.push('(no rows: the ledger is undecidable, so no service is reported as anything)');
	}
	lines.push('');
	lines.push(
		`verdict: ${audit.verdict}  reason=${audit.reason}  ` +
			`confirmed=${audit.counts.confirmed} unconfirmed=${audit.counts.unconfirmed} ` +
			`stale=${audit.counts.stale} missing=${audit.counts.missing} exit=${exitCodeFor(audit)}`,
	);
	for (const note of audit.notes) lines.push(`note: ${note}`);
	if (context.note) lines.push(`note: ${context.note}`);
	lines.push(
		'note: no account identifier, factor secret or enrolment list is part of this ledger or this output',
	);
	const text = `${lines.join('\n')}\n`;
	assertNoSensitiveInText(text);
	return text;
}

/**
 * The mechanical anonymization guard: report every pattern hit as
 * `{ id, line }` and **never** the matched text. A scanner whose finding
 * quotes the value it found is a disclosure channel (AGENTS.md §4).
 *
 * @param {string} text
 * @returns {{id: string, line: number}[]}
 */
export function findSensitiveInText(text) {
	/** @type {{id: string, line: number}[]} */
	const findings = [];
	text.split('\n').forEach((line, index) => {
		for (const pattern of SENSITIVE_PATTERNS) {
			if (pattern.re.test(line)) findings.push({ id: pattern.id, line: index + 1 });
		}
	});
	return findings;
}

/** Throw (value-free) when the text would disclose an identifier or a secret. */
export function assertNoSensitiveInText(text) {
	const findings = findSensitiveInText(text);
	if (findings.length === 0) return;
	const first = findings[0];
	throw new Error(
		`anonymization guard: ${first.id} at line ${first.line} (${findings.length} finding(s)); the matched text is deliberately not printed`,
	);
}
