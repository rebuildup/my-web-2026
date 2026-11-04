#!/usr/bin/env node
/**
 * One-shot Notion portfolio media writer (Issue #814).
 *
 * Usage:
 *   node scripts/write-portfolio-to-notion.mjs --dry-run
 *   node scripts/write-portfolio-to-notion.mjs --apply --state <path>
 *
 * What this is for
 * ----------------
 * The legacy site's portfolio images are `media.data` BLOBs in
 * `.reference/my-web-2025/data/contents/content-*.db`. They were migrated
 * to R2, but Notion — the authoring source of truth for the portfolio —
 * has no image on any of its pages. The owner decision (2026-11-02) is
 * that this is not a synchronisation: the rewrite happens ONCE, here, and
 * the site only ever reads. So this CLI uploads each BLOB as a Notion
 * file upload and appends ONE `image` block to the matching page. It
 * never deletes, never replaces, never reorders, and it is not scheduled.
 *
 * Attribution (the rule that decides which work a file belongs to)
 * ----------------------------------------------------------------
 * `media.content_id` is NOT the attribution key: 25 rows carry a NULL
 * `content_id` while their database still holds exactly one `contents`
 * row, and reading `media.content_id` alone drops those bytes. The key is
 * **the single `contents.id` the database holds**. A database whose
 * `contents` table does not hold exactly one row cannot say which work it
 * belongs to, so every one of its media rows is refused as
 * `undecidable_db` (fail-closed — a file is never attached to a page by
 * guesswork).
 *
 * Reason codes (closed on purpose)
 * --------------------------------
 *   * `no_notion_page`      — no portfolio page carries this work's slug.
 *   * `undecidable_db`      — the database does not hold exactly one
 *                             `contents` row, so the work is unknown.
 *   * `mime_mismatch`       — the BLOB's leading bytes do not match the
 *                             declared `mime_type`. Never uploaded under a
 *                             type the bytes do not have.
 *   * `replayed`            — the state file already records this
 *                             `contentId/mediaId` pair, so it is skipped.
 * A free-text reason would let "we could not" read as "we chose not to";
 * each code above names a fact and a person who can unblock it.
 *
 * Idempotency
 * -----------
 * The state file is the ONLY basis for a re-run: every successfully
 * appended block is recorded as `contentId/mediaId -> {blockId, sha256,
 * bytes}` and flushed after each file, so a crash resumes instead of
 * duplicating. `--apply` therefore refuses to start without one unless
 * `--allow-duplicates` says the operator accepts possible duplicates
 * (exit 3). Nothing else in this repository knows what has been uploaded.
 *
 * Failure contract
 * ----------------
 * HTTP 429 / 5xx are retried with exponential backoff, at most 4 times.
 * Any other failure marks THAT ONE file `failed` and the loop continues —
 * 136 files are not thrown away because one upload was rejected.
 *
 * Output is status-only (AGENTS.md §4): counts, byte totals, reason codes
 * and identifiers. Never a token, never a response body, never a media
 * byte, never page content.
 *
 * Exit codes: 0 = every planned file succeeded, 1 = at least one file
 * failed, 2 = invalid input (missing credential / target / corpus,
 * unreadable database, bad argument), 3 = refused before writing (no
 * state file, unreadable state, duplicate slug, Notion read failure).
 *
 * Out of scope: the READ side (`image_block_unsupported` in
 * `scripts/_notion-mapper.mjs`) still refuses an image block. Accepting
 * one is a separate unit; this file only writes.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	NOTION_API_BASE,
	NOTION_API_VERSION,
	readDatabaseId,
	readToken,
} from './_notion-transport.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 0 = all planned files succeeded, 1 = partial, 2 = input, 3 = refused. */
export const EXIT = Object.freeze({ OK: 0, PARTIAL: 1, INPUT: 2, REFUSED: 3 });

export const DEFAULT_LEGACY_DIR = '.reference/my-web-2025/data/contents';
export const DEFAULT_STATE_PATH = '.tmp/notion-portfolio-write-state.json';
export const STATE_SCHEMA = 'notion-portfolio-write-state.v1';

/** Retries for HTTP 429 / 5xx, per the failure contract in the header. */
export const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 500;

/** Per-request ceiling for Notion API calls. */
const REQUEST_TIMEOUT_MS = 20_000;
/** A signed upload URL takes the bytes themselves; 8 MiB needs longer. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Notion's rich-text ceiling; a longer caption is a 400, not a feature. */
const CAPTION_MAX = 2000;

const USAGE = `write-portfolio-to-notion — put the legacy portfolio images on their Notion pages

  node scripts/write-portfolio-to-notion.mjs [--dry-run] [--apply]

  --dry-run                 plan only, write nothing (the default)
  --apply                   upload and append blocks (writes to Notion)
  --state <path>            replay record (default: ${DEFAULT_STATE_PATH})
  --data-source-id <id>     Notion data source id (default: $NOTION_PORTFOLIO_DB_ID)
  --legacy-dir <path>       legacy corpus (default: ${DEFAULT_LEGACY_DIR})
  --allow-duplicates        start --apply without a state file (accepts duplicates)
  --help                    print this text

  Live mode reads NOTION_TOKEN from the environment. Output is status-only.
`;

/** An HTTP failure. The message carries a status, never a response body. */
class HttpFailure extends Error {
	constructor(message, { reason = 'http_error' } = {}) {
		super(message);
		this.name = 'HttpFailure';
		this.reason = reason;
	}
}

/**
 * Parse argv. Throws on anything it does not understand, so an operator
 * typo exits 2 before a single byte is read.
 */
export function parseArgs(argv) {
	const options = {
		help: false,
		apply: false,
		dryRun: false,
		state: DEFAULT_STATE_PATH,
		dataSourceId: null,
		legacyDir: DEFAULT_LEGACY_DIR,
		allowDuplicates: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		let arg = argv[index];
		let inline = null;
		const equals = arg.indexOf('=');
		if (arg.startsWith('--') && equals !== -1) {
			inline = arg.slice(equals + 1);
			arg = arg.slice(0, equals);
		}
		const takeValue = () => {
			if (inline !== null) return inline;
			const next = argv[index + 1];
			if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
			index += 1;
			return next;
		};
		if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg === '--apply') options.apply = true;
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--allow-duplicates') options.allowDuplicates = true;
		else if (arg === '--state') options.state = takeValue();
		else if (arg === '--data-source-id') options.dataSourceId = takeValue();
		else if (arg === '--legacy-dir') options.legacyDir = takeValue();
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (options.apply && options.dryRun) {
		throw new Error('pass either --apply or --dry-run, not both');
	}
	// Dry-run is the default: a write only ever happens because --apply
	// was written down.
	options.dryRun = !options.apply;
	return options;
}

/** The work key the legacy corpus identifies a file by. */
export function normalizeSlug(contentId) {
	return String(contentId).trim().toLowerCase().replaceAll('_', '-');
}

/** A declared `mime_type` without its (unused) parameters. */
export function normalizeMime(value) {
	return String(value ?? '')
		.split(';')[0]
		.trim()
		.toLowerCase();
}

/**
 * The media type of the leading bytes, or null when nothing in this
 * repository's vocabulary matches.
 *
 * The buffer is copied through `Buffer` on purpose: a BLOB arrives as a
 * `Uint8Array`, whose `toString()` ignores an encoding argument and would
 * render "71,73,70,…" instead of "GIF89a".
 */
export function sniffMime(bytes) {
	const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return 'image/png';
	}
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return 'image/jpeg';
	}
	if (buffer.length >= 6) {
		const head = buffer.subarray(0, 6).toString('latin1');
		if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
	}
	if (
		buffer.length >= 12 &&
		buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
		buffer.subarray(8, 12).toString('latin1') === 'WEBP'
	) {
		return 'image/webp';
	}
	// SVG is text: skip a BOM and leading whitespace, then look for the
	// declaration or the root element.
	const text = buffer
		.subarray(0, Math.min(buffer.length, 512))
		.toString('utf8')
		.replace(/^﻿/, '')
		.trimStart();
	if (/^<\?xml/i.test(text) || /^<svg[\s>]/i.test(text) || /^<!doctype svg/i.test(text)) {
		return 'image/svg+xml';
	}
	return null;
}

/** The caption Notion gets: the recorded alt text, else the file name. */
export function decideCaption(alt, filename) {
	const text = typeof alt === 'string' ? alt.trim() : '';
	if (text.length > 0) return text.slice(0, CAPTION_MAX);
	const name = typeof filename === 'string' ? filename.trim() : '';
	return name.length > 0 ? name.slice(0, CAPTION_MAX) : 'image';
}

/** The replay-record key for one file. */
export function stateKey(contentId, mediaId) {
	return `${contentId}/${mediaId}`;
}

/** The `image` block Notion API 2025-09-03 accepts (Issue #814). */
export function imageBlock({ uploadId, caption }) {
	return {
		object: 'block',
		type: 'image',
		image: {
			type: 'file_upload',
			file_upload: { id: uploadId },
			caption: [{ type: 'text', text: { content: caption } }],
		},
	};
}

/** The `Slug` property of a query result, or null when it has none. */
export function pageSlug(page) {
	const richText = page?.properties?.Slug?.rich_text;
	if (!Array.isArray(richText)) return null;
	const text = richText
		.map((node) => (typeof node?.plain_text === 'string' ? node.plain_text : ''))
		.join('')
		.trim();
	return text.length > 0 ? text : null;
}

/**
 * slug → page id for every page the data source returned.
 *
 * A duplicate slug is an ambiguity, not a choice: two pages cannot both
 * own one URL, and picking the first would attach a file to a page the
 * owner did not mean. The duplicates are reported so the caller can
 * refuse before anything is written.
 */
export function buildSlugIndex(pages) {
	const index = new Map();
	const duplicates = new Set();
	for (const page of pages) {
		const slug = pageSlug(page);
		if (slug === null || typeof page?.id !== 'string') continue;
		const key = normalizeSlug(slug);
		if (index.has(key)) duplicates.add(key);
		else index.set(key, page.id);
	}
	return { index, duplicates };
}

const MEDIA_SQL =
	'SELECT id, content_id, filename, mime_type, size, data, alt FROM media WHERE data IS NOT NULL';

function hasTable(db, name) {
	try {
		const row = db
			.prepare("select name from sqlite_master where type = 'table' and name = ?")
			.get(name);
		return row !== undefined && row !== null;
	} catch {
		return false;
	}
}

/**
 * Every media row of every legacy database, attributed through the
 * database's own `contents` row (see the header: `media.content_id` is
 * not the key).
 *
 * Databases without a `media` table are skipped; a database with media
 * but without exactly one `contents` row keeps its rows with
 * `contentId: null`, which `buildPlan` refuses as `undecidable_db`.
 */
export async function readLegacySources(legacyDir) {
	const { DatabaseSync } = await import('node:sqlite');
	const files = readdirSync(legacyDir)
		.filter((name) => name.startsWith('content-') && name.endsWith('.db'))
		.sort((left, right) => left.localeCompare(right, 'en'));
	const sources = [];
	for (const file of files) {
		let db;
		try {
			db = new DatabaseSync(join(legacyDir, file), { readOnly: true });
		} catch (error) {
			throw new Error(`unreadable legacy database: ${file} (${String(error?.code ?? 'error')})`);
		}
		try {
			if (!hasTable(db, 'media')) continue;
			const rows = db.prepare(MEDIA_SQL).all();
			if (rows.length === 0) continue;
			let contentRows = [];
			if (hasTable(db, 'contents')) {
				try {
					contentRows = db.prepare('SELECT id FROM contents').all();
				} catch {
					contentRows = [];
				}
			}
			const contentId =
				contentRows.length === 1 && typeof contentRows[0].id === 'string'
					? contentRows[0].id
					: null;
			sources.push({
				db: file,
				contentId,
				rows: rows.map((row) => {
					const bytes = Buffer.from(row.data);
					return {
						mediaId: String(row.id),
						filename: typeof row.filename === 'string' ? row.filename : 'image',
						declaredMime: row.mime_type,
						alt: typeof row.alt === 'string' ? row.alt : null,
						byteLength: bytes.byteLength,
						bytes,
					};
				}),
			});
		} finally {
			try {
				db.close();
			} catch {
				// A close failure is not a read failure; the read already succeeded.
			}
		}
	}
	return sources;
}

/**
 * Decide what to upload.
 *
 * Pure: the corpus, the slug index and the replay record are arguments,
 * so the whole decision — including every refusal — is testable without
 * a network, a Notion token or a real database.
 */
export function buildPlan(sources, slugIndex, stateEntries) {
	const plan = [];
	const skipped = { no_notion_page: 0, undecidable_db: 0, mime_mismatch: 0, replayed: 0 };
	for (const source of sources) {
		if (source.contentId === null) {
			skipped.undecidable_db += source.rows.length;
			continue;
		}
		const slug = normalizeSlug(source.contentId);
		const pageId = slugIndex.get(slug) ?? null;
		for (const row of source.rows) {
			const key = stateKey(source.contentId, row.mediaId);
			if (stateEntries.has(key)) {
				skipped.replayed += 1;
				continue;
			}
			if (pageId === null) {
				skipped.no_notion_page += 1;
				continue;
			}
			const sniffed = sniffMime(row.bytes);
			if (sniffed === null || sniffed !== normalizeMime(row.declaredMime)) {
				skipped.mime_mismatch += 1;
				continue;
			}
			plan.push({
				key,
				contentId: source.contentId,
				slug,
				pageId,
				mediaId: row.mediaId,
				filename: row.filename,
				mime: sniffed,
				byteLength: row.byteLength,
				sha256: createHash('sha256').update(row.bytes).digest('hex'),
				caption: decideCaption(row.alt, row.filename),
				bytes: row.bytes,
			});
		}
	}
	return { plan, skipped };
}

/** The upload count per slug, sorted so two runs print the same lines. */
export function planPageCounts(plan) {
	const counts = new Map();
	for (const entry of plan) counts.set(entry.slug, (counts.get(entry.slug) ?? 0) + 1);
	return [...counts].sort(([left], [right]) => left.localeCompare(right, 'en'));
}

export function planBytes(plan) {
	return plan.reduce((sum, entry) => sum + entry.byteLength, 0);
}

/** Read the replay record. Returns null when there is none yet. */
export function readState(path) {
	if (!existsSync(path)) return null;
	const parsed = JSON.parse(readFileSync(path, 'utf8'));
	if (parsed?.schema !== STATE_SCHEMA || typeof parsed?.entries !== 'object') {
		throw new Error('state file is not a portfolio write record');
	}
	return new Map(Object.entries(parsed.entries));
}

/**
 * Rewrite the replay record.
 *
 * Flushed after every successful file: the whole point of the record is
 * that a crash at file 90 resumes at file 91 instead of appending a
 * second copy of the first 90.
 */
export function writeState(path, entries) {
	mkdirSync(dirname(path), { recursive: true });
	const document = { schema: STATE_SCHEMA, entries: Object.fromEntries(entries) };
	writeFileSync(path, `${JSON.stringify(document, null, '\t')}\n`);
}

/** A status-only code for a failure. Never a body, never a token. */
function failureReason(error) {
	if (error instanceof HttpFailure) return error.reason;
	return 'network';
}

/**
 * A JSON request to the Notion API with the retry contract.
 *
 * Only HTTP 429 and 5xx are retried, because those are the statuses that
 * say "not processed". A network error during a block append could mean
 * the block WAS appended, and retrying it would put a second copy of the
 * image on the page — so a connection failure fails that one file and is
 * counted, never retried. Response bodies are never included in an error.
 */
async function requestJson({ url, method = 'GET', token = null, body, fetchImpl, sleep }) {
	let attempt = 0;
	for (;;) {
		let response;
		try {
			response = await fetchImpl(url, {
				method,
				headers: {
					...(token === null ? {} : { Authorization: `Bearer ${token}` }),
					'Notion-Version': NOTION_API_VERSION,
					'Content-Type': 'application/json',
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new HttpFailure('network request failed', { reason: 'network' });
		}
		if (response.status === 429 || response.status >= 500) {
			if (attempt < MAX_RETRIES) {
				attempt += 1;
				await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
				continue;
			}
			throw new HttpFailure(`HTTP ${response.status} after ${MAX_RETRIES} retries`, {
				reason: `http_${response.status}`,
			});
		}
		if (!response.ok) {
			throw new HttpFailure(`HTTP ${response.status}`, { reason: `http_${response.status}` });
		}
		try {
			return await response.json();
		} catch {
			throw new HttpFailure('response was not JSON', { reason: 'malformed_response' });
		}
	}
}

/** Every page of the portfolio data source, so a slug can find its page. */
async function queryNotionPages({ targetId, isDataSource, token, fetchImpl, sleep }) {
	let id = null;
	if (isDataSource) {
		// `--data-source-id` was written down by the operator: it is used as
		// given, and nothing is discovered from it.
		id = targetId;
	} else {
		// The configured id may be a database id, and the query endpoint
		// takes its data source. It may also be a data-source id — the value
		// the Notion UI hands out for exactly this endpoint — which
		// `/databases/{id}` does not know, so a 404 falls back to querying
		// the same value directly. A miss on BOTH is still an operator
		// problem, and it is reported as one.
		try {
			const database = await requestJson({
				url: `${NOTION_API_BASE}/databases/${encodeURIComponent(targetId)}`,
				token,
				fetchImpl,
				sleep,
			});
			const sources = Array.isArray(database?.data_sources) ? database.data_sources : [];
			const usable = sources.filter((source) => typeof source?.id === 'string');
			if (usable.length !== 1) {
				throw new HttpFailure('database has no single data source', {
					reason: usable.length > 1 ? 'multiple_data_sources' : 'no_data_source',
				});
			}
			id = usable[0].id;
		} catch (error) {
			const isDatabaseMiss = error instanceof HttpFailure && error.reason === 'http_404';
			if (!isDatabaseMiss) throw error;
			id = targetId;
		}
	}
	const pages = [];
	let cursor;
	for (let page = 0; page < 40; page += 1) {
		const body = await requestJson({
			url: `${NOTION_API_BASE}/data_sources/${encodeURIComponent(id)}/query`,
			method: 'POST',
			body: cursor === undefined ? {} : { start_cursor: cursor },
			token,
			fetchImpl,
			sleep,
		});
		if (Array.isArray(body?.results)) pages.push(...body.results);
		if (body?.has_more !== true) return pages;
		const next = body?.next_cursor;
		if (typeof next !== 'string' || next.length === 0) {
			throw new HttpFailure('pagination reported more results but gave no cursor', {
				reason: 'malformed_response',
			});
		}
		cursor = next;
	}
	throw new HttpFailure('pagination exceeded the page ceiling', { reason: 'malformed_response' });
}

/** Step 4a: create the file upload object (returns id + upload_url). */
function createFileUpload({ filename, mime, token, fetchImpl, sleep }) {
	return requestJson({
		url: `${NOTION_API_BASE}/file_uploads`,
		method: 'POST',
		body: { filename, content_type: mime },
		token,
		fetchImpl,
		sleep,
	});
}

/**
 * Step 4b: send the bytes to the signed upload URL.
 *
 * A signed URL is not an API endpoint: no `Authorization`, no
 * `Notion-Version`. The multipart field is `file`, and the body is built
 * per attempt because a `FormData` is consumed by the first fetch.
 */
async function uploadBytes({ url, bytes, filename, mime, fetchImpl, sleep }) {
	let attempt = 0;
	for (;;) {
		const form = new FormData();
		form.append('file', new Blob([bytes], { type: mime }), filename);
		let response;
		try {
			response = await fetchImpl(url, {
				method: 'POST',
				body: form,
				signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
			});
		} catch {
			throw new HttpFailure('network request failed', { reason: 'network' });
		}
		if (response.status === 429 || response.status >= 500) {
			if (attempt < MAX_RETRIES) {
				attempt += 1;
				await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
				continue;
			}
			throw new HttpFailure(`HTTP ${response.status} after ${MAX_RETRIES} retries`, {
				reason: `http_${response.status}`,
			});
		}
		if (!response.ok) {
			throw new HttpFailure(`HTTP ${response.status}`, { reason: `http_${response.status}` });
		}
		// The body is read only to learn the status word; it is never
		// rendered, so an error path cannot echo an upstream message.
		let payload = null;
		try {
			payload = await response.json();
		} catch {
			payload = null;
		}
		if (payload !== null && typeof payload?.status === 'string' && payload.status !== 'uploaded') {
			throw new HttpFailure('upload was not accepted', { reason: 'upload_rejected' });
		}
		return;
	}
}

/** Step 5: append one `image` block to the end of the page. */
async function appendImageBlock({ pageId, block, token, fetchImpl, sleep }) {
	const body = await requestJson({
		url: `${NOTION_API_BASE}/blocks/${encodeURIComponent(pageId)}/children`,
		method: 'PATCH',
		body: { children: [block] },
		token,
		fetchImpl,
		sleep,
	});
	const first = Array.isArray(body?.results) ? body.results[0] : null;
	if (typeof first?.id !== 'string') {
		throw new HttpFailure('block response had no id', { reason: 'malformed_response' });
	}
	return first.id;
}

/** Run one invocation. Returns the exit code; prints status-only lines. */
export async function run({
	argv = process.argv.slice(2),
	env = process.env,
	fetchImpl = globalThis.fetch,
	stdout = process.stdout,
	stderr = process.stderr,
	sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
		return EXIT.INPUT;
	}
	if (options.help) {
		stdout.write(USAGE);
		return EXIT.OK;
	}

	const token = readToken(env);
	const targetId = options.dataSourceId ?? readDatabaseId(env);
	if (token === null) {
		stderr.write('missing credential: NOTION_TOKEN is not set\n');
		return EXIT.INPUT;
	}
	if (targetId === null) {
		stderr.write('missing target: pass --data-source-id or set NOTION_PORTFOLIO_DB_ID\n');
		return EXIT.INPUT;
	}

	const statePath = isAbsolute(options.state) ? options.state : resolve(REPO_ROOT, options.state);
	const legacyDir = isAbsolute(options.legacyDir)
		? options.legacyDir
		: resolve(REPO_ROOT, options.legacyDir);

	let stateEntries;
	try {
		stateEntries = readState(statePath);
	} catch {
		stderr.write(`refused: state file could not be read (${statePath})\n`);
		return EXIT.REFUSED;
	}
	if (stateEntries === null) {
		if (options.apply && !options.allowDuplicates) {
			stderr.write(
				`refused: no state file at ${statePath}; pass --allow-duplicates to upload without a replay record\n`,
			);
			return EXIT.REFUSED;
		}
		stateEntries = new Map();
	}

	if (!existsSync(legacyDir)) {
		stderr.write(`missing legacy corpus: ${legacyDir}\n`);
		return EXIT.INPUT;
	}

	let sources;
	try {
		sources = await readLegacySources(legacyDir);
	} catch (error) {
		stderr.write(`${error instanceof Error ? error.message : 'unreadable legacy corpus'}\n`);
		return EXIT.INPUT;
	}

	let pages;
	try {
		pages = await queryNotionPages({
			targetId,
			isDataSource: options.dataSourceId !== null,
			token,
			fetchImpl,
			sleep,
		});
	} catch (error) {
		stderr.write(`refused: notion read failed (${failureReason(error)})\n`);
		return EXIT.REFUSED;
	}

	const { index, duplicates } = buildSlugIndex(pages);
	if (duplicates.size > 0) {
		stderr.write(`refused: data source carries ${duplicates.size} duplicate slug(s)\n`);
		return EXIT.REFUSED;
	}

	const { plan, skipped } = buildPlan(sources, index, stateEntries);
	stdout.write(
		`plan: upload=${plan.length} skip_no_notion_page=${skipped.no_notion_page} skip_undecidable_db=${skipped.undecidable_db} skip_mime_mismatch=${skipped.mime_mismatch} replayed=${skipped.replayed} bytes=${planBytes(plan)}\n`,
	);
	for (const [slug, count] of planPageCounts(plan)) {
		stdout.write(`page ${slug}: upload=${count}\n`);
	}

	if (options.dryRun) {
		stdout.write(`dry-run: nothing written upload=${plan.length} bytes=${planBytes(plan)}\n`);
		return EXIT.OK;
	}

	let uploaded = 0;
	let failed = 0;
	let writtenBytes = 0;
	for (const entry of plan) {
		try {
			const created = await createFileUpload({
				filename: entry.filename,
				mime: entry.mime,
				token,
				fetchImpl,
				sleep,
			});
			if (typeof created?.id !== 'string' || typeof created?.upload_url !== 'string') {
				throw new HttpFailure('file upload response lacked an id or upload url', {
					reason: 'malformed_response',
				});
			}
			await uploadBytes({
				url: created.upload_url,
				bytes: entry.bytes,
				filename: entry.filename,
				mime: entry.mime,
				fetchImpl,
				sleep,
			});
			const blockId = await appendImageBlock({
				pageId: entry.pageId,
				block: imageBlock({ uploadId: created.id, caption: entry.caption }),
				token,
				fetchImpl,
				sleep,
			});
			stateEntries.set(entry.key, {
				blockId,
				sha256: entry.sha256,
				bytes: entry.byteLength,
			});
			writeState(statePath, stateEntries);
			uploaded += 1;
			writtenBytes += entry.byteLength;
		} catch (error) {
			// One rejected file must not cost the other 135.
			failed += 1;
			stderr.write(
				`failed page=${entry.slug} media=${entry.mediaId} reason=${failureReason(error)}\n`,
			);
		}
	}

	stdout.write(
		`applied: uploaded=${uploaded} blocks=${uploaded} bytes=${writtenBytes} replayed=${skipped.replayed} failed=${failed}\n`,
	);
	return failed > 0 ? EXIT.PARTIAL : EXIT.OK;
}

async function main() {
	return run();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await main();
}
