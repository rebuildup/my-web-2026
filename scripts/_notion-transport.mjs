/**
 * Notion API reads for the portfolio sync (Issue #765).
 *
 * This is the only module in the repository that talks to Notion, and it
 * runs at **build time only** — the Worker never imports it and never holds
 * the token. The shape mirrors `scripts/_project-introduction.mjs`, which
 * established the same split for the GitHub README sync: one module owns the
 * outbound request, the CLI owns the decision.
 *
 * Three rules that are not negotiable here:
 *
 *   1. **The token is read from the environment, never printed, never
 *      logged, never written to the snapshot.** Every error this module
 *      raises carries a status code and a short reason, never a response
 *      body and never a request header.
 *   2. **A transport failure is an outage, not a content decision.** The
 *      caller records an `unavailable` snapshot and keeps the last known
 *      records; nothing here invents an empty database.
 *   3. **Pagination is bounded.** A page that keeps returning `has_more` is
 *      a bug or an adversarial response, not something to follow forever.
 *
 * API version: `2025-09-03` pins the data-source model. It is the oldest
 * version that carries it, so it is the most stable supported choice;
 * `POST /v1/databases/{id}/query` is deprecated as of that version and is
 * deliberately not used (see ADR-0018 §2.4).
 */

export const NOTION_API_BASE = 'https://api.notion.com/v1';

/** Oldest version with the data-source model. See the module note. */
export const NOTION_API_VERSION = '2025-09-03';

/** A Notion response body larger than this is treated as hostile. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Per-request ceiling. A build step may take seconds, not minutes. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Upper bound on pagination, so a loop cannot become an outage of its own. */
export const MAX_PAGES = 40;

/** A failure the operator must act on (credential, network, HTTP error). */
export class NotionTransportError extends Error {
	constructor(message, { status = null } = {}) {
		super(message);
		this.name = 'NotionTransportError';
		this.status = status;
	}
}

/** The source cannot be read right now; the last known content stays published. */
export class NotionUnavailable extends Error {
	constructor(reason) {
		super(reason);
		this.name = 'NotionUnavailable';
		this.reason = reason;
	}
}

/**
 * The token, from the environment.
 *
 * Returns `null` rather than throwing so the CLI can print "which variable
 * is missing, where it belongs, and what to run next" instead of an
 * exception. It is never included in anything this module writes.
 */
export function readToken(env = process.env) {
	const value = env.NOTION_TOKEN;
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** The database id, from `--database-id` or the environment. */
export function readDatabaseId(env = process.env) {
	const value = env.NOTION_PORTFOLIO_DATABASE_ID;
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function request({ path, method = 'GET', body, token, fetchImpl, version }) {
	let response;
	try {
		response = await fetchImpl(`${NOTION_API_BASE}${path}`, {
			method,
			headers: {
				// The only place the token is used. It is never logged.
				Authorization: `Bearer ${token}`,
				'Notion-Version': version ?? NOTION_API_VERSION,
				'Content-Type': 'application/json',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		// Timeout, DNS, TLS, connection reset. The message is the runtime's,
		// which carries no credential.
		throw new NotionTransportError(
			error instanceof Error && error.name === 'TimeoutError'
				? 'request timed out'
				: 'network request failed',
		);
	}

	if (!response.ok) {
		const status = response.status;
		if (status === 401 || status === 403) {
			throw new NotionTransportError(
				'credential rejected or integration not shared with the database',
				{
					status,
				},
			);
		}
		if (status === 404) {
			throw new NotionTransportError(
				'database or page not found (check the id and the integration share)',
				{
					status,
				},
			);
		}
		if (status === 429) {
			throw new NotionUnavailable('rate_limited');
		}
		if (status >= 500) {
			throw new NotionUnavailable('source_error');
		}
		throw new NotionTransportError(`request rejected (HTTP ${status})`, { status });
	}

	let text;
	try {
		text = await response.text();
	} catch {
		throw new NotionTransportError('response body could not be read');
	}
	if (text.length > MAX_RESPONSE_BYTES) {
		throw new NotionTransportError('response body exceeded the size ceiling');
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new NotionTransportError('response was not JSON');
	}
}

/**
 * Read the database object.
 *
 * The id the owner configures is a **database** id, and a database now
 * carries one or more data sources. The query endpoint takes a data source
 * id, so this read is the one that discovers it — it is not a convenience.
 */
export async function fetchDatabase({ databaseId, token, fetchImpl = globalThis.fetch, version }) {
	const body = await request({
		path: `/databases/${encodeURIComponent(databaseId)}`,
		token,
		fetchImpl,
		version,
	});
	if (typeof body?.id !== 'string') {
		throw new NotionTransportError('database response had no id');
	}
	return body;
}

/**
 * Pick the data source to query.
 *
 * A second data source is not handled automatically: which one is the
 * portfolio is an owner decision, and silently taking the first would
 * publish a different table's rows under the portfolio's URLs.
 */
export function selectDataSource(database) {
	const sources = Array.isArray(database?.data_sources) ? database.data_sources : [];
	const usable = sources.filter((source) => typeof source?.id === 'string');
	if (usable.length === 0) {
		throw new NotionTransportError(
			'database has no data source (is the integration shared with the database?)',
		);
	}
	if (usable.length > 1) {
		throw new NotionTransportError(
			`database has ${usable.length} data sources; the portfolio must be exactly one`,
		);
	}
	return usable[0];
}

/** Every page in the data source, following `next_cursor`. */
export async function queryDataSource({
	dataSourceId,
	token,
	fetchImpl = globalThis.fetch,
	version,
}) {
	const results = [];
	let cursor;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		const body = await request({
			path: `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
			method: 'POST',
			body: cursor === undefined ? {} : { start_cursor: cursor },
			token,
			fetchImpl,
			version,
		});
		if (Array.isArray(body?.results)) results.push(...body.results);
		if (body?.has_more !== true) return results;
		const next = body?.next_cursor;
		if (typeof next !== 'string' || next.length === 0) {
			throw new NotionTransportError('pagination reported more results but gave no cursor');
		}
		cursor = next;
	}
	throw new NotionTransportError('pagination exceeded the page ceiling');
}

/** Every child block of a page, flattened one level deep. */
export async function fetchBlockChildren({
	blockId,
	token,
	fetchImpl = globalThis.fetch,
	version,
}) {
	const blocks = [];
	let cursor;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		const suffix = cursor === undefined ? '' : `&start_cursor=${encodeURIComponent(cursor)}`;
		const body = await request({
			path: `/blocks/${encodeURIComponent(blockId)}/children?page_size=100${suffix}`,
			token,
			fetchImpl,
			version,
		});
		if (Array.isArray(body?.results)) blocks.push(...body.results);
		if (body?.has_more !== true) return blocks;
		const next = body?.next_cursor;
		if (typeof next !== 'string' || next.length === 0) {
			throw new NotionTransportError('pagination reported more results but gave no cursor');
		}
		cursor = next;
	}
	throw new NotionTransportError('pagination exceeded the page ceiling');
}

/**
 * Read the whole database: its pages and each page's blocks.
 *
 * Returns the same intermediate shape a fixture file has, so the mapping
 * path is identical in both modes — that is what makes the fixture a real
 * test of the real path rather than a parallel implementation.
 */
export async function fetchNotionPortfolio({
	databaseId,
	token,
	fetchImpl = globalThis.fetch,
	version,
	maxPages = 200,
}) {
	const database = await fetchDatabase({ databaseId, token, fetchImpl, version });
	const dataSource = selectDataSource(database);
	const pages = await queryDataSource({
		dataSourceId: dataSource.id,
		token,
		fetchImpl,
		version,
	});
	if (pages.length > maxPages) {
		throw new NotionTransportError(
			`database has more than ${maxPages} pages; refusing to sync all of them`,
		);
	}

	const documents = [];
	for (const page of pages) {
		// A child page or a database row without a body still maps: the
		// section text is empty and the properties carry the entry.
		const pageId = typeof page?.id === 'string' ? page.id : null;
		if (pageId === null) throw new NotionTransportError('a query result had no id');
		const blocks = await fetchBlockChildren({ blockId: pageId, token, fetchImpl, version });
		documents.push({ page, blocks });
	}

	return {
		databaseId: database.id,
		// Deliberately not published: the database URL is an internal
		// identifier and this file is bundled into the build.
		sourceUrl: null,
		pages: documents,
	};
}
