import channelsJson from './channels.json' with { type: 'json' };
import {
	type Channel,
	ChannelsFileSchema,
	FRESHNESS_WINDOW_MS,
	type Purpose,
	daysSinceVerified,
	filterActiveVerified,
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
 * Fail-closed: an unverified / inactive channel is dropped before
 * the page ever sees it.
 */
export function getVisibleChannels(now: number = Date.now()): Channel[] {
	return filterActiveVerified(RAW_CHANNELS, now, FRESHNESS_WINDOW_MS);
}

/**
 * The public projection of {@link getVisibleChannels} — the only
 * channel shape the `/contact` loader may return (Issue #1009).
 */
export function getVisiblePublicChannels(now: number = Date.now()): PublicContactChannel[] {
	return getVisibleChannels(now).map((channel) => ({
		id: channel.id,
		label: channel.label,
		labelEn: channel.labelEn,
		purpose: channel.purpose,
		url: channel.url,
		verifiedDaysAgo: daysSinceVerified(channel, now),
	}));
}
