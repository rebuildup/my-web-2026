#!/usr/bin/env node
/**
 * Sync the portfolio content from Notion into the committed snapshot
 * (Issue #765).
 *
 * Usage:
 *   node scripts/sync-portfolio-notion.mjs --fixture scripts/fixtures/notion-portfolio/portfolio.json
 *   node scripts/sync-portfolio-notion.mjs --dry-run
 *   node scripts/sync-portfolio-notion.mjs
 *
 * This runs at **build time only**. There is no scheduled workflow, no
 * cron, and no Worker-side call: `src/portfolio/notion/generated/snapshot.json`
 * is what the deployment serves, and the editor is Notion. That is the
 * whole trade (ADR-0018 §2.1) — the public site never depends on Notion
 * being reachable, and an edit reaches production on the next build.
 *
 * Two modes, one code path:
 *
 *   * `--fixture <path>` reads a file in the same intermediate shape the
 *     API client returns. It is not a mock of the script — it is the same
 *     mapping, from the same functions, so the offline run exercises every
 *     decision the online run makes.
 *   * the default mode reads the live database. It needs `NOTION_TOKEN`
 *     and a database id (`--database-id` or `NOTION_PORTFOLIO_DB_ID`).
 *     Neither value is printed, and neither reaches the snapshot.
 *
 * Media ingest (Issue #889)
 * -------------------------
 * An `image` block is not content the mapper can turn into a record: its
 * bytes live behind a **signed Notion URL that expires in about an hour**
 * (ADR-0018 §2.11). So the pipeline is deliberately two-stage:
 *
 *   1. **map** — every image becomes a descriptor carrying that ephemeral
 *      URL, and every `bookmark` becomes one Markdown link line. The URL
 *      is never placed in Markdown, in the link list, or in a record.
 *   2. **resolve** — after mapping, each descriptor is downloaded (bounded
 *      concurrency, per-object size ceiling, image content-type
 *      allowlist), hashed with SHA-256, and given the content-addressed
 *      key `portfolio/notion/<sha256>.<ext>`. The bytes are uploaded
 *      through `scripts/_r2.mjs#putObject` — **local target by default**;
 *      production only when `--r2-target=production` says so explicitly.
 *
 * Before uploading, the target bucket's `portfolio/` objects are hashed
 * once and reused by key: identical bytes are never stored twice, whether
 * the existing copy came from an earlier ingest (Issue #889) or from the
 * legacy-media migration (Issue #850). Nothing existing is deleted or
 * rewritten.
 *
 * `--dry-run` runs steps 1 and 2 **including the downloads and the hash**
 * and then stops: no snapshot, no R2 write. That is what makes the dry-run
 * an honest preview of the bytes the real ingest would move.
 *
 * Failure semantics:
 *   - a **content refusal** (an unknown section heading, an unsupported
 *     block, a malformed link) exits 1 and writes nothing. Publishing a
 *     page with a paragraph silently missing is the failure this refuses
 *     to make.
 *   - a **media refusal** (bytes that cannot be downloaded, typed,
 *     hashed or uploaded) exits 1 and writes nothing, each with a stable
 *     reason code. A silently dropped image is the same defect as a
 *     silently dropped paragraph.
 *   - a **rejected credential** (401 / 403 / 404) exits 3 and writes
 *     nothing. That is an operator error, not an outage; recording it as
 *     `unavailable` would hide it.
 *   - an **outage** (429 / 5xx / network) records `availability:
 *     "unavailable"` with a reason and keeps the last known records, so the
 *     page shows yesterday's text and says so (ADR-0018 §2.5).
 *
 * Output is status-only: counts, a digest prefix, a reason code. Never a
 * title, never a body, never a credential.
 *
 * Exit codes: 0 = written / unchanged / unavailable recorded, 1 = content
 * refusal or invalid output, 2 = usage error, 3 = credential or transport
 * failure.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapDocuments, toContractMedia } from './_notion-mapper.mjs';
import {
	NotionTransportError,
	NotionUnavailable,
	fetchNotionPortfolio,
	readDatabaseId,
	readToken,
} from './_notion-transport.mjs';
import { readPageKeys } from './_r2-media-key-set.mjs';
import { listObjectKeysPage, getObject as r2GetObject, putObject as r2PutObject } from './_r2.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
export const SNAPSHOT_SCHEMA = 'portfolio-notion-snapshot.v1';

/** Namespace every Notion-sourced object is stored under (`portfolio/` is public). */
export const MEDIA_PREFIX = 'portfolio/notion/';

/**
 * Image types the byte fetch accepts, and the extension each becomes.
 *
 * The list is the same set `src/http/media/router.ts` will serve, so an
 * object this script stores is an object the delivery route can hand back.
 */
export const MEDIA_EXTENSIONS = Object.freeze({
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/avif': 'avif',
});

/**
 * Per-object ceiling. One image over this is a bug or an attack, not a photo.
 */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/**
 * Hard per-object ceiling on one download, headers to last byte.
 *
 * Measured, not guessed: one legacy image is 6.2 MB and arrives at about
 * 19 kB/s from Notion's store (Issue #889, 2026-11-04), which is ~5.5
 * minutes of wall time for a single object. The bound stays — a download
 * that cannot finish inside it is an error — it is just set where an
 * honest transfer fits.
 */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 600_000;

/**
 * No bytes for this long means the connection stalled, not that it is
 * slow. This is what keeps a dead socket from occupying the whole
 * `MEDIA_DOWNLOAD_TIMEOUT_MS` window while nothing moves.
 */
export const MEDIA_IDLE_TIMEOUT_MS = 60_000;

/** Parallel byte downloads. Uploads stay serial: the R2 adapter is a CLI child. */
export const MEDIA_CONCURRENCY = 4;

/**
 * Bounds on the dedupe scan (hashing objects that already exist).
 *
 * The scan is what lets the ingest reuse an existing key instead of
 * storing the same bytes twice, so it cannot simply be skipped when it
 * grows: exceeding a bound is an error the operator resolves deliberately
 * (by raising the constant in review), never a silent "upload anyway".
 */
export const SCAN_MAX_OBJECTS = 512;
export const SCAN_MAX_BYTES = 512 * 1024 * 1024;

export const ASSET_LICENSE_INVENTORY_PATH = join(
	REPO_ROOT,
	'quality',
	'asset-license-inventory.json',
);

const USAGE = `sync-portfolio-notion — build the portfolio snapshot from Notion

  node scripts/sync-portfolio-notion.mjs [--fixture <path>] [--dry-run] [--force]
      [--r2-target <local|production>]

  --fixture <path>       read a Notion-shaped JSON file instead of the API
  --database-id <id>     Notion database id (default: $NOTION_PORTFOLIO_DB_ID)
  --out <path>           where to write the snapshot (default: the bundled file)
  --dry-run              map, download and hash the media, write nothing
  --force                write even when the content digest is unchanged
  --r2-target <target>   where image bytes are uploaded: local (default) or
                         production. "production" is the explicit request
                         that makes a real R2 write happen; it also needs
                         CLOUDFLARE_R2_API_TOKEN
  --help                 print this text

  Live mode reads NOTION_TOKEN from the environment. See
  docs/runbook/notion-portfolio-sync.md.
`;

/** Parse argv. Throws on anything it does not understand. */
export function parseArgs(argv) {
	const options = {
		help: false,
		fixture: null,
		databaseId: null,
		out: SNAPSHOT_PATH,
		dryRun: false,
		force: false,
		r2Target: 'local',
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--help' || arg === '-h') return { ...options, help: true };
		if (arg === '--dry-run') {
			options.dryRun = true;
			continue;
		}
		if (arg === '--force') {
			options.force = true;
			continue;
		}
		if (
			arg === '--fixture' ||
			arg === '--database-id' ||
			arg === '--out' ||
			arg === '--r2-target'
		) {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
			if (arg === '--fixture') options.fixture = value;
			if (arg === '--database-id') options.databaseId = value;
			if (arg === '--out') options.out = value;
			if (arg === '--r2-target') {
				// "remote" does not exist and production must be NAMED: an
				// omitted or mistyped target must fall towards the local
				// store, never towards a production write.
				if (value !== 'local' && value !== 'production') {
					throw new Error('--r2-target must be local or production');
				}
				options.r2Target = value;
			}
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

/** Read a fixture file in the intermediate shape the API client returns. */
export function readFixture(path) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new NotionTransportError(
			`fixture could not be read as JSON (${error instanceof Error ? error.name : 'read error'})`,
		);
	}
	if (typeof parsed?.databaseId !== 'string' || !Array.isArray(parsed?.pages)) {
		throw new NotionTransportError('fixture must carry a databaseId and a pages array');
	}
	return parsed;
}

/**
 * Stable digest over the mapped records, so a re-run can say "unchanged".
 */
export function contentDigest(records) {
	const canonical = JSON.stringify(
		[...records].sort((left, right) =>
			String(left.pageId).localeCompare(String(right.pageId), 'en'),
		),
	);
	return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/**
 * Assemble the snapshot document.
 *
 * This is not a second schema — `src/portfolio/notion/contract.ts` is the
 * contract, and a test asserts this output satisfies it. What is checked
 * here is only the invariant the contract cannot express about itself:
 * `unavailable` and a reason travel together, and neither appears alone.
 */
export function buildSnapshot({
	databaseId,
	idKind = null,
	sourceUrl = null,
	records,
	now,
	previous = null,
	unavailable = null,
}) {
	const observedAt = now.toISOString();
	if (unavailable !== null) {
		const kept = Array.isArray(previous?.records) ? previous.records : records;
		return {
			schema: SNAPSHOT_SCHEMA,
			source: {
				databaseId,
				...(idKind === null
					? typeof previous?.source?.idKind === 'string'
						? { idKind: previous.source.idKind }
						: {}
					: { idKind }),
				capabilities: ['read_content'],
				// The snapshot was not fetched this run; keep the last
				// successful fetch time so a reader can measure the age.
				fetchedAt:
					typeof previous?.source?.fetchedAt === 'string' ? previous.source.fetchedAt : observedAt,
				sourceUrl,
			},
			availability: 'unavailable',
			unavailableReason: unavailable,
			observedAt,
			contentDigest: contentDigest(kept),
			records: kept,
		};
	}
	return {
		schema: SNAPSHOT_SCHEMA,
		source: {
			databaseId,
			...(idKind === null ? {} : { idKind }),
			capabilities: ['read_content'],
			fetchedAt: observedAt,
			sourceUrl,
		},
		availability: 'public',
		unavailableReason: null,
		observedAt,
		contentDigest: contentDigest(records),
		records,
	};
}

/** The structural invariants the writer can check without the zod schema. */
export function checkSnapshotShape(snapshot) {
	if (snapshot.schema !== SNAPSHOT_SCHEMA) return 'wrong schema marker';
	if (snapshot.availability !== 'public' && snapshot.availability !== 'unavailable') {
		return 'unknown availability';
	}
	if (snapshot.availability === 'unavailable' && typeof snapshot.unavailableReason !== 'string') {
		return 'unavailable without a reason';
	}
	if (snapshot.availability === 'public' && snapshot.unavailableReason !== null) {
		return 'a reason without unavailable';
	}
	if (!/^sha256:[0-9a-f]{64}$/u.test(String(snapshot.contentDigest)))
		return 'malformed content digest';
	if (!Array.isArray(snapshot.records)) return 'records is not an array';
	for (const [index, record] of snapshot.records.entries()) {
		const media = record?.media;
		if (!Array.isArray(media)) return `record ${index} has no media array`;
		if (media.length > 32) return `record ${index} has more than 32 media`;
		for (const entry of media) {
			// The exact field set is the containment rule: a stray `url` is
			// how an ephemeral Notion address would ride into a committed
			// file, and the contract's parser would silently strip it while
			// the digest still covered it.
			const fields = Object.keys(entry ?? {})
				.sort()
				.join(',');
			if (fields !== 'alt,caption,contentType,displayOrder,height,isCover,r2Key,rights,width') {
				return 'a media entry with fields outside the contract';
			}
			// A key is an object name, never a URL. `:`, `?`, `#` and
			// whitespace are exactly how a signed address or a token would
			// disguise itself as one.
			if (
				typeof entry.r2Key !== 'string' ||
				entry.r2Key.length > 512 ||
				!entry.r2Key.startsWith('portfolio/') ||
				/[:?#\s]/u.test(entry.r2Key)
			) {
				return 'a media key that is not a plain portfolio object key';
			}
			if (!Object.hasOwn(MEDIA_EXTENSIONS, entry.contentType)) {
				return 'a media content type outside the image allowlist';
			}
			if (entry.rights !== 'recorded' && entry.rights !== 'unrecorded') {
				return 'an unknown media rights verdict';
			}
		}
	}
	return null;
}

/**
 * Refuse to write a snapshot that carries the credential.
 *
 * A token reaching a committed file is the failure mode this whole
 * boundary exists to prevent, so it is checked on the serialized bytes
 * rather than trusted to the mapping.
 */
export function findCredentialLeak(serialized, token) {
	if (typeof token === 'string' && token.length > 0 && serialized.includes(token))
		return 'token value';
	if (/\b(ntn_[A-Za-z0-9]{16,}|secret_[A-Za-z0-9]{20,})\b/u.test(serialized))
		return 'token-like literal';
	return null;
}

/* -------------------------------------------------------------------------
 * Media ingest (Issue #889)
 * -------------------------------------------------------------------------
 */

/**
 * A media-ingest failure with a **stable reason code**.
 *
 * Codes, not messages: an operator greps for `media_content_type_refused`
 * and a message text that drifts with a library version is not a contract.
 * `detail` carries a non-sensitive qualifier (an HTTP status, a stage) and
 * never a URL, a key or a body.
 */
export class MediaIngestError extends Error {
	constructor(code, detail = null) {
		super(code);
		this.name = 'MediaIngestError';
		this.code = code;
		this.detail = detail;
	}
}

/* ---- rights (ADR-0019 / Issue #811) ---------------------------------- */

/**
 * The committed rights inventory, or a refusal.
 *
 * The file is a repository artefact, so an unreadable one is a repository
 * defect and the ingest stops — it does not invent an empty inventory and
 * publish everything as unreviewed by accident.
 */
export function readRightsInventory(path = ASSET_LICENSE_INVENTORY_PATH) {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		if (parsed?.schema !== 'asset-license-inventory.v1' || !Array.isArray(parsed.assets)) {
			throw new Error('unexpected shape');
		}
		return parsed;
	} catch {
		throw new MediaIngestError('rights_inventory_unreadable');
	}
}

/** `*` within one path segment, `**` across segments, anchored at both ends. */
function globToRegExp(pattern) {
	const parts = [];
	let index = 0;
	while (index < pattern.length) {
		const character = pattern[index];
		if (character === '*') {
			if (pattern[index + 1] === '*') {
				parts.push('.*');
				index += 2;
				continue;
			}
			parts.push('[^/]*');
			index += 1;
			continue;
		}
		if ('\\.+^${}()|[]?'.includes(character)) parts.push(`\\${character}`);
		else parts.push(character);
		index += 1;
	}
	return new RegExp(`^${parts.join('')}$`, 'u');
}

function assetCoversKey(asset, key) {
	const patterns = [
		...(Array.isArray(asset?.covers) ? asset.covers : []),
		...(Array.isArray(asset?.publicPaths) ? asset.publicPaths : []).map((path) =>
			String(path).replace(/^\//u, ''),
		),
	];
	return patterns.some((pattern) => {
		try {
			return globToRegExp(String(pattern)).test(key);
		} catch {
			return false;
		}
	});
}

/**
 * The offline rights verdict for one key (`recorded` | `unrecorded`).
 *
 * Two rules, both fail-closed:
 *
 *   * nothing in the inventory covers the key ⇒ `unrecorded`. The
 *     Notion-sourced images have no inventory entry today, so they are
 *     `unrecorded` — which ADR-0019 / Issue #811 makes a **published,
 *     displayed** state, not a refusal;
 *   * an entry that covers the key but verifies it with `method: none`
 *     also yields `unrecorded`: covering a path is not evidence.
 *
 * A record is never written here. `quality/asset-license-inventory.json`
 * is the owner's artefact; this function only reads it.
 */
export function rightsForR2Key(key, inventory) {
	for (const asset of Array.isArray(inventory?.assets) ? inventory.assets : []) {
		if (!assetCoversKey(asset, key)) continue;
		const method = asset?.verification?.method;
		if (typeof method === 'string' && method.length > 0 && method !== 'none') return 'recorded';
	}
	return 'unrecorded';
}

/* ---- byte fetch ------------------------------------------------------- */

/** Image signatures, read from the bytes themselves (last-resort typing). */
function sniffImageContentType(bytes) {
	const header = (start, end) => bytes.subarray(start, end).toString('latin1');
	if (bytes.length >= 8 && header(0, 4) === '\x89PNG') return 'image/png';
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return 'image/jpeg';
	const gif = header(0, 6);
	if (bytes.length >= 6 && (gif === 'GIF87a' || gif === 'GIF89a')) return 'image/gif';
	if (bytes.length >= 12 && header(0, 4) === 'RIFF' && header(8, 12) === 'WEBP')
		return 'image/webp';
	if (bytes.length >= 12 && header(4, 8) === 'ftyp') {
		const brand = header(8, 12);
		if (brand === 'avif' || brand === 'avis') return 'image/avif';
	}
	return null;
}

/** Read a body without ever buffering more than `MAX_MEDIA_BYTES`. */
async function readBoundedBody(response) {
	const declared = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10);
	if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) {
		throw new MediaIngestError('media_too_large', 'declared');
	}
	const body = response.body;
	if (body !== null && body !== undefined && typeof body.getReader === 'function') {
		const reader = body.getReader();
		const chunks = [];
		let total = 0;
		for (;;) {
			let timer = null;
			const idle = new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new MediaIngestError('media_download_failed', 'idle')),
					MEDIA_IDLE_TIMEOUT_MS,
				);
			});
			let outcome;
			try {
				outcome = await Promise.race([reader.read(), idle]);
			} catch (error) {
				await reader.cancel().catch(() => {});
				if (error instanceof MediaIngestError) throw error;
				// A mid-body `terminated` / `TimeoutError` is the transport's,
				// not this module's: it becomes the same stable code with a
				// stage, never a raw library message an operator has to decode.
				throw new MediaIngestError(
					'media_download_failed',
					error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'stream',
				);
			} finally {
				clearTimeout(timer);
			}
			if (outcome.done) break;
			total += outcome.value.byteLength;
			if (total > MAX_MEDIA_BYTES) {
				await reader.cancel().catch(() => {});
				throw new MediaIngestError('media_too_large', 'streamed');
			}
			chunks.push(Buffer.from(outcome.value));
		}
		return Buffer.concat(chunks);
	}
	let buffer;
	try {
		buffer = Buffer.from(await response.arrayBuffer());
	} catch (error) {
		throw new MediaIngestError(
			'media_download_failed',
			error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'body',
		);
	}
	if (buffer.byteLength > MAX_MEDIA_BYTES) {
		throw new MediaIngestError('media_too_large', 'buffered');
	}
	return buffer;
}

/**
 * Download one image and decide its content type.
 *
 * The response header wins when it names a type we can serve. When it
 * names nothing usable (`''` / `application/octet-stream`), the bytes are
 * asked instead — a signature is evidence, and only the five signatures
 * above can answer. A definite header we cannot serve is refused outright:
 * storing it would create an object the delivery route 404s on.
 */
export async function downloadMedia(url, { fetchImpl = globalThis.fetch } = {}) {
	let response;
	try {
		response = await fetchImpl(url, { signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS) });
	} catch (error) {
		throw new MediaIngestError(
			'media_download_failed',
			error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
		);
	}
	if (!response.ok) throw new MediaIngestError('media_download_failed', `http_${response.status}`);
	const declared = String(response.headers?.get?.('content-type') ?? '')
		.split(';')[0]
		.trim()
		.toLowerCase();
	let contentType = null;
	if (Object.hasOwn(MEDIA_EXTENSIONS, declared)) contentType = declared;
	else if (declared !== '' && declared !== 'application/octet-stream') {
		throw new MediaIngestError('media_content_type_refused', 'declared');
	}
	const bytes = await readBoundedBody(response);
	if (contentType === null) {
		const sniffed = sniffImageContentType(bytes);
		if (sniffed === null) {
			throw new MediaIngestError(
				declared === '' ? 'media_content_type_missing' : 'media_content_type_refused',
				'sniffed',
			);
		}
		contentType = sniffed;
	}
	return { bytes, contentType, ext: MEDIA_EXTENSIONS[contentType] };
}

/** Run `worker` over `items` with at most `limit` in flight, in order. */
async function mapWithConcurrency(items, limit, worker) {
	const results = new Array(items.length);
	let cursor = 0;
	const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	});
	await Promise.all(lanes);
	return results;
}

/* ---- R2 seam ---------------------------------------------------------- */

/**
 * The R2 operations this ingest needs, over `scripts/_r2.mjs`.
 *
 * One seam so a test can prove the decisions (reuse, upload, dry-run)
 * without a bucket, while the production path still goes through the
 * repository's gated driver — target local by default, production only on
 * an explicit request, and a production write still requiring `execute`.
 */
export function defaultR2() {
	return {
		listKeys({ target, env = process.env }) {
			const page = listObjectKeysPage({ target, env });
			const read = readPageKeys(page);
			if ('reason' in read) throw new Error(read.reason);
			if (read.truncated) throw new Error('listing_incomplete');
			return read.keys;
		},
		getObject(key, { target, env = process.env }) {
			return r2GetObject(key, { target, env });
		},
		putObject(key, filePath, options) {
			return r2PutObject(key, filePath, options);
		},
	};
}

/**
 * sha256 → existing key for every object already under `portfolio/`.
 *
 * This is the Issue #850 overlap check: identical bytes must not be stored
 * twice, whatever namespace the existing copy lives in. Nothing is deleted
 * or rewritten — a match only means the new record points at the object
 * that is already there.
 */
async function buildReuseMap({ r2, target, env, keys }) {
	const portfolioKeys = keys.filter((key) => key.startsWith('portfolio/'));
	const reuse = new Map();
	let objects = 0;
	let bytes = 0;
	for (const key of portfolioKeys) {
		if (objects >= SCAN_MAX_OBJECTS || bytes >= SCAN_MAX_BYTES) {
			throw new MediaIngestError('r2_scan_budget_exceeded');
		}
		let object;
		try {
			object = await r2.getObject(key, { target, env });
		} catch {
			throw new MediaIngestError('r2_scan_failed');
		}
		const buffer = Buffer.from(object);
		objects += 1;
		bytes += buffer.byteLength;
		const digest = createHash('sha256').update(buffer).digest('hex');
		if (!reuse.has(digest)) reuse.set(digest, key);
	}
	return reuse;
}

/**
 * Decide, per object: reuse an existing key, skip a duplicate of this run,
 * or upload under the content-addressed key.
 */
function planMedia(items, existingKeys, reuse) {
	const existing = new Set(existingKeys);
	const scheduled = new Set();
	for (const item of items) {
		const reusedKey = reuse.get(item.sha256);
		if (reusedKey !== undefined) {
			item.r2Key = reusedKey;
			item.upload = false;
			item.reused = true;
			continue;
		}
		if (existing.has(item.r2Key) || scheduled.has(item.r2Key)) {
			item.upload = false;
			item.reused = true;
			continue;
		}
		scheduled.add(item.r2Key);
		item.upload = true;
		item.reused = false;
	}
	return items;
}

/**
 * Download, hash and plan every descriptor.
 *
 * Returns `{ failures }` when a byte fetch failed (the caller reports and
 * stops before any R2 interaction), or `{ items }` when every object is
 * resolved and the target bucket has been read for the reuse decision.
 * Listing / scanning problems are raised as `MediaIngestError` — they are
 * undecidable states, and an ingest that cannot prove it will not
 * duplicate bytes must not write.
 */
async function resolveMedia({ descriptors, fetchImpl, r2Target, env, r2 }) {
	const outcomes = await mapWithConcurrency(descriptors, MEDIA_CONCURRENCY, async (descriptor) => {
		try {
			const fetched = await downloadMedia(descriptor.url, { fetchImpl });
			return { ok: true, descriptor, ...fetched };
		} catch (error) {
			return {
				ok: false,
				descriptor,
				code: error instanceof MediaIngestError ? error.code : 'media_download_failed',
				detail: error instanceof MediaIngestError ? error.detail : null,
			};
		}
	});

	const failures = outcomes
		.filter((outcome) => !outcome.ok)
		.map((outcome) => ({
			pageId: outcome.descriptor.pageId,
			blockId: outcome.descriptor.blockId,
			code: outcome.code,
			detail: outcome.detail,
		}));
	if (failures.length > 0) return { failures, items: [] };

	const items = outcomes.map((outcome) => ({
		pageId: outcome.descriptor.pageId,
		blockId: outcome.descriptor.blockId,
		alt: outcome.descriptor.alt,
		caption: outcome.descriptor.caption,
		isCover: outcome.descriptor.isCover,
		displayOrder: outcome.descriptor.displayOrder,
		bytes: outcome.bytes,
		contentType: outcome.contentType,
		ext: outcome.ext,
		sha256: createHash('sha256').update(outcome.bytes).digest('hex'),
		r2Key: '',
	}));
	for (const item of items) item.r2Key = `${MEDIA_PREFIX}${item.sha256}.${item.ext}`;

	let keys;
	try {
		keys = await r2.listKeys({ target: r2Target, env });
	} catch {
		throw new MediaIngestError('r2_list_failed');
	}
	if (!Array.isArray(keys)) throw new MediaIngestError('r2_list_failed');

	const reuse = await buildReuseMap({ r2, target: r2Target, env, keys });
	planMedia(items, keys, reuse);
	return { failures: [], items, keys };
}

/** Upload the planned objects. Serial by design: the R2 adapter is a CLI child. */
async function uploadMedia({ items, r2Target, env, r2 }) {
	const tempDir = mkdtempSync(join(tmpdir(), 'notion-media-'));
	try {
		for (const item of items) {
			const filePath = join(tempDir, `${item.sha256}.${item.ext}`);
			writeFileSync(filePath, item.bytes);
			let result;
			try {
				result = await r2.putObject(item.r2Key, filePath, {
					contentType: item.contentType,
					target: r2Target,
					// Reaching a production write at all means the operator
					// passed `--r2-target=production`; that flag is the
					// explicit request `putObject` demands as `execute`.
					execute: r2Target === 'production',
					env,
				});
			} catch {
				throw new MediaIngestError('media_upload_failed');
			} finally {
				rmSync(filePath, { force: true });
			}
			if (result && result.applied === false) {
				throw new MediaIngestError('media_upload_refused');
			}
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function readPrevious(path) {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		return parsed?.schema === SNAPSHOT_SCHEMA ? parsed : null;
	} catch {
		// A corrupt file is not a reason to refuse to rebuild it.
		return null;
	}
}

/** Status-only line. Never prints document text, never a key, never a URL. */
function report(status, fields, stdout) {
	const parts = [`${status} records=${fields.records ?? 0}`];
	if (fields.findings !== undefined) parts.push(`findings=${fields.findings}`);
	if (fields.media !== undefined) parts.push(`media=${fields.media}`);
	if (fields.mediaBytes !== undefined) parts.push(`media_bytes=${fields.mediaBytes}`);
	if (fields.wouldUpload !== undefined) parts.push(`would_upload=${fields.wouldUpload}`);
	if (fields.uploadBytes !== undefined) parts.push(`upload_bytes=${fields.uploadBytes}`);
	if (fields.reused !== undefined) parts.push(`reused=${fields.reused}`);
	if (fields.digest) parts.push(`digest=${fields.digest.slice(0, 19)}…`);
	if (fields.reason) parts.push(`reason=${fields.reason}`);
	if (fields.written !== undefined) parts.push(`written=${fields.written}`);
	stdout.write(`${parts.join(' ')}\n`);
}

/**
 * Run one sync. Exported so a test can point it at a temporary output path
 * and prove that a refusal leaves the committed snapshot byte-identical.
 */
export async function syncNotion({
	fixture = null,
	databaseId = null,
	outPath = SNAPSHOT_PATH,
	dryRun = false,
	force = false,
	r2Target = 'local',
	now = new Date(),
	env = process.env,
	fetchImpl = globalThis.fetch,
	r2 = null,
	inventory = null,
	stdout = process.stdout,
	stderr = process.stderr,
} = {}) {
	const previous = readPrevious(outPath);
	const token = fixture === null ? readToken(env) : null;
	const id = fixture === null ? (databaseId ?? readDatabaseId(env)) : null;

	if (fixture === null) {
		if (token === null) {
			stderr.write(
				'missing credential: NOTION_TOKEN is not set. See docs/runbook/notion-portfolio-sync.md\n',
			);
			return 3;
		}
		if (id === null) {
			stderr.write('missing target: pass --database-id or set NOTION_PORTFOLIO_DB_ID\n');
			return 3;
		}
	}

	let source;
	try {
		source =
			fixture === null
				? await fetchNotionPortfolio({ databaseId: id, token, fetchImpl })
				: readFixture(fixture);
	} catch (error) {
		if (error instanceof NotionUnavailable) {
			const snapshot = buildSnapshot({
				databaseId: id ?? previous?.source?.databaseId ?? 'unconfigured',
				records: [],
				now,
				previous,
				unavailable: error.reason,
			});
			if (!dryRun && previous !== null) writeSnapshot(outPath, snapshot);
			report(
				'unavailable',
				{
					records: snapshot.records.length,
					digest: snapshot.contentDigest,
					reason: error.reason,
					written: !dryRun && previous !== null,
				},
				stdout,
			);
			return 0;
		}
		const message = error instanceof Error ? error.message : 'unknown failure';
		stderr.write(`sync failed: ${message}\n`);
		return 3;
	}

	const { records, media: descriptors, errors } = mapDocuments(source.pages);
	if (errors.length > 0) {
		for (const error of errors) {
			stderr.write(
				`refused page=${error.pageId} ${error.code} at=${error.at} expected=${error.expected}\n`,
			);
		}
		// One page can fail several properties, so the count that matters to
		// an operator is pages, not findings.
		const refusedPages = new Set(errors.map((error) => error.pageId));
		stderr.write(
			`sync aborted: ${refusedPages.size} page(s) could not be mapped (${errors.length} finding(s)); nothing was written\n`,
		);
		return 1;
	}

	// ---- media ingest (Issue #889) -------------------------------------
	// Every image is downloaded, hashed and planned BEFORE anything is
	// written: a byte failure must leave both the snapshot and the bucket
	// exactly as they were.
	const mediaStats = {
		media: 0,
		mediaBytes: 0,
		wouldUpload: 0,
		uploadBytes: 0,
		reused: 0,
	};
	let pendingUploads = [];
	if (descriptors.length > 0) {
		const r2Driver = r2 ?? defaultR2();
		let rights;
		try {
			rights = inventory ?? readRightsInventory();
		} catch (error) {
			if (error instanceof MediaIngestError) {
				stderr.write(`sync aborted: media ingest failed code=${error.code}; nothing was written\n`);
				return 1;
			}
			throw error;
		}

		let resolved;
		try {
			resolved = await resolveMedia({
				descriptors,
				fetchImpl,
				r2Target,
				env,
				r2: r2Driver,
			});
		} catch (error) {
			if (error instanceof MediaIngestError) {
				stderr.write(
					`sync aborted: media ingest failed code=${error.code}${
						error.detail ? ` detail=${error.detail}` : ''
					}; nothing was written\n`,
				);
				return 1;
			}
			throw error;
		}

		if (resolved.failures.length > 0) {
			for (const failure of resolved.failures) {
				stderr.write(
					`media refused page=${failure.pageId} block=${failure.blockId} code=${failure.code}${
						failure.detail ? ` detail=${failure.detail}` : ''
					}\n`,
				);
			}
			const pages = new Set(resolved.failures.map((failure) => failure.pageId));
			stderr.write(
				`sync aborted: ${resolved.failures.length} media object(s) could not be resolved on ${pages.size} page(s); nothing was written\n`,
			);
			return 1;
		}

		for (const item of resolved.items) {
			item.rights = rightsForR2Key(item.r2Key, rights);
		}
		const byPage = new Map();
		for (const item of resolved.items) {
			const list = byPage.get(item.pageId) ?? [];
			list.push(item);
			byPage.set(item.pageId, list);
		}
		for (const record of records) {
			const list = byPage.get(record.pageId) ?? [];
			record.media = list.map((item) =>
				toContractMedia(item, {
					r2Key: item.r2Key,
					contentType: item.contentType,
					rights: item.rights,
				}),
			);
		}

		mediaStats.media = resolved.items.length;
		mediaStats.mediaBytes = resolved.items.reduce((sum, item) => sum + item.bytes.byteLength, 0);
		mediaStats.wouldUpload = resolved.items.filter((item) => item.upload).length;
		mediaStats.uploadBytes = resolved.items
			.filter((item) => item.upload)
			.reduce((sum, item) => sum + item.bytes.byteLength, 0);
		mediaStats.reused = resolved.items.filter((item) => item.reused).length;
		pendingUploads = resolved.items.filter((item) => item.upload);
	}

	const databaseIdOut = source.databaseId;
	const snapshot = buildSnapshot({
		databaseId: databaseIdOut,
		// A fixture has no id kind: it is not fetched from either endpoint.
		idKind: source.idKind === 'database' || source.idKind === 'data_source' ? source.idKind : null,
		sourceUrl: typeof source.sourceUrl === 'string' ? source.sourceUrl : null,
		records,
		now,
	});

	const shapeError = checkSnapshotShape(snapshot);
	if (shapeError !== null) {
		stderr.write(`generated snapshot is not valid: ${shapeError}\n`);
		return 1;
	}

	const serialized = `${JSON.stringify(snapshot, null, '\t')}\n`;
	const leak = findCredentialLeak(serialized, token);
	if (leak !== null) {
		stderr.write(`refusing to write the snapshot: it contains a ${leak}\n`);
		return 1;
	}

	// Uploads happen BEFORE the snapshot is written: a file that names an
	// object the bucket does not have is a broken image on every public
	// page, and `contentDigest` is only true once the bytes exist.
	if (!dryRun && pendingUploads.length > 0) {
		try {
			await uploadMedia({ items: pendingUploads, r2Target, env, r2: r2 ?? defaultR2() });
		} catch (error) {
			if (error instanceof MediaIngestError) {
				stderr.write(
					`sync aborted: media upload failed code=${error.code}; the snapshot was not written\n`,
				);
				return 1;
			}
			throw error;
		}
	}

	const unchanged = previous !== null && previous.contentDigest === snapshot.contentDigest;
	const write = !dryRun && (force || !unchanged);
	if (write) writeSnapshot(outPath, serialized);

	report(
		unchanged && !force ? 'unchanged' : 'synced',
		{
			records: records.length,
			findings: 0,
			...mediaStats,
			digest: snapshot.contentDigest,
			written: write,
		},
		stdout,
	);
	return 0;
}

function writeSnapshot(path, snapshot) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		typeof snapshot === 'string' ? snapshot : `${JSON.stringify(snapshot, null, '\t')}\n`,
	);
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
		return 2;
	}
	if (options.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	return syncNotion({
		fixture: options.fixture,
		databaseId: options.databaseId,
		outPath: options.out,
		dryRun: options.dryRun,
		force: options.force,
		r2Target: options.r2Target,
	});
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await main();
}
