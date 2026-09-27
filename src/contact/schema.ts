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
 * Filter active + verified channels from a list.
 *
 * Fail-closed: a channel without a recent `verified_at` is dropped.
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
		const verifiedMs = Date.parse(`${ch.verified_at}T00:00:00Z`);
		if (Number.isNaN(verifiedMs)) continue;
		if (verifiedMs < cutoff) continue;
		out.push(ch);
	}
	// Stable order: most-recently verified first, then id ascending.
	return out.sort((a, b) => {
		const va = Date.parse(`${a.verified_at}T00:00:00Z`);
		const vb = Date.parse(`${b.verified_at}T00:00:00Z`);
		if (vb !== va) return vb - va;
		return a.id.localeCompare(b.id);
	});
}

/**
 * Days since `verified_at` — exposed for UI display ("verified N days ago").
 * Negative values mean `verified_at` is in the future relative to `now`.
 */
export function daysSinceVerified(ch: Channel, now: number): number {
	const verifiedMs = Date.parse(`${ch.verified_at}T00:00:00Z`);
	if (Number.isNaN(verifiedMs)) return Number.NaN;
	return Math.floor((now - verifiedMs) / (24 * 60 * 60 * 1000));
}
