import { z } from 'zod';
import {
	SECURITY_TXT_CANONICAL_URL,
	type SecurityTxtDocument,
	isSecurityTxtLive,
} from './document';

/**
 * Owner-controlled `security.txt` policy, and the publication decision
 * it implies (Issue #468).
 *
 * What this module owns
 * ---------------------
 * RFC 9116 §2.5.3 requires the document to carry a reporting channel
 * the operator actually stands behind (`Contact` "MUST always be
 * present"). This repository has no such channel yet:
 * `src/contact/channels.json` publishes GitHub identities and
 * public domains and deliberately contains **no address**, and
 * `docs/security.md` still routes urgent reports through an operator
 * channel that is not written down anywhere public. So the document is
 * assembled here from an explicit, repo-controlled manifest and
 * published only when that manifest says a human approved it.
 *
 * The gate
 * ---------
 * `approval.status` is the whole decision, and it is `pending` today.
 * A `pending` manifest renders nothing: `./router.ts` answers `404`,
 * which is what a site that does not publish the file answers at all
 * (RFC 9116 §3 requires the file at `/.well-known/` for a site that
 * publishes one; it prescribes no status for a site that does not).
 * Nothing about the pipeline is stubbed to make that work — the
 * renderer, the grammar, the expiry gate and the HTTP contract are
 * complete and tested; what is missing is an owner's answer, and a
 * fabricated mailbox must never stand in for one
 * (Issue #468: 公開しないメールを推測で追加しない).
 *
 * Fail-closed by construction
 * ---------------------------
 * Every reason a document is NOT served is enumerated in
 * {@link PublicationDecision} rather than collapsed into a boolean, so
 * `policy.test.ts` can assert each one:
 *
 *   - `not-approved`  the manifest is still `pending` / `rejected`
 *   - `no-contact`    approved, but it names no way to report anything
 *   - `expired`       approved, but `Expires` is in the past
 *                     (RFC 9116 §2.5.5, §5.3)
 *
 * A malformed manifest is a THIRD case that does not reach this
 * function: {@link parseSecurityTxtManifest} throws, and `./policy.ts`
 * calls it at module-evaluation time, so a bad `policy.json` fails the
 * Worker boot (the same fail-closed-at-boot decision
 * `src/contact/public.ts` makes for `channels.json`) instead of
 * quietly serving an empty policy.
 */

/**
 * C0 / DEL controls, plus the line separators some readers accept.
 *
 * Field values are restricted to printable, line-safe text because a
 * line break ENDS a field — the RFC 9116 §4 grammar has no escaping
 * and no folding — and the reason that matters mechanically is
 * INJECTION: a value containing `\n` would end its line and start a new
 * field. A manifest is repo-controlled data today, but "controlled by a
 * file" is not a security boundary — the check lives in the schema so a
 * future editor, script or API writer cannot publish a second
 * `Expires:` by accident.
 *
 * U+2028 / U+2029 and U+0085 (C1 NEL) are included because several
 * readers treat them as line terminators even though the ABNF does not:
 * a value carrying one would end its line in the reader's
 * implementation while looking like a single line here.
 *
 * Written as a code-point scan rather than a regex literal on purpose:
 * Biome's `noControlCharactersInRegex` rule is right that such a
 * literal is unreadable in source, and the intent is clearer spelled
 * out.
 */
function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return true;
		if (code === 0x85 || code === 0x2028 || code === 0x2029) return true;
	}
	return false;
}

function fieldValue(field: string) {
	return z
		.string()
		.min(1)
		.refine((value) => !hasControlCharacter(value), {
			message: `${field} must not contain a line break or control character`,
		});
}

/**
 * An absolute URI with one of the given schemes.
 *
 * `new URL()` alone is not enough: it accepts `javascript:` and
 * `file:`, which a reader's client may follow. The scheme allow-list
 * is the decision; the parse is only the syntax check.
 */
function uriWithSchemes(field: string, schemes: readonly string[]) {
	return fieldValue(field).refine(
		(value) => {
			try {
				return schemes.includes(new URL(value).protocol);
			} catch {
				return false;
			}
		},
		{ message: `${field} must be an absolute ${schemes.join(' / ')} URI` },
	);
}

/**
 * RFC 9116 §2.5.3. `mailto:` for a monitored mailbox, `https:` for a
 * private-advisory form, and — deliberately — nothing else.
 *
 * The RFC also permits `tel:` and describes a phone number as a valid
 * `Contact`; this repository refuses it because a telephone number in a
 * file that strangers and scanners read and archive is a personal datum
 * with no rotation or revocation. Whether to publish one is an
 * owner-level PUBLIC-CONTRACT decision, not an implementation detail,
 * so it is recorded as an open decision in
 * `docs/security/security-txt.md` rather than decided here.
 */
const ContactUriSchema = uriWithSchemes('Contact', ['mailto:', 'https:']);

/**
 * RFC 9116 §2.5.4. An OpenPGP key identified by URI; `https:` and
 * `dns:` are what a published key file is actually served as, and
 * `openpgp4fpr:` is the fingerprint form RFC 9580 defines.
 */
const EncryptionUriSchema = uriWithSchemes('Encryption', ['https:', 'dns:', 'openpgp4fpr:']);

/** Every remaining web reference field is a public HTTPS document. */
const HttpsUriSchema = uriWithSchemes('Policy', ['https:']);

/**
 * RFC 9116 §2.5.8 — RFC 5646 language tags, all of equal priority.
 *
 * Checked with `Intl.getCanonicalLocales`, i.e. the runtime's own
 * RFC 5646 well-formedness check, rather than a hand-rolled regular
 * expression. A regex of this shape is always either too strict
 * (rejecting private-use subtag sequences) or too lax (accepting a
 * subtag RFC 5646 does not define); the runtime already implements the
 * `langtag` production of RFC 5646 §2.1 correctly and is present in
 * both the Worker and the test pool.
 *
 * Narrowed grammar, deliberately: the runtime accepts the `langtag`
 * production (language + optional script / region / variants /
 * extensions / trailing private-use subtag sequence) and REJECTS the
 * `privateuse` and `grandfathered` productions of RFC 5646 §2.1
 * (`x-…`, `i-klingon`, `zh-min-nan`, …). RFC 9116 §2.5.8 asks for
 * "language tags", i.e. languages a report could be submitted in, and a
 * bare private-use or grandfathered tag is not one; stating the
 * narrower grammar is better than a permissive regex pretending to be
 * RFC 5646. `policy.test.ts` pins both directions.
 */
const LanguageTagSchema = fieldValue('Preferred-Languages').refine(
	(value) => {
		try {
			return Intl.getCanonicalLocales(value).length === 1;
		} catch {
			return false;
		}
	},
	{ message: 'Preferred-Languages must be a BCP 47 language tag' },
);

/**
 * RFC 9116 §2.5.5 — an RFC 3339 date-time. Zod's `datetime` is the
 * grammar check; the SEMANTIC check (still in the future) belongs to
 * {@link resolvePublication}, because "is it still valid" is a question
 * about time, not about shape.
 *
 * "Less than a year into the future" is the RFC's RECOMMENDED (§2.5.5)
 * practice, not a MUST, so it is not a runtime gate: a deadline three
 * years out is not invalid, and refusing to publish would be a rule
 * this repository invented. It is asserted as a review-time property of
 * the shipped manifest in `policy.test.ts` instead, so the authored
 * data cannot drift silently past the guidance.
 */
const ExpiresSchema = z.string().datetime({ offset: true });

/**
 * The approval record.
 *
 * `approved_at` / `approved_by` are REQUIRED once `status` is
 * `approved`: an approval nobody can attribute is indistinguishable
 * from a manifest someone edited in a hurry, which is the failure the
 * gate exists to stop.
 */
const ApprovalSchema = z
	.object({
		status: z.enum(['pending', 'approved', 'rejected']),
		approved_at: z.string().datetime({ offset: true }).nullable(),
		approved_by: z.string().min(1).nullable(),
		/**
		 * Free-text note the owner (or the implementing agent) records
		 * with the decision: what the contact IS, why it was chosen,
		 * when it must be re-verified. Never rendered into the served
		 * document — the manifest is repo data, the document is a
		 * published artefact, and an internal note must not leak into
		 * one.
		 */
		note: z.string().min(1).nullable(),
	})
	.superRefine((approval, ctx) => {
		if (approval.status !== 'approved') return;
		if (approval.approved_at === null) {
			ctx.addIssue({
				code: 'custom',
				path: ['approved_at'],
				message: 'an approved manifest must record when it was approved',
			});
		}
		if (approval.approved_by === null) {
			ctx.addIssue({
				code: 'custom',
				path: ['approved_by'],
				message: 'an approved manifest must record who approved it',
			});
		}
	});

/** The repo-controlled manifest (`policy.json`). */
export const SecurityTxtManifestSchema = z
	.object({
		/** RFC 9116 §2.5.3. May be empty while the manifest is `pending`. */
		contacts: z.array(ContactUriSchema),
		/** RFC 9116 §2.5.5. */
		expires: ExpiresSchema,
		/** RFC 9116 §2.5.4. */
		encryption: z.array(EncryptionUriSchema).optional(),
		/** RFC 9116 §2.5.1. */
		acknowledgments: z.array(HttpsUriSchema).optional(),
		/** RFC 9116 §2.5.8. */
		preferred_languages: z.array(LanguageTagSchema).nonempty().optional(),
		/** RFC 9116 §2.5.7. */
		policy: HttpsUriSchema.optional(),
		/** RFC 9116 §2.5.6. */
		hiring: HttpsUriSchema.optional(),
		/** An `ext-field` (§2.4, §6.2 registry): optional, ignorable. */
		csaf: HttpsUriSchema.optional(),
		approval: ApprovalSchema,
	})
	.superRefine((manifest, ctx) => {
		/**
		 * RFC 9116 §2.5.3: the `Contact` field "MUST always be present
		 * in a security.txt file", and the §4 ABNF makes it the
		 * `*line (contact-field eol)` prefix of an unsigned file — so
		 * one or more contact lines, before the deadline. The earlier
		 * reading ("any one of Contact / Encryption / Acknowledgments /
		 * Policy", §2's generic rule) is not enough here: a manifest
		 * carrying only a `Policy` URL publishes a disclosure-policy
		 * link with no address a researcher could report to, which is
		 * precisely what Issue #468 refuses to do
		 * (連絡可能な脆弱性報告窓口).
		 *
		 * Checked only when the manifest is approved: a pending
		 * manifest is a work-in-progress data file and may
		 * legitimately be empty.
		 */
		if (manifest.approval.status !== 'approved') return;
		if (manifest.contacts.length === 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['contacts'],
				message:
					'an approved security.txt must name at least one Contact (RFC 9116 §2.5.3): a Policy or Acknowledgments URL is not a reporting channel',
			});
		}
	});

export type SecurityTxtManifest = z.infer<typeof SecurityTxtManifestSchema>;

/**
 * Why the document is not (or is) published.
 *
 * `state: 'published'` carries the rendered document; every other
 * state names the gate that closed. The router logs nothing and
 * returns the same `404` for all three — the distinction exists so a
 * test (and a maintainer reading one) can tell "the owner has not
 * answered yet" from "the answer has expired".
 */
export type PublicationDecision =
	| { readonly state: 'published'; readonly document: SecurityTxtDocument }
	| { readonly state: 'unpublished'; readonly reason: 'not-approved' | 'no-contact' | 'expired' };

/** Parse and validate a raw manifest, throwing on a malformed one. */
export function parseSecurityTxtManifest(input: unknown): SecurityTxtManifest {
	return SecurityTxtManifestSchema.parse(input);
}

/**
 * Apply the publication gate.
 *
 * Pure: `now` is a parameter rather than a `Date.now()` call so the
 * expiry boundary is testable to the millisecond, and so the router
 * and this function can never disagree about what time it is.
 */
export function resolvePublication(
	manifest: SecurityTxtManifest,
	now: number,
): PublicationDecision {
	if (manifest.approval.status !== 'approved') {
		return { state: 'unpublished', reason: 'not-approved' };
	}

	const hasContact = manifest.contacts.length > 0;
	if (!hasContact) {
		return { state: 'unpublished', reason: 'no-contact' };
	}

	const document: SecurityTxtDocument = {
		contacts: manifest.contacts,
		// Normalised to UTC so the served `Expires:` is byte-identical
		// regardless of the offset the manifest was authored in.
		expires: new Date(manifest.expires).toISOString(),
		// `Canonical` is derived, never authored: the path is fixed by
		// RFC 9116 §3 and the origin by ADR-0014.
		canonical: SECURITY_TXT_CANONICAL_URL,
		...(manifest.encryption ? { encryption: manifest.encryption } : {}),
		...(manifest.acknowledgments ? { acknowledgments: manifest.acknowledgments } : {}),
		...(manifest.preferred_languages ? { preferredLanguages: manifest.preferred_languages } : {}),
		...(manifest.policy ? { policy: manifest.policy } : {}),
		...(manifest.hiring ? { hiring: manifest.hiring } : {}),
		...(manifest.csaf ? { csaf: manifest.csaf } : {}),
	};

	// Checked last so an expired document is reported as EXPIRED even
	// when it is well-formed: that is the state an operator has to act
	// on, and collapsing it into "not-approved" would hide it.
	if (!isSecurityTxtLive(document, now)) {
		return { state: 'unpublished', reason: 'expired' };
	}

	return { state: 'published', document };
}
