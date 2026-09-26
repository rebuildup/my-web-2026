import { describe, expect, it } from 'vitest';
import { parseVersionedSecrets } from './better-auth';

/**
 * `BETTER_AUTH_SECRETS` parser invariants — pure-function unit tests.
 *
 * The parser is the contract surface between the runtime secret SoT
 * (Infisical / Cloudflare Worker secret bindings) and Better Auth 1.5+'s
 * versioned `secrets` option. Three classes of invariants matter:
 *
 *   1. **Well-formed input parsing** — comma-separated `version:value`
 *      pairs with positive integer versions and non-empty values.
 *   2. **Cross-entry invariants** — Better Auth treats the array head as
 *      the current signing key. Duplicate versions or non-descending
 *      order would silently promote an old key to the "current" role.
 *   3. **Secret-handling invariant** — error messages must NOT echo the
 *      raw entry back. The raw entry may carry the secret itself, and
 *      ADR-0015 forbids leaking secrets to argv / logs / errors.
 */
describe('parseVersionedSecrets', () => {
	describe('well-formed input', () => {
		it('parses a strictly descending multi-entry list', () => {
			const result = parseVersionedSecrets('2:new-secret,1:old-secret');
			expect(result).toEqual([
				{ version: 2, value: 'new-secret' },
				{ version: 1, value: 'old-secret' },
			]);
		});

		it('parses a single-entry list', () => {
			const result = parseVersionedSecrets('3:single-secret');
			expect(result).toEqual([{ version: 3, value: 'single-secret' }]);
		});

		it('tolerates whitespace around commas', () => {
			const result = parseVersionedSecrets('2:new , 1:old');
			expect(result).toEqual([
				{ version: 2, value: 'new' },
				{ version: 1, value: 'old' },
			]);
		});

		it('preserves value strings containing colons (only the first ":" splits)', () => {
			const result = parseVersionedSecrets('2:abc:def,1:old');
			expect(result).toEqual([
				{ version: 2, value: 'abc:def' },
				{ version: 1, value: 'old' },
			]);
		});
	});

	describe('malformed input', () => {
		it('rejects empty input', () => {
			expect(() => parseVersionedSecrets('')).toThrow(/empty/i);
		});

		it('rejects whitespace-only input', () => {
			expect(() => parseVersionedSecrets('   ')).toThrow(/empty/i);
		});

		it('rejects entries missing the version:value separator', () => {
			expect(() => parseVersionedSecrets('bad-format-no-colon,1:old')).toThrow(
				/missing ':' separator/,
			);
		});

		it('rejects entries with non-decimal-digit version (e.g. exponent / hex)', () => {
			expect(() => parseVersionedSecrets('1e3:notnum,1:old')).toThrow(/decimal digits only/);
			expect(() => parseVersionedSecrets('0x10:notnum,1:old')).toThrow(/decimal digits only/);
		});

		it('rejects entries with non-positive-integer versions', () => {
			expect(() => parseVersionedSecrets('0:zero,1:old')).toThrow(/positive safe integer/);
			expect(() => parseVersionedSecrets('-1:negative,1:old')).toThrow(/decimal digits only/);
			expect(() => parseVersionedSecrets('abc:notnum,1:old')).toThrow(/decimal digits only/);
		});

		it('rejects entries with empty value', () => {
			expect(() => parseVersionedSecrets('2:,1:old')).toThrow(/empty value/);
		});

		it('rejects empty segments from extra commas ("2:new,,1:old")', () => {
			expect(() => parseVersionedSecrets('2:new,,1:old')).toThrow(
				/empty \(extra or trailing comma/,
			);
		});

		it('rejects trailing commas ("2:new,1:old,")', () => {
			expect(() => parseVersionedSecrets('2:new,1:old,')).toThrow(
				/empty \(extra or trailing comma/,
			);
		});
	});

	describe('cross-entry invariants', () => {
		it('rejects duplicate versions', () => {
			expect(() => parseVersionedSecrets('2:same,2:other,1:old')).toThrow(/duplicate version/);
		});

		it('rejects ascending order (current key at tail)', () => {
			expect(() => parseVersionedSecrets('1:old,2:new')).toThrow(/strictly descending order/);
		});

		it('rejects equal versions between two entries (not strictly less)', () => {
			// Caught by the duplicate-version check first; this test exists to
			// document that path explicitly.
			expect(() => parseVersionedSecrets('2:a,2:b,1:old')).toThrow();
		});
	});

	describe('secret-handling invariant (no leak in error messages)', () => {
		// Helper: assert parser throws and the error message does NOT contain
		// any of the given forbidden substrings. Keeps the assertion separate
		// from the throw site so a parser that does not throw does not
		// silently produce a passing test (which is the bug CodeRabbit
		// flagged as `PRRT_kwDOUW6FgM6mQRun`).
		function expectNoLeak(raw: string, forbidden: string[]) {
			expect(() => parseVersionedSecrets(raw)).toThrow();
			try {
				parseVersionedSecrets(raw);
			} catch (e) {
				const message = (e as Error).message;
				for (const fragment of forbidden) {
					expect(message).not.toContain(fragment);
				}
			}
		}

		it('does not include the raw entry string when separator is missing', () => {
			const secretFragment = 'super-secret-leak-test-value-12345';
			expectNoLeak(`2:${secretFragment},bad-format-no-colon`, [secretFragment, 'super-secret']);
		});

		it('does not include the secret value when the value is empty', () => {
			expect(() => parseVersionedSecrets('2:,1:old')).toThrow(/empty value/);
			try {
				parseVersionedSecrets('2:,1:old');
			} catch (e) {
				const message = (e as Error).message;
				expect(message).toMatch(/empty value/);
				expect(message).not.toContain('1:old');
			}
		});

		it('does not echo duplicate-version raw values', () => {
			const secretA = 'rotate-confidential-A-99887';
			const secretB = 'rotate-confidential-B-77665';
			expectNoLeak(`2:${secretA},2:${secretB},1:old`, [secretA, secretB]);
		});

		it('does not echo ascending-order raw values', () => {
			const oldSecret = 'old-key-confidential-001';
			const newSecret = 'new-key-confidential-002';
			expectNoLeak(`1:${oldSecret},2:${newSecret}`, [oldSecret, newSecret]);
		});

		it('does not echo raw values when version is malformed', () => {
			const secret = 'malformed-version-leak-test-33445';
			expectNoLeak(`2${secret},1:old`, [secret]);
		});
	});
});
