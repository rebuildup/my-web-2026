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
 * RFC 9116 §2 requires the document to carry a reporting channel the
 * operator actually stands behind. This repository has no such channel
 * yet: `src/contact/channels.json` publishes GitHub identities and
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
 * which is exactly what RFC 9116 §3.2 prescribes for a site that does
 * not publish the file. Nothing about the pipeline is stubbed to make
 * that work — the renderer, the grammar, the expiry gate and the HTTP
 * contract are complete and tested; what is missing is an owner's
 * answer, and a fabricated mailbox must never stand in for one
 * (Issue #468: 公開しないメールを推測で追加しない).
 *
 * Fail-closed by construction
 * ---------------------------
 * Every reason a document is NOT served is enumerated in
 * {@link PublicationDecision} rather than collapsed into a boolean, so
 * `policy.test.ts` can assert each one:
 *
 *   - `not-approved`  the manifest is still `pending` / `rejected`
 *   - `no-channel`    approved, but it names no way to report anything
 *   - `expired`       approved, but `Expires` is in the past (RFC §2.5.1)
 *
 * A malformed manifest is a THIRD case that does not reach this
 * function: {@link parseSecurityTxtManifest} throws, and `./policy.ts`
 * calls it at module-evaluation time, so a bad `policy.json` fails the
 * Worker boot (the same fail-closed-at-boot decision
 * `src/contact/public.ts` makes for `channels.json`) instead of
 * quietly serving an empty policy.
 */

/**
 * Field values are restricted to printable, line-safe text.
 *
 * RFC 9116 §7 restricts the file to a small ASCII subset, and the
 * reason that matters mechanically is INJECTION: the grammar has no
 * comment and no escaping, so a value containing `\n` would end its
 * line and start a new field. A manifest is repo-controlled data today,
 * but "controlled by a file" is not a security boundary — the check
 * lives in the schema so a future editor, script or API writer cannot
 * publish a second `Expires:` by accident.
 */
/**
 * C0 / DEL controls, plus the two Unicode line separators.
 *
 * U+2028 / U+2029 are included because several parsers treat them as
 * line terminators even though the ABNF does not: a value carrying one
 * would end its line in the reader's implementation while looking like
 * a single line here.
 *
 * Written as a code-point scan rather than a regex literal on purpose:
 * Biome's `noControlCharactersInRegex` rule is right that such a
 * literal is unreadable in source, and the intent is clearer spelled
 * out.
 */
function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
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
 * RFC 9116 §2.1. `mailto:` for a monitored mailbox, `https:` for a
 * private-advisory form. `tel:` and other schemes are refused: a phone
 * number in a public file is a personal datum, and a URL is the only
 * alternative this platform can actually stand behind.
 */
const ContactUriSchema = uriWithSchemes('Contact', ['mailto:', 'https:']);

/**
 * RFC 9116 §2.6. An OpenPGP key identified by URI; `https:` and `dns:`
 * are what a published key file is actually served as, and
 * `openpgp4fpr:` is the fingerprint form RFC 9580 defines.
 */
const EncryptionUriSchema = uriWithSchemes('Encryption', ['https:', 'dns:', 'openpgp4fpr:']);

/** Every remaining reference field is a public HTTPS document. */
const HttpsUriSchema = uriWithSchemes('Policy', ['https:']);

/** RFC 9116 §2.4 — BCP 47 language tags, most-preferred first. */
const LanguageTagSchema = fieldValue('Preferred-Languages').refine(
	(value) => /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(value),
	{ message: 'Preferred-Languages must be a BCP 47 language tag' },
);

/**
 * RFC 9116 §2.5 — an RFC 3339 date-time. Zod's `datetime` is the
 * grammar check; the SEMANTIC check (still in the future, at most a
 * year out) belongs to {@link resolvePublication}, because "is it
 * still valid" is a question about time, not about shape.
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
		/** RFC 9116 §2.1. May be empty while the manifest is `pending`. */
		contacts: z.array(ContactUriSchema),
		/** RFC 9116 §2.5. */
		expires: ExpiresSchema,
		/** RFC 9116 §2.6. */
		encryption: z.array(EncryptionUriSchema).optional(),
		/** RFC 9116 §2.7. */
		acknowledgments: z.array(HttpsUriSchema).optional(),
		/** RFC 9116 §2.4. */
		preferred_languages: z.array(LanguageTagSchema).nonempty().optional(),
		/** RFC 9116 §2.2. */
		policy: HttpsUriSchema.optional(),
		/** RFC 9116 §2.8. */
		hiring: HttpsUriSchema.optional(),
		/** RFC 9116 §2.9. */
		csaf: HttpsUriSchema.optional(),
		approval: ApprovalSchema,
	})
	.superRefine((manifest, ctx) => {
		/**
		 * RFC 9116 §2 requires AT LEAST ONE of `Contact` /
		 * `Encryption` / `Acknowledgments` / `Policy`. Checked only
		 * when the manifest is approved: a pending manifest is a
		 * work-in-progress data file and may legitimately be empty,
		 * while an APPROVED one that names no channel would publish a
		 * document no researcher could use.
		 */
		if (manifest.approval.status !== 'approved') return;
		const hasChannel =
			manifest.contacts.length > 0 ||
			(manifest.encryption?.length ?? 0) > 0 ||
			(manifest.acknowledgments?.length ?? 0) > 0 ||
			manifest.policy !== undefined;
		if (!hasChannel) {
			ctx.addIssue({
				code: 'custom',
				path: ['contacts'],
				message:
					'an approved security.txt must name at least one of Contact / Encryption / Acknowledgments / Policy (RFC 9116 §2)',
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
	| { readonly state: 'unpublished'; readonly reason: 'not-approved' | 'no-channel' | 'expired' };

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

	const hasChannel =
		manifest.contacts.length > 0 ||
		(manifest.encryption?.length ?? 0) > 0 ||
		(manifest.acknowledgments?.length ?? 0) > 0 ||
		manifest.policy !== undefined;
	if (!hasChannel) {
		return { state: 'unpublished', reason: 'no-channel' };
	}

	const document: SecurityTxtDocument = {
		contacts: manifest.contacts,
		// Normalised to UTC so the served `Expires:` is byte-identical
		// regardless of the offset the manifest was authored in.
		expires: new Date(manifest.expires).toISOString(),
		// `Canonical` is derived, never authored: the path is fixed by
		// RFC 9116 §3.1 and the origin by ADR-0014.
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
