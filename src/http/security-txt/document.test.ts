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
 * The RFC 9116 §4 grammar, asserted on the rendered bytes (Issue #468).
 *
 * Why this file exists separately from the schema test
 * ---------------------------------------------------
 * `policy.test.ts` proves WHICH documents may be published; this file
 * proves the shape of the bytes when one is. A renderer that emitted a
 * valid document in the wrong order — `Expires:` before `Contact:`, or
 * the single-valued `Preferred-Languages` field repeated once per
 * language — would still satisfy every schema rule and would be
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
	it('orders the fields the way the RFC 9116 §4 ABNF requires', () => {
		const rendered = lines(FULL);
		const contact = rendered.findIndex((line) => line.startsWith('Contact: '));
		const expires = rendered.findIndex((line) => line.startsWith('Expires: '));
		const languages = rendered.findIndex((line) => line.startsWith('Preferred-Languages: '));
		// `unsigned = *line (contact-field eol) *line (expires-field eol)
		//          *line [lang-field eol] *line`
		expect(contact).toBeGreaterThanOrEqual(0);
		expect(contact).toBeLessThan(expires);
		expect(expires).toBeLessThan(languages);
	});

	it('repeats Contact once per value, but emits Preferred-Languages once', () => {
		// §2.5.8: the language field "MUST NOT appear more than once";
		// multiple values are comma-separated on the one line.
		expect(lines(FULL)).toEqual([
			'Contact: mailto:security@example.invalid',
			'Contact: https://example.invalid/security/advisories/new',
			'Encryption: https://example.invalid/pgp-key.txt',
			'Acknowledgments: https://example.invalid/security/acknowledgments',
			`Canonical: ${SECURITY_TXT_CANONICAL_URL}`,
			'Policy: https://example.invalid/security-policy',
			'Hiring: https://example.invalid/careers',
			'CSAF: https://example.invalid/security/data/csaf.json',
			`Expires: ${EXPIRES}`,
			'Preferred-Languages: ja, en',
		]);
		const fieldNames = lines(FULL).map((line) => line.split(':')[0]);
		expect(fieldNames.filter((name) => name === 'Preferred-Languages')).toHaveLength(1);
	});

	it('emits only the fields the RFC 9116 §4 grammar knows', () => {
		const fields = new Set(lines(FULL).map((line) => line.split(':')[0]));
		for (const field of fields) {
			expect(SECURITY_TXT_ALLOWED_FIELDS).toContain(
				field as (typeof SECURITY_TXT_ALLOWED_FIELDS)[number],
			);
		}
		// The RFC DOES have a comment production (§2.1, and `comment` in
		// the §4 ABNF); emitting none is this renderer's choice, so the
		// assertion below pins the choice rather than a requirement.
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

	it('declares the path, media type and canonical URL RFC 9116 §3 requires', () => {
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

	it('is not live at or after the deadline (RFC 9116 §2.5.5)', () => {
		expect(isSecurityTxtLive(FULL, now)).toBe(false);
		expect(isSecurityTxtLive(FULL, now + 1)).toBe(false);
	});

	it('treats an unreadable deadline as expired rather than valid forever', () => {
		expect(isSecurityTxtLive({ contacts: [], expires: 'not a date' }, now)).toBe(false);
	});
});
