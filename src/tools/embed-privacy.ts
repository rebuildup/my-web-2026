/**
 * Third-party contact + consent contract for embedded Tools (Issue #498).
 *
 * Problem this module solves
 * --------------------------
 * `src/tools/embed-policy.ts` (Issue #465) decides *whether a Tool may be
 * framed* (sandbox tokens, referrer policy, frame origin, message
 * channel). It says nothing about what the framed document does once it
 * is mounted. Measured against the two Tools the registry ships today
 * (`pnpm run verify:embed-privacy-screenshot` re-measures), that gap is
 * not theoretical: the pinned ProtoType artifact loads
 * `https://fonts.googleapis.com` (stylesheet + `preconnect`),
 * `https://fonts.gstatic.com` (font files) and
 * `https://use.typekit.net` (Adobe Typekit loader) from its own
 * `index.html`, i.e. **three third-party origins contacted the moment
 * the host frames it**, before the visitor touched anything. Every
 * visitor to `/tools/prototype` paid for that, including the ones who
 * closed the tab immediately.
 *
 * The contract implemented here
 * -----------------------------
 * 1. **The host declares, it does not guess.** `delivery.privacy` in
 *    `src/tools/manifest.json` names the third-party origins the framed
 *    document may contact, plus a short purpose for each Tool (both
 *    locales). The declaration is REQUIRED for every embeddable Tool and
 *    the gate fails closed when it is missing — "no third-party origin"
 *    has to be written down, not assumed by omission.
 * 2. **Consent is derived, never declared.** There is no
 *    `consent_mode` field an operator could write to opt out. The host
 *    computes `click_to_load` from facts it can check itself: the frame
 *    is cross-origin, or the declaration names at least one origin.
 *    Everything else is `not_required`. The consent gate is therefore a
 *    consequence of the declaration, not a second thing to keep in sync.
 * 3. **A foreign frame must name itself.** An `external_exception`
 *    frame is a document request to a foreign origin by definition, so
 *    its own origin MUST appear in `third_party_origins`. A manifest
 *    cannot embed an external document without publishing which origin
 *    that is.
 * 4. **Pre-activation contacts are empty by construction.** The route
 *    renders a notice and no frame, so the host document names no
 *    third-party origin at all before activation — `pre_activation`
 *    exists as a first-class field of the verdict so a caller can
 *    assert it rather than infer it.
 *
 * Deliberately out of scope (owner decisions, not this module's call):
 *
 *   - **Consent persistence.** There is no cookie and no
 *     `localStorage` record for "the visitor agreed once". A per-visit
 *     gate asks again on every navigation; a consent store is a new
 *     published data surface (and needs its own retention story).
 *   - **Host-document analytics.** Every SSR page — including
 *     `/tools/<slug>` — mounts GA4 (`src/editorial/analytics/`) and
 *     Google Fonts in the site chrome. That is a deliberate host-level
 *     product decision (Issue #171 / #447), not an embed-induced
 *     contact, and changing it belongs to a different Issue.
 *   - **What the artifact does after activation.** The host declares
 *     the contacts it can see in the manifest and refuses to frame a
 *     Tool whose own frame origin is undeclared. It cannot observe a
 *     framed document's network behaviour, and this module does not
 *     pretend otherwise: re-declaring after a submodule bump is the
 *     documented duty (the "Re-measuring after a submodule bump"
 *     section of `docs/tools/embed-privacy.md`).
 *
 * Dependency-free like `embed-policy.ts` (no manifest import, no React,
 * no DOM), so `scripts/check-tools-manifest.mjs` imports it directly
 * under Node type stripping and the route imports the same function.
 * The ONE thing it reads from `embed-policy.ts` is
 * `resolveToolFrameSrc()` — the frame-src resolution, imported rather
 * than re-derived, so the privacy contract and the embed policy can
 * never disagree about which document the host mounts.
 */

import { resolveToolFrameSrc } from './embed-policy.ts';

/* ------------------------------------------------------------------ *
 * 1. consent modes
 * ------------------------------------------------------------------ */

/** The framed document is served from the host origin and declares no third-party contact. */
export const CONSENT_MODE_NOT_REQUIRED = 'not_required' as const;

/** Nothing is loaded until the visitor activates the notice. */
export const CONSENT_MODE_CLICK_TO_LOAD = 'click_to_load' as const;

export type EmbedConsentMode = typeof CONSENT_MODE_NOT_REQUIRED | typeof CONSENT_MODE_CLICK_TO_LOAD;

/** Delivery kinds the host can frame; the only ones this contract polices. */
const EMBEDDABLE_KINDS: ReadonlySet<string> = new Set(['same_origin_static', 'external_exception']);

/* ------------------------------------------------------------------ *
 * 2. declaration shape
 * ------------------------------------------------------------------ */

/** Bilingual purpose for the contact(s). Required when origins are declared. */
export interface ToolPrivacyPurpose {
	readonly ja: string;
	readonly en: string;
}

/**
 * `delivery.privacy` as declared in `src/tools/manifest.json`.
 *
 * Only facts go here: which origins the framed document may contact and
 * why. The consent behaviour is DERIVED from those facts, so there is no
 * field here that could switch the gate off.
 */
export interface ToolPrivacyDeclaration {
	/**
	 * The origins the framed document may contact. Empty is a written
	 * declaration ("no third-party contact"); omission is not a default.
	 * The runtime guard in `evaluateEmbedPrivacy` still refuses a missing
	 * or non-array value even though the JSON is only cast to this type.
	 */
	readonly third_party_origins: readonly string[];
	readonly purpose?: ToolPrivacyPurpose;
	/** How the declaration was established (measured from what, when). */
	readonly basis?: string;
}

/** The `delivery` fields the privacy contract reads. */
export interface ToolPrivacyDeliveryLike {
	readonly kind: string;
	readonly artifact_path?: string;
	readonly entry_html?: string;
	readonly external_url?: string;
	readonly privacy?: ToolPrivacyDeclaration | undefined;
}

/** Flattened subject, mirroring `embed-policy.ts#toEmbedSubject`. */
export interface EmbedPrivacySubject {
	readonly slug: string;
	readonly kind: string;
	readonly frame_src: string;
	readonly frame_origin: 'same-origin' | 'cross-origin' | 'unresolved';
	readonly privacy: ToolPrivacyDeclaration | undefined;
}

export type EmbedPrivacyViolationCode =
	| 'privacy.declaration-missing'
	| 'privacy.origins.missing'
	| 'privacy.origin.invalid'
	| 'privacy.origin.duplicate'
	| 'privacy.origin.frame-origin-undeclared'
	| 'privacy.purpose.missing'
	| 'privacy.purpose.locale-missing';

export interface EmbedPrivacyViolation {
	readonly slug: string;
	readonly code: EmbedPrivacyViolationCode;
	/** English, single line, stable enough to assert on in tests. */
	readonly message: string;
}

/** What the host does with one embeddable Tool. */
export interface EmbedPrivacyVerdict {
	readonly slug: string;
	readonly consent: EmbedConsentMode;
	/** Normalised, de-duplicated, sorted origins the frame may contact once mounted. */
	readonly contacts_after_activation: readonly string[];
	/**
	 * Always empty: the host document requests / references no third-party
	 * origin before the visitor activates the consent notice. (The declared
	 * list is a statement about the frame's future contacts, not a contact
	 * the host itself makes.)
	 */
	readonly contacts_before_activation: readonly string[];
	/** `true` when the frame document itself is served by a third party. */
	readonly frame_is_third_party: boolean;
	readonly violations: readonly EmbedPrivacyViolation[];
}

/* ------------------------------------------------------------------ *
 * 3. helpers
 * ------------------------------------------------------------------ */

/**
 * Normalise one declared origin to a bare `https://host[:port]` origin,
 * or `null` when the value cannot be one.
 *
 * Rejected, each for a reason the publication surface depends on:
 *
 *   - a wildcard host (`https://*.google.com`) — a "declared origin"
 *     that matches an unbounded set of parties is not a disclosure.
 *   - a path, query or fragment — `https://x.test/track?id=1` is a URL
 *     the host cannot present as "an origin", and it is the shape a
 *     tracking endpoint takes.
 *   - `http:` — the canonical production origin is https (ADR-0014).
 *   - credentials in the authority (`https://user:pw@x.test`).
 *
 * The messages below stay short on purpose: this module ships in the
 * client entry chunk (the loader runs on client-side navigation), so
 * every byte of developer prose here is paid for by every route. The
 * reasons live in this comment and in `docs/tools/embed-privacy.md`;
 * the message itself carries slug + code + the one fact to fix.
 */
export function normalizeThirdPartyOrigin(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const raw = value.trim();
	if (raw.length === 0) return null;
	if (raw.includes('*')) return null;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:') return null;
	if (parsed.username.length > 0 || parsed.password.length > 0) return null;
	if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return null;
	return parsed.origin;
}

/** Flatten a manifest `delivery` block into the privacy subject. */
export function toPrivacySubject(
	slug: string,
	delivery: ToolPrivacyDeliveryLike,
): EmbedPrivacySubject {
	// The SAME resolution the embed policy uses, so the privacy subject
	// names the document the host will actually mount: `entry_html`
	// first, then `artifact_path`/index.html for a `same_origin_static`
	// entry that declares no entry HTML, then the external URL. A
	// re-derived rule here would let the two contracts disagree about
	// which document is framed.
	const frame_src = resolveToolFrameSrc(delivery);
	return {
		slug,
		kind: delivery.kind,
		frame_src,
		frame_origin: classifyFrameOrigin(frame_src),
		privacy: delivery.privacy,
	};
}

/**
 * Classify the frame `src` for the privacy question only.
 *
 * Deliberately narrower than `embed-policy.ts#classifyToolFrameSrc`: that
 * function distinguishes "the URL parser sends this elsewhere" (a
 * smuggling attempt) from "the author meant a foreign origin", and this
 * one only needs to know whether the frame document is third-party.
 *
 * An `src` this cannot parse stays `unresolved`, and the gate reads an
 * unresolved frame as requiring consent (fail closed) — an unparseable
 * `src` can never lower the gate. The frame-src rules in
 * `embed-policy.ts` refuse such a `src` outright
 * (`embed.frame-src.invalid-scheme`), so nothing unresolved is ever
 * mounted; the fail-closed reading here is the second line of defence.
 */
function classifyFrameOrigin(src: string): EmbedPrivacySubject['frame_origin'] {
	if (typeof src !== 'string' || src.trim().length === 0) return 'unresolved';
	const value = src.trim();
	if (value.startsWith('/')) {
		// Root-relative: same-origin by construction here. (A src that
		// the browser resolves elsewhere is `embed.frame-src.cross-origin`
		// — a different violation, in a different module.)
		return 'same-origin';
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return 'unresolved';
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'unresolved';
	return 'cross-origin';
}

function violation(
	slug: string,
	code: EmbedPrivacyViolationCode,
	message: string,
): EmbedPrivacyViolation {
	return { slug, code, message };
}

/* ------------------------------------------------------------------ *
 * 4. evaluation
 * ------------------------------------------------------------------ */

/**
 * Evaluate the third-party contact contract for one Tool.
 *
 * Returns the verdict even when there are violations — the caller fails
 * closed on `violations.length > 0` (the `/tools/<slug>` loader renders a
 * blocked placeholder, `pnpm run tools:check` fails the commit), and the
 * verdict still reports what the host would have done so the violation
 * message can name the consequence.
 *
 * `host_disabled` / `not_integrable_yet` entries are framed by nobody,
 * so they are returned as `not_required` with no violations — the same
 * posture `evaluateToolEmbedPolicy` takes. A Tool that graduates to an
 * embeddable kind then has to declare its contacts before it can ship.
 */
export function evaluateEmbedPrivacy(subject: EmbedPrivacySubject): EmbedPrivacyVerdict {
	const violations: EmbedPrivacyViolation[] = [];
	const { slug, kind } = subject;
	const frame_is_third_party = subject.frame_origin === 'cross-origin';

	if (!EMBEDDABLE_KINDS.has(kind)) {
		return {
			slug,
			consent: CONSENT_MODE_NOT_REQUIRED,
			contacts_after_activation: [],
			contacts_before_activation: [],
			frame_is_third_party: false,
			violations: [],
		};
	}

	const declaration = subject.privacy;
	if (!declaration) {
		violations.push(
			violation(
				slug,
				'privacy.declaration-missing',
				`${slug}: delivery.privacy is required for ${kind} (Issue #498)`,
			),
		);
	}

	// Omission is not a default. A present declaration whose
	// `third_party_origins` is absent, null or not an array is a refusal,
	// not an empty contact list: `privacy: {}` used to derive
	// `not_required` and mount the frame eagerly (Issue #498 review).
	const origins = declaration?.third_party_origins;
	const hasOriginList = Array.isArray(origins);
	if (declaration && !hasOriginList) {
		violations.push(
			violation(
				slug,
				'privacy.origins.missing',
				`${slug}: delivery.privacy.third_party_origins must be an array (and may be empty) once delivery.privacy is present`,
			),
		);
	}

	const contacts: string[] = [];
	const seen = new Set<string>();
	for (const entry of hasOriginList ? origins : []) {
		const normalized = normalizeThirdPartyOrigin(entry);
		if (normalized === null) {
			violations.push(
				violation(
					slug,
					'privacy.origin.invalid',
					`${slug}: third_party_origins entry ${JSON.stringify(entry)} is not a bare https origin`,
				),
			);
			continue;
		}
		if (seen.has(normalized)) {
			violations.push(
				violation(
					slug,
					'privacy.origin.duplicate',
					`${slug}: third_party_origins repeats ${normalized}`,
				),
			);
			continue;
		}
		seen.add(normalized);
		contacts.push(normalized);
	}

	// The frame's own origin is a contact like any other: an external
	// document cannot be embedded without publishing which origin serves
	// it. `classifyFrameOrigin` already parsed this src, so the origin
	// resolves; `null` is still handled rather than assumed away.
	const frameOrigin = frame_is_third_party ? normalizeFrameOrigin(subject.frame_src) : null;
	if (frameOrigin !== null && !seen.has(frameOrigin)) {
		violations.push(
			violation(
				slug,
				'privacy.origin.frame-origin-undeclared',
				`${slug}: frame origin ${frameOrigin} is not declared in third_party_origins (Issue #498)`,
			),
		);
	}

	if (contacts.length > 0) {
		const purpose = declaration?.purpose;
		const ja = typeof purpose?.ja === 'string' ? purpose.ja.trim() : '';
		const en = typeof purpose?.en === 'string' ? purpose.en.trim() : '';
		if (!purpose || (ja.length === 0 && en.length === 0)) {
			violations.push(
				violation(
					slug,
					'privacy.purpose.missing',
					`${slug}: delivery.privacy.purpose is required once third_party_origins is non-empty`,
				),
			);
		} else if (ja.length === 0 || en.length === 0) {
			violations.push(
				violation(
					slug,
					'privacy.purpose.locale-missing',
					`${slug}: delivery.privacy.purpose needs a non-empty ja AND en`,
				),
			);
		}
	}

	contacts.sort();

	// Consent fails closed: a cross-origin frame, a frame whose `src`
	// could not be resolved at all, or a non-empty declaration all
	// require the visitor to activate the load. Only a same-origin
	// frame that declares no contact may mount without asking.
	const consent: EmbedConsentMode =
		frame_is_third_party ||
		subject.frame_origin === 'unresolved' ||
		contacts.length > 0 ||
		(declaration !== undefined && !hasOriginList)
			? CONSENT_MODE_CLICK_TO_LOAD
			: CONSENT_MODE_NOT_REQUIRED;

	return {
		slug,
		consent,
		contacts_after_activation: contacts,
		contacts_before_activation: [],
		frame_is_third_party,
		violations,
	};
}

/** The origin a cross-origin frame document is served by, or `null`. */
function normalizeFrameOrigin(frame_src: string): string | null {
	try {
		return new URL(frame_src).origin;
	} catch {
		return null;
	}
}

/**
 * The origins a consent notice has to name.
 *
 * A single accessor so the notice copy, the report generator and the
 * tests all read the same list. `evaluateEmbedPrivacy` already requires
 * a cross-origin frame's own origin to be declared, so the frame origin
 * is never absent from here.
 */
export function consentNoticeOrigins(verdict: EmbedPrivacyVerdict): readonly string[] {
	return verdict.contacts_after_activation;
}
