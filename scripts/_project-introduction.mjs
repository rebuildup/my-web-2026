/**
 * Project introduction sync — pure policy and Markdown extraction.
 *
 * What this module owns
 * ---------------------
 * A public introduction page for an upstream repository is derived from
 * that repository's PUBLIC README. This module is the boundary between
 * "the upstream document" and "the text this site publishes":
 *
 *   1. an explicit SOURCE ALLOWLIST — three GitHub API reads for one
 *      fixed public repository (metadata, default-branch commit, README
 *      blob at that commit). No request is built from visitor input, no
 *      submodule is traversed, no arbitrary path is joined, and no
 *      credential is ever attached;
 *   2. a deterministic EXTRACTION — a small, named set of README
 *      sections becomes a structured introduction. The raw document is
 *      NOT republished: setup commands, secret model, machine-local
 *      identity and generated configuration stay on the canonical
 *      README;
 *   3. SANITIZATION — Markdown-embedded HTML is stripped, script/style
 *      bodies are removed, unsafe link schemes are dropped, and the
 *      result is a JSON tree of TEXT + validated hrefs. There is no
 *      HTML string anywhere in the output, so the page cannot execute
 *      embedded markup;
 *   4. RESOLUTION — relative links, images and `#anchor`s are resolved
 *      against the exact source commit, so a stale link cannot look
 *      current;
 *   5. PROVENANCE + FRESHNESS — target ref, commit SHA, README blob
 *      SHA, last verified instant, last applied instant and a content
 *      digest. An unchanged fetch does not rewrite the snapshot; a
 *      failed fetch never overwrites the last known introduction.
 *
 * Why a committed snapshot instead of a runtime fetch
 * ---------------------------------------------------
 * `docs/domain/integrations.md` records GitHub as not integrated, and
 * `src/external-api/**` is deliberately unwired. An always-on Worker
 * call for this page would add an outbound dependency, a rate-limit
 * failure mode and a per-visitor privacy surface to a static document.
 * The sync runs offline (operator) or in a scheduled workflow and
 * commits the result, so the shipped page makes no outbound request.
 *
 * Consumers
 * ---------
 *   - `scripts/sync-project-introductions.mjs` (fetch / write / check)
 *   - `scripts/_project-introduction.test.mjs` (node:test fixtures)
 *   - `scripts/check-project-introductions.mjs` (offline fast gate)
 *
 * Everything here is pure except `fetchSourceSnapshot`, which takes its
 * `fetch` implementation as an argument so tests never open a socket.
 */

import { createHash } from 'node:crypto';

/** Snapshot shape version. Bump on a breaking shape change. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** The only host the sync may read from. */
export const ALLOWED_API_ORIGIN = 'https://api.github.com';

/**
 * Closed failure vocabulary written into an unavailable snapshot.
 *
 * Every entry describes a SOURCE STATE that makes the document
 * unusable: the repository is gone, private, archived, no longer on the
 * tracked branch, or the README at the resolved commit cannot be parsed
 * into the allowlisted shape. Transport problems (timeout, rate limit,
 * 5xx, truncated or non-JSON body) are not in this list: they are
 * `ProjectSourceTransportError`, so a transient GitHub failure can
 * never publish "this repository is not public".
 */
export const UNAVAILABLE_REASONS = Object.freeze([
	'not-found',
	'not-public',
	'archived',
	'ref-mismatch',
	'readme-shape',
]);

/** Upper bounds that keep one response from becoming an unbounded input. */
export const LIMITS = Object.freeze({
	metadataBytes: 64 * 1024,
	commitBytes: 64 * 1024,
	readmeBytes: 512 * 1024,
	readmeCharacters: 200_000,
	leadCharacters: 800,
	sectionSummaryCharacters: 600,
	pointCharacters: 320,
	sectionPoints: 8,
	relatedRepositories: 5,
	structureEntries: 16,
});

/**
 * The explicit allowlist. A source is a fixed public repository plus
 * the exact API reads needed to pin one README revision.
 *
 * Adding a source is a reviewable change to this table (and to the
 * source-specific section plan below), never a caller-supplied URL.
 */
export const PROJECT_SOURCES = Object.freeze({
	dotfiles: Object.freeze({
		id: 'dotfiles',
		owner: 'rebuildup',
		repo: 'dotfiles',
		ref: 'main',
		readmePath: 'README.md',
		canonicalUrl: 'https://github.com/rebuildup/dotfiles',
		readmeUrl: 'https://github.com/rebuildup/dotfiles/blob/main/README.md',
	}),
});

/** `dotfiles` is the only source this ticket ships. */
export const DEFAULT_SOURCE_ID = 'dotfiles';

/** A snapshot older than this is displayed as "not current". */
export const MAX_AGE_HOURS = 14 * 24;

/**
 * An unchanged source is re-verified into the snapshot at most once a
 * week. This keeps `verifiedAt` truthful without committing every day:
 * the scheduled workflow runs daily, but it only writes when the source
 * changed OR this heartbeat is due. `MAX_AGE_HOURS` is twice the
 * heartbeat, so a stopped workflow has a two-week margin before the
 * page declares itself stale.
 */
export const HEARTBEAT_HOURS = 7 * 24;

/** Bound on one fetch so a hung request cannot hold the workflow. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Closed failure class for a source that is no longer usable. */
export class ProjectSourceUnavailable extends Error {
	/**
	 * @param {string} reason one of `UNAVAILABLE_REASONS`
	 * @param {string} detail status-only detail (never a response body)
	 */
	constructor(reason, detail) {
		super(detail ? `${reason}: ${detail}` : reason);
		this.name = 'ProjectSourceUnavailable';
		this.reason = reason;
	}
}

/** Closed failure class for a transport / usage error (no snapshot write). */
export class ProjectSourceTransportError extends Error {
	constructor(detail) {
		super(detail);
		this.name = 'ProjectSourceTransportError';
	}
}

/** Resolve a source from the allowlist or fail closed. */
export function getProjectSource(sourceId = DEFAULT_SOURCE_ID) {
	const source = PROJECT_SOURCES[sourceId];
	if (!source) {
		throw new ProjectSourceTransportError(`unknown project source: ${sourceId}`);
	}
	return source;
}

/** The three exact URLs one sync may request. */
export function allowedRequestUrls(source) {
	const repository = `/repos/${source.owner}/${source.repo}`;
	return Object.freeze({
		repository: `${ALLOWED_API_ORIGIN}${repository}`,
		commit: `${ALLOWED_API_ORIGIN}${repository}/commits/${source.ref}`,
		readme: `${ALLOWED_API_ORIGIN}${repository}/contents/${source.readmePath}`,
	});
}

/**
 * Prove a URL is one of the allowlisted reads for `source`.
 *
 * This is deliberately an equality check, not a pattern: a query
 * parameter, a different owner, a path traversing out of the repository
 * or an alternate host fails. `ref` is the only permitted search
 * parameter and its value must equal the commit SHA we just resolved.
 */
export function assertAllowedApiUrl(rawUrl, source, { commitSha = null } = {}) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new ProjectSourceTransportError('allowlist: not an absolute URL');
	}
	if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.port !== '') {
		throw new ProjectSourceTransportError('allowlist: host is not api.github.com');
	}
	if (url.username || url.password) {
		throw new ProjectSourceTransportError('allowlist: credentials are not permitted');
	}
	const expected = allowedRequestUrls(source);
	const pathMatches = [expected.repository, expected.commit, expected.readme].includes(
		`${url.origin}${url.pathname}`,
	);
	if (!pathMatches) {
		throw new ProjectSourceTransportError('allowlist: path is not an allowlisted read');
	}
	if (url.hash) {
		throw new ProjectSourceTransportError('allowlist: fragments are not requested');
	}
	if (url.pathname.endsWith(`/contents/${source.readmePath}`)) {
		const keys = [...url.searchParams.keys()];
		if (keys.length !== 1 || keys[0] !== 'ref') {
			throw new ProjectSourceTransportError('allowlist: README read permits only one ref');
		}
		const ref = url.searchParams.get('ref') ?? '';
		if (!isCommitSha(ref) || (commitSha && ref !== commitSha)) {
			throw new ProjectSourceTransportError('allowlist: README ref is not the resolved commit');
		}
		return url;
	}
	if ([...url.searchParams.keys()].length > 0) {
		throw new ProjectSourceTransportError('allowlist: metadata read takes no query');
	}
	return url;
}

/** A 40-character lowercase hex SHA. */
export function isCommitSha(value) {
	return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isIsoInstant(value) {
	if (typeof value !== 'string') return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed);
}

/** Read a JSON response under a byte cap, with no credential attached. */
async function requestJson(fetchImpl, url, { maxBytes, source, commitSha = null, now }) {
	assertAllowedApiUrl(url, source, { commitSha });
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let response;
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			redirect: 'error',
			headers: {
				accept: 'application/vnd.github+json',
				'user-agent': 'my-web-2026-project-introduction-sync',
				// Deliberately no Authorization header: this boundary may
				// only read a public repository. A token would turn a
				// public-source mistake into a private read.
			},
			signal: controller.signal,
		});
	} catch (error) {
		clearTimeout(timer);
		throw new ProjectSourceTransportError(
			`request failed: ${error?.name === 'AbortError' ? 'timeout' : 'network'}`,
		);
	}

	try {
		const status = response.status;
		if (status === 404) {
			throw new ProjectSourceUnavailable(
				'not-found',
				`upstream answered 404 at ${new Date(now).toISOString()}`,
			);
		}
		if (status === 401 || status === 403 || status === 429) {
			// GitHub returns 404 for a private repository to an anonymous
			// client. A 401/403/429 reaching here is an authentication
			// boundary, abuse detection or a rate limit — a TRANSPORT
			// condition. Treating it as a source state would publish
			// "this repository is no longer public" on a transient 403.
			throw new ProjectSourceTransportError(`upstream answered ${status}`);
		}
		if (!response.ok) {
			throw new ProjectSourceTransportError(`upstream answered ${status}`);
		}

		const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);
		if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
			throw new ProjectSourceTransportError('response exceeds byte cap');
		}
		let text;
		try {
			text = await response.text();
		} catch {
			throw new ProjectSourceTransportError('response body could not be read');
		}
		if (Buffer.byteLength(text, 'utf8') > maxBytes) {
			throw new ProjectSourceTransportError('response exceeds byte cap');
		}
		try {
			return JSON.parse(text);
		} catch {
			throw new ProjectSourceTransportError('response is not JSON');
		}
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Validate the repository metadata read.
 *
 * `visibility` is checked rather than inferred from `private`: the
 * page must not publish an archived or now-private repository as
 * current, and the failure has to be a named state, not a crash.
 */
export function validateRepositoryPayload(payload, source) {
	if (!payload || typeof payload !== 'object') {
		throw new ProjectSourceTransportError('repository metadata is not an object');
	}
	const fullName = typeof payload.full_name === 'string' ? payload.full_name.toLowerCase() : '';
	if (fullName !== `${source.owner}/${source.repo}`.toLowerCase()) {
		throw new ProjectSourceUnavailable('not-public', 'repository identity does not match');
	}
	if (payload.private !== false || payload.visibility !== 'public') {
		throw new ProjectSourceUnavailable('not-public', 'repository is not public');
	}
	if (payload.archived === true) {
		throw new ProjectSourceUnavailable('archived', 'repository is archived');
	}
	if (payload.disabled === true) {
		throw new ProjectSourceUnavailable('not-public', 'repository is disabled');
	}
	if (payload.default_branch !== source.ref) {
		throw new ProjectSourceUnavailable('ref-mismatch', 'default branch is not the tracked ref');
	}
	if (typeof payload.html_url !== 'string' || payload.html_url !== source.canonicalUrl) {
		throw new ProjectSourceTransportError('repository URL does not match');
	}
	return {
		fullName: payload.full_name,
		defaultBranch: payload.default_branch,
	};
}

/** Validate the commit read and return its pinned SHA. */
export function validateCommitPayload(payload) {
	if (!payload || typeof payload !== 'object' || !isCommitSha(payload.sha)) {
		throw new ProjectSourceTransportError('commit SHA is missing');
	}
	const committedAt = payload?.commit?.committer?.date ?? payload?.commit?.author?.date;
	if (!isIsoInstant(committedAt)) {
		throw new ProjectSourceTransportError('commit date is missing');
	}
	return { commitSha: payload.sha, committedAt: new Date(committedAt).toISOString() };
}

/**
 * Decode and validate the README contents read.
 *
 * The response is pinned by `ref=<commitSha>`, so `sha` identifies the
 * exact blob the extraction below reads. A `download_url` is never
 * followed: it would be a fourth, unallowlisted request.
 */
export function validateReadmePayload(payload, source) {
	if (!payload || typeof payload !== 'object') {
		throw new ProjectSourceTransportError('README payload is not an object');
	}
	// Everything below is valid JSON that does not describe the README
	// this contract expects AT THE RESOLVED COMMIT. That is a source
	// state (`readme-shape`), not a transport failure: the fetch
	// succeeded, and the page must say that the README changed shape
	// rather than that the repository stopped being public.
	if (payload.type !== 'file' || payload.path !== source.readmePath) {
		throw new ProjectSourceUnavailable('readme-shape', 'README path or type is wrong');
	}
	if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
		throw new ProjectSourceUnavailable('readme-shape', 'README encoding is not base64');
	}
	if (!isCommitSha(payload.sha)) {
		throw new ProjectSourceUnavailable('readme-shape', 'README blob SHA is missing');
	}
	let text;
	try {
		text = Buffer.from(payload.content.replace(/\s+/g, ''), 'base64').toString('utf8');
	} catch {
		throw new ProjectSourceUnavailable('readme-shape', 'README base64 could not be decoded');
	}
	if (text.length === 0) {
		throw new ProjectSourceUnavailable('readme-shape', 'README is empty');
	}
	if (text.length > LIMITS.readmeCharacters) {
		throw new ProjectSourceUnavailable('readme-shape', 'README exceeds character cap');
	}
	return { readmeText: text, readmeBlobSha: payload.sha };
}

/* ------------------------------------------------------------------ *
 * Markdown sanitization / extraction
 * ------------------------------------------------------------------ */

const HTML_BLOCK_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/** Decode the small entity set Markdown prose actually uses. */
export function decodeHtmlEntities(value) {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, code) => {
			const point = Number(code);
			return Number.isInteger(point) && point > 0 && point <= 0x10ffff
				? String.fromCodePoint(point)
				: '';
		})
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
			const point = Number.parseInt(code, 16);
			return Number.isInteger(point) && point > 0 && point <= 0x10ffff
				? String.fromCodePoint(point)
				: '';
		})
		.replace(/&amp;/g, '&');
}

/** Strip raw HTML tags while keeping their text children. */
export function stripHtmlTags(value) {
	return value.replace(/<\/?[a-z][^>]*>/gi, '');
}

/**
 * Normalize a trusted upstream Markdown string before extraction.
 *
 * Script/style bodies are removed WITH their content, not just their
 * tags: a test asserts the payload text of an embedded `<script>` never
 * reaches the snapshot.
 */
export function sanitizeMarkdownSource(value) {
	if (typeof value !== 'string') return '';
	return value
		.replace(/\r\n?/g, '\n')
		.replace(HTML_COMMENT_PATTERN, '')
		.replace(HTML_BLOCK_PATTERN, '')
		.replace(/<\/?[a-z][^>]*>/gi, '');
}

/**
 * GitHub heading anchor slug.
 *
 * Mirrors github-slugger's visible behaviour for the characters this
 * README uses: lowercase, drop punctuation, spaces to hyphens, and
 * append `-1`, `-2`, … for duplicates. It is not a general Markdown
 * implementation; it exists so `#layout` resolves to a real anchor.
 */
export function githubHeadingSlug(value) {
	return decodeHtmlEntities(stripHtmlTags(value))
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.replace(/\s+/g, '-');
}

/** A slugger that assigns unique anchors in document order. */
export function createHeadingSlugger() {
	const seen = new Map();
	return (heading) => {
		const base = githubHeadingSlug(heading);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${count}`;
	};
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * Resolve one Markdown href against the pinned source commit.
 *
 * Returns `null` when the href must not be published. The page renders
 * a link only for a value this function returned, so an unsafe scheme
 * cannot reach an `<a href>` through a second rendering path.
 */
export function resolveSourceHref(rawHref, { source, commitSha }) {
	if (typeof rawHref !== 'string') return null;
	// Control characters are removed before scheme detection so
	// `java\nscript:` cannot hide a scheme from the check below.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the subject of this removal, not an accident.
	const href = rawHref.replace(/[\u0000-\u001f\u007f\s]+/g, '').replace(/^<|>$/g, '');
	if (!href) return null;

	if (href.startsWith('#')) {
		const anchor = href.slice(1);
		return anchor ? `${readmeUrlAt(source, commitSha)}#${anchor}` : readmeUrlAt(source, commitSha);
	}
	if (href.startsWith('//')) {
		const protocolRelative = `https:${href}`;
		return safeExternalUrl(protocolRelative);
	}

	const schemeMatch = href.match(/^([a-z][a-z0-9+.-]*):/i);
	if (schemeMatch) {
		const scheme = `${schemeMatch[1].toLowerCase()}:`;
		if (!SAFE_SCHEMES.has(scheme)) return null;
		if (scheme === 'mailto:') return href;
		return safeExternalUrl(href);
	}

	// A relative link is relative to the directory that contains the
	// README, i.e. the repository root at this commit. A leading `/` is
	// repository-root-absolute in GitHub's renderer, not host-absolute.
	const base = `${source.canonicalUrl}/blob/${commitSha}/`;
	const relative = href.startsWith('/') ? href.slice(1) : href;
	let resolved;
	try {
		resolved = new URL(relative, base);
	} catch {
		return null;
	}
	const expectedPrefix = `${source.canonicalUrl}/blob/${commitSha}/`;
	if (resolved.origin !== 'https://github.com') return null;
	if (!resolved.pathname.startsWith('/rebuildup/')) return null;
	if (!`${resolved.origin}${resolved.pathname}`.startsWith(expectedPrefix)) return null;
	return resolved.toString();
}

function readmeUrlAt(source, commitSha) {
	return `${source.canonicalUrl}/blob/${commitSha}/${source.readmePath}`;
}

function safeExternalUrl(raw) {
	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		if (url.username || url.password) return null;
		const host = url.hostname.toLowerCase();
		if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
			return null;
		}
		// Publication boundary: an operator endpoint named by the source
		// README is not part of a public introduction.
		if (/(^|\.)secrets\./.test(host)) return null;
		if (/^(?:10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) {
			return null;
		}
		if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Resolve a Markdown image to a raw GitHub URL at the pinned commit.
 *
 * The page does not hotlink the image: it renders a link to this URL.
 * That keeps the visitor's browser from issuing a third-party request
 * while still resolving the relative path to the right source byte.
 */
export function resolveSourceImage(rawSrc, { source, commitSha }) {
	if (typeof rawSrc !== 'string') return null;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are the subject of this removal, not an accident.
	const src = rawSrc.replace(/[\u0000-\u001f\u007f\s]+/g, '').replace(/^<|>$/g, '');
	if (!src) return null;
	if (/^https?:\/\//i.test(src)) return safeExternalUrl(src);
	if (src.startsWith('//')) return safeExternalUrl(`https:${src}`);
	if (src.startsWith('#')) return null;
	const base = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commitSha}/`;
	const relative = src.startsWith('/') ? src.slice(1) : src;
	let resolved;
	try {
		resolved = new URL(relative, base);
	} catch {
		return null;
	}
	if (resolved.origin !== 'https://raw.githubusercontent.com') return null;
	if (!resolved.pathname.startsWith(`/${source.owner}/${source.repo}/${commitSha}/`)) return null;
	return resolved.toString();
}

/** Collapse Markdown whitespace without changing the authored words. */
function cleanText(value) {
	return decodeHtmlEntities(stripHtmlTags(value))
		.replace(/`+([^`]+)`+/g, '$1')
		.replace(/`/g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.;:!?])/g, '$1')
		.trim();
}

/**
 * Apply the publication boundary to one plain-text run.
 *
 * The upstream README may name an operator endpoint or a machine-local
 * config path. The introduction describes the role, not the operator's
 * environment, so those details are generalized rather than
 * republished. This runs AFTER inline tokens are merged, because the
 * path may be split across an inline-code token and its surrounding
 * text (`the managed \`~/.gitconfig\``).
 */
export function redactPublicationText(value) {
	return String(value)
		.replace(/https?:\/\/(?:[\w-]+\.)*secrets\.[\w.-]+(?:\/[^\s)]*)?/gi, 'a private endpoint')
		.replace(
			/(?:the\s+)?machine-local\s+~\/\.gitconfig\.local\b/g,
			'a machine-local Git config file',
		)
		.replace(/~\/\.gitconfig\.local\b/g, 'a machine-local Git config file')
		.replace(/(?:the\s+)?managed\s+~\/\.gitconfig\b/g, 'the managed Git config file')
		.replace(/~\/\.gitconfig\b/g, 'the managed Git config file')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Cut rich text at a character budget without splitting a node.
 *
 * The cut prefers a sentence end, then a word boundary, so an excerpt
 * never asserts a half-word as the upstream text.
 */
export function limitRichText(nodes, maxCharacters) {
	const out = [];
	let used = 0;
	let truncated = false;
	for (const node of nodes) {
		if (used >= maxCharacters) {
			truncated = true;
			break;
		}
		const remaining = maxCharacters - used;
		const text = node.text.length > remaining ? node.text.slice(0, remaining).trimEnd() : node.text;
		if (!text) continue;
		if (node.text.length > remaining) truncated = true;
		out.push({ ...node, text });
		used += text.length;
	}
	if (truncated && out.length > 0) {
		const last = out[out.length - 1];
		const trimmed = last.text.replace(/[\s.,;:!?-]+$/, '');
		const sentenceEnd = Math.max(
			trimmed.lastIndexOf('. '),
			trimmed.lastIndexOf('! '),
			trimmed.lastIndexOf('? '),
		);
		const wordEnd = trimmed.lastIndexOf(' ');
		const cut = sentenceEnd >= Math.floor(maxCharacters / 2) ? sentenceEnd + 1 : wordEnd;
		last.text = `${(cut > 0 ? trimmed.slice(0, cut) : trimmed).trimEnd()}…`;
	}
	return out;
}

const INLINE_TOKEN_PATTERN =
	/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)|\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;

/**
 * Convert one Markdown inline run to text + validated links.
 *
 * Images become a link node whose text is the alt text. Raw HTML has
 * already been stripped by `sanitizeMarkdownSource`.
 */
export function toRichText(markdown, { source, commitSha, limit = null } = {}) {
	const value = String(markdown ?? '');
	const nodes = [];
	let cursor = 0;
	const pushText = (text, { code = false, spaceBefore = false } = {}) => {
		const cleaned = cleanText(text);
		if (cleaned) nodes.push(code ? { text: cleaned, code, spaceBefore } : { text: cleaned });
	};

	for (const match of value.matchAll(INLINE_TOKEN_PATTERN)) {
		const index = match.index ?? 0;
		const gap = index > cursor ? value.slice(cursor, index) : '';
		if (gap) pushText(gap);
		const spaceBefore = /\s$/.test(gap);
		cursor = index + match[0].length;

		if (match[1] !== undefined) {
			const alt = redactPublicationText(cleanText(match[1])) || '画像';
			const href = resolveSourceImage(match[2], { source, commitSha });
			nodes.push(href ? { text: alt, href, image: true } : { text: alt });
			continue;
		}
		if (match[3] !== undefined) {
			const label = redactPublicationText(cleanText(match[3]));
			const href = resolveSourceHref(match[4], { source, commitSha });
			if (label) nodes.push(href ? { text: label, href } : { text: label });
			continue;
		}
		const code = match[5] ?? match[6] ?? match[7] ?? match[8] ?? match[9];
		if (code !== undefined) pushText(code, { code: true, spaceBefore });
	}
	if (cursor < value.length) pushText(value.slice(cursor));

	// Drop a node that has no text even after cleanup and merge adjacent
	// text nodes so the JSON stays small and stable.
	const merged = [];
	for (const node of nodes) {
		if (!node.text) continue;
		const previous = merged[merged.length - 1];
		if (previous && !previous.href && !node.href) {
			// An inline-code token is a word, not punctuation. Keep the
			// whitespace the source had before it, otherwise
			// `plaintext \`.env\`` would publish as `plaintext.env`.
			const glue = node.spaceBefore
				? /[(\[{]$/.test(previous.text)
					? ''
					: ' '
				: /^[,.;:!?)\]]/.test(node.text) || /[(\[{]$/.test(previous.text)
					? ''
					: ' ';
			previous.text = `${previous.text}${glue}${node.text}`.replace(/\s+/g, ' ').trim();
		} else {
			merged.push({ ...node });
		}
	}
	const redacted = [];
	for (const node of merged) {
		const text = node.href ? node.text : redactPublicationText(node.text);
		if (!text) continue;
		// Emit only the fields in the published contract. `code` and
		// `spaceBefore` are extraction-local hints.
		const clean = { text };
		if (node.href) clean.href = node.href;
		if (node.image) clean.image = true;
		redacted.push(clean);
	}
	return limit ? limitRichText(redacted, limit) : redacted;
}

/** Plain text of a rich-text tree (used for digests and tests). */
export function richTextToPlainText(nodes) {
	let out = '';
	for (const node of nodes ?? []) {
		if (!node.text) continue;
		const glue = out && !/^[,.;:!?)\]]/.test(node.text) ? ' ' : '';
		out += `${glue}${node.text}`;
	}
	return out;
}

/** Parse ATX headings and their body ranges from sanitized Markdown. */
export function parseHeadings(markdown) {
	const lines = markdown.split('\n');
	const slugger = createHeadingSlugger();
	const headings = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
		if (!match) continue;
		const raw = match[2].trim();
		headings.push({
			level: match[1].length,
			raw,
			text: cleanText(raw),
			slug: slugger(raw),
			line: index,
		});
	}
	return headings;
}

/** Lines of a section body, excluding fenced code blocks. */
function sectionBodyLines(lines, startLine, endLine) {
	const body = [];
	let inFence = false;
	for (let index = startLine + 1; index < endLine; index += 1) {
		const line = lines[index];
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence) body.push(line);
	}
	return body;
}

/** Paragraphs (blank-line separated, non-list, non-heading) in a body. */
function paragraphsOf(lines) {
	const paragraphs = [];
	let current = [];
	const flush = () => {
		if (current.length === 0) return;
		const paragraph = current.join(' ').trim();
		if (paragraph) paragraphs.push(paragraph);
		current = [];
	};
	for (const line of lines) {
		if (!line.trim()) {
			flush();
			continue;
		}
		if (/^#{1,6}\s/.test(line)) {
			flush();
			continue;
		}
		if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
			flush();
			continue;
		}
		if (/^\s*\|/.test(line)) {
			flush();
			continue;
		}
		current.push(line.trim());
	}
	flush();
	return paragraphs;
}

/** Top-level list items (no nested item is published). */
function topLevelBullets(lines) {
	const bullets = [];
	for (const line of lines) {
		const match = line.match(/^[-*+]\s+(.+)$/);
		if (!match) continue;
		bullets.push(match[1].trim());
	}
	return bullets;
}

/**
 * Top-level entries of the README's `Layout` tree.
 *
 * Scoped to the `Layout` section on purpose: a later section may also
 * contain a fenced tree (the agent-configuration block nests children
 * under `agents/`), and treating those children as repository-root
 * entries would misdescribe the layout.
 */
export function extractStructure(markdown) {
	const lines = markdown.split('\n');
	const headings = parseHeadings(markdown);
	const headingIndex = headings.findIndex(
		(heading) => heading.level === 2 && /^Layout$/i.test(heading.text),
	);
	if (headingIndex === -1) return [];
	const heading = headings[headingIndex];
	const next = headings.slice(headingIndex + 1).find((candidate) => candidate.level <= 2);
	const endLine = next?.line ?? lines.length;
	const structure = [];
	let inFence = false;
	for (let index = heading.line + 1; index < endLine; index += 1) {
		const line = lines[index];
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence) continue;
		const match = line.match(/^[├└]──\s+([^\s#]+)/);
		if (!match) continue;
		const name = match[1].replace(/\/$/, '');
		if (!name || name === '.') continue;
		structure.push(name);
		if (structure.length >= LIMITS.structureEntries) break;
	}
	return structure;
}

/**
 * Section plan for `dotfiles`.
 *
 * The list is deliberately an allowlist of TOPICS, not "render the
 * README". Setup steps, the secret model, machine-local identity and
 * generated configuration stay on the canonical README: republishing
 * them here would duplicate instructions whose source of truth is the
 * upstream document (and, for the setup section, would put hostnames
 * and machine-local paths on this site).
 */
const DOTFILES_SECTION_PLAN = Object.freeze([
	Object.freeze({ id: 'principles', match: /^Principles$/i, points: 6 }),
	Object.freeze({ id: 'layout', match: /^Layout$/i, structure: true }),
	Object.freeze({ id: 'agent-launcher', match: /^Agent launcher\b/i, summary: true }),
	Object.freeze({ id: 'agent-configuration', match: /^Agent configuration$/i, summary: true }),
	Object.freeze({
		id: 'decisions-and-research',
		match: /^Decisions and research$/i,
		points: 8,
	}),
]);

/** The section allowlist for each source, used by the offline gate. */
const SECTION_PLANS = Object.freeze({
	dotfiles: DOTFILES_SECTION_PLAN,
});

/** The section plan for a source id, or an empty plan for an unknown one. */
function sectionPlanFor(sourceId) {
	return SECTION_PLANS[sourceId] ?? [];
}

/**
 * Extract the introduction from a README.
 *
 * The output has no raw HTML and no unvalidated URL. It is the only
 * shape the snapshot writer and the page read.
 */
export function extractIntroduction(markdown, { source, commitSha }) {
	const sanitized = sanitizeMarkdownSource(markdown);
	const lines = sanitized.split('\n');
	const headings = parseHeadings(sanitized);
	const titleHeading = headings.find((heading) => heading.level === 1);
	const title = titleHeading?.text || source.repo;

	const leadStart = (titleHeading?.line ?? -1) + 1;
	const firstSection = headings.find((heading) => heading.line > leadStart && heading.level <= 2);
	const leadLines = lines.slice(leadStart, firstSection?.line ?? lines.length);
	const leadParagraphs = paragraphsOf(leadLines).slice(0, 2);
	const lead = toRichText(leadParagraphs.join('\n\n'), {
		source,
		commitSha,
		limit: LIMITS.leadCharacters,
	});

	const related = new Map();
	for (const node of lead) {
		if (!node.href) continue;
		const match = node.href.match(/^https:\/\/github\.com\/rebuildup\/([A-Za-z0-9_.-]+)\/?$/);
		if (!match || match[1] === source.repo) continue;
		related.set(match[1], {
			repo: match[1],
			url: `https://github.com/rebuildup/${match[1]}`,
			label: node.text,
		});
	}

	const sections = [];
	for (const plan of DOTFILES_SECTION_PLAN) {
		const headingIndex = headings.findIndex(
			(heading) => heading.level === 2 && plan.match.test(heading.text),
		);
		if (headingIndex === -1) continue;
		const heading = headings[headingIndex];
		const next = headings.slice(headingIndex + 1).find((candidate) => candidate.level <= 2);
		const endLine = next?.line ?? lines.length;
		const body = sectionBodyLines(lines, heading.line, endLine);

		const section = {
			id: plan.id,
			heading: heading.text,
			anchor: heading.slug,
			sourceUrl: `${readmeUrlAt(source, commitSha)}#${heading.slug}`,
			summary: null,
			points: [],
			structure: [],
		};
		if (plan.summary) {
			const paragraph = paragraphsOf(body)[0];
			if (paragraph) {
				section.summary = toRichText(paragraph, {
					source,
					commitSha,
					limit: LIMITS.sectionSummaryCharacters,
				});
			}
		}
		if (plan.points) {
			section.points = topLevelBullets(body)
				.slice(0, Math.min(plan.points, LIMITS.sectionPoints))
				.map((bullet) =>
					toRichText(bullet, {
						source,
						commitSha,
						limit: LIMITS.pointCharacters,
					}),
				)
				.filter((point) => point.length > 0);
		}
		if (plan.structure) section.structure = extractStructure(sanitized);
		sections.push(section);
	}

	return {
		title: redactPublicationText(title),
		lead,
		sections: sections.map((section) => ({
			...section,
			heading: redactPublicationText(section.heading),
		})),
		relatedRepositories: [...related.values()].slice(0, LIMITS.relatedRepositories),
	};
}

/* ------------------------------------------------------------------ *
 * Snapshot construction / validation
 * ------------------------------------------------------------------ */

/** Stable JSON for hashing: key order is built here, not left to callers. */
function canonicalIntroduction(introduction) {
	return JSON.stringify({
		title: introduction.title,
		lead: introduction.lead,
		sections: introduction.sections,
		relatedRepositories: introduction.relatedRepositories,
	});
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SHA-256 over the extracted introduction, independent of the commit
 * that happens to be the default-branch head today.
 *
 * Every URL the extraction pins is normalized to a commit placeholder
 * before hashing. Moving the branch forward, or a commit that does not
 * touch the published README sections, therefore produces the SAME
 * digest and does not rewrite the snapshot. Only a change to the text
 * or to the resolved target of a published link does.
 */
export function contentDigestOf(source, introduction) {
	const normalized = canonicalIntroduction(introduction)
		.replace(
			new RegExp(`${escapeRegExp(source.canonicalUrl)}/blob/[0-9a-f]{40}/`, 'g'),
			`${source.canonicalUrl}/blob/<readme-commit>/`,
		)
		.replace(
			new RegExp(
				`https://raw\\.githubusercontent\\.com/${escapeRegExp(source.owner)}/${escapeRegExp(source.repo)}/[0-9a-f]{40}/`,
				'g',
			),
			`https://raw.githubusercontent.com/${source.owner}/${source.repo}/<readme-commit>/`,
		);
	const hash = createHash('sha256');
	hash.update(
		JSON.stringify({
			source: {
				id: source.id,
				owner: source.owner,
				repo: source.repo,
				ref: source.ref,
			},
			introduction: JSON.parse(normalized),
		}),
	);
	return `sha256:${hash.digest('hex')}`;
}

/**
 * Which commit the snapshot should name as its README provenance.
 *
 * `source.commitSha` answers "which revision of the published document
 * is this?", not "what was the branch head at the last sync?". While
 * the README blob is unchanged, the previous commit is kept, so a
 * dependabot commit cannot move the provenance or rewrite the page.
 */
function resolveReadmeProvenance(previous, commitSha, committedAt, readmeBlobSha) {
	if (
		previous?.source?.readmeBlobSha === readmeBlobSha &&
		isCommitSha(previous?.source?.commitSha) &&
		isIsoInstant(previous?.source?.committedAt)
	) {
		return {
			commitSha: previous.source.commitSha,
			committedAt: previous.source.committedAt,
		};
	}
	return { commitSha, committedAt };
}

/** Create the public snapshot for a successful fetch. */
export function buildPublicSnapshot({
	source,
	commitSha,
	committedAt,
	readmeBlobSha,
	readmeText,
	now,
	previous,
}) {
	const provenance = resolveReadmeProvenance(previous, commitSha, committedAt, readmeBlobSha);
	const introduction = extractIntroduction(readmeText, {
		source,
		commitSha: provenance.commitSha,
	});
	const contentDigest = contentDigestOf(source, introduction);
	const changed = !previous || previous.contentDigest !== contentDigest;
	const verifiedAt = new Date(now).toISOString();
	return {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		source: {
			id: source.id,
			owner: source.owner,
			repo: source.repo,
			ref: source.ref,
			commitSha: provenance.commitSha,
			committedAt: provenance.committedAt,
			readmePath: source.readmePath,
			readmeBlobSha,
			canonicalUrl: source.canonicalUrl,
			readmeUrl: readmeUrlAt(source, provenance.commitSha),
		},
		availability: 'public',
		unavailable: null,
		verifiedAt,
		appliedAt: changed ? verifiedAt : (previous?.appliedAt ?? verifiedAt),
		contentDigest,
		introduction,
	};
}

/**
 * Preserve the last known introduction when the source is no longer
 * usable. The result is explicit: `availability` is `unavailable`, the
 * reason is one of the closed vocabulary, and `verifiedAt` still names
 * the last SUCCESSFUL read — never the failed attempt.
 */
export function buildUnavailableSnapshot(previous, reason, now) {
	if (!previous) {
		throw new ProjectSourceTransportError(
			'cannot record an unavailable state before a public snapshot exists',
		);
	}
	if (!UNAVAILABLE_REASONS.includes(reason)) {
		throw new ProjectSourceTransportError(`unknown unavailable reason: ${reason}`);
	}
	return {
		...previous,
		availability: 'unavailable',
		unavailable: {
			reason,
			observedAt: new Date(now).toISOString(),
		},
	};
}

/** Seconds between two ISO instants, or `null` when either is unusable. */
export function ageHours(verifiedAt, now) {
	const then = Date.parse(verifiedAt);
	const at = now instanceof Date ? now.getTime() : Date.parse(now);
	if (!Number.isFinite(then) || !Number.isFinite(at)) return null;
	return Math.max(0, (at - then) / 3_600_000);
}

/**
 * Decide whether a sync result must be written.
 *
 * - content changed → write (a new `appliedAt` and `verifiedAt`);
 * - content unchanged, heartbeat due → write only `verifiedAt` (and
 *   `observedAt` while unavailable), so the page stays truthful without
 *   a daily commit;
 * - content unchanged, heartbeat not due → write nothing.
 */
export function planSnapshotWrite(previous, next, now) {
	if (!previous) return { write: true, reason: 'initial' };
	if (previous.contentDigest !== next.contentDigest) {
		return { write: true, reason: 'content-changed' };
	}
	if (previous.availability !== next.availability) {
		return { write: true, reason: 'availability-changed' };
	}
	if (previous.availability === 'unavailable' && next.availability === 'unavailable') {
		if (previous.unavailable?.reason !== next.unavailable?.reason) {
			return { write: true, reason: 'reason-changed' };
		}
		const observedAge = ageHours(previous.unavailable?.observedAt, now);
		if (observedAge === null || observedAge >= HEARTBEAT_HOURS) {
			return { write: true, reason: 'heartbeat' };
		}
		return { write: false, reason: 'unchanged' };
	}
	const verifiedAge = ageHours(previous.verifiedAt, now);
	if (verifiedAge === null || verifiedAge >= HEARTBEAT_HOURS) {
		return { write: true, reason: 'heartbeat' };
	}
	return { write: false, reason: 'unchanged' };
}

/** Serialize deterministically so `--check` can byte-compare. */
export function serializeSnapshot(snapshot) {
	return `${JSON.stringify(snapshot, null, '\t')}\n`;
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject text the publication boundary would have had to change. */
function validatePublishedText(value, label, errors) {
	if (typeof value !== 'string') return;
	if (redactPublicationText(value) !== value) {
		errors.push(`${label}: is outside the publication boundary`);
	}
}

function validateRichTextBoundary(nodes, label, errors) {
	if (!Array.isArray(nodes)) return;
	for (const [index, node] of nodes.entries()) {
		if (!isPlainObject(node)) continue;
		validatePublishedText(node.text, `${label}[${index}].text`, errors);
	}
}

function validateRichText(value, label, errors) {
	if (!Array.isArray(value)) {
		errors.push(`${label}: not an array`);
		return;
	}
	for (const [index, node] of value.entries()) {
		if (!isPlainObject(node) || typeof node.text !== 'string' || node.text.length === 0) {
			errors.push(`${label}[${index}]: text is missing`);
			continue;
		}
		if (node.href !== undefined) {
			if (typeof node.href !== 'string') {
				errors.push(`${label}[${index}]: href is not a string`);
				continue;
			}
			let url;
			try {
				url = new URL(node.href);
			} catch {
				errors.push(`${label}[${index}]: href is not absolute`);
				continue;
			}
			if (!SAFE_SCHEMES.has(url.protocol)) {
				errors.push(`${label}[${index}]: href scheme is not publishable`);
			}
		}
	}
}

/**
 * Validate a committed snapshot without touching the network.
 *
 * The digest is recomputed from the stored introduction, so a manually
 * edited snapshot that no longer matches its provenance fails instead
 * of being rendered as current.
 */
export function validateSnapshot(snapshot) {
	const errors = [];
	if (!isPlainObject(snapshot)) return ['snapshot: not an object'];
	if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
		errors.push(`schemaVersion: expected ${SNAPSHOT_SCHEMA_VERSION}`);
	}
	const source = PROJECT_SOURCES[snapshot?.source?.id];
	if (!source) {
		errors.push('source.id: not an allowlisted source');
		return errors;
	}
	if (snapshot.source.owner !== source.owner || snapshot.source.repo !== source.repo) {
		errors.push('source: identity does not match the allowlist');
	}
	if (snapshot.source.ref !== source.ref) errors.push('source.ref: does not match the allowlist');
	if (!isCommitSha(snapshot.source.commitSha)) errors.push('source.commitSha: is not a SHA');
	if (!isCommitSha(snapshot.source.readmeBlobSha)) {
		errors.push('source.readmeBlobSha: is not a SHA');
	}
	if (snapshot.source.readmePath !== source.readmePath) {
		errors.push('source.readmePath: does not match the allowlist');
	}
	if (snapshot.source.canonicalUrl !== source.canonicalUrl) {
		errors.push('source.canonicalUrl: does not match the allowlist');
	}
	if (snapshot.source.readmeUrl !== readmeUrlAt(source, snapshot.source.commitSha)) {
		errors.push('source.readmeUrl: is not the pinned README URL');
	}
	if (!isIsoInstant(snapshot.source.committedAt)) errors.push('source.committedAt: not an instant');
	if (!isIsoInstant(snapshot.verifiedAt)) errors.push('verifiedAt: not an instant');
	if (!isIsoInstant(snapshot.appliedAt)) errors.push('appliedAt: not an instant');
	if (snapshot.availability !== 'public' && snapshot.availability !== 'unavailable') {
		errors.push('availability: not a known state');
	}
	if (snapshot.availability === 'unavailable') {
		if (!UNAVAILABLE_REASONS.includes(snapshot.unavailable?.reason)) {
			errors.push('unavailable.reason: not a known reason');
		}
		if (!isIsoInstant(snapshot.unavailable?.observedAt)) {
			errors.push('unavailable.observedAt: not an instant');
		}
	} else if (snapshot.unavailable !== null) {
		errors.push('unavailable: must be null while the source is public');
	}

	const introduction = snapshot.introduction;
	if (!isPlainObject(introduction)) {
		errors.push('introduction: not an object');
		return errors;
	}
	if (typeof introduction.title !== 'string' || introduction.title.length === 0) {
		errors.push('introduction.title: is missing');
	} else {
		validatePublishedText(introduction.title, 'introduction.title', errors);
	}
	validateRichText(introduction.lead, 'introduction.lead', errors);
	validateRichTextBoundary(introduction.lead, 'introduction.lead', errors);
	if (!Array.isArray(introduction.sections) || introduction.sections.length === 0) {
		errors.push('introduction.sections: is empty');
	} else {
		const plan = sectionPlanFor(source.id);
		const allowedIds = new Set(plan.map((entry) => entry.id));
		const seenIds = new Set();
		for (const [index, section] of introduction.sections.entries()) {
			const label = `introduction.sections[${index}]`;
			if (!isPlainObject(section)) {
				errors.push(`${label}: not an object`);
				continue;
			}
			for (const key of ['id', 'heading', 'anchor', 'sourceUrl']) {
				if (typeof section[key] !== 'string' || section[key].length === 0) {
					errors.push(`${label}.${key}: is missing`);
				}
			}
			if (typeof section.id === 'string') {
				if (!allowedIds.has(section.id)) {
					errors.push(`${label}.id: is not in the source section allowlist`);
				}
				if (seenIds.has(section.id)) {
					errors.push(`${label}.id: is duplicated`);
				}
				seenIds.add(section.id);
			}
			if (typeof section.heading === 'string') {
				validatePublishedText(section.heading, `${label}.heading`, errors);
			}
			if (section.sourceUrl && section.anchor) {
				const expectedSectionUrl = `${readmeUrlAt(source, snapshot.source.commitSha)}#${section.anchor}`;
				if (section.sourceUrl !== expectedSectionUrl) {
					errors.push(`${label}.sourceUrl: is not pinned to the recorded commit`);
				}
			}
			if (section.summary !== null) {
				validateRichText(section.summary, `${label}.summary`, errors);
				validateRichTextBoundary(section.summary, `${label}.summary`, errors);
			}
			if (!Array.isArray(section.points)) errors.push(`${label}.points: not an array`);
			else
				for (const [p, point] of section.points.entries()) {
					validateRichText(point, `${label}.points[${p}]`, errors);
					validateRichTextBoundary(point, `${label}.points[${p}]`, errors);
				}
			if (!Array.isArray(section.structure)) errors.push(`${label}.structure: not an array`);
			else {
				const seenStructure = new Set();
				for (const [entryIndex, entry] of section.structure.entries()) {
					const entryLabel = `${label}.structure[${entryIndex}]`;
					if (typeof entry !== 'string') {
						errors.push(`${entryLabel}: is not a string`);
						continue;
					}
					if (!/^[A-Za-z0-9_.-]+$/.test(entry) || entry === '.' || entry === '..') {
						errors.push(`${entryLabel}: is not a repository-root entry`);
					}
					if (seenStructure.has(entry)) {
						errors.push(`${entryLabel}: is duplicated`);
					}
					seenStructure.add(entry);
					validatePublishedText(entry, entryLabel, errors);
				}
			}
		}
	}
	if (!Array.isArray(introduction.relatedRepositories)) {
		errors.push('introduction.relatedRepositories: not an array');
	} else {
		for (const [index, repo] of introduction.relatedRepositories.entries()) {
			const label = `introduction.relatedRepositories[${index}]`;
			if (!isPlainObject(repo)) {
				errors.push(`${label}: not an object`);
				continue;
			}
			if (!/^[A-Za-z0-9_.-]+$/.test(repo.repo ?? '')) errors.push(`${label}.repo: invalid`);
			if (repo.url !== `https://github.com/rebuildup/${repo.repo}`) {
				errors.push(`${label}.url: not the allowlisted repository URL`);
			}
			if (typeof repo.label !== 'string' || repo.label.length === 0) {
				errors.push(`${label}.label: is missing`);
			} else {
				validatePublishedText(repo.label, `${label}.label`, errors);
			}
		}
	}

	const expectedDigest = contentDigestOf(source, introduction);
	if (snapshot.contentDigest !== expectedDigest) {
		errors.push('contentDigest: does not match the stored introduction');
	}
	return errors;
}

/* ------------------------------------------------------------------ *
 * Network orchestration
 * ------------------------------------------------------------------ */

/**
 * Fetch one source and return the public snapshot for this run.
 *
 * Transport failures throw `ProjectSourceTransportError` (no write is
 * planned). A source state that makes the document unusable throws
 * `ProjectSourceUnavailable`; the caller records that state, preserving
 * the previous introduction, when one exists.
 */
export async function fetchPublicSnapshot({
	sourceId = DEFAULT_SOURCE_ID,
	now = new Date(),
	fetchImpl = globalThis.fetch,
	previous = null,
} = {}) {
	if (typeof fetchImpl !== 'function') {
		throw new ProjectSourceTransportError('no fetch implementation available');
	}
	const source = getProjectSource(sourceId);
	const urls = allowedRequestUrls(source);

	const repositoryPayload = await requestJson(fetchImpl, urls.repository, {
		maxBytes: LIMITS.metadataBytes,
		source,
		now,
	});
	validateRepositoryPayload(repositoryPayload, source);

	const commitPayload = await requestJson(fetchImpl, urls.commit, {
		maxBytes: LIMITS.commitBytes,
		source,
		now,
	});
	const { commitSha, committedAt } = validateCommitPayload(commitPayload);

	const readmeUrl = new URL(urls.readme);
	readmeUrl.searchParams.set('ref', commitSha);
	const readmePayload = await requestJson(fetchImpl, readmeUrl.toString(), {
		maxBytes: LIMITS.readmeBytes,
		source,
		commitSha,
		now,
	});
	const { readmeText, readmeBlobSha } = validateReadmePayload(readmePayload, source);

	return buildPublicSnapshot({
		source,
		commitSha,
		committedAt,
		readmeBlobSha,
		readmeText,
		now,
		previous,
	});
}
