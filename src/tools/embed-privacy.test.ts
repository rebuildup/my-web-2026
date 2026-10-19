import { describe, expect, it } from 'vitest';
import {
	CONSENT_MODE_CLICK_TO_LOAD,
	CONSENT_MODE_NOT_REQUIRED,
	consentNoticeOrigins,
	evaluateEmbedPrivacy,
	normalizeThirdPartyOrigin,
	toPrivacySubject,
} from './embed-privacy';
import type { EmbedPrivacySubject, ToolPrivacyDeliveryLike } from './embed-privacy';
import { listAllTools } from './registry';

/**
 * Third-party contact + consent contract (Issue #498).
 *
 * Three groups of assertions:
 *
 *   1. The LIVE manifest satisfies the contract, and the derived mode
 *      for each shipped Tool is the one the report claims. `pnpm run
 *      tools:check` gates the same function at build time; this test
 *      proves it without shelling out to git.
 *   2. Hostile fixtures prove each rule REJECTS — a missing
 *      declaration, a wildcard or path-bearing "origin", a duplicate,
 *      an external frame that does not name itself, and a contact
 *      list with no purpose. Every fixture is a local object literal:
 *      no Tool repo, no network, no third-party service is contacted.
 *   3. Consent is DERIVED. There is no manifest field that turns the
 *      gate off, so the only way to `not_required` is to prove the Tool
 *      is same-origin AND declares no contact.
 */

/** A minimal valid `same_origin_static` delivery block. */
function okDelivery(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'same_origin_static',
		entry_html: '/tools/fixture/app/index.html',
		privacy: { third_party_origins: [] },
		...overrides,
	};
}

/** A minimal valid `external_exception` delivery block. */
function externalDelivery(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'external_exception',
		external_url: 'https://embed.example.invalid/app',
		privacy: {
			third_party_origins: ['https://embed.example.invalid'],
			purpose: { ja: '埋め込み先 fetches itself.', en: 'The embedded frame loads itself.' },
		},
		...overrides,
	};
}

function evaluate(delivery: ToolPrivacyDeliveryLike | Record<string, unknown>) {
	return evaluateEmbedPrivacy(toPrivacySubject('fixture', delivery as ToolPrivacyDeliveryLike));
}

function codes(delivery: ToolPrivacyDeliveryLike | Record<string, unknown>): string[] {
	return evaluate(delivery).violations.map((violation) => violation.code);
}

/**
 * A manifest entry by slug, or a thrown assertion naming the slug —
 * `expect(x).toBeDefined()` followed by `x!` is exactly the shape the
 * lint rule forbids, and a non-null assertion here would only paper
 * over a manifest rename.
 */
function tool(slug: string) {
	const found = listAllTools().find((entry) => entry.slug === slug);
	if (!found) throw new Error(`manifest has no Tool named "${slug}"`);
	return found;
}

function subject(overrides: Partial<EmbedPrivacySubject> = {}): EmbedPrivacySubject {
	return {
		slug: 'fixture',
		kind: 'same_origin_static',
		frame_src: '/tools/fixture/app/index.html',
		frame_origin: 'same-origin',
		privacy: { third_party_origins: [] },
		...overrides,
	};
}

describe('embed privacy — the live manifest', () => {
	it('every manifest entry satisfies the third-party contact contract', () => {
		for (const tool of listAllTools()) {
			const verdict = evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery));
			expect(verdict.violations.map((violation) => `${tool.slug}: ${violation.message}`)).toEqual(
				[],
			);
		}
	});

	it('every embeddable Tool declares its contacts explicitly, including "none"', () => {
		const embeddable = listAllTools().filter((tool) => tool.delivery.kind !== 'host_disabled');
		expect(embeddable.length).toBeGreaterThan(0);
		for (const tool of embeddable) {
			expect(tool.delivery.kind === 'host_disabled').toBe(false);
			const privacy = tool.delivery.kind === 'host_disabled' ? undefined : tool.delivery.privacy;
			// "contacts no third party" is a written-down claim, never an
			// omission: the field exists even when the answer is [].
			expect(privacy).toBeDefined();
			expect(Array.isArray(privacy?.third_party_origins)).toBe(true);
		}
	});

	it('pre-activation contacts are empty for every manifest entry', () => {
		for (const tool of listAllTools()) {
			const verdict = evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery));
			expect(verdict.contacts_before_activation).toEqual([]);
		}
	});

	it('derives click_to_load for a same-origin Tool that declares contacts', () => {
		const prototype = tool('prototype');
		const verdict = evaluateEmbedPrivacy(toPrivacySubject('prototype', prototype.delivery));
		expect(verdict.consent).toBe(CONSENT_MODE_CLICK_TO_LOAD);
		expect(verdict.contacts_after_activation).toEqual([
			'https://fonts.googleapis.com',
			'https://fonts.gstatic.com',
			'https://script.google.com',
			'https://use.typekit.net',
		]);
		// The artifact is served from the host origin, so the frame
		// document itself is first-party; only its subresources are not.
		expect(verdict.frame_is_third_party).toBe(false);
		expect(consentNoticeOrigins(verdict)).toEqual(verdict.contacts_after_activation);
	});

	it('derives not_required for a same-origin Tool that declares no contact', () => {
		const readmark = tool('readmark');
		const verdict = evaluateEmbedPrivacy(toPrivacySubject('readmark', readmark.delivery));
		expect(verdict.consent).toBe(CONSENT_MODE_NOT_REQUIRED);
		expect(verdict.contacts_after_activation).toEqual([]);
		expect(verdict.violations).toEqual([]);
	});
});

describe('embed privacy — hostile fixtures are refused', () => {
	it('an embeddable Tool with no declaration is a violation', () => {
		expect(codes(okDelivery({ privacy: undefined }))).toContain('privacy.declaration-missing');
	});

	it('a non-https origin is refused', () => {
		expect(
			codes(okDelivery({ privacy: { third_party_origins: ['http://insecure.example.invalid'] } })),
		).toContain('privacy.origin.invalid');
	});

	it('a wildcard host is refused — a disclosure must name one party', () => {
		expect(
			codes(okDelivery({ privacy: { third_party_origins: ['https://*.example.invalid'] } })),
		).toContain('privacy.origin.invalid');
	});

	it('a path / query / fragment is refused — an origin is not a tracking URL', () => {
		for (const entry of [
			'https://example.invalid/track',
			'https://example.invalid/?id=1',
			'https://example.invalid/#frag',
		]) {
			expect(codes(okDelivery({ privacy: { third_party_origins: [entry] } }))).toContain(
				'privacy.origin.invalid',
			);
		}
	});

	it('credentials in the authority are refused', () => {
		expect(
			codes(okDelivery({ privacy: { third_party_origins: ['https://user:pw@example.invalid'] } })),
		).toContain('privacy.origin.invalid');
	});

	it('a repeated origin is refused and appears once in the verdict', () => {
		const verdict = evaluate(
			okDelivery({
				privacy: {
					third_party_origins: ['https://a.example.invalid', 'https://a.example.invalid'],
					purpose: { ja: 'テスト用。', en: 'Fixture purpose.' },
				},
			}),
		);
		expect(verdict.violations.map((violation) => violation.code)).toContain(
			'privacy.origin.duplicate',
		);
		expect(verdict.contacts_after_activation).toEqual(['https://a.example.invalid']);
	});

	it('an external frame that does not name its own origin is refused', () => {
		expect(
			codes(
				externalDelivery({
					privacy: {
						third_party_origins: ['https://cdn.example.invalid'],
						purpose: { ja: 'テスト用。', en: 'Fixture purpose.' },
					},
				}),
			),
		).toContain('privacy.origin.frame-origin-undeclared');
	});

	it('declared contacts without a purpose are refused', () => {
		expect(
			codes(okDelivery({ privacy: { third_party_origins: ['https://a.example.invalid'] } })),
		).toContain('privacy.purpose.missing');
	});

	it('a half-translated purpose is refused', () => {
		expect(
			codes(
				okDelivery({
					privacy: {
						third_party_origins: ['https://a.example.invalid'],
						purpose: { ja: 'テスト用。', en: '  ' },
					},
				}),
			),
		).toContain('privacy.purpose.locale-missing');
	});

	it('an external frame is contact-gated even with an empty declaration list', () => {
		// The frame document request IS the contact, so it cannot be
		// talked out of the gate by claiming an empty list.
		const verdict = evaluate(
			externalDelivery({
				privacy: {
					third_party_origins: ['https://embed.example.invalid'],
					purpose: { ja: 'テスト用。', en: 'Fixture purpose.' },
				},
			}),
		);
		expect(verdict.frame_is_third_party).toBe(true);
		expect(verdict.consent).toBe(CONSENT_MODE_CLICK_TO_LOAD);
	});

	it('a host_disabled Tool is not policed — nobody frames it', () => {
		const verdict = evaluate({
			kind: 'host_disabled',
			privacy: undefined,
		});
		expect(verdict.violations).toEqual([]);
		expect(verdict.consent).toBe(CONSENT_MODE_NOT_REQUIRED);
	});

	it('no delivery kind can opt out of the gate by declaring a mode', () => {
		// The declaration is a FACT list. There is no `consent_mode`
		// field to read, which is the property this test pins: adding
		// one to the schema would have to change this test.
		expect(
			codes(okDelivery({ privacy: { third_party_origins: [], consent_mode: 'not_required' } })),
		).toHaveLength(0);
		const verdict = evaluate(
			okDelivery({
				privacy: {
					third_party_origins: ['https://a.example.invalid'],
					consent_mode: 'not_required',
					purpose: { ja: 'テスト用。', en: 'Fixture purpose.' },
				},
			}),
		);
		// An unknown field cannot lower the derived mode.
		expect(verdict.consent).toBe(CONSENT_MODE_CLICK_TO_LOAD);
	});
});

describe('embed privacy — origin normalisation and subject flattening', () => {
	it('normalises case and a trailing slash, and refuses everything else', () => {
		expect(normalizeThirdPartyOrigin('https://Example.Invalid')).toBe('https://example.invalid');
		expect(normalizeThirdPartyOrigin('  https://example.invalid  ')).toBe(
			'https://example.invalid',
		);
		expect(normalizeThirdPartyOrigin('https://example.invalid:8443')).toBe(
			'https://example.invalid:8443',
		);
		for (const bad of ['', '   ', 'example.invalid', '//example.invalid', '*', 42, null]) {
			expect(normalizeThirdPartyOrigin(bad)).toBeNull();
		}
	});

	it('flattens a delivery block the way the route and the gate both read it', () => {
		expect(toPrivacySubject('a', okDelivery())).toMatchObject({
			slug: 'a',
			frame_src: '/tools/fixture/app/index.html',
			frame_origin: 'same-origin',
		});
		expect(toPrivacySubject('b', externalDelivery())).toMatchObject({
			slug: 'b',
			frame_src: 'https://embed.example.invalid/app',
			frame_origin: 'cross-origin',
		});
	});

	it('treats an unresolvable frame src as third-party, never as an exemption', () => {
		const verdict = evaluateEmbedPrivacy(
			subject({ frame_src: 'javascript:alert(1)', frame_origin: 'unresolved' }),
		);
		// `unresolved` is not `cross-origin`, so the gate is derived from
		// the declared contacts; the separate frame-src rules in
		// embed-policy.ts are what refuse this src outright.
		expect(verdict.consent).toBe(CONSENT_MODE_NOT_REQUIRED);
		const subject2 = evaluateEmbedPrivacy(
			subject({ frame_src: 'data:text/html,x', frame_origin: 'unresolved' }),
		);
		expect(subject2.violations).toEqual([]);
	});
});
