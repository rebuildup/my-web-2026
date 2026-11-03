/**
 * YouTube facade contract (Issue #870).
 *
 * What this module owns
 * ---------------------
 * The legacy Portfolio corpus records its videos as **links**, not as
 * files: `docs/migration/portfolio-2025-inventory.json` finds 0 mp4 /
 * webm rows among the 297 migrated media rows, and 44 `content_assets`
 * rows of type `video/youtube`. `scripts/seed-portfolio-path-a.mjs`
 * therefore stores each YouTube URL as a `portfolio_link` row whose
 * `kind` is `video` (`linkKindFromUrl`), which is why no migration and
 * no new column are needed here.
 *
 * The shipped surface rendered those rows only in the §07 Links list,
 * so a project whose whole point is a motion video showed a still
 * thumbnail and a bare URL. This module is the decision seam between
 * "a stored string" and "a URL this page will put inside an iframe":
 *
 *   1. **Only three shapes are recognised** — `youtube.com/watch?v=`,
 *      `youtu.be/<id>` and `<host>/embed/<id>`. Everything else is
 *      refused, including `shorts/`, `playlist`, `channel`, and a bare
 *      `watch?v=` without a host.
 *   2. **The id is validated as an id**, `/^[A-Za-z0-9_-]{11}$/`, and
 *      the embed URL is BUILT from it. A stored URL is never copied
 *      into `iframe.src`, so a stored string cannot carry a query
 *      parameter, a `javascript:` scheme, a lookalike host or an
 *      `autoplay` flag into the frame.
 *   3. **The embed origin is `youtube-nocookie.com`**, always https.
 *      `autoplay` is never added: the visitor pressed a button, they
 *      did not ask for sound.
 *
 * Fail closed, not fail visible
 * -----------------------------
 * A link this module cannot understand is not an error the page
 * reports — it is a link the page renders as a link, exactly as it did
 * before this Issue. The failure mode of "refuse" is the old surface;
 * the failure mode of "guess" would be an arbitrary third-party frame.
 *
 * Dependency-free (no React, no DOM), so the tests can exercise it and
 * `PortfolioVideoFacade` is the only place that turns its output into
 * markup.
 */

import type { PortfolioLink } from './schema';

/** The public id grammar YouTube uses. Exactly 11 characters. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Hosts whose URL shapes this module understands.
 *
 * An exact set, not a suffix test: `youtube.com.example.test` must not
 * pass, and `endsWith('.youtube.com')` would also have to special-case
 * the bare apex. The set mirrors the classifier the seed already uses
 * (`linkKindFromUrl`), so the write path and the read path agree about
 * which links are videos.
 */
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'youtu.be',
	'www.youtu.be',
	'youtube-nocookie.com',
	'www.youtube-nocookie.com',
]);

/** The longest stored string this module will even parse. */
const MAX_URL_LENGTH = 2048;

/**
 * The parts of a facade the detail page needs, derived once from a
 * stored link.
 */
export interface PortfolioVideo {
	/** The 11-character public id. */
	id: string;
	/** The `portfolio_link` row this was derived from. */
	link: PortfolioLink;
	/** `https://www.youtube-nocookie.com/embed/<id>` — built, never stored. */
	embedUrl: string;
	/** `https://www.youtube.com/watch?v=<id>` — the no-JavaScript path. */
	watchUrl: string;
}

/**
 * Extract the public id from a stored YouTube URL, or `null`.
 *
 * Accepts:
 *   - `https://www.youtube.com/watch?v=<id>` (also `m.` / bare apex;
 *     extra query parameters are ignored, because the id is what the
 *     frame is built from and nothing else is carried over)
 *   - `https://youtu.be/<id>`
 *   - `https://www.youtube.com/embed/<id>` and
 *     `https://www.youtube-nocookie.com/embed/<id>`
 *
 * Refuses everything else. `http:` is accepted (the legacy corpus
 * contains both) but never re-emitted: the embed and watch URLs this
 * module builds are https.
 */
export function parseYouTubeVideoId(input: string): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

	const host = url.hostname.toLowerCase();
	if (!YOUTUBE_HOSTS.has(host)) return null;

	// `youtu.be/<id>` — the path is the id and nothing else may follow.
	if (host === 'youtu.be' || host === 'www.youtu.be') {
		return idFromPath(url.pathname, 1);
	}

	// `/embed/<id>` on any accepted host.
	const embedId = idFromPath(url.pathname, 2, '/embed/');
	if (embedId !== null) return embedId;

	// `/watch?v=<id>` on a youtube.com host.
	if (url.pathname === '/watch') {
		const candidate = url.searchParams.get('v');
		if (candidate === null) return null;
		return isVideoId(candidate) ? candidate : null;
	}

	return null;
}

/**
 * Read `<segment>/<id>` out of a pathname, or `null`.
 *
 * `expectedSegments` is the count of non-empty path segments. The
 * prefix form (`/embed/`) is checked before the id so `/shorts/<id>`
 * and `/live/<id>` cannot slip through as "some path with an id".
 */
function idFromPath(pathname: string, expectedSegments: number, prefix?: string): string | null {
	if (prefix !== undefined && !pathname.startsWith(prefix)) return null;
	const segments = pathname.split('/').filter((segment) => segment.length > 0);
	if (segments.length !== expectedSegments) return null;
	const candidate = segments[segments.length - 1];
	if (candidate === undefined) return null;
	return isVideoId(candidate) ? candidate : null;
}

function isVideoId(candidate: string): boolean {
	return YOUTUBE_VIDEO_ID_PATTERN.test(candidate);
}

/** The privacy-preserving embed origin for a validated id. */
export function composeVideoEmbedUrl(id: string): string {
	return `https://www.youtube-nocookie.com/embed/${id}`;
}

/** The plain watch URL, for visitors who did not activate the frame. */
export function composeVideoWatchUrl(id: string): string {
	return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * The first `kind: 'video'` link whose URL parses, as a facade.
 *
 * One facade per project on purpose: the first viewport has one
 * representative motion surface (the cover is the still one). Later
 * video links stay in §07 Links, where they are already rendered.
 */
export function selectPortfolioVideo(links: readonly PortfolioLink[]): PortfolioVideo | null {
	for (const link of links) {
		if (link.kind !== 'video') continue;
		const id = parseYouTubeVideoId(link.url);
		if (id === null) continue;
		return {
			id,
			link,
			embedUrl: composeVideoEmbedUrl(id),
			watchUrl: composeVideoWatchUrl(id),
		};
	}
	return null;
}
