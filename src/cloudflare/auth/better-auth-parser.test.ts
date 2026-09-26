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

		it('rejects entries missing the version:value separator', () => {
			expect(() => parseVersionedSecrets('bad-format-no-colon,1:old')).toThrow(
				/missing ':' separator/,
			);
		});

		it('rejects entries with non-positive-integer versions', () => {
			expect(() => parseVersionedSecrets('0:zero,1:old')).toThrow(/invalid version/);
			expect(() => parseVersionedSecrets('-1:negative,1:old')).toThrow(/invalid version/);
			expect(() => parseVersionedSecrets('abc:notnum,1:old')).toThrow(/invalid version/);
		});

		it('rejects entries with empty value', () => {
			expect(() => parseVersionedSecrets('2:,1:old')).toThrow(/empty value/);
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
		it('does not include the raw entry string when separator is missing', () => {
			const secretFragment = 'super-secret-leak-test-value-12345';
			try {
				parseVersionedSecrets(`2:${secretFragment},bad-format-no-colon`);
				expect.fail('expected throw');
			} catch (e) {
				const message = (e as Error).message;
				expect(message).not.toContain(secretFragment);
				expect(message).not.toContain('super-secret');
			}
		});

		it('does not include the secret value when the value is empty', () => {
			try {
				parseVersionedSecrets('2:,1:old');
				expect.fail('expected throw');
			} catch (e) {
				const message = (e as Error).message;
				// The error must mention "empty value" but must not carry any
				// neighbouring-entry fragment either.
				expect(message).toMatch(/empty value/);
				expect(message).not.toContain('1:old');
			}
		});

		it('does not echo duplicate-version raw values', () => {
			const secretA = 'rotate-confidential-A-99887';
			const secretB = 'rotate-confidential-B-77665';
			try {
				parseVersionedSecrets(`2:${secretA},2:${secretB},1:old`);
				expect.fail('expected throw');
			} catch (e) {
				const message = (e as Error).message;
				expect(message).not.toContain(secretA);
				expect(message).not.toContain(secretB);
			}
		});

		it('does not echo ascending-order raw values', () => {
			const oldSecret = 'old-key-confidential-001';
			const newSecret = 'new-key-confidential-002';
			try {
				parseVersionedSecrets(`1:${oldSecret},2:${newSecret}`);
				expect.fail('expected throw');
			} catch (e) {
				const message = (e as Error).message;
				expect(message).not.toContain(oldSecret);
				expect(message).not.toContain(newSecret);
			}
		});
	});
});
