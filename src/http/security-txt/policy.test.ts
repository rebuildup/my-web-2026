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
 *   4. every rejection path the schema owns fails closed: no
 *      contact, an unattributed approval, a newline that would inject
 *      a second field, a scheme a client would follow.
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

	it('publishes exactly when the shipped manifest says so', () => {
		// Derived, not hard-coded: `policy.json` is bundled into the
		// Worker at build time, so approving a channel is a DATA change
		// that must not require editing this test (or breaking it). The
		// gate's own behaviour is asserted with the fixtures below; this
		// row only states that the shipped manifest and the endpoint can
		// never disagree. The manifest is `pending` today.
		const decision = resolveSecurityTxt(NOW);
		const approved = SECURITY_TXT_MANIFEST.approval.status === 'approved';
		const live = Date.parse(SECURITY_TXT_MANIFEST.expires) > NOW;
		expect(decision.state === 'published').toBe(approved && live);
		expect(loadSecurityTxtPolicy(NOW) !== null).toBe(approved && live);
		if (!approved) {
			expect(decision).toEqual({ state: 'unpublished', reason: 'not-approved' });
		}
	});

	it('keeps the authored deadline inside RFC 9116 §2.5.5 guidance of a year', () => {
		// The deadline is authored data, so this cannot drift silently
		// past the RFC's "less than a year into the future" advice for
		// long: it is re-read here rather than trusted. It is a test,
		// not a runtime gate — §2.5.5 states it as RECOMMENDED.
		const expires = Date.parse(SECURITY_TXT_MANIFEST.expires);
		expect(Number.isFinite(expires)).toBe(true);
		expect(expires).toBeGreaterThan(NOW);
		expect(expires - NOW).toBeLessThanOrEqual(365 * 24 * 60 * 60 * 1000);
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

	it('refuses an approved manifest that names a Policy but no Contact', () => {
		// RFC 9116 §2.5.3: `Contact` MUST always be present. A
		// disclosure-policy URL is not a reporting channel, so such a
		// manifest is refused twice over: the schema refuses to parse
		// it, and the gate refuses it independently of the schema.
		expect(() =>
			approvedManifest({ contacts: [], policy: 'https://example.invalid/policy' }),
		).toThrow();
		expect(resolvePublication({ ...approvedManifest(), contacts: [] }, NOW)).toEqual({
			state: 'unpublished',
			reason: 'no-contact',
		});
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
	it('rejects an approved manifest that names no Contact (RFC 9116 §2.5.3)', () => {
		expect(() => approvedManifest({ contacts: [] })).toThrow();
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
		// Shapes RFC 5646 rejects: an `extlang` after a four-letter
		// language, and a variant subtag longer than eight characters.
		expect(() => approvedManifest({ preferred_languages: ['abcd-abc'] })).toThrow();
		expect(() => approvedManifest({ preferred_languages: ['en-abcdefghi'] })).toThrow();
	});

	it('accepts the RFC 5646 shapes a naive tag regex refuses', () => {
		// Script, region, variant, extension and trailing private-use
		// subtags are all valid and are validated by
		// `Intl.getCanonicalLocales`, not by a regex.
		for (const tag of ['ja', 'en-US', 'zh-Hans-CN', 'de-CH-1901', 'en-x-priv']) {
			expect(() => approvedManifest({ preferred_languages: [tag] })).not.toThrow();
		}
	});

	it('refuses the privateuse / grandfathered productions (narrowed grammar)', () => {
		// RFC 5646 §2.1 defines them; this field deliberately does not
		// accept them (see `schema.ts`), so the refusal is asserted
		// rather than left to whichever way the runtime leans.
		for (const tag of ['x-private', 'i-klingon', 'zh-min-nan']) {
			expect(() => approvedManifest({ preferred_languages: [tag] })).toThrow();
		}
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
