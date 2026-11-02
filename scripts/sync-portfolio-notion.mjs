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
 * Failure semantics:
 *   - a **content refusal** (an unknown section heading, an image block,
 *     a malformed link) exits 1 and writes nothing. Publishing a page with
 *     a paragraph silently missing is the failure this refuses to make.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapDocuments } from './_notion-mapper.mjs';
import {
	NotionTransportError,
	NotionUnavailable,
	fetchNotionPortfolio,
	readDatabaseId,
	readToken,
} from './_notion-transport.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
export const SNAPSHOT_SCHEMA = 'portfolio-notion-snapshot.v1';

const USAGE = `sync-portfolio-notion — build the portfolio snapshot from Notion

  node scripts/sync-portfolio-notion.mjs [--fixture <path>] [--dry-run] [--force]

  --fixture <path>       read a Notion-shaped JSON file instead of the API
  --database-id <id>     Notion database id (default: $NOTION_PORTFOLIO_DB_ID)
  --out <path>           where to write the snapshot (default: the bundled file)
  --dry-run              map and validate, write nothing
  --force                write even when the content digest is unchanged
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
		if (arg === '--fixture' || arg === '--database-id' || arg === '--out') {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
			if (arg === '--fixture') options.fixture = value;
			if (arg === '--database-id') options.databaseId = value;
			if (arg === '--out') options.out = value;
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

/** Status-only line. Never prints document text. */
function report(status, fields, stdout) {
	const parts = [`${status} records=${fields.records ?? 0}`];
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
	now = new Date(),
	env = process.env,
	fetchImpl = globalThis.fetch,
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

	const { records, errors } = mapDocuments(source.pages);
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

	const unchanged = previous !== null && previous.contentDigest === snapshot.contentDigest;
	const write = !dryRun && (force || !unchanged);
	if (write) writeSnapshot(outPath, serialized);

	report(
		unchanged && !force ? 'unchanged' : 'synced',
		{
			records: records.length,
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
	});
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await main();
}
