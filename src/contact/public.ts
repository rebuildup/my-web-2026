import channelsJson from './channels.json' with { type: 'json' };
import {
	AUDIT_WINDOW_MS,
	type AuditedChannel,
	type Channel,
	ChannelsFileSchema,
	type DisplayableAuditState,
	type Purpose,
	countUnauditableChannels,
	selectDisplayableChannels,
} from './schema';

/**
 * The channel shape the public page receives (Issue #1009).
 *
 * `Channel` carries operator fields — `active` (the publish switch)
 * and `verified_at` (the freshness gate input). The route loader
 * serialises whatever it returns into the `$_TSR` hydration payload,
 * so handing the page the raw record would publish internal schema
 * field names to every visitor. The projection below keeps exactly
 * what `ContactPage` renders and precomputes the one derived value
 * (`verifiedDaysAgo`) the page used to compute from `verified_at`.
 */
export interface PublicContactChannel {
	readonly id: string;
	readonly label: string;
	readonly labelEn: string;
	readonly purpose: Purpose;
	readonly url: string;
	readonly verifiedDaysAgo: number;
	/**
	 * Audit freshness (Issue #833): `fresh` inside the audit window,
	 * `due` past it. `due` rows stay listed with a re-verification
	 * note — date age alone never removes a verified channel.
	 */
	readonly audit: DisplayableAuditState;
}

/**
 * `/contact` public surface (Issue #103).
 *
 * Channel data lives in `src/contact/channels.json` (repo-controlled).
 * The file is imported at build time and validated through the same
 * Zod schema used by tests. Filtering (active + verified_at gate)
 * happens at render time against the request's `Date.now()` so the
 * freshness contract holds without a per-channel cron.
 *
 * Why this module exists:
 *   - The route file is the framework contract (`createFileRoute`)
 *     and SHOULD stay thin.
 *   - The page composition (`ContactPage`) is the presentational
 *     concern; it reads the result of this module through the
 *     loader, not the raw JSON.
 *   - Tests can import this module directly to assert the schema
 *     + filter behaviour without dragging the Router into Vitest.
 */

const parsed = ChannelsFileSchema.safeParse(channelsJson);
if (!parsed.success) {
	// Fail at module-evaluation time (SSR Worker boot) if the file
	// is malformed — better than silent broken pages.
	throw new Error(`[contact] channels.json failed schema validation:\n${parsed.error.message}`);
}

export const RAW_CHANNELS: readonly Channel[] = parsed.data.channels;

/**
 * Resolve the channels that should be displayed RIGHT NOW.
 *
 * Display validity and audit freshness are separate contracts
 * (Issue #833): `active` channels with a confirmable `verified_at`
 * are listed even when the audit window has elapsed (`due`); only
 * inactive channels and records that cannot confirm verification
 * (`unknown`) are excluded.
 */
export function getVisibleChannels(now: number = Date.now()): AuditedChannel[] {
	return selectDisplayableChannels(RAW_CHANNELS, now, AUDIT_WINDOW_MS);
}

/**
 * The public projection of {@link getVisibleChannels} — the only
 * channel shape the `/contact` loader may return (Issue #1009).
 */
export function getVisiblePublicChannels(now: number = Date.now()): PublicContactChannel[] {
	return getVisibleChannels(now).map(({ channel, audit, verifiedDaysAgo }) => ({
		id: channel.id,
		label: channel.label,
		labelEn: channel.labelEn,
		purpose: channel.purpose,
		url: channel.url,
		verifiedDaysAgo,
		audit,
	}));
}

/**
 * Active channels whose records cannot confirm verification
 * (`unknown` audit). The page uses this count to distinguish
 * "no channels exist" from "channels exist but none are
 * confirmable" in its empty state (Issue #833).
 */
export function getUnauditableChannelCount(now: number = Date.now()): number {
	return countUnauditableChannels(RAW_CHANNELS, now);
}
