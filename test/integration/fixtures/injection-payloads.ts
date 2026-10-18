/**
 * String-attack fixtures for the D1 parameter-binding suite (Issue #452).
 *
 * These strings are attacker input, not production data. They exist so
 * `test/integration/d1-parameter-binding.test.ts` can push them through
 * the real external HTTP boundary (`/api/v1/*`) and the D1 loaders, and
 * then assert three things:
 *
 *   1. **Query structure never changes.** The SQL text handed to
 *      `D1Database.prepare()` is identical whether the caller sent a
 *      benign value or one of these payloads.
 *   2. **The payload only ever reaches SQLite as a bound value.** It
 *      never appears inside the statement text, so it cannot change the
 *      parse tree.
 *   3. **Table contents are maintained.** Seeded rows survive, and the
 *      attack widens no predicate — a tautology payload still returns
 *      zero rows instead of "everything".
 *
 * Nothing here is a secret, a credential, or a real customer string; it
 * is the OWASP-style metacharacter set quoted in Issue #452 (ASVS V5.3.4
 * "parameterised queries") plus the classic tautology / UNION /
 * stacked-statement / comment-tail shapes.
 *
 * Three families, because the surfaces differ:
 *
 *   - `INJECTION_PAYLOADS` — metacharacter payloads whose length fits
 *     the surface under test. Surfaces that bound length but not
 *     charset MUST store them verbatim as data.
 *   - `MALFORMED_INPUT_PAYLOADS` — inputs the format validators reject
 *     before SQLite runs (over-length, embedded whitespace, control
 *     character). The contract for those is "rejected, D1 untouched".
 *   - `UNIVERSAL_PAYLOADS` — the short subset that fits every length
 *     bound in the codebase, including `MAX_EMOJI_LEN` (16).
 */

/** A single attacker-controlled string plus why it is in the set. */
export interface InjectionPayload {
	/** Stable identifier used in test names and failure messages. */
	readonly id: string;
	/** The literal string sent to the endpoint / loader. */
	readonly value: string;
	/** Which injection technique the payload exercises. */
	readonly intent: string;
}

/**
 * Length-legal metacharacter payloads.
 *
 * `withinMaxLength()` narrows the set for surfaces with a tight bound;
 * `withoutWhitespace()` narrows it for the access-counter key / session
 * validators, which refuse ASCII control characters, space and DEL.
 */
export const INJECTION_PAYLOADS: readonly InjectionPayload[] = [
	{
		id: 'tautology',
		value: "' OR '1'='1",
		intent: "closes the string literal and appends an always-true comparison (' OR '1'='1)",
	},
	{
		id: 'comment-tail',
		value: "' OR 1=1 --",
		intent: 'classic comment-terminated tautology (-- swallows the rest of the statement)',
	},
	{
		id: 'union-select',
		value: "' UNION SELECT 1,2,3 --",
		intent: 'attempts to splice an extra result set into a 3-column SELECT',
	},
	{
		id: 'stacked-delete',
		value: "x'; DELETE FROM reactions; --",
		intent: 'stacked-statement attempt (D1 prepare() rejects multi-statement SQL outright)',
	},
	{
		id: 'backslash-quote',
		value: "\\' OR 1=1 --",
		intent: "backslash-escaped quote, to catch naive \\' -escaping in a string builder",
	},
	{
		id: 'like-wildcard',
		value: "%' OR slug LIKE '%",
		intent: 'LIKE wildcard pair, to catch a query that swaps = for LIKE on untrusted input',
	},
	{
		// The same tautology with the whitespace removed: the access
		// counter rejects spaces, so without this variant that surface
		// could only ever be tested through its rejection path.
		id: 'tautology-compact',
		value: "'OR'1'='1",
		intent: 'whitespace-free tautology, the shape that reaches the access-counter validators',
	},
	{
		id: 'union-compact',
		value: "'UNIONSELECT1,2,3--",
		intent: 'whitespace-free UNION/SELECT splice attempt',
	},
	{
		id: 'wildcard-compact',
		value: "%'OR'%",
		intent: 'whitespace-free LIKE wildcard pair',
	},
];

/**
 * Inputs the format validators reject before any SQL runs.
 *
 * They belong to the same threat model: the safe outcome is a client
 * error with D1 untouched, not a silent write.
 */
export const MALFORMED_INPUT_PAYLOADS: readonly InjectionPayload[] = [
	{
		id: 'over-length',
		value: 'x'.repeat(257),
		intent: 'one character past MAX_TARGET_KEY_LEN / MAX_ACTOR_ID_LEN / MAX_COUNTER_KEY_LEN',
	},
	{
		id: 'embedded-whitespace',
		value: 'home page',
		intent: 'space is rejected by the access-counter key/session validators',
	},
	{
		id: 'control-char',
		value: `home-page${String.fromCharCode(0)}`,
		intent:
			'NUL is an ASCII control character, rejected by the access-counter key/session validators',
	},
];

/** Every attacker string in the suite, for the "never inside SQL text" assertion. */
export const ALL_PAYLOADS: readonly InjectionPayload[] = [
	...INJECTION_PAYLOADS,
	...MALFORMED_INPUT_PAYLOADS,
];

/** Payloads whose length fits a validator bounding inputs at `max` characters. */
export function withinMaxLength(
	payloads: readonly InjectionPayload[],
	max: number,
): InjectionPayload[] {
	return payloads.filter((payload) => payload.value.length <= max);
}

/**
 * Mirrors the access-counter `hasForbiddenChar` rule (ASCII control
 * characters, space and DEL) without importing it, so the fixture stays
 * free of a `src/http` dependency.
 */
export function hasControlOrWhitespace(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x20 || code === 0x7f) return true;
	}
	return false;
}

/** Payloads the access-counter key / session validators let through. */
export function withoutWhitespace(payloads: readonly InjectionPayload[]): InjectionPayload[] {
	return payloads.filter((payload) => !hasControlOrWhitespace(payload.value));
}

/** Payloads that fit every length bound in the codebase. */
export const UNIVERSAL_PAYLOADS: readonly InjectionPayload[] = withinMaxLength(
	INJECTION_PAYLOADS,
	16,
);
