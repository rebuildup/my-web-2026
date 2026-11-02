import { z } from 'zod';

/**
 * `/contact` channel schema (Issue #103).
 *
 * Channels are repo-controlled (NOT DB-backed) because:
 *   1. Public contact channels are a deploy-time artefact — they
 *      change when the operator publishes or retires a channel,
 *      not in response to user action.
 *   2. The decision doc for the /contact surface (see
 *      `docs/decisions/` for the canonical reference; the
 *      release-trunk slug is the filename, not a version claim)
 *      records this contract as "channels that have not been
 *      re-verified at deploy time MUST NOT be listed".
 *   3. ADR-0008 (obligation-oriented ownership) requires an
 *      independent contract, authority, and lifecycle to justify a
 *      promotion to its own obligation. A DB-backed contact store
 *      would re-litigate that decision without a downstream
 *      consumer observed.
 *
 * Each channel MUST have an `active` flag and a `verified_at`
 * timestamp. The fail-closed gate (`verified_at` within the
 * `freshnessWindowDays` of the deploy time) is part of the schema
 * contract, not a UI choice — see {@link filterActiveVerified}.
 */

export const PurposeSchema = z.enum([
	/** 採用 / hiring inquiries. */
	'recruitment',
	/** 技術的な議論 / engineering collaboration. */
	'technical',
	/** 作品・plugin 等の配布 / distribution feedback. */
	'distribution',
	/** 制作依頼 / commissioned work (NOT commission pricing — just intake). */
	'commission-intake',
	/** その他 / other (use sparingly). */
	'other',
]);
export type Purpose = z.infer<typeof PurposeSchema>;

export const PURPOSE_LABEL_JA: Record<Purpose, string> = {
	recruitment: '採用のお問い合わせ',
	technical: '技術的な議論',
	distribution: '配布・公開について',
	'commission-intake': '制作依頼の受け付け',
	other: 'その他',
};

export const PURPOSE_LABEL_EN: Record<Purpose, string> = {
	recruitment: 'Hiring inquiries',
	technical: 'Technical discussion',
	distribution: 'Distribution & publication',
	'commission-intake': 'Commission intake',
	other: 'Other',
};

/**
 * `freshnessWindowDays` — how many days back from `now` a channel's
 * `verified_at` may be before it is considered stale and filtered
 * out by {@link filterActiveVerified}.
 *
 * Per the Issue #103 scope: 30 days at deploy time.
 *
 * Keep this constant here (not in the route or filter call site)
 * so a single edit extends the freshness contract repo-wide.
 */
export const FRESHNESS_WINDOW_DAYS = 30;

export const FRESHNESS_WINDOW_MS = FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const ChannelBaseSchema = z.object({
	/** Stable identifier — kebab-case, route-stable. */
	id: z
		.string()
		.min(1)
		.regex(/^[a-z0-9-]+$/, 'channel id must be kebab-case (lowercase, digits, dashes only)'),
	/** Display label (Japanese preferred for visitor-facing UI). */
	label: z.string().min(1),
	/** English alias for the channel — used in metadata / `aria-label`. */
	labelEn: z.string().min(1),
	/** What this channel is for. Drives the "用途" line. */
	purpose: PurposeSchema,
	/** Public URL. NOT a contact form endpoint. */
	url: z.string().url(),
	/** ISO 8601 date (YYYY-MM-DD) the channel was last verified live. */
	verified_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'verified_at must be YYYY-MM-DD'),
	/** Whether this channel is currently published. */
	active: z.boolean(),
});

/** A raw channel record as it lives in `channels.json`. */
export type Channel = z.infer<typeof ChannelBaseSchema>;

/** Full file schema for `channels.json` — a list of channels. */
export const ChannelsFileSchema = z.object({
	channels: z.array(ChannelBaseSchema).readonly(),
});

export type ChannelsFile = z.infer<typeof ChannelsFileSchema>;

/**
 * `verified_at` is an AUTHORED calendar day, and the day is JST.
 *
 * Issue #832: the record is written when the operator checks a channel,
 * which they do on a JST calendar day. Anchoring the parse at UTC
 * midnight made a same-day verification read as 23:00 of the previous
 * day — the row rendered `days = -1`, which the UI then labelled
 * 「検証日不明 / verified_at unparseable」 even though the value was
 * perfectly well-formed, and the fail-closed gate happily listed it.
 * Anchor at JST midnight instead: the day the operator wrote is the day
 * the platform means, and `days >= 0` again holds for a same-day check.
 */
const VERIFIED_AT_SUFFIX = 'T00:00:00+09:00';

function verifiedAtMs(ch: Channel): number {
	return Date.parse(`${ch.verified_at}${VERIFIED_AT_SUFFIX}`);
}

/**
 * Filter active + verified channels from a list.
 *
 * Fail-closed in both directions: a channel whose `verified_at` is older
 * than the freshness window is dropped, and so is one dated in the
 * future (a verification cannot precede the day it was performed; a
 * future date means the record is wrong, so the platform must not
 * present it as verified).
 *
 * The caller supplies `now` so the test can pin the clock and the
 * route can pass the request time deterministically.
 *
 * @param input       raw channels (from JSON, before gating)
 * @param now         reference time (ms since epoch)
 * @param windowMs    freshness window in ms (defaults to FRESHNESS_WINDOW_MS)
 */
export function filterActiveVerified(
	input: readonly Channel[],
	now: number,
	windowMs: number = FRESHNESS_WINDOW_MS,
): Channel[] {
	const cutoff = now - windowMs;
	const out: Channel[] = [];
	for (const ch of input) {
		if (!ch.active) continue;
		const verifiedMs = verifiedAtMs(ch);
		if (Number.isNaN(verifiedMs)) continue;
		if (verifiedMs < cutoff) continue;
		if (verifiedMs > now) continue;
		out.push(ch);
	}
	// Stable order: most-recently verified first, then id ascending.
	return out.sort((a, b) => {
		const va = verifiedAtMs(a);
		const vb = verifiedAtMs(b);
		if (vb !== va) return vb - va;
		return a.id.localeCompare(b.id);
	});
}

/**
 * Days since `verified_at` — exposed for UI display ("verified N days ago").
 * Negative values mean `verified_at` is in the future relative to `now`
 * (which {@link filterActiveVerified} refuses to publish).
 */
export function daysSinceVerified(ch: Channel, now: number): number {
	const verifiedMs = verifiedAtMs(ch);
	if (Number.isNaN(verifiedMs)) return Number.NaN;
	return Math.floor((now - verifiedMs) / (24 * 60 * 60 * 1000));
}
