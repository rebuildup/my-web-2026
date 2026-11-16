#!/usr/bin/env node
/**
 * sync-discord-presence — push the owner's Discord presence to the site.
 *
 * Issue #320. A Cloudflare Worker cannot hold a Gateway WebSocket,
 * so this operator-side process owns the ONLY Discord connection:
 * an official bot account on the Gateway with the privileged
 * `GuildPresences` intent (enable it in the application portal; bots
 * below Discord's verification threshold do not need review). The
 * bot must share at least one guild with the owner, and the owner
 * must not have "hide presence" enabled toward the bot's server.
 *
 * What it does
 * ------------
 * - Subscribes to `presenceUpdate` for `DISCORD_USER_ID` only. Other
 *   guild members' presence is never read, stored or forwarded —
 *   the snapshot contract has no field that could carry it.
 * - Normalizes the presence (status, custom status, activities /
 *   Rich Presence) into the `DiscordPresenceSnapshot` document and
 *   `PUT`s it to `PRESENCE_INGEST_URL` (default
 *   `https://rebuildup.dev/api/v1/presence/discord`) with
 *   `Authorization: Bearer $MY_WEB_2026_API_KEY` — a dedicated
 *   ingest key scoped `discord_presence:write` (see
 *   `docs/runbook/discord-presence.md`).
 * - Re-pushes the re-observed presence every `PRESENCE_REFRESH_MS`
 *   (default 5 min) so `generatedAt` stays inside the reader's
 *   15-minute freshness window while the feed is alive.
 * - `--once` pushes the current presence a single time and exits —
 *   the verification path before installing the long-running mode.
 * - On SIGINT/SIGTERM it pushes one `offline`/`isLive:false`
 *   snapshot (best effort) so the card stops claiming "online"
 *   immediately instead of waiting out the staleness window.
 *
 * Environment (never committed; inject via `infisical run`):
 *   DISCORD_BOT_TOKEN     required — the bot token (secret)
 *   DISCORD_USER_ID       required — owner snowflake the card tracks
 *   MY_WEB_2026_API_KEY   required — ingest API key (secret)
 *   PRESENCE_INGEST_URL   optional — default production ingest URL
 *   PRESENCE_REFRESH_MS   optional — default 300000
 *
 * Output is status-only: no token, key, guild name or third-party
 * presence data is ever printed.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ActivityType, Client, GatewayIntentBits } from 'discord.js';

const INGEST_URL =
	process.env.PRESENCE_INGEST_URL ?? 'https://rebuildup.dev/api/v1/presence/discord';
const REFRESH_MS = Number(process.env.PRESENCE_REFRESH_MS ?? 300_000);
const STATUS_MAP = {
	online: 'online',
	idle: 'idle',
	dnd: 'dnd',
	invisible: 'offline',
	offline: 'offline',
	unknown: 'unknown',
};

function toIso(unixSeconds) {
	return typeof unixSeconds === 'number' && Number.isFinite(unixSeconds)
		? new Date(unixSeconds * 1000).toISOString()
		: undefined;
}

function mapEmoji(emoji) {
	if (!emoji) return undefined;
	if (emoji.id) {
		return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
	}
	return typeof emoji.name === 'string' && emoji.name ? emoji.name : undefined;
}

function mapActivity(activity, isPrimary) {
	const out = {
		type: activity.type,
		name: typeof activity.name === 'string' ? activity.name : 'unknown',
	};
	if (typeof activity.details === 'string' && activity.details) out.details = activity.details;
	if (typeof activity.state === 'string' && activity.state) out.state = activity.state;
	const start = toIso(activity.timestamps?.start);
	const end = toIso(activity.timestamps?.end);
	if (start || end) {
		out.timestamps = {};
		if (start) out.timestamps.start = start;
		if (end) out.timestamps.end = end;
	}
	const assets = activity.assets;
	if (assets && typeof assets === 'object') {
		const mapped = {};
		if (assets.large_image) mapped.largeImage = assets.large_image;
		if (assets.large_text) mapped.largeText = assets.large_text;
		if (assets.small_image) mapped.smallImage = assets.small_image;
		if (assets.small_text) mapped.smallText = assets.small_text;
		if (Object.keys(mapped).length > 0) out.assets = mapped;
	}
	if (typeof activity.applicationId === 'string' && activity.applicationId) {
		out.applicationId = activity.applicationId;
	}
	if (isPrimary) out.isPrimary = true;
	if (typeof activity.url === 'string' && activity.url) out.url = activity.url;
	if (activity.party && typeof activity.party === 'object') {
		const party = {};
		if (typeof activity.party.id === 'string') party.id = activity.party.id;
		if (Array.isArray(activity.party.size) && activity.party.size.length === 2) {
			party.size = activity.party.size;
		}
		if (Object.keys(party).length > 0) out.party = party;
	}
	const flags = activity.flags?.bitfield;
	if (typeof flags === 'number') out.flags = flags;
	return out;
}

/**
 * Normalize a discord.js Presence (or null) into the snapshot
 * document `PUT /api/v1/presence/discord` accepts. Exported for the
 * contract test; `presence === null` yields the offline document.
 */
export function buildSnapshot(presence, { userId, now = new Date(), isLive = true } = {}) {
	const rawActivities = Array.isArray(presence?.activities) ? presence.activities : [];
	const custom = rawActivities.find((a) => a.type === ActivityType.Custom);
	const others = rawActivities.filter((a) => a.type !== ActivityType.Custom).slice(0, 8);

	const snapshot = {
		generatedAt: now.toISOString(),
		userId,
		status: STATUS_MAP[presence?.status] ?? 'unknown',
		activities: others.map((a, i) => mapActivity(a, i === 0)),
		isLive,
	};

	const clientStatus = presence?.clientStatus;
	if (clientStatus && typeof clientStatus === 'object') {
		const platform = Object.keys(clientStatus)[0];
		if (platform) snapshot.client = platform;
	}

	if (custom) {
		if (typeof custom.state === 'string' && custom.state.trim() !== '') {
			snapshot.customStatusText = custom.state;
		}
		const emoji = mapEmoji(custom.emoji);
		if (emoji) snapshot.customStatusEmoji = emoji;
	}

	return snapshot;
}

async function push(snapshot, { ingestUrl, apiKey, log }) {
	try {
		const res = await fetch(ingestUrl, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${apiKey}`,
				// The boundary CSRF guard (`src/http/middleware/csrf.ts`)
				// fails closed on a write with no origin evidence. This
				// is a first-party server-to-server caller, so it
				// declares its own origin exactly like the in-repo
				// callers do.
				origin: new URL(ingestUrl).origin,
			},
			body: JSON.stringify(snapshot),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) {
			log(`push failed: HTTP ${res.status}`);
			return false;
		}
		return true;
	} catch {
		log('push failed: transport error');
		return false;
	}
}

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) {
		console.error(`missing required env: ${name} (see docs/runbook/discord-presence.md)`);
		process.exit(2);
	}
	return value;
}

async function main() {
	const once = process.argv.includes('--once');
	const token = requiredEnv('DISCORD_BOT_TOKEN');
	const userId = requiredEnv('DISCORD_USER_ID');
	const apiKey = requiredEnv('MY_WEB_2026_API_KEY');
	const ingestUrl = process.env.PRESENCE_INGEST_URL ?? INGEST_URL;

	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildPresences],
	});

	const log = (msg) => console.log(`[discord-presence] ${msg}`);

	const findPresence = async () => {
		for (const guild of client.guilds.cache.values()) {
			try {
				const member = await guild.members.fetch(userId);
				if (member?.presence) return member.presence;
			} catch {
				// Member not in this guild or fetch refused — try the next.
			}
		}
		return null;
	};

	const pushCurrent = async (isLive = true) => {
		const presence = await findPresence();
		// A null presence means "no observation" (member not in a
		// mutual guild, fetch refused, intent not delivering) — NOT
		// "offline". Pushing it would overwrite a good snapshot with
		// an unknown one, so the refresh path skips instead.
		if (!presence) {
			log('no presence observed — skipping push');
			return;
		}
		const snapshot = buildSnapshot(presence, { userId, isLive });
		const ok = await push(snapshot, { ingestUrl, apiKey, log });
		if (ok) log(`pushed status=${snapshot.status} activities=${snapshot.activities.length}`);
	};

	client.on('presenceUpdate', (_old, next) => {
		const uid = next?.userId ?? next?.user?.id;
		if (uid !== userId) return;
		const snapshot = buildSnapshot(next, { userId });
		push(snapshot, { ingestUrl, apiKey, log }).then((ok) => {
			if (ok) log(`event push status=${snapshot.status}`);
		});
	});

	let refreshTimer = null;
	const shutdown = async (signal) => {
		log(`${signal} — pushing offline snapshot`);
		if (refreshTimer) clearInterval(refreshTimer);
		await push(buildSnapshot(null, { userId, isLive: false }), {
			ingestUrl,
			apiKey,
			log,
		});
		client.destroy();
		process.exit(0);
	};
	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));

	client.once('clientReady', async () => {
		log(`ready — tracking user ${userId}`);
		await pushCurrent();
		if (once) {
			client.destroy();
			process.exit(0);
		}
		refreshTimer = setInterval(() => void pushCurrent(), REFRESH_MS);
		refreshTimer.unref?.();
	});

	await client.login(token);
}

// Compare REAL paths: on macOS temp dirs live under /var →
// /private/var, so import.meta.url and argv[1] can differ textually
// while naming the same file — a textual compare silently skips main.
const isMain =
	process.argv[1] &&
	realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
	main().catch((err) => {
		console.error(`sync-discord-presence failed: ${err?.message ?? err}`);
		process.exit(1);
	});
}
