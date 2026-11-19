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
 * timestamp. `active` is the operator's publish switch (the result
 * of the two-axis reachability / contactability verification —
 * Issue #832). `verified_at` feeds the AUDIT clock, not the display
 * gate: an overdue channel stays listed with a re-verification
 * note instead of disappearing (Issue #833). See
 * {@link selectDisplayableChannels} and {@link auditChannelState}.
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

/**
 * `AUDIT_WINDOW_DAYS` — how many days may pass between a channel's
 * last two-axis verification (`verified_at`) and the point where the
 * platform flags it as needing re-verification.
 *
 * Issue #833 redefined this constant's ROLE: it is the periodic-audit
 * deadline, NOT a display gate. A channel past this window remains
 * listed (it was verified to exist) but renders a "re-verification
 * due" note; only `active: false`, an unparseable `verified_at`, or a
 * future-dated `verified_at` removes a channel from the public list.
 * The value itself is unchanged from the Issue #103 contract.
 *
 * Keep this constant here (not in the route or filter call site)
 * so a single edit extends the audit contract repo-wide.
 */
export const AUDIT_WINDOW_DAYS = 30;

export const AUDIT_WINDOW_MS = AUDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
 * day — the row rendered `days = -1`, which the UI then labelled the
 * date as unverifiable even though the value was
 * perfectly well-formed, and the fail-closed gate happily listed it.
 * Anchor at JST midnight instead: the day the operator wrote is the day
 * the platform means, and `days >= 0` again holds for a same-day check.
 */
const VERIFIED_AT_SUFFIX = 'T00:00:00+09:00';

function verifiedAtMs(ch: Channel): number {
	return Date.parse(`${ch.verified_at}${VERIFIED_AT_SUFFIX}`);
}

/**
 * The audit state of one channel (Issue #833).
 *
 * - `fresh` — `verified_at` is inside {@link AUDIT_WINDOW_MS} of `now`.
 * - `due` — `verified_at` is older than the audit window. The channel
 *   was verified to exist, so date age alone must not remove it; the
 *   public row carries a re-verification note instead.
 * - `unknown` — `verified_at` is unparseable or dated in the future.
 *   The record cannot confirm the channel was ever verified, so the
 *   channel is NOT displayable (fail-closed on validity, not on age).
 */
export type ChannelAuditState = 'fresh' | 'due' | 'unknown';

/** The audit states a displayable channel can carry (`unknown` is excluded). */
export type DisplayableAuditState = Exclude<ChannelAuditState, 'unknown'>;

/** A channel together with its audit verdict. */
export interface AuditedChannel {
	readonly channel: Channel;
	readonly audit: DisplayableAuditState;
	readonly verifiedDaysAgo: number;
}

/**
 * Classify one channel's audit state against `now`.
 *
 * `verified_at` is an AUTHORED calendar day, and the day is JST (see
 * {@link verifiedAtMs}). A date ahead of `now` is a wrong record — a
 * verification cannot precede the day it was performed — so it reads
 * as `unknown`, never as `fresh`.
 */
export function auditChannelState(
	ch: Channel,
	now: number,
	windowMs: number = AUDIT_WINDOW_MS,
): ChannelAuditState {
	const verifiedMs = verifiedAtMs(ch);
	if (Number.isNaN(verifiedMs)) return 'unknown';
	if (verifiedMs > now) return 'unknown';
	return verifiedMs < now - windowMs ? 'due' : 'fresh';
}

/**
 * Select the channels the public page may list (Issue #833).
 *
 * Two independent questions are answered separately:
 *
 *   - DISPLAY validity — is this a channel the operator published and
 *     verified to exist? Answered by `active: true` plus a parseable,
 *     non-future `verified_at`. An `unknown` audit state means the
 *     record cannot confirm validity, so the channel is dropped
 *     (fail-closed).
 *   - AUDIT freshness — how long since that verification? Answered by
 *     {@link auditChannelState}: `due` channels stay listed with a
 *     re-verification note; date age alone never removes a channel.
 *
 * The caller supplies `now` so the test can pin the clock and the
 * route can pass the request time deterministically.
 */
export function selectDisplayableChannels(
	input: readonly Channel[],
	now: number,
	windowMs: number = AUDIT_WINDOW_MS,
): AuditedChannel[] {
	const out: AuditedChannel[] = [];
	for (const ch of input) {
		if (!ch.active) continue;
		const state = auditChannelState(ch, now, windowMs);
		if (state === 'unknown') continue;
		out.push({ channel: ch, audit: state, verifiedDaysAgo: daysSinceVerified(ch, now) });
	}
	// Stable order: most-recently verified first, then id ascending.
	return out.sort((a, b) => {
		const va = verifiedAtMs(a.channel);
		const vb = verifiedAtMs(b.channel);
		if (vb !== va) return vb - va;
		return a.channel.id.localeCompare(b.channel.id);
	});
}

/**
 * Count ACTIVE channels whose audit state is `unknown` — records that
 * cannot confirm the channel was ever verified. The public page uses
 * this to distinguish "no channels exist" from "channels exist but
 * none can be confirmed" (Issue #833). Inactive channels are not
 * counted: the operator already retired them.
 */
export function countUnauditableChannels(input: readonly Channel[], now: number): number {
	let count = 0;
	for (const ch of input) {
		if (!ch.active) continue;
		if (auditChannelState(ch, now) === 'unknown') count += 1;
	}
	return count;
}

/**
 * Days since `verified_at` — exposed for UI display ("verified N days ago").
 * Negative values mean `verified_at` is in the future relative to `now`
 * (which {@link auditChannelState} reports as `unknown`, never displayed).
 */
export function daysSinceVerified(ch: Channel, now: number): number {
	const verifiedMs = verifiedAtMs(ch);
	if (Number.isNaN(verifiedMs)) return Number.NaN;
	return Math.floor((now - verifiedMs) / (24 * 60 * 60 * 1000));
}
