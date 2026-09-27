import channelsJson from './channels.json' with { type: 'json' };
import {
	ChannelsFileSchema,
	FRESHNESS_WINDOW_MS,
	type Channel,
	filterActiveVerified,
} from './schema';

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
