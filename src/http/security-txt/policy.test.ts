import { describe, expect, it } from 'vitest';
import { SECURITY_TXT_CANONICAL_URL } from './document';
import { SECURITY_TXT_MANIFEST, loadSecurityTxtPolicy, resolveSecurityTxt } from './policy';
import { parseSecurityTxtManifest, resolvePublication } from './schema';

/**
 * The publication gate: what may be served, and what may not
 * (Issue #468).
 *
 * What is proven here
 * -------------------
 *   1. the SHIPPED manifest (`policy.json`) is valid — a malformed one
 *      must throw at module evaluation, not degrade to an empty
 *      policy, and this suite imports the module that does the parse,
 *   2. it is not published today, and the reason is `not-approved`
 *      rather than something that would hide a broken file,
 *   3. an approved manifest with a live deadline publishes, and
 *      normalises `Expires` to UTC,
 *   4. every rejection path the schema owns fails closed: no channel,
 *      an unattributed approval, a newline that would inject a second
 *      field, a scheme a client would follow.
 *
 * A `SecurityTxtDocument` assembled here is a FIXTURE. Nothing in this
 * file — and nothing in `policy.json` — is an operator-approved
 * reporting channel; the addresses are RFC 2606 reserved names
 * (`example.invalid`) precisely so no one can mistake a test row for a
 * published mailbox.
 */

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const NOW = Date.parse('2026-10-19T00:00:00.000Z');

/** An approvable manifest, overridable per test. */
function approvedManifest(overrides: Record<string, unknown> = {}) {
	return parseSecurityTxtManifest({
		approval: {
			status: 'approved',
			approved_at: '2026-10-19T00:00:00.000Z',
			approved_by: 'repository owner',
			note: null,
		},
		contacts: ['mailto:security@example.invalid'],
		expires: FUTURE,
		...overrides,
	});
}

describe('the shipped manifest (src/http/security-txt/policy.json)', () => {
	it('parses at module evaluation, so a malformed file fails the Worker boot', () => {
		expect(SECURITY_TXT_MANIFEST.approval.status).toBeDefined();
		expect(SECURITY_TXT_MANIFEST.expires).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('is not published, and says why', () => {
		expect(resolveSecurityTxt(NOW)).toEqual({ state: 'unpublished', reason: 'not-approved' });
		expect(loadSecurityTxtPolicy(NOW)).toBeNull();
	});

	it('still expires inside RFC 9116 §2.5.1 guidance of a year (sanity, not a gate)', () => {
		// The deadline is authored data, so this cannot drift silently
		// past the RFC's "SHOULD be within a year" advice for long: it
		// is re-read here rather than trusted.
		const expires = Date.parse(SECURITY_TXT_MANIFEST.expires);
		expect(Number.isFinite(expires)).toBe(true);
		expect(expires).toBeGreaterThan(NOW);
	});
});

describe('resolvePublication', () => {
	it('publishes an approved, unexpired manifest with a contact', () => {
		const decision = resolvePublication(approvedManifest(), NOW);
		expect(decision.state).toBe('published');
		if (decision.state !== 'published') return;
		expect(decision.document.contacts).toEqual(['mailto:security@example.invalid']);
	});

	it('derives Canonical from the RFC path and the production origin, never from the manifest', () => {
		const decision = resolvePublication(
			approvedManifest({ canonical: 'https://evil.example' }),
			NOW,
		);
		expect(decision.state).toBe('published');
		if (decision.state !== 'published') return;
		expect(decision.document.canonical).toBe(SECURITY_TXT_CANONICAL_URL);
	});

	it('normalises Expires to UTC so two readers compute the same deadline', () => {
		const decision = resolvePublication(
			approvedManifest({ expires: '2099-01-01T09:00:00+09:00' }),
			NOW,
		);
		expect(decision.state).toBe('published');
		if (decision.state !== 'published') return;
		expect(decision.document.expires).toBe('2099-01-01T00:00:00.000Z');
	});

	it('refuses an expired policy instead of advertising a possibly dead channel', () => {
		expect(resolvePublication(approvedManifest({ expires: PAST }), NOW)).toEqual({
			state: 'unpublished',
			reason: 'expired',
		});
	});

	it('publishes an approved manifest whose only channel is Policy (RFC 9116 §2)', () => {
		const decision = resolvePublication(
			approvedManifest({ contacts: [], policy: 'https://example.invalid/policy' }),
			NOW,
		);
		expect(decision.state).toBe('published');
	});

	it('refuses a rejected manifest the same way it refuses a pending one', () => {
		const rejected = approvedManifest({
			approval: { status: 'rejected', approved_at: null, approved_by: null, note: null },
		});
		expect(resolvePublication(rejected, NOW)).toEqual({
			state: 'unpublished',
			reason: 'not-approved',
		});
	});
});

describe('the schema refuses a manifest that must not be published', () => {
	it('rejects an approved manifest that names no way to report anything', () => {
		expect(() => approvedManifest({ contacts: [], policy: undefined })).toThrow();
	});

	it('rejects an approval nobody can attribute', () => {
		expect(() =>
			approvedManifest({
				approval: {
					status: 'approved',
					approved_at: '2026-10-19T00:00:00.000Z',
					approved_by: null,
				},
			}),
		).toThrow();
		expect(() =>
			approvedManifest({
				approval: { status: 'approved', approved_at: null, approved_by: 'owner' },
			}),
		).toThrow();
	});

	it('rejects a newline, which would inject a second field into the document', () => {
		expect(() =>
			approvedManifest({ contacts: ['mailto:a@example.invalid\nExpires: 2099-01-01'] }),
		).toThrow();
	});

	it('rejects a scheme a reader client would follow', () => {
		expect(() => approvedManifest({ contacts: ['javascript:alert(1)'] })).toThrow();
		expect(() => approvedManifest({ contacts: ['file:///etc/passwd'] })).toThrow();
	});

	it('rejects a plaintext Policy URL', () => {
		expect(() => approvedManifest({ policy: 'http://example.invalid/policy' })).toThrow();
	});

	it('rejects an unreadable deadline or language tag', () => {
		expect(() => approvedManifest({ expires: 'soon' })).toThrow();
		expect(() => approvedManifest({ preferred_languages: ['not a tag'] })).toThrow();
		expect(() => approvedManifest({ preferred_languages: [] })).toThrow();
	});

	it('accepts the pending manifest even with no contacts yet', () => {
		const pending = parseSecurityTxtManifest({
			approval: { status: 'pending', approved_at: null, approved_by: null, note: null },
			contacts: [],
			expires: FUTURE,
		});
		expect(resolvePublication(pending, NOW).state).toBe('unpublished');
	});
});
