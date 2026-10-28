import { describe, expect, it } from 'vitest';
import {
	D1_MAX_SAFE_INTEGER,
	D1_MIN_SAFE_INTEGER,
	classifyD1NumericValue,
	isD1BackupSafeNumber,
} from './d1-numeric';

/**
 * Unit tests for the D1 / JavaScript numeric boundary (Issue #701).
 *
 * The claim under test: a number may enter a backup document only when
 * the document can be shown to carry the value that was stored. The
 * binding side of that claim — a real D1 round trip — is exercised in
 * `test/integration/d1-backup-integer-precision.test.ts`; this file
 * pins the rule itself, so a failure names the boundary that broke
 * instead of the binding.
 *
 * The values below are the ones the Issue names: ±(2^53 − 1), ±2^53,
 * and the SQLite int64 bounds as the JavaScript adapter sees them.
 */

describe('the safe-integer range is the boundary the adapter can cross', () => {
	it('accepts the largest and smallest exactly representable integers', () => {
		expect(D1_MAX_SAFE_INTEGER).toBe(9007199254740991);
		expect(D1_MIN_SAFE_INTEGER).toBe(-9007199254740991);
		expect(classifyD1NumericValue(D1_MAX_SAFE_INTEGER)).toBe('safe_integer');
		expect(classifyD1NumericValue(D1_MIN_SAFE_INTEGER)).toBe('safe_integer');
		expect(isD1BackupSafeNumber(D1_MAX_SAFE_INTEGER)).toBe(true);
		expect(isD1BackupSafeNumber(D1_MIN_SAFE_INTEGER)).toBe(true);
	});

	it('refuses ±2^53, the first integer a double cannot carry', () => {
		expect(Number.isSafeInteger(2 ** 53)).toBe(false);
		expect(classifyD1NumericValue(2 ** 53)).toBe('unsafe_integer');
		expect(classifyD1NumericValue(-(2 ** 53))).toBe('unsafe_integer');
		expect(isD1BackupSafeNumber(2 ** 53)).toBe(false);
		expect(isD1BackupSafeNumber(-(2 ** 53))).toBe(false);
	});

	it('refuses the SQLite int64 bounds as the adapter delivers them', () => {
		// The int64 maximum is not representable: the adapter delivers
		// it as 2^63, which is a different integer.
		expect(BigInt(2 ** 63)).not.toBe(9223372036854775807n);
		expect(BigInt(2 ** 63)).toBe(9223372036854775808n);
		expect(Number.isSafeInteger(2 ** 63)).toBe(false);
		expect(classifyD1NumericValue(2 ** 63)).toBe('unsafe_integer');
		expect(classifyD1NumericValue(-(2 ** 63))).toBe('unsafe_integer');
		expect(isD1BackupSafeNumber(2 ** 63)).toBe(false);
		expect(isD1BackupSafeNumber(-(2 ** 63))).toBe(false);
	});
});

describe('a REAL is judged by a different rule than an INTEGER', () => {
	it('accepts a fractional value, because only a REAL can produce one', () => {
		expect(classifyD1NumericValue(1.5)).toBe('finite_real');
		expect(classifyD1NumericValue(-2.25)).toBe('finite_real');
		expect(classifyD1NumericValue(0.1)).toBe('finite_real');
		expect(isD1BackupSafeNumber(1.5)).toBe(true);
		expect(isD1BackupSafeNumber(-2.25)).toBe(true);
	});

	it('accepts an integral REAL inside the safe range', () => {
		expect(classifyD1NumericValue(2)).toBe('safe_integer');
		expect(classifyD1NumericValue(0)).toBe('safe_integer');
		expect(isD1BackupSafeNumber(2)).toBe(true);
	});

	it('refuses a non-finite value, because JSON carries neither', () => {
		expect(classifyD1NumericValue(Number.NaN)).toBe('not_finite');
		expect(classifyD1NumericValue(Number.POSITIVE_INFINITY)).toBe('not_finite');
		expect(classifyD1NumericValue(Number.NEGATIVE_INFINITY)).toBe('not_finite');
		expect(isD1BackupSafeNumber(Number.NaN)).toBe(false);
		expect(isD1BackupSafeNumber(Number.POSITIVE_INFINITY)).toBe(false);
	});
});

describe('the rule is the same one the JSON round trip keeps', () => {
	it('keeps every accepted number byte-exact through JSON', () => {
		const accepted = [
			D1_MAX_SAFE_INTEGER,
			D1_MIN_SAFE_INTEGER,
			0,
			1,
			1.5,
			-2.25,
			0.1,
			Number.MIN_VALUE,
		];
		for (const value of accepted) {
			expect(isD1BackupSafeNumber(value)).toBe(true);
			// `JSON.stringify` emits the shortest representation that
			// parses back to the same double, so the document carries
			// the value and not an approximation of it.
			expect(JSON.parse(JSON.stringify(value))).toBe(value);
		}
	});

	it('rounds an int64 the adapter cannot carry, which is why it is refused', () => {
		// The neighbouring int64 rounds onto the same double, so a
		// document could not tell the two apart.
		expect(2 ** 53 + 1).toBe(2 ** 53);
		expect(Number.isSafeInteger(2 ** 53)).toBe(false);
		expect(isD1BackupSafeNumber(2 ** 53)).toBe(false);
	});

	it('refuses an integral value beyond the safe range even when it is a REAL', () => {
		// The rule draws ONE line, at 2^53 − 1, and refuses every
		// integral value beyond it. A REAL holding 1e16 would
		// round-trip exactly, and is still refused: a second line at
		// the int64 range would make the rule depend on a column's
		// storage class, which a value read through the adapter does
		// not carry. Refusing a value that would have round-tripped is
		// a smaller defect than accepting one that would not.
		expect(classifyD1NumericValue(1e16)).toBe('unsafe_integer');
		expect(classifyD1NumericValue(Number.MAX_VALUE)).toBe('unsafe_integer');
		expect(isD1BackupSafeNumber(1e16)).toBe(false);
		expect(isD1BackupSafeNumber(Number.MAX_VALUE)).toBe(false);
	});
});
