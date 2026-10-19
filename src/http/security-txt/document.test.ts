import { describe, expect, it } from 'vitest';
import {
	SECURITY_TXT_ALLOWED_FIELDS,
	SECURITY_TXT_CANONICAL_URL,
	SECURITY_TXT_CONTENT_TYPE,
	SECURITY_TXT_ORIGIN,
	SECURITY_TXT_PATH,
	type SecurityTxtDocument,
	isSecurityTxtLive,
	renderSecurityTxt,
} from './document';

/**
 * The RFC 9116 §6 grammar, asserted on the rendered bytes (Issue #468).
 *
 * Why this file exists separately from the schema test
 * ---------------------------------------------------
 * `policy.test.ts` proves WHICH documents may be published; this file
 * proves the shape of the bytes when one is. A renderer that emitted a
 * valid document in the wrong order — `Expires:` first, or a `Contact:`
 * after it — would still satisfy every schema rule and would be
 * rejected by the parsers that read this file, which is why the
 * ordering assertions below are the load-bearing ones.
 *
 * The fixture is a fully populated document: every field the renderer
 * can emit is present, so a field added to the schema later cannot be
 * added to the renderer silently.
 */

const EXPIRES = '2027-04-01T00:00:00.000Z';

const FULL: SecurityTxtDocument = {
	contacts: ['mailto:security@example.invalid', 'https://example.invalid/security/advisories/new'],
	expires: EXPIRES,
	encryption: ['https://example.invalid/pgp-key.txt'],
	acknowledgments: ['https://example.invalid/security/acknowledgments'],
	preferredLanguages: ['ja', 'en'],
	canonical: SECURITY_TXT_CANONICAL_URL,
	policy: 'https://example.invalid/security-policy',
	hiring: 'https://example.invalid/careers',
	csaf: 'https://example.invalid/security/data/csaf.json',
};

function lines(document: SecurityTxtDocument): string[] {
	return renderSecurityTxt(document).replace(/\n$/, '').split('\n');
}

describe('renderSecurityTxt', () => {
	it('puts Contact on the start line and Expires on the last line (RFC 9116 §6)', () => {
		const rendered = lines(FULL);
		expect(rendered[0]?.startsWith('Contact: ')).toBe(true);
		expect(rendered.at(-1)).toBe(`Expires: ${EXPIRES}`);
	});

	it('repeats a field once per value, in order', () => {
		expect(lines(FULL)).toEqual([
			'Contact: mailto:security@example.invalid',
			'Contact: https://example.invalid/security/advisories/new',
			'Encryption: https://example.invalid/pgp-key.txt',
			'Acknowledgments: https://example.invalid/security/acknowledgments',
			'Preferred-Languages: ja',
			'Preferred-Languages: en',
			`Canonical: ${SECURITY_TXT_CANONICAL_URL}`,
			'Policy: https://example.invalid/security-policy',
			'Hiring: https://example.invalid/careers',
			'CSAF: https://example.invalid/security/data/csaf.json',
			`Expires: ${EXPIRES}`,
		]);
	});

	it('emits only the fields the RFC 9116 §6 grammar knows', () => {
		const fields = new Set(lines(FULL).map((line) => line.split(':')[0]));
		for (const field of fields) {
			expect(SECURITY_TXT_ALLOWED_FIELDS).toContain(
				field as (typeof SECURITY_TXT_ALLOWED_FIELDS)[number],
			);
		}
		// No comment production exists in RFC 9116 §6, so a `#` line
		// would make the whole file unparseable.
		expect(renderSecurityTxt(FULL)).not.toMatch(/^#/m);
	});

	it('ends with a trailing newline and uses LF line endings', () => {
		const rendered = renderSecurityTxt(FULL);
		expect(rendered.endsWith('\n')).toBe(true);
		expect(rendered.includes('\r')).toBe(false);
	});

	it('omits an absent field entirely instead of emitting an empty one', () => {
		const minimal = renderSecurityTxt({
			contacts: ['mailto:security@example.invalid'],
			expires: EXPIRES,
		});
		expect(minimal).toBe(`Contact: mailto:security@example.invalid\nExpires: ${EXPIRES}\n`);
	});

	it('declares the path, media type and canonical URL RFC 9116 §3.1 requires', () => {
		expect(SECURITY_TXT_PATH).toBe('/.well-known/security.txt');
		expect(SECURITY_TXT_CONTENT_TYPE).toBe('text/plain; charset=utf-8');
		expect(SECURITY_TXT_ORIGIN).toBe('https://rebuildup.dev');
		expect(SECURITY_TXT_CANONICAL_URL).toBe('https://rebuildup.dev/.well-known/security.txt');
	});
});

describe('isSecurityTxtLive', () => {
	const now = Date.parse(EXPIRES);

	it('is live strictly before the deadline', () => {
		expect(isSecurityTxtLive(FULL, now - 1)).toBe(true);
	});

	it('is not live at or after the deadline (RFC 9116 §2.5.1)', () => {
		expect(isSecurityTxtLive(FULL, now)).toBe(false);
		expect(isSecurityTxtLive(FULL, now + 1)).toBe(false);
	});

	it('treats an unreadable deadline as expired rather than valid forever', () => {
		expect(isSecurityTxtLive({ contacts: [], expires: 'not a date' }, now)).toBe(false);
	});
});
