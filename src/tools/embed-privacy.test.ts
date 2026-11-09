import { describe, expect, it } from 'vitest';
import { evaluateEmbedPrivacy, normalizeThirdPartyOrigin, toPrivacySubject } from './embed-privacy';
import type { EmbedPrivacySubject, ToolPrivacyDeliveryLike } from './embed-privacy';
import { listAllTools } from './registry';

/**
 * Third-party contact contract (Issue #498; the click_to_load gate was
 * removed by owner decision, PR #914).
 *
 * Three groups of assertions:
 *
 *   1. The LIVE manifest satisfies the contract: every embeddable Tool
 *      declares its contacts explicitly. `pnpm run tools:check` gates
 *      the same function at build time; this test proves it without
 *      shelling out to git.
 *   2. Hostile fixtures prove each rule REJECTS — a missing
 *      declaration, a wildcard or path-bearing "origin", a duplicate,
 *      an external frame that does not name itself, and a contact
 *      list with no purpose. Every fixture is a local object literal:
 *      no Tool repo, no network, no third-party service is contacted.
 *   3. The verdict is a FACT list. Unknown manifest fields cannot
 *      change it, and the contacts are exactly the normalised
 *      declaration.
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

	it('collects the declared contacts for a same-origin Tool that declares them', () => {
		const prototype = tool('prototype');
		const verdict = evaluateEmbedPrivacy(toPrivacySubject('prototype', prototype.delivery));
		expect(verdict.contacts).toEqual([
			'https://fonts.googleapis.com',
			'https://fonts.gstatic.com',
			'https://script.google.com',
			'https://use.typekit.net',
		]);
		// The artifact is served from the host origin, so the frame
		// document itself is first-party; only its subresources are not.
		expect(verdict.frame_is_third_party).toBe(false);
	});

	it('returns no contacts and no violations for a same-origin Tool that declares none', () => {
		const readmark = tool('readmark');
		const verdict = evaluateEmbedPrivacy(toPrivacySubject('readmark', readmark.delivery));
		expect(verdict.contacts).toEqual([]);
		expect(verdict.violations).toEqual([]);
	});
});

describe('embed privacy — hostile fixtures are refused', () => {
	it('an embeddable Tool with no declaration is a violation', () => {
		expect(codes(okDelivery({ privacy: undefined }))).toContain('privacy.declaration-missing');
	});

	// Omission is not a default. Before this guard, `privacy: {}` looked
	// like a written "no third-party contact" declaration, so a manifest
	// could silently ship an undeclared contact list.
	it('a declaration without an origin list is refused', () => {
		for (const privacy of [
			{},
			{ third_party_origins: null },
			{ third_party_origins: 'https://a.example.invalid' },
		]) {
			const verdict = evaluate(okDelivery({ privacy }));
			expect(verdict.violations.map((violation) => violation.code)).toContain(
				'privacy.origins.missing',
			);
		}
	});

	it('an explicit empty list is still the one way to declare no contact', () => {
		const verdict = evaluate(okDelivery({ privacy: { third_party_origins: [] } }));
		expect(verdict.violations).toEqual([]);
		expect(verdict.contacts).toEqual([]);
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
		expect(verdict.contacts).toEqual(['https://a.example.invalid']);
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

	it('an external frame is third-party even with a declared contact list', () => {
		// The frame document request IS a contact with the serving origin,
		// which is why the frame's own origin must be declared.
		const verdict = evaluate(
			externalDelivery({
				privacy: {
					third_party_origins: ['https://embed.example.invalid'],
					purpose: { ja: 'テスト用。', en: 'Fixture purpose.' },
				},
			}),
		);
		expect(verdict.frame_is_third_party).toBe(true);
	});

	it('a host_disabled Tool is not policed — nobody frames it', () => {
		const verdict = evaluate({
			kind: 'host_disabled',
			privacy: undefined,
		});
		expect(verdict.violations).toEqual([]);
		expect(verdict.contacts).toEqual([]);
	});

	it('no unknown manifest field can change the verdict', () => {
		// The declaration is a FACT list. There is no `consent_mode`
		// field to read — the property this test pins: adding one to
		// the schema would have to change this test.
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
		// An unknown field cannot change the derived contacts either.
		expect(verdict.contacts).toEqual(['https://a.example.invalid']);
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

	it('flattens a delivery block the way the route and the manifest check both read it', () => {
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

	it('resolves the frame src exactly the way the embed policy resolves it', () => {
		// A `same_origin_static` entry that declares no entry HTML is
		// mounted from `artifact_path`/index.html. The privacy subject
		// has to name the SAME document the policy resolved — otherwise
		// the two contracts disagree about what is framed.
		expect(
			toPrivacySubject('c', {
				kind: 'same_origin_static',
				artifact_path: '/tools/fixture/app',
				privacy: { third_party_origins: [] },
			}),
		).toMatchObject({
			frame_src: '/tools/fixture/app/index.html',
			frame_origin: 'same-origin',
		});
	});

	it('leaves an unresolvable frame src to the embed policy, not to its own verdict', () => {
		// `unresolved` is not read as third-party here — the frame-src
		// rules in embed-policy.ts refuse such a src outright
		// (`embed.frame-src.invalid-scheme`), so nothing unresolved is
		// ever mounted. This test pins that the privacy verdict adds no
		// violation of its own for the same src (the refusal is
		// embed-policy's, asserted in embed-policy's suite).
		const verdict = evaluateEmbedPrivacy(
			subject({ frame_src: 'javascript:alert(1)', frame_origin: 'unresolved' }),
		);
		expect(verdict.violations).toEqual([]);
		expect(verdict.frame_is_third_party).toBe(false);
	});
});
