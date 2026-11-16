/**
 * Discord Presence — fail-closed snapshot reader.
 *
 * Reads the committed JSON snapshot produced by the operator script.
 * Any failure (missing file, parse error, schema mismatch, stale data,
 * user ID mismatch) returns a typed error variant — the caller must
 * not invent data.
 */

import {
	ACTIVITY_TYPE_LABELS,
	type DiscordPresenceCard,
	type DiscordPresenceReadResult,
	type DiscordPresenceReaderConfig,
	type DiscordPresenceSnapshot,
	PRESENCE_STATUS_LABELS,
	PRESENCE_STATUS_TONES,
} from './types';

export type {
	DiscordPresenceCard,
	DiscordPresenceSnapshot,
	DiscordPresenceReadResult,
	DiscordPresenceReaderConfig,
};

const DEFAULT_SNAPSHOT_PATH = 'src/home/presence/discord-presence.json';
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

const VALID_STATUSES = ['online', 'idle', 'dnd', 'offline', 'unknown'] as const;

function isValidStatus(value: unknown): value is (typeof VALID_STATUSES)[number] {
	return (
		typeof value === 'string' && VALID_STATUSES.includes(value as (typeof VALID_STATUSES)[number])
	);
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number';
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function isArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

/**
 * Validates a parsed JSON object against the DiscordPresenceSnapshot shape.
 * Returns the validated snapshot or throws with a reason code.
 */
function validateSnapshot(data: unknown, expectedUserId: string): DiscordPresenceSnapshot {
	if (!isObject(data)) {
		throw { reason: 'schema' as const, message: 'Snapshot is not an object' };
	}

	const obj = data;

	// generatedAt (required)
	if (!isString(obj.generatedAt) || !obj.generatedAt) {
		throw { reason: 'schema' as const, message: 'Missing or invalid generatedAt' };
	}
	const generatedAt = obj.generatedAt;

	// userId (required)
	if (!isString(obj.userId) || !obj.userId) {
		throw { reason: 'schema' as const, message: 'Missing or invalid userId' };
	}
	if (obj.userId !== expectedUserId) {
		throw {
			reason: 'mismatch' as const,
			message: `Snapshot userId ${obj.userId} does not match expected ${expectedUserId}`,
		};
	}

	// status (required, normalized)
	let status: (typeof VALID_STATUSES)[number] = 'unknown';
	if (isValidStatus(obj.status)) {
		status = obj.status;
	}

	// customStatusText (optional)
	const customStatusText = isString(obj.customStatusText) ? obj.customStatusText : undefined;

	// customStatusEmoji (optional)
	const customStatusEmoji = isString(obj.customStatusEmoji) ? obj.customStatusEmoji : undefined;

	// customStatusExpiresAt (optional)
	const customStatusExpiresAt = isString(obj.customStatusExpiresAt)
		? obj.customStatusExpiresAt
		: undefined;

	// activities (optional, default empty array)
	let activities: DiscordPresenceSnapshot['activities'] = [];
	if (isArray(obj.activities)) {
		activities = obj.activities
			.filter(isObject)
			.map((a) => {
				const rawTimestamps = a.timestamps;
				const timestamps = isObject(rawTimestamps)
					? {
							start: isString(rawTimestamps.start) ? rawTimestamps.start : undefined,
							end: isString(rawTimestamps.end) ? rawTimestamps.end : undefined,
						}
					: undefined;

				const rawAssets = a.assets;
				const assets = isObject(rawAssets)
					? {
							largeImage: isString(rawAssets.largeImage) ? rawAssets.largeImage : undefined,
							largeText: isString(rawAssets.largeText) ? rawAssets.largeText : undefined,
							smallImage: isString(rawAssets.smallImage) ? rawAssets.smallImage : undefined,
							smallText: isString(rawAssets.smallText) ? rawAssets.smallText : undefined,
						}
					: undefined;

				const rawParty = a.party;
				const party = isObject(rawParty)
					? {
							id: isString(rawParty.id) ? rawParty.id : undefined,
							size:
								isArray(rawParty.size) &&
								rawParty.size.length === 2 &&
								isNumber(rawParty.size[0]) &&
								isNumber(rawParty.size[1])
									? ([rawParty.size[0], rawParty.size[1]] as [number, number])
									: undefined,
						}
					: undefined;

				return {
					type: isNumber(a.type) ? a.type : 0,
					name: isString(a.name) && a.name ? a.name : 'Unknown Activity',
					details: isString(a.details) ? a.details : undefined,
					state: isString(a.state) ? a.state : undefined,
					timestamps,
					assets,
					applicationId: isString(a.applicationId) ? a.applicationId : undefined,
					isPrimary: isBoolean(a.isPrimary) ? a.isPrimary : undefined,
					url: isString(a.url) ? a.url : undefined,
					sessionId: isString(a.sessionId) ? a.sessionId : undefined,
					party,
					flags: isNumber(a.flags) ? a.flags : undefined,
				};
			})
			.filter((a) => a.name !== 'Unknown Activity' || a.type !== 0 || a.details || a.state);
	}

	// client (optional)
	const client = isString(obj.client) ? obj.client : undefined;

	// isLive (optional, default false)
	const isLive = isBoolean(obj.isLive) ? obj.isLive : false;

	return {
		generatedAt,
		userId: obj.userId,
		status,
		customStatusText,
		customStatusEmoji,
		customStatusExpiresAt,
		activities,
		client,
		isLive,
	};
}

/**
 * Checks if a snapshot is stale based on its generatedAt timestamp.
 */
function isStale(generatedAt: string, maxAgeMs: number): boolean {
	const snapshotTime = new Date(generatedAt).getTime();
	if (Number.isNaN(snapshotTime)) {
		return true; // unparseable date → treat as stale
	}
	const now = Date.now();
	return now - snapshotTime > maxAgeMs;
}

/**
 * Projects a validated snapshot to the DiscordPresenceCard shape
 * consumed by the UI.
 */
export function projectToCard(
	snapshot: DiscordPresenceSnapshot,
	maxAgeMs: number,
): DiscordPresenceCard {
	const stale = isStale(snapshot.generatedAt, maxAgeMs);

	// Find primary activity (isPrimary flag or first non-custom activity)
	let primaryActivity = snapshot.activities.find((a) => a.isPrimary === true);
	if (!primaryActivity) {
		// Fallback: first activity that is not type 4 (custom status)
		primaryActivity = snapshot.activities.find((a) => a.type !== 4);
	}
	if (!primaryActivity && snapshot.activities.length > 0) {
		// Final fallback: first activity
		primaryActivity = snapshot.activities[0];
	}

	const additionalActivities = snapshot.activities
		.filter((a) => a !== primaryActivity)
		.map((a) => ({
			typeLabel: ACTIVITY_TYPE_LABELS[a.type] ?? `Type ${a.type}`,
			name: a.name,
			details: a.details,
			state: a.state,
		}));

	return {
		statusLabel: PRESENCE_STATUS_LABELS[snapshot.status],
		statusTone: PRESENCE_STATUS_TONES[snapshot.status],
		customStatus:
			snapshot.customStatusText && snapshot.customStatusText.trim() !== ''
				? {
						text: snapshot.customStatusText,
						emoji: snapshot.customStatusEmoji,
						expiresAt: snapshot.customStatusExpiresAt,
					}
				: null,
		primaryActivity: primaryActivity
			? {
					typeLabel: ACTIVITY_TYPE_LABELS[primaryActivity.type] ?? `Type ${primaryActivity.type}`,
					name: primaryActivity.name,
					details: primaryActivity.details,
					state: primaryActivity.state,
					assets: primaryActivity.assets,
					timestamps: primaryActivity.timestamps,
					applicationId: primaryActivity.applicationId,
					url: primaryActivity.url,
				}
			: null,
		additionalActivities,
		freshness: {
			generatedAt: snapshot.generatedAt,
			isStale: stale,
			isLive: snapshot.isLive,
		},
		available: true,
	};
}

/**
 * Reads the raw snapshot content from the given source.
 * In production Workers: reads from the ASSETS binding via fetch.
 * In tests: accepts a provided string.
 */
export interface SnapshotSource {
	read(): Promise<string | null>;
}

/**
 * Creates a snapshot source that reads from a fetchable URL (Worker self-origin).
 */
export function createFetchSnapshotSource(url: string): SnapshotSource {
	return {
		async read() {
			try {
				const response = await fetch(url, { cache: 'no-store' });
				if (!response.ok) {
					return null;
				}
				return await response.text();
			} catch {
				return null;
			}
		},
	};
}

/**
 * Creates a snapshot source for testing with a fixed string.
 */
export function createTestSnapshotSource(content: string | null): SnapshotSource {
	return {
		async read() {
			return content;
		},
	};
}

/**
 * Reads and validates the committed snapshot from a source.
 * Fail-closed: any error returns a typed failure result.
 */
export async function readDiscordPresenceSnapshotFromSource(
	source: SnapshotSource,
	config: Partial<DiscordPresenceReaderConfig> = {},
): Promise<DiscordPresenceReadResult> {
	const expectedUserId = config.expectedUserId ?? '';
	const maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

	if (!expectedUserId) {
		return {
			ok: false,
			reason: 'schema',
			message: 'expectedUserId is required but not configured',
		};
	}

	const raw = await source.read();

	if (raw === null || raw === '') {
		return {
			ok: false,
			reason: 'missing',
			message: 'Snapshot file not found or unreadable',
		};
	}

	if (!isString(raw)) {
		return {
			ok: false,
			reason: 'parse',
			message: 'Snapshot file is not a string',
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			reason: 'parse',
			message: 'Snapshot contains invalid JSON',
		};
	}

	let snapshot: DiscordPresenceSnapshot;
	try {
		snapshot = validateSnapshot(parsed, expectedUserId);
	} catch (err) {
		if (isObject(err) && 'reason' in err && 'message' in err) {
			const reason = err.reason;
			const message = err.message;
			if (
				isString(reason) &&
				isString(message) &&
				['missing', 'parse', 'schema', 'stale', 'mismatch'].includes(reason)
			) {
				return {
					ok: false,
					reason: reason as 'missing' | 'parse' | 'schema' | 'stale' | 'mismatch',
					message,
				};
			}
		}
		return {
			ok: false,
			reason: 'schema',
			message: 'Snapshot validation failed with unknown error',
		};
	}

	// Check staleness after validation
	if (isStale(snapshot.generatedAt, maxAgeMs)) {
		return {
			ok: false,
			reason: 'stale',
			message: `Snapshot is older than ${maxAgeMs}ms`,
		};
	}

	return { ok: true, snapshot };
}

/**
 * Convenience: read + project in one call.
 * Returns the card (available=true) or the unavailable card (available=false).
 */
export async function loadDiscordPresenceCardFromSource(
	source: SnapshotSource,
	config: Partial<DiscordPresenceReaderConfig> = {},
): Promise<DiscordPresenceCard> {
	const result = await readDiscordPresenceSnapshotFromSource(source, config);

	if (!result.ok) {
		return {
			statusLabel: PRESENCE_STATUS_LABELS.unknown,
			statusTone: PRESENCE_STATUS_TONES.unknown,
			customStatus: null,
			primaryActivity: null,
			additionalActivities: [],
			freshness: {
				generatedAt: new Date().toISOString(),
				isStale: true,
				isLive: false,
			},
			available: false,
		};
	}

	return projectToCard(result.snapshot, config.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
}
