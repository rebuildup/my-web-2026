import { describe, expect, it } from 'vitest';
import {
	ACTOR_COOKIE_NAME,
	ACTOR_COOKIE_VALUE_LEN,
	buildActorCookieSetHeader,
	generateActorId,
	isWellFormedActorId,
	readActorIdFromCookieHeader,
} from './cookie';

/**
 * Cookie helper unit tests — pure functions, no workerd.
 */

describe('cookie helpers', () => {
	describe('generateActorId', () => {
		it('produces a 32-hex-char value', () => {
			const id = generateActorId();
			expect(id).toHaveLength(ACTOR_COOKIE_VALUE_LEN);
			expect(isWellFormedActorId(id)).toBe(true);
		});

		it('produces unique values across calls', () => {
			const ids = new Set(Array.from({ length: 64 }, () => generateActorId()));
			expect(ids.size).toBe(64);
		});
	});

	describe('isWellFormedActorId', () => {
		it('accepts canonical 32-hex ids', () => {
			expect(isWellFormedActorId('0123456789abcdef0123456789abcdef')).toBe(true);
		});
		it('rejects wrong-length / non-hex / mixed case', () => {
			expect(isWellFormedActorId('0123')).toBe(false);
			expect(isWellFormedActorId('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
			expect(isWellFormedActorId('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
		});
		it('rejects non-strings', () => {
			expect(isWellFormedActorId(123)).toBe(false);
			expect(isWellFormedActorId(null)).toBe(false);
			expect(isWellFormedActorId(undefined)).toBe(false);
		});
	});

	describe('readActorIdFromCookieHeader', () => {
		it('returns null when the header is absent', () => {
			expect(readActorIdFromCookieHeader(null)).toBeNull();
			expect(readActorIdFromCookieHeader(undefined)).toBeNull();
		});
		it('returns null when the cookie is absent from the header', () => {
			expect(readActorIdFromCookieHeader('other=1; foo=bar')).toBeNull();
		});
		it('returns the value when present', () => {
			const id = generateActorId();
			expect(readActorIdFromCookieHeader(`${ACTOR_COOKIE_NAME}=${id}`)).toBe(id);
		});
		it('returns the value when surrounded by other cookies', () => {
			const id = generateActorId();
			expect(readActorIdFromCookieHeader(`a=1; ${ACTOR_COOKIE_NAME}=${id}; b=2`)).toBe(id);
		});
		it('returns null when the value is malformed', () => {
			expect(readActorIdFromCookieHeader(`${ACTOR_COOKIE_NAME}=not-hex`)).toBeNull();
		});
	});

	describe('buildActorCookieSetHeader', () => {
		it('includes HttpOnly, SameSite=Lax, Path=/, Max-Age=1y, and Secure when requested', () => {
			const value = '0123456789abcdef0123456789abcdef';
			const header = buildActorCookieSetHeader(value, true);
			expect(header).toContain(`${ACTOR_COOKIE_NAME}=${value}`);
			expect(header).toContain('Max-Age=31536000');
			expect(header).toContain('Path=/');
			expect(header).toContain('HttpOnly');
			expect(header).toContain('SameSite=Lax');
			expect(header).toContain('Secure');
		});
		it('omits Secure when not requested (local dev)', () => {
			const value = '0123456789abcdef0123456789abcdef';
			const header = buildActorCookieSetHeader(value, false);
			expect(header).not.toContain('Secure');
			expect(header).toContain('HttpOnly');
			expect(header).toContain('SameSite=Lax');
		});
	});
});
