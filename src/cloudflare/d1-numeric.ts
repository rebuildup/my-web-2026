/**
 * The D1 / JavaScript numeric boundary (Issue #701).
 *
 * The obligation this module owns
 * -------------------------------
 * SQLite stores an INTEGER as a 64-bit integer. The D1 JavaScript
 * adapter exposes every numeric column as a `number` — an IEEE-754
 * double — so the two representations disagree outside ±(2^53 − 1).
 * This module owns the ONE rule that decides which numbers may cross
 * that boundary into a backup document, and the reason the rule has
 * the shape it has.
 *
 * Why "is it finite?" is not a rule
 * ---------------------------------
 * A double above 2^53 cannot represent every integer around it, so
 * the adapter's number may be a **rounded** int64. A backup document,
 * its digest and its read-back comparison all use that same rounded
 * number, so a matching digest proves only that the same rounded
 * number came back — not that the stored int64 did. A restore that
 * reports success on that basis is claiming something it cannot know,
 * and the claim is exactly the one a backup exists to make.
 *
 * The rule
 * ---------
 * A number may appear in a backup document only when it is one of:
 *
 *   - a **safe integer** (|v| ≤ 2^53 − 1). Every int64 in that range
 *     is exactly representable, so the adapter's double *is* the
 *     stored integer, and the document reproduces it.
 *   - a **fractional finite value**. An int64 always converts to an
 *     integral double, so a fractional value can only have come from a
 *     REAL — and a REAL is stored as that same double, so the value
 *     the document carries is the value that was stored.
 *
 * Everything else is refused:
 *
 *   - an integral value outside the safe range. It may be a rounded
 *     int64, and the document cannot say which int64 it was.
 *   - a non-finite value. JSON has no NaN and no Infinity, so
 *     writing one would silently become `null` in the document.
 *
 * The refusal is deliberately wider than the lossless cases. The rule
 * draws ONE line, at 2^53 − 1, and refuses every integral value beyond
 * it: a REAL column holding 1e16 would round-trip exactly and is
 * still refused. A second line at the int64 range would make the rule
 * depend on a column's storage class, which a value read through the
 * adapter does not carry — and the document's number rule has to be
 * the rule the restore applies. Refusing a value that would have
 * round-tripped is a smaller defect than accepting one that would not.
 *
 * The adapter constraint (recorded, not worked around)
 * -----------------------------------------------------
 * The loss happens in the **JavaScript adapter**, not in SQLite.
 * SQLite keeps the exact int64 — its own JSON surface prints
 * 9223372036854775807 exactly — while the adapter returns
 * 9223372036854775808 for the same row. A document written through
 * this module therefore cannot represent that row at all, and this
 * module says so instead of writing a plausible-looking number.
 *
 * The operator path for a database that holds such values is
 * Cloudflare's own export surface (an operator action outside this
 * repository — see `docs/runbook/d1-backup-restore.md`), which writes
 * an int64 as text and never passes through a JS `number`.
 */

/**
 * The largest integer a JS `number` carries without loss: 2^53 − 1.
 *
 * SQLite's int64 range is far wider, so this is the boundary the
 * adapter cannot cross.
 */
export const D1_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** The smallest integer a JS `number` carries without loss: −(2^53 − 1). */
export const D1_MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;

/**
 * How a number read from D1 classifies against the backup rule.
 *
 * The classes describe the **value**, not SQLite's storage class: the
 * adapter hands over a double and nothing else, so the storage class
 * is not available to the rule (see the module header).
 */
export type D1NumericClass =
	/** An integer inside ±(2^53 − 1): exactly representable, so exact. */
	| 'safe_integer'
	/** A fractional finite value: only a REAL can produce one, so exact. */
	| 'finite_real'
	/** An integral value outside ±(2^53 − 1): possibly a rounded int64. */
	| 'unsafe_integer'
	/** NaN or Infinity: JSON cannot carry either. */
	| 'not_finite';

/**
 * Classify one number against the backup rule.
 *
 * The order of the questions matters: a non-finite value is not an
 * integer at all, and an integral value is judged by the safe-integer
 * range rather than by the fractional rule.
 */
export function classifyD1NumericValue(value: number): D1NumericClass {
	if (!Number.isFinite(value)) return 'not_finite';
	if (!Number.isInteger(value)) return 'finite_real';
	return Number.isSafeInteger(value) ? 'safe_integer' : 'unsafe_integer';
}

/**
 * Whether a number may appear in a backup document — the single
 * predicate the export, the parser and the restore's bind step all
 * ask, so the rule cannot drift between them.
 */
export function isD1BackupSafeNumber(value: number): boolean {
	const numericClass = classifyD1NumericValue(value);
	return numericClass === 'safe_integer' || numericClass === 'finite_real';
}
