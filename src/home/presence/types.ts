/**
 * Discord Presence — the shared vocabulary for the owner's Discord
 * presence/activities/Rich Presence/custom status snapshot.
 *
 * This module owns the contract types only. The snapshot itself is a
 * JSON document stored in D1 (`discord_presence_snapshot`), written
 * by `PUT /api/v1/presence/discord` from the operator-side Gateway
 * script `scripts/sync-discord-presence.mjs` (Issue #320). The Worker
 * never calls Discord at runtime. No self-bot, no user-token
 * automation, no scraping, no third-party presence data, no private
 * messages.
 */

export type DiscordPresenceStatus = 'online' | 'idle' | 'dnd' | 'offline' | 'unknown';

/**
 * The canonical presence snapshot the home page reads.
 * All fields are optional in the source JSON; the reader normalises
 * missing/unknown values to the explicit `unknown` state rather than
 * leaving them undefined.
 */
export interface DiscordPresenceSnapshot {
	/**
	 * ISO 8601 instant when the snapshot was generated.
	 * Used for freshness evaluation.
	 */
	generatedAt: string;

	/**
	 * The owner's Discord user ID (snowflake). Used only to assert
	 * the snapshot belongs to the expected account.
	 */
	userId: string;

	/**
	 * The raw presence status from Discord Gateway.
	 * Absent or unrecognised → 'unknown'.
	 */
	status: DiscordPresenceStatus;

	/**
	 * The custom status text the owner set, if any.
	 * Empty string or absent → treated as unconfigured.
	 */
	customStatusText?: string;

	/**
	 * The emoji (unicode or custom) on the custom status, if any.
	 * Format: "😀" or "<:name:id>" or "<a:name:id>" for animated.
	 */
	customStatusEmoji?: string;

	/**
	 * Custom status expiration timestamp (ISO 8601), if set.
	 * Absent → no expiration configured.
	 */
	customStatusExpiresAt?: string;

	/**
	 * Activities currently attached to the presence (Rich Presence,
	 * game, application, streaming, etc.).
	 * Empty array → no activities observed at snapshot time.
	 */
	activities: readonly DiscordActivity[];

	/**
	 * The client/platform the presence was observed from, if available.
	 * e.g. "desktop", "web", "mobile".
	 */
	client?: string;

	/**
	 * Whether the snapshot was generated from a live Gateway connection
	 * (true) or from a REST fallback / cached state (false).
	 * The operator script decides which path produced the file.
	 */
	isLive: boolean;
}

/**
 * One activity entry from Discord's presence payload.
 * Mirrors the subset of fields the public display surface may need.
 */
export interface DiscordActivity {
	/**
	 * Activity type per Discord API:
	 * 0 = Game, 1 = Streaming, 2 = Listening, 3 = Watching,
	 * 4 = Custom, 5 = Competing.
	 */
	type: number;

	/**
	 * The activity name (e.g. "Visual Studio Code", "Spotify", "GitHub").
	 */
	name: string;

	/**
	 * Optional detail line (e.g. file being edited, song title).
	 */
	details?: string;

	/**
	 * Optional state line (e.g. "Debugging", "Paused", "In a lobby").
	 */
	state?: string;

	/**
	 * Timestamps for the activity (start/end).
	 */
	timestamps?: {
		start?: string;
		end?: string;
	};

	/**
	 * Rich Presence assets (large/small image keys + text).
	 */
	assets?: {
		largeImage?: string;
		largeText?: string;
		smallImage?: string;
		smallText?: string;
	};

	/**
	 * The application ID this activity belongs to (for Rich Presence).
	 */
	applicationId?: string;

	/**
	 * Whether this activity is the "primary" one shown in the profile.
	 * Only one activity per presence has this flag.
	 */
	isPrimary?: boolean;

	/**
	 * URL for streaming activities (type 1).
	 */
	url?: string;

	/**
	 * Session ID for the activity (used for Rich Presence party).
	 */
	sessionId?: string;

	/**
	 * Party information (size, max).
	 */
	party?: {
		id?: string;
		size?: [number, number];
	};

	/**
	 * Flags bitfield (e.g. instance, join, spectate, sync, play).
	 */
	flags?: number;
}

/**
 * The projection shape the home status section consumes.
 * This is the "card" the UI renders — derived from the snapshot with
 * explicit fallbacks for every unknown/unconfigured state.
 */
export interface DiscordPresenceCard {
	/**
	 * Human-readable status label for the badge.
	 * Always present — never undefined.
	 */
	statusLabel: string;

	/**
	 * Semantic tone for the status badge.
	 * 'accent' for online/idle/dnd, 'neutral' for offline/unknown.
	 */
	statusTone: 'accent' | 'neutral';

	/**
	 * The custom status line, if configured.
	 * Null when unconfigured/empty.
	 */
	customStatus: {
		text: string;
		emoji?: string;
		expiresAt?: string;
	} | null;

	/**
	 * The primary activity to display (Rich Presence, game, etc.).
	 * Null when no activities observed.
	 */
	primaryActivity: {
		typeLabel: string;
		name: string;
		details?: string;
		state?: string;
		assets?: {
			largeImage?: string;
			largeText?: string;
			smallImage?: string;
			smallText?: string;
		};
		timestamps?: {
			start?: string;
			end?: string;
		};
		applicationId?: string;
		url?: string;
	} | null;

	/**
	 * Additional activities beyond the primary one.
	 * Empty array when none.
	 */
	additionalActivities: readonly {
		typeLabel: string;
		name: string;
		details?: string;
		state?: string;
	}[];

	/**
	 * Freshness metadata for the "observed at" display.
	 */
	freshness: {
		generatedAt: string;
		isStale: boolean;
		isLive: boolean;
	};

	/**
	 * Whether the snapshot exists and was readable.
	 * False → the whole card degrades to "unconfigured" state.
	 */
	available: boolean;
}

/**
 * Result of reading the stored snapshot document.
 * Fail-closed: any read/parse/validation failure returns an error
 * variant with a reason code; the caller must not invent data.
 */
export type DiscordPresenceReadResult =
	| { ok: true; snapshot: DiscordPresenceSnapshot }
	| {
			ok: false;
			reason: 'missing' | 'parse' | 'schema' | 'stale' | 'mismatch';
			message: string;
	  };

/**
 * Configuration for the snapshot reader.
 */
export interface DiscordPresenceReaderConfig {
	/**
	 * Expected owner Discord user ID (snowflake). Used for
	 * ownership validation — a snapshot for a different account
	 * is treated as mismatch.
	 */
	expectedUserId: string;

	/**
	 * Maximum age in milliseconds before a snapshot is considered stale.
	 * Default: 15 minutes (900_000 ms).
	 */
	maxAgeMs: number;
}

/**
 * Activity type label mapping (Discord API type → display label).
 */
export const ACTIVITY_TYPE_LABELS: Record<number, string> = {
	0: 'Playing',
	1: 'Streaming',
	2: 'Listening to',
	3: 'Watching',
	4: 'Custom status',
	5: 'Competing in',
};

/**
 * Status label mapping for display.
 */
export const PRESENCE_STATUS_LABELS: Record<DiscordPresenceStatus, string> = {
	online: 'Online',
	idle: 'Idle',
	dnd: 'Do Not Disturb',
	offline: 'Offline',
	unknown: 'Unknown',
};

/**
 * Status tone mapping for badge styling.
 */
export const PRESENCE_STATUS_TONES: Record<DiscordPresenceStatus, 'accent' | 'neutral'> = {
	online: 'accent',
	idle: 'accent',
	dnd: 'accent',
	offline: 'neutral',
	unknown: 'neutral',
};
