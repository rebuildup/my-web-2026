/**
 * GitHub activity — live snapshot selection (Issues #316 / #319 /
 * #932).
 *
 * Two sources can hold the snapshot the home renders:
 *
 *   - D1 `github_activity_snapshot` — pushed by the operator sync
 *     job (`scripts/sync-github-activity.mjs --push` →
 *     `PUT /api/v1/activity/github`). Refreshes without a commit,
 *     merge or release.
 *   - the committed `github-activity.json` — the reviewed fallback
 *     and release seed.
 *
 * Selection rule: whichever VALID document observed GitHub most
 * recently wins. "Most recently" is the newest `observedAt` across
 * the document's two source states — the same timestamps the card
 * already displays, so the choice can never contradict what the
 * page claims. An invalid, missing or unreadable D1 row simply
 * loses; the committed artefact is always the floor. Nothing here
 * invents data: both candidates pass the same fail-closed reader
 * (`snapshot.ts`) before either is trusted.
 *
 * This module is imported INSIDE server-function handlers only —
 * it reaches `cloudflare:workers` dynamically, the same pattern as
 * `src/home/presence/load.ts`, so no client bundle ever sees the
 * binding or the committed JSON through this path.
 */

import type { GitHubActivitySnapshot } from './contract';
import { readGitHubActivitySnapshot } from './snapshot';

interface ActivityEnv {
	DB?: D1Database;
}

/** Newest `observedAt` across a snapshot's source states ('' if none). */
function newestObservedAt(snapshot: GitHubActivitySnapshot): string {
	const stamps = [snapshot.sources.public.observedAt, snapshot.sources.private.observedAt].filter(
		(s): s is string => typeof s === 'string',
	);
	return stamps.sort().at(-1) ?? '';
}

/**
 * Pick the fresher of two raw snapshot documents. Both are validated
 * by the fail-closed reader first; `null` means "no usable snapshot"
 * and callers render the unavailable state.
 */
export function selectActivitySnapshot(
	live: unknown,
	committed: unknown,
): GitHubActivitySnapshot | null {
	const committedSnapshot = readGitHubActivitySnapshot(committed);
	const liveSnapshot = readGitHubActivitySnapshot(live);
	if (liveSnapshot) {
		if (!committedSnapshot) return liveSnapshot;
		if (newestObservedAt(liveSnapshot) >= newestObservedAt(committedSnapshot)) {
			return liveSnapshot;
		}
	}
	return committedSnapshot;
}

/**
 * Read the D1 snapshot row. Returns the raw payload string, or
 * `null` on ANY failure — missing binding, missing table (migration
 * not yet applied), missing row, or a transport error. Callers treat
 * `null` as "no live snapshot", never as an error to surface.
 */
export async function readLiveActivityPayload(): Promise<string | null> {
	try {
		const { env } = await import('cloudflare:workers');
		const db = (env as unknown as ActivityEnv).DB;
		if (!db) return null;
		const row = await db
			.prepare('SELECT payload FROM github_activity_snapshot WHERE id = 1')
			.first<{ payload: string }>();
		return typeof row?.payload === 'string' ? row.payload : null;
	} catch {
		return null;
	}
}

/**
 * The snapshot the home should render right now: the D1 document
 * when it is valid and at least as fresh as the committed one,
 * otherwise the committed artefact. Used by both the status card
 * (`activity/load.ts`) and the current-projects selection
 * (`current/load.ts`) so the two surfaces can never disagree about
 * which observation they describe.
 */
export async function readPreferredGitHubActivitySnapshot(): Promise<GitHubActivitySnapshot | null> {
	const { default: committedJson } = await import('./github-activity.json', {
		with: { type: 'json' },
	});
	const payload = await readLiveActivityPayload();
	let live: unknown = null;
	if (payload) {
		try {
			live = JSON.parse(payload);
		} catch {
			live = null;
		}
	}
	return selectActivitySnapshot(live, committedJson);
}
