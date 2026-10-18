/**
 * Tool embed security policy — iframe sandbox + host message contract
 * (Issue #465).
 *
 * Problem this module solves
 * --------------------------
 * ADR-0006 §3 defines *how* a Tool is delivered (build artefact →
 * `/tools/<slug>/app/`), and the ADR's "Re-evaluation triggers"
 * section (NOT §3) explicitly leaves the runtime API surface and the
 * sandbox rules open:
 *
 *   > "A Tool needs a runtime API surface beyond a static iframe
 *   >  (e.g. cross-origin postMessage for collaboration). That is a
 *   >  new architectural decision — revisit the iframe sandbox rules
 *   >  in `delivery.iframe.sandbox` and the `Permissions-Policy` header."
 *
 * Until now the only enforcement was one line inside
 * `scripts/check-tools-manifest.mjs` that rejected the
 * `allow-scripts allow-same-origin` pair. Everything else was
 * convention: a Tool artefact served from the host's own origin inside
 * an iframe, with no statement anywhere about what the host is willing
 * to accept from that frame.
 *
 * Two concrete gaps:
 *
 *   1. `allow-same-origin` on a SAME-ORIGIN artefact is a total sandbox
 *      escape. The framed document is served from the host's own
 *      origin, so granting it `allow-same-origin` hands it the host's
 *      origin: the Tool can then reach `document.cookie`, `localStorage`,
 *      `indexedDB`, and same-origin `fetch` against `/api/v1/*`. The
 *      sandbox attribute would still *look* right in review while
 *      providing no isolation at all.
 *   2. The host had no statement about the message channel. An
 *      unexpected `postMessage` from a Tool frame (or from anything
 *      else that obtained a reference to the host window) had no
 *      defined handling, so "the host ignores it" was an emergent
 *      property, not a contract.
 *
 * The contract implemented here
 * -----------------------------
 * 1. **Fail closed on the manifest.** `evaluateToolEmbedPolicy()` is a
 *    pure function over one manifest entry. Any violation means the
 *    host renders a "blocked" placeholder instead of an iframe. There
 *    is no implicit default sandbox: `delivery.iframe` is REQUIRED for
 *    every embeddable Tool.
 * 2. **Same-origin artefact, sandboxed away from the host origin.**
 *    `allow-same-origin` is always rejected, together with every token
 *    that can navigate / escape / unlock storage
 *    (`allow-top-navigation*`, `allow-popups-to-escape-sandbox`,
 *    `allow-storage-access-by-user-activation`). Capability tokens
 *    (`allow-forms`, `allow-popups`, `allow-modals`, …) are allowed
 *    only together with an explicit capability grant (`iframe.allow`,
 *    which the route renders as the `<iframe allow=…>` attribute) and a
 *    written reason (`iframe.sandbox_rationale`). Both are required by
 *    this Issue's manifest schema — ADR-0006 does NOT contain the
 *    `allow-same-origin` rule nor a written-reason requirement.
 * 3. **Referrer policy is declared, not defaulted.** Only
 *    `no-referrer`, `same-origin`, and `strict-origin` are accepted;
 *    anything that can leak the full host URL cross-origin
 *    (`unsafe-url`, `origin-when-cross-origin`,
 *    `strict-origin-when-cross-origin`, `no-referrer-when-downgrade`)
 *    is rejected.
 * 4. **Frame origin is derived, never declared by hand.** The frame
 *    `src` for `same_origin_static` must be root-relative (host
 *    origin). `//host/...` (protocol-relative) and absolute URLs are
 *    rejected — both are ways to smuggle a foreign origin into a field
 *    that reads like a path — and so is a root-relative-looking src
 *    that URL resolution sends elsewhere (`/\evil.example/…`, which
 *    the parser reads as `//evil.example/…`). The origin comes from an
 *    actual parse, never from a string comparison.
 *    `external_exception` Tools are framed from their declared `https`
 *    `external_url`, never from the artefact path.
 * 5. **The message channel is opt-in and origin-exact.**
 *    `delivery.host_message` is OPTIONAL. With no declaration the host
 *    attaches no `message` listener at all, so no message from a Tool
 *    frame can reach host code. With a declaration, every event must
 *    satisfy all of: `event.origin === expectedOrigin`,
 *    `event.source === iframe.contentWindow`, `data.type ∈ allowed_types`,
 *    and `data` must be a plain object. Anything else is refused
 *    without dispatch. The reverse direction (host → Tool) resolves
 *    the same expected origin (so `'self'` becomes the host origin
 *    rather than a literal that `postMessage` would reject) and refuses
 *    `targetOrigin: '*'` and any target origin that is not the resolved
 *    one.
 *
 * Known limitation (owner decision, deliberately NOT decided here):
 * rule 2 denies `allow-same-origin`, so EVERY framed Tool runs in an
 * OPAQUE origin — on both delivery kinds, whatever its `src` URL says —
 * and every message it posts reports `event.origin === "null"`, never
 * a concrete origin. A `'self'` declaration therefore cannot be
 * satisfied at runtime, and neither can a literal `https://…` one: the
 * guard attaches (the declaration is syntactically valid) and then
 * refuses every event as `origin-mismatch`. That is fail-closed, and it
 * is also why no Tool declares `host_message` today. Making such a
 * channel work needs a sandbox-compatible identity (an opaque-origin
 * marker, frame `contentWindow` plus a nonce handshake) — an
 * architectural change that is ADR-0006's re-evaluation trigger and
 * belongs to the first Tool that actually needs it, not to this Issue.
 * Both candidate contracts are written out in
 * `docs/tools/embed-policy.md` §5a.
 *
 * This module is the single source of truth for those rules. It is
 * consumed by three surfaces, and all three MUST agree:
 *
 *   - `scripts/check-tools-manifest.mjs` (build-time gate,
 *     `pnpm run tools:check` inside `validate:fast`)
 *   - `src/routes/tools.$slug.tsx` (runtime gate — fail closed to a
 *     "blocked" placeholder)
 *   - `src/tools/use-tool-host-message.ts` (message channel)
 *
 * The file is deliberately dependency-free (no manifest import, no
 * React, no DOM access) so the Node verifier can import it directly
 * under type stripping, and so the rules can be unit-tested without a
 * browser.
 */

/* ------------------------------------------------------------------ *
 * 1. sandbox tokens
 * ------------------------------------------------------------------ */

/**
 * The complete HTML `sandbox` token set (WHATWG HTML §iframe sandbox
 * directive). Anything outside this list is an unknown token and is
 * rejected — a typo must fail the build, not silently degrade the
 * sandbox to "no tokens at all".
 */
export const SANDBOX_TOKENS = [
	'allow-downloads',
	'allow-forms',
	'allow-modals',
	'allow-orientation-lock',
	'allow-pointer-lock',
	'allow-popups',
	'allow-popups-to-escape-sandbox',
	'allow-presentation',
	'allow-same-origin',
	'allow-scripts',
	'allow-storage-access-by-user-activation',
	'allow-top-navigation',
	'allow-top-navigation-by-user-activation',
	'allow-top-navigation-to-custom-protocols',
] as const;

export type SandboxToken = (typeof SANDBOX_TOKENS)[number];

/**
 * Tokens that are always rejected. Each one either defeats the point
 * of the sandbox or lets the frame act on the HOST:
 *
 *   - `allow-same-origin` — the artefact is served from the host
 *     origin, so this grants the Tool the host's origin (cookies,
 *     storage, same-origin fetch to `/api/v1/*`). Combined with
 *     `allow-scripts` it is a full sandbox escape.
 *   - `allow-top-navigation*` — lets the Tool replace the host page.
 *   - `allow-popups-to-escape-sandbox` — a popup that is not sandboxed.
 *   - `allow-storage-access-by-user-activation` — asks the browser to
 *     unpartition storage for the frame (the escape the sandbox
 *     exists to prevent, by another route).
 */
export const SANDBOX_TOKENS_FORBIDDEN: ReadonlySet<string> = new Set([
	'allow-same-origin',
	'allow-popups-to-escape-sandbox',
	'allow-storage-access-by-user-activation',
	'allow-top-navigation',
	'allow-top-navigation-by-user-activation',
	'allow-top-navigation-to-custom-protocols',
]);

/**
 * Tokens that grant a capability beyond "run scripts in an opaque
 * origin". They are allowed, but only when the manifest declares BOTH
 * the capability grant (`iframe.allow`, rendered as the
 * `<iframe allow=…>` attribute) and a written reason
 * (`iframe.sandbox_rationale`). Issue #465 introduces both
 * requirements (ADR-0006 does not state an `allow-same-origin` rule);
 * this extends the always-denied family to the whole conditional set
 * so the answer is uniform instead of per-token folklore.
 */
export const SANDBOX_TOKENS_CONDITIONAL: ReadonlySet<string> = new Set([
	'allow-downloads',
	'allow-forms',
	'allow-modals',
	'allow-orientation-lock',
	'allow-pointer-lock',
	'allow-popups',
	'allow-presentation',
]);

/** `allow-scripts` is the only token that needs no justification. */
export const SANDBOX_TOKEN_FREE: SandboxToken = 'allow-scripts';

/* ------------------------------------------------------------------ *
 * 2. referrer policy
 * ------------------------------------------------------------------ */

/**
 * Accepted `referrerpolicy` values for a Tool iframe.
 *
 * A Tool frame is not a navigation the user asked for: it is an
 * embedded surface on someone else's document. Every value that can
 * send the host's full URL (path + query) to the Tool is therefore
 * rejected; only values that send nothing, or send the host's own
 * origin back to itself, are accepted.
 */
export const REFERRER_POLICIES_ALLOWED: readonly string[] = [
	'no-referrer',
	'same-origin',
	'strict-origin',
];

/* ------------------------------------------------------------------ *
 * 3. structural input types
 * ------------------------------------------------------------------ */

/**
 * `delivery.iframe` as declared in `src/tools/manifest.json`.
 *
 * Structurally compatible with the manifest's own union member, so
 * callers can pass a `ManifestTool['delivery']` directly.
 */
export interface ToolIframeDeclaration {
	readonly sandbox?: string;
	readonly referrer_policy?: string;
	/** Capability grant list (Permissions-Policy style tokens). */
	readonly allow?: string;
	/** Written reason, required alongside any conditional token. */
	readonly sandbox_rationale?: string;
}

/**
 * `delivery.host_message` — the OPT-IN Tool ↔ host message contract.
 *
 * Omit the block entirely and the host attaches no listener at all.
 */
export interface ToolHostMessageDeclaration {
	/** `'self'` (the host's own origin) or an explicit `https` origin. `'*'` is never valid. */
	readonly expected_origin?: string;
	readonly allowed_types?: readonly string[];
	/** Only `iframe_window` is accepted: the event must come from the Tool frame itself. */
	readonly source?: string;
}

/** The `delivery` fields the policy reads. */
export interface ToolDeliveryLike {
	readonly kind: string;
	readonly artifact_path?: string;
	readonly entry_html?: string;
	readonly external_url?: string;
	readonly iframe?: ToolIframeDeclaration | undefined;
	readonly host_message?: ToolHostMessageDeclaration | undefined;
}

/** Flattened subject the policy functions operate on. */
export interface ToolEmbedSubject {
	readonly slug: string;
	readonly kind: string;
	/** Resolved frame `src` (root-relative path, or the external URL). */
	readonly frame_src: string;
	/** `same-origin` when `frame_src` is served from the host origin. */
	readonly frame_origin: 'same-origin' | 'cross-origin' | 'unresolved';
	readonly iframe: ToolIframeDeclaration | undefined;
	readonly host_message: ToolHostMessageDeclaration | undefined;
}

export type EmbedViolationCode =
	| 'embed.delivery-not-embeddable'
	| 'embed.frame-src.missing'
	| 'embed.frame-src.invalid-scheme'
	| 'embed.frame-src.cross-origin'
	| 'embed.frame-src.not-https'
	| 'embed.iframe.missing'
	| 'embed.sandbox.missing'
	| 'embed.sandbox.unknown-token'
	| 'embed.sandbox.duplicate-token'
	| 'embed.sandbox.forbidden-token'
	| 'embed.sandbox.same-origin-escape'
	| 'embed.sandbox.conditional-without-grant'
	| 'embed.sandbox.conditional-without-rationale'
	| 'embed.referrer-policy.missing'
	| 'embed.referrer-policy.not-allowed'
	| 'host-message.origin.wildcard'
	| 'host-message.origin.invalid'
	| 'host-message.origin.mismatch'
	| 'host-message.types.missing'
	| 'host-message.types.invalid'
	| 'host-message.source.invalid';

export interface EmbedViolation {
	readonly slug: string;
	readonly code: EmbedViolationCode;
	/** English, single line, stable enough to assert on in tests. */
	readonly message: string;
}

/* ------------------------------------------------------------------ *
 * 4. helpers
 * ------------------------------------------------------------------ */

/** Split a sandbox / capability attribute into normalised tokens. */
export function parseTokenList(value: string | undefined): string[] {
	if (typeof value !== 'string') return [];
	return value
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

/**
 * A stand-in for the host origin, used ONLY to resolve a frame `src`
 * with the parser the browser itself uses. It is never contacted —
 * the resolved URL's origin is compared, not fetched.
 *
 * The probe has to be a special-scheme URL with an authority: for
 * `http:`/`https:` references the WHATWG URL parser strips ASCII tab /
 * CR / LF and maps `\` to `/`, and that normalisation is exactly what
 * turns a string that *looks* root-relative into a foreign origin.
 */
const HOST_ORIGIN_PROBE = 'https://host.invalid';

/**
 * Classify a frame `src` the way the browser will resolve it.
 *
 *   - root-relative (`/tools/x/app/index.html`) → `same-origin`
 *     **only when it resolves to the host origin**
 *   - protocol-relative (`//host/x`) → `cross-origin` (this is the
 *     trap: it looks like a path and is not)
 *   - absolute `http(s)` → `cross-origin`
 *   - anything else (`javascript:`, `data:`, `blob:`, garbage) →
 *     `unresolved`
 *
 * A prefix check is NOT enough, and the backslash is the reason. The
 * URL parser treats `\` as `/` inside an `http(s)` URL, so the src
 * `/\evil.example/tool` resolves to `https://evil.example/tool`, and a
 * src with a raw tab, LF or CR inside it is normalised the same way
 * (`/<TAB>/evil.example`, `/<CR>/evil.example`, …). Classifying those
 * as `same-origin` from their first character would let a manifest ship
 * a frame that the browser loads from a foreign origin — the precise
 * smuggling this rule exists to refuse. So the origin comes from an
 * actual parse, never from a string comparison.
 */
export function classifyToolFrameSrc(src: string): ToolEmbedSubject['frame_origin'] {
	if (typeof src !== 'string' || src.trim().length === 0) return 'unresolved';
	const value = src.trim();
	if (value.startsWith('//')) return 'cross-origin';
	if (value.startsWith('/')) {
		// Root-relative candidate: resolve it the way the browser will
		// and compare origins. Anything the parser sends elsewhere is
		// `cross-origin` (fail closed), anything it cannot resolve at
		// all is `unresolved` (also fail closed).
		let resolved: URL;
		try {
			resolved = new URL(value, HOST_ORIGIN_PROBE);
		} catch {
			return 'unresolved';
		}
		if (resolved.protocol !== 'https:') return 'unresolved';
		return resolved.origin === HOST_ORIGIN_PROBE ? 'same-origin' : 'cross-origin';
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

/**
 * Resolve the frame `src` for one delivery entry.
 *
 * `same_origin_static` → the manifest's root-relative entry HTML
 * (ADR-0006 §1: artefacts live at `/tools/<slug>/app/`).
 * `external_exception` → the declared external URL. Never the
 * artefact path: the schema requires the host not to serve a frame
 * from `artifact_path` when `external_url` is set.
 */
export function resolveToolFrameSrc(delivery: ToolDeliveryLike): string {
	if (delivery.kind === 'external_exception') return delivery.external_url ?? '';
	if (delivery.kind !== 'same_origin_static') return '';
	if (typeof delivery.entry_html === 'string' && delivery.entry_html.length > 0) {
		return delivery.entry_html;
	}
	if (typeof delivery.artifact_path === 'string' && delivery.artifact_path.length > 0) {
		return `${delivery.artifact_path.replace(/\/+$/, '')}/index.html`;
	}
	return '';
}

/** Flatten a manifest `delivery` block into the policy subject. */
export function toEmbedSubject(slug: string, delivery: ToolDeliveryLike): ToolEmbedSubject {
	const frame_src = resolveToolFrameSrc(delivery);
	return {
		slug,
		kind: delivery.kind,
		frame_src,
		frame_origin: classifyToolFrameSrc(frame_src),
		iframe: delivery.iframe,
		host_message: delivery.host_message,
	};
}

/* ------------------------------------------------------------------ *
 * 5. evaluation
 * ------------------------------------------------------------------ */

const EMBEDDABLE_KINDS: ReadonlySet<string> = new Set(['same_origin_static', 'external_exception']);

const MESSAGE_TYPE_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,63}$/;

function violation(slug: string, code: EmbedViolationCode, message: string): EmbedViolation {
	return { slug, code, message };
}

/**
 * Evaluate every embed rule for one Tool.
 *
 * Returns an empty array when the entry may be framed. Any other
 * result means the host MUST NOT render an iframe for it
 * (`src/routes/tools.$slug.tsx` renders a blocked placeholder) and
 * `pnpm run tools:check` must fail the commit.
 *
 * `host_disabled` / `not_integrable_yet` entries return an empty array
 * too: no frame is rendered for them, so there is nothing to police.
 */
export function evaluateToolEmbedPolicy(subject: ToolEmbedSubject): readonly EmbedViolation[] {
	const violations: EmbedViolation[] = [];
	const { slug, kind } = subject;

	if (!EMBEDDABLE_KINDS.has(kind)) return violations;

	// --- frame src ---------------------------------------------------
	if (subject.frame_src.length === 0) {
		violations.push(
			violation(
				slug,
				'embed.frame-src.missing',
				`${slug}: delivery.kind=${kind} has no frame src (entry_html / external_url); the host would render an empty iframe`,
			),
		);
	} else if (subject.frame_origin === 'unresolved') {
		violations.push(
			violation(
				slug,
				'embed.frame-src.invalid-scheme',
				`${slug}: frame src "${subject.frame_src}" is not an http(s) URL and not a root-relative path`,
			),
		);
	} else if (kind === 'same_origin_static' && subject.frame_origin === 'cross-origin') {
		// A `same_origin_static` artefact is served by the host's own
		// Static Assets binding (ADR-0006 §3). A cross-origin src here
		// means the manifest entry and the delivery kind disagree — the
		// exact src/targetOrigin confusion this contract exists to
		// reject. `//host/...` lands in this branch too.
		violations.push(
			violation(
				slug,
				'embed.frame-src.cross-origin',
				`${slug}: delivery.kind=same_origin_static requires a root-relative frame src, got "${subject.frame_src}"`,
			),
		);
	} else if (kind === 'external_exception' && subject.frame_origin === 'cross-origin') {
		// An `external_exception` frame is a foreign origin the host does
		// not control. The canonical production origin is https
		// (ADR-0014) and the whole Tool story assumes https (getUserMedia,
		// SharedArrayBuffer), so a plaintext external frame is rejected
		// rather than served with a "mixed content" warning.
		let protocol = '';
		try {
			protocol = new URL(subject.frame_src).protocol;
		} catch {
			protocol = '';
		}
		if (protocol !== 'https:') {
			violations.push(
				violation(
					slug,
					'embed.frame-src.not-https',
					`${slug}: external_url must be an https URL, got "${subject.frame_src}"`,
				),
			);
		}
	}

	violations.push(...evaluateIframeDeclaration(slug, subject));
	violations.push(...evaluateHostMessageDeclaration(subject));

	return violations;
}

/** iframe sandbox + referrer policy rules. */
export function evaluateIframeDeclaration(
	slug: string,
	subject: ToolEmbedSubject,
): readonly EmbedViolation[] {
	const violations: EmbedViolation[] = [];
	const iframe = subject.iframe;

	if (!iframe) {
		violations.push(
			violation(
				slug,
				'embed.iframe.missing',
				`${slug}: delivery.iframe is required for ${subject.kind}; the host has no implicit sandbox default (fail closed)`,
			),
		);
		return violations;
	}

	// --- sandbox -----------------------------------------------------
	const tokens = parseTokenList(iframe.sandbox);
	if (tokens.length === 0) {
		violations.push(
			violation(
				slug,
				'embed.sandbox.missing',
				`${slug}: delivery.iframe.sandbox is required and must contain at least one token`,
			),
		);
	} else {
		// De-duplicate first, then rule over the unique tokens in a
		// stable (first-seen) order, so a violation list never depends
		// on where the operator happened to place a repeated token.
		const seen = new Set<string>();
		const duplicates = new Set<string>();
		for (const token of tokens) {
			if (seen.has(token)) duplicates.add(token);
			else seen.add(token);
		}
		for (const token of duplicates) {
			violations.push(
				violation(
					slug,
					'embed.sandbox.duplicate-token',
					`${slug}: sandbox token "${token}" is repeated`,
				),
			);
		}

		const grants = parseTokenList(iframe.allow);
		const hasRationale =
			typeof iframe.sandbox_rationale === 'string' && iframe.sandbox_rationale.trim().length > 0;

		// The escape case is order-independent, so it is checked against
		// the whole token set instead of inside the loop: on a
		// SAME-ORIGIN artefact, `allow-same-origin` hands the Tool the
		// host's own origin.
		if (seen.has(SANDBOX_TOKEN_FREE) && seen.has('allow-same-origin')) {
			violations.push(
				violation(
					slug,
					'embed.sandbox.same-origin-escape',
					`${slug}: "allow-scripts allow-same-origin" hands the Tool the host origin (cookies, storage, same-origin /api/v1/*); it is always rejected, not merely documented`,
				),
			);
		}

		for (const token of seen) {
			if (!(SANDBOX_TOKENS as readonly string[]).includes(token)) {
				violations.push(
					violation(
						slug,
						'embed.sandbox.unknown-token',
						`${slug}: sandbox token "${token}" is not an HTML sandbox token; a typo must fail the build rather than weaken the sandbox`,
					),
				);
				continue;
			}

			if (SANDBOX_TOKENS_FORBIDDEN.has(token)) {
				violations.push(
					violation(
						slug,
						'embed.sandbox.forbidden-token',
						`${slug}: sandbox token "${token}" is never allowed for an embedded Tool`,
					),
				);
				continue;
			}

			if (SANDBOX_TOKENS_CONDITIONAL.has(token)) {
				if (grants.length === 0) {
					violations.push(
						violation(
							slug,
							'embed.sandbox.conditional-without-grant',
							`${slug}: sandbox token "${token}" requires delivery.iframe.allow to declare the granted capability`,
						),
					);
				}
				if (!hasRationale) {
					violations.push(
						violation(
							slug,
							'embed.sandbox.conditional-without-rationale',
							`${slug}: sandbox token "${token}" requires delivery.iframe.sandbox_rationale (Issue #465 requires a written reason for every conditional token)`,
						),
					);
				}
			}
		}
	}

	// --- referrer policy ---------------------------------------------
	const referrer = typeof iframe.referrer_policy === 'string' ? iframe.referrer_policy.trim() : '';
	if (referrer.length === 0) {
		violations.push(
			violation(
				slug,
				'embed.referrer-policy.missing',
				`${slug}: delivery.iframe.referrer_policy is required; the host does not default it (fail closed)`,
			),
		);
	} else if (!REFERRER_POLICIES_ALLOWED.includes(referrer)) {
		violations.push(
			violation(
				slug,
				'embed.referrer-policy.not-allowed',
				`${slug}: referrer_policy "${referrer}" is not one of ${REFERRER_POLICIES_ALLOWED.join(' | ')}`,
			),
		);
	}

	return violations;
}

/** Host message channel rules (origin / type / source). */
export function evaluateHostMessageDeclaration(
	subject: ToolEmbedSubject,
): readonly EmbedViolation[] {
	const violations: EmbedViolation[] = [];
	const declaration = subject.host_message;
	if (!declaration) return violations;
	const { slug } = subject;

	const expected =
		typeof declaration.expected_origin === 'string' ? declaration.expected_origin.trim() : '';
	if (expected.length === 0) {
		violations.push(
			violation(
				slug,
				'host-message.origin.invalid',
				`${slug}: delivery.host_message.expected_origin is required ("self" or an explicit https origin)`,
			),
		);
	} else if (expected === '*') {
		violations.push(
			violation(
				slug,
				'host-message.origin.wildcard',
				`${slug}: expected_origin "*" would accept a message from ANY origin; it is never valid`,
			),
		);
	} else if (expected !== 'self') {
		if (!/^https:\/\/[^/?#]+$/.test(expected)) {
			violations.push(
				violation(
					slug,
					'host-message.origin.invalid',
					`${slug}: expected_origin "${expected}" must be "self" or an https origin literal`,
				),
			);
		} else if (subject.frame_origin !== 'unresolved') {
			// Cross-origin frame: the declared origin must match the
			// origin the frame's URL implies, so a manifest cannot name
			// an origin the frame does not even point at. (It is NOT the
			// origin the frame runs on — under this policy the sandbox
			// makes every frame opaque; see the NOTE below.)
			let frameOrigin: string | null = null;
			try {
				frameOrigin = new URL(subject.frame_src).origin;
			} catch {
				frameOrigin = null;
			}
			if (frameOrigin !== expected) {
				violations.push(
					violation(
						slug,
						'host-message.origin.mismatch',
						`${slug}: expected_origin "${expected}" does not match the frame origin "${frameOrigin ?? 'unresolved'}"`,
					),
				);
			}
		}
	} else if (subject.frame_origin === 'cross-origin') {
		// `'self'` claims a same-origin frame while the src is cross-origin.
		violations.push(
			violation(
				slug,
				'host-message.origin.mismatch',
				`${slug}: expected_origin "self" contradicts the cross-origin frame src "${subject.frame_src}"`,
			),
		);
	}
	// NOTE (Issue #465, reviews): under this policy NO `host_message`
	// declaration can be satisfied at runtime, on either embeddable
	// kind. `allow-same-origin` is always denied, so every framed Tool
	// runs in an opaque origin and every event it posts carries
	// `event.origin === "null"` — a `'self'` declaration on a
	// `same_origin_static` entry, and a literal `https://…` declaration
	// on an `external_exception` entry alike. The guard attaches (the
	// declaration is syntactically valid) and then refuses every event
	// as `origin-mismatch`. That stays a runtime refusal rather than a
	// build-time violation on purpose: the gate would be pre-deciding
	// the architecture question (opaque-origin identity via frame
	// `contentWindow` or a host-issued nonce handshake) that ADR-0006's
	// re-evaluation trigger owns. Both constraints, and the two
	// candidate contracts, are written out in `docs/tools/embed-policy.md`
	// §5a; the behaviour is pinned by `src/tools/embed-policy.test.ts`.

	const types = declaration.allowed_types;
	if (!Array.isArray(types) || types.length === 0) {
		violations.push(
			violation(
				slug,
				'host-message.types.missing',
				`${slug}: delivery.host_message.allowed_types must list at least one message type`,
			),
		);
	} else {
		for (const type of types) {
			if (typeof type !== 'string' || !MESSAGE_TYPE_PATTERN.test(type)) {
				violations.push(
					violation(
						slug,
						'host-message.types.invalid',
						`${slug}: allowed_types entry ${JSON.stringify(type)} must match ${MESSAGE_TYPE_PATTERN.source}`,
					),
				);
			}
		}
	}

	const source = declaration.source ?? 'iframe_window';
	if (source !== 'iframe_window') {
		violations.push(
			violation(
				slug,
				'host-message.source.invalid',
				`${slug}: host_message.source must be "iframe_window"; "${source}" is not an accepted source`,
			),
		);
	}

	return violations;
}

/* ------------------------------------------------------------------ *
 * 6. runtime message guard
 * ------------------------------------------------------------------ */

/** Minimal structural shape of the DOM `MessageEvent` the guard needs. */
export interface ToolMessageEventLike {
	readonly origin: string;
	readonly source: unknown;
	readonly data: unknown;
}

/** Minimal structural shape of a `window`-like message target. */
export interface ToolMessageTarget {
	addEventListener(type: 'message', listener: (event: never) => void): void;
	removeEventListener(type: 'message', listener: (event: never) => void): void;
	readonly location?: { readonly origin?: string | undefined } | undefined;
}

/** A Tool message that passed every check. */
export interface AcceptedToolMessage {
	readonly type: string;
	readonly payload: unknown;
}

export type ToolMessageRejectionReason =
	| 'origin-mismatch'
	| 'source-mismatch'
	| 'type-not-allowed'
	| 'malformed-payload';

export type ToolMessageVerdict =
	| { readonly accepted: true; readonly message: AcceptedToolMessage }
	| { readonly accepted: false; readonly reason: ToolMessageRejectionReason };

export interface ToolMessageGuardOptions {
	readonly slug: string;
	readonly declaration: ToolHostMessageDeclaration;
	/** The host's own origin at runtime (`window.location.origin`). */
	readonly hostOrigin: string;
	/** The Tool frame's `contentWindow`; `null` while the frame is not mounted. */
	readonly toolWindow: unknown;
	readonly dispatch: (message: AcceptedToolMessage) => void;
}

/**
 * Resolve the ONE origin a Tool message may come from.
 *
 * Returns `null` when the declaration cannot be resolved to a single
 * concrete origin (missing, wildcard, malformed, or a frame origin
 * that disagrees with the declaration) — the caller then refuses to
 * attach rather than guessing.
 *
 * `frameOrigin` is the origin the Tool frame actually runs on. It is
 * optional here because the runtime guard cannot know it: the host
 * holds an opaque `iframe.contentWindow` and only `event.origin` is
 * readable. So this branch is a defence-in-depth helper for callers
 * that DO know the frame origin (the build-time gate derives it from
 * the declared `external_url`; `src/tools/use-tool-host-message.ts`
 * passes nothing, which is why the runtime defence is `event.origin` +
 * `event.source` equality). Today no production caller supplies it and
 * only the unit test exercises the mismatch branch — it is not a
 * runtime guarantee, and the runtime does not claim one.
 *
 * This function is also what makes `'self'` usable in BOTH directions:
 * the inbound guard compares `event.origin` against the resolved host
 * origin, and `postToToolWindow` compares its `targetOrigin` against
 * the same resolved value, so a `'self'` declaration can never be used
 * to smuggle a literal `'self'` string into `postMessage`.
 */
export function resolveExpectedToolOrigin(
	declaration: ToolHostMessageDeclaration,
	hostOrigin: string,
	frameOrigin?: string | null,
): string | null {
	const expected =
		typeof declaration.expected_origin === 'string' ? declaration.expected_origin.trim() : '';
	if (expected.length === 0 || expected === '*') return null;
	if (expected === 'self') {
		// The host origin — but only while the frame really is same-origin.
		if (frameOrigin != null && frameOrigin !== hostOrigin) return null;
		return hostOrigin;
	}
	if (!/^https:\/\/[^/?#]+$/.test(expected)) return null;
	if (frameOrigin != null && frameOrigin !== expected) return null;
	return expected;
}

/**
 * Build the host-side message guard.
 *
 * Returns `null` when the guard cannot be constructed from the
 * declaration (no contract / unresolvable origin) — "no contract" is
 * the default, so the default state is "no listener, nothing to
 * abuse".
 */
export function createToolMessageGuard(
	options: ToolMessageGuardOptions,
): ((event: ToolMessageEventLike) => ToolMessageVerdict) | null {
	const { declaration, hostOrigin, toolWindow } = options;
	if (!declaration) return null;
	if (typeof hostOrigin !== 'string' || hostOrigin.length === 0) return null;

	const expectedOrigin = resolveExpectedToolOrigin(declaration, hostOrigin);
	if (expectedOrigin === null) return null;

	const allowed = new Set(declaration.allowed_types ?? []);

	return (event: ToolMessageEventLike): ToolMessageVerdict => {
		// 1. Origin. Checked FIRST and by exact string equality — a
		//    frame that navigates to a foreign origin (or a hostile
		//    opener) is refused even if everything else matches.
		if (!event || event.origin !== expectedOrigin) {
			return { accepted: false, reason: 'origin-mismatch' };
		}

		// 2. Source window. Origin alone is not identity: a page on the
		//    same origin that is not the Tool frame must not be able to
		//    drive the host either.
		if (toolWindow === null || toolWindow === undefined || event.source !== toolWindow) {
			return { accepted: false, reason: 'source-mismatch' };
		}

		// 3. Payload shape. A string / array / null payload is not a
		//    Tool message; treating it as one would let a frame probe
		//    the host's parser behaviour.
		const data = event.data;
		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			return { accepted: false, reason: 'malformed-payload' };
		}
		const type = (data as { type?: unknown }).type;
		if (typeof type !== 'string' || !allowed.has(type)) {
			return { accepted: false, reason: 'type-not-allowed' };
		}

		const message: AcceptedToolMessage = {
			type,
			payload: (data as { payload?: unknown }).payload,
		};
		options.dispatch(message);
		return { accepted: true, message };
	};
}

export interface AttachToolMessageGuardOptions extends ToolMessageGuardOptions {
	/** `window`-like target that receives the `message` event. */
	readonly target: ToolMessageTarget;
}

/**
 * Attach the guard to a window-like target.
 *
 * Attaching is opt-in: without `declaration` (or without a resolvable
 * origin) NOTHING is attached, so an unexpected message from a Tool
 * frame has no host code to reach.
 *
 * Returns a detach function, or `null` when nothing was attached (the
 * caller must treat that as "no message channel", never as success).
 */
export function attachToolMessageGuard(
	options: AttachToolMessageGuardOptions,
): (() => void) | null {
	const guard = createToolMessageGuard(options);
	if (!guard) return null;
	const listener = (event: never): void => {
		guard(event as unknown as ToolMessageEventLike);
	};
	options.target.addEventListener('message', listener);
	return () => {
		options.target.removeEventListener('message', listener);
	};
}

export interface PostToToolResult {
	readonly sent: boolean;
	readonly reason?:
		| 'no-target-window'
		| 'no-host-origin'
		| 'wildcard-target-origin'
		| 'unresolvable-origin'
		| 'target-origin-invalid'
		| 'target-origin-mismatch'
		| 'no-contract';
}

/**
 * Host → Tool direction.
 *
 * `targetOrigin` must resolve to the ONE origin the declaration
 * allows — the same origin the inbound guard accepts. `'*'` is refused
 * unconditionally: it would deliver the payload to whatever document
 * happens to occupy the frame after a navigation.
 *
 * `hostOrigin` is required because the declaration is written in terms
 * of `'self'`: comparing a raw `'self'` string against a concrete
 * target origin would refuse every same-origin Tool (the one case the
 * contract exists for), and passing `'self'` straight to
 * `postMessage()` throws a `SyntaxError` in a real DOM (`targetOrigin`
 * must be `'*'` or a URL). The declaration is therefore resolved
 * through the SAME `resolveExpectedToolOrigin` the inbound guard uses,
 * and the result is additionally checked to be a syntactically valid
 * origin before it reaches `postMessage`.
 */
export function postToToolWindow(
	toolWindow: { postMessage(message: unknown, targetOrigin: string): void } | null | undefined,
	declaration: ToolHostMessageDeclaration | undefined,
	hostOrigin: string,
	targetOrigin: string,
	message: unknown,
): PostToToolResult {
	if (!declaration) return { sent: false, reason: 'no-contract' };
	if (typeof hostOrigin !== 'string' || hostOrigin.length === 0) {
		// Without a host origin `'self'` is unresolvable, and guessing
		// it is exactly the wildcard-in-disguise this function refuses.
		return { sent: false, reason: 'no-host-origin' };
	}
	if (!toolWindow) return { sent: false, reason: 'no-target-window' };
	if (targetOrigin === '*') return { sent: false, reason: 'wildcard-target-origin' };
	const declared = resolveExpectedToolOrigin(declaration, hostOrigin);
	if (declared === null) return { sent: false, reason: 'unresolvable-origin' };
	// Syntax BEFORE equality, so the reason is the actionable one: a
	// caller passing `'self'` (or a path-bearing origin) is told the
	// string is not a usable `postMessage` target, not merely that it
	// differs from the declaration. `postMessage(msg, targetOrigin)`
	// throws a `SyntaxError` for anything that is not `'*'` (already
	// refused above) or a parseable origin, and `declared` inherits the
	// caller-supplied `hostOrigin` verbatim for a `'self'`
	// declaration — so an unvalidated host origin is caught here too.
	let parsed: URL;
	try {
		parsed = new URL(targetOrigin);
	} catch {
		return { sent: false, reason: 'target-origin-invalid' };
	}
	if (parsed.origin !== targetOrigin) {
		// Rejects 'self', 'https://host/path', 'https://host:443', and
		// any origin string carrying a path/query/fragment.
		return { sent: false, reason: 'target-origin-invalid' };
	}
	if (targetOrigin !== declared) return { sent: false, reason: 'target-origin-mismatch' };
	toolWindow.postMessage(message, targetOrigin);
	return { sent: true };
}
