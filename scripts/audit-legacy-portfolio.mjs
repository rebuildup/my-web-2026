#!/usr/bin/env node
/**
 * Legacy portfolio inventory — my-web-2025 → migration ledger (Issue #766).
 *
 * Usage:
 *   node scripts/audit-legacy-portfolio.mjs --source=.reference/my-web-2025
 *   node scripts/audit-legacy-portfolio.mjs --source=… --format=json
 *   node scripts/audit-legacy-portfolio.mjs --source=… --check   # drift gate
 *
 * What this script is FOR: the migration ledger
 * (`docs/migration/notion-migration-ledger.md`) has to say, per legacy
 * item, what its old URL was, what state it was in, and how much media
 * came with it. Issue #78's classifier already records the classification,
 * the owner-selection state and the per-row counts — this script does NOT
 * reclassify anything and does not rewrite that artefact. It joins four
 * facts the classification does not carry:
 *
 *   1. `contents.public_url` — the old site's URL for the row. The legacy
 *      schema stores it; it is read, never derived.
 *   2. `media` — count, byte total and mime breakdown, measured from the
 *      BLOB column length (the blob itself is never selected).
 *   3. rights state — every legacy asset is `unrecorded` until
 *      `quality/asset-license-inventory.json` records it. The inventory is
 *      read here; the verdict vocabulary stays owned by `src/legal/**`.
 *   4. the Notion/new-URL columns, which are `null` by construction: no
 *      page has been created and no destination has been decided.
 *
 * Titles and body text are deliberately NOT read into the output. The
 * ledger needs identifiers and states, not prose, and copying a title into
 * a public repository is a publication decision the owner has not made
 * (client names appear in some of them — ADR-0018 §5-7).
 *
 * Output contract: `--format=summary` (default) prints counts and a
 * verdict only; `--format=json` prints the document to stdout. Neither
 * ever prints a media byte, a body, or a credential. There is no secret in
 * this input, but the status-only shape is the repository's convention for
 * operator tooling (AGENTS.md §4) and is kept anyway.
 *
 * Exit codes: 0 = inventory produced / no drift, 1 = `--check` found drift,
 * 2 = bad input (missing source, missing classification, Node too old),
 * 3 = a legacy database could not be read (nothing is written).
 *
 * The input directory is a gitignored reference clone (AGENTS.md §9), so
 * this script is an operator tool: it is not part of `validate:fast` and
 * cannot run in CI.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT = { OK: 0, DRIFT: 1, INPUT: 2, UNREADABLE: 3 };

const INVENTORY_SCHEMA = 'portfolio-2025-inventory.v1';
const DEFAULT_SOURCE = '.reference/my-web-2025';
const DEFAULT_CLASSIFICATION = 'docs/migration/portfolio-2025-to-2026-classification.json';
const DEFAULT_OUT = 'docs/migration/portfolio-2025-inventory.json';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * Parse `--flag=value` / `--flag value` / bare `--flag` without a
 * dependency. A bare flag is `true`; anything else is a string.
 */
export function parseArgs(argv) {
	const flags = new Map();
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith('--')) continue;
		const eq = token.indexOf('=');
		if (eq !== -1) {
			flags.set(token.slice(2, eq), token.slice(eq + 1));
			continue;
		}
		const next = argv[index + 1];
		if (next !== undefined && !next.startsWith('--')) {
			flags.set(token.slice(2), next);
			index += 1;
			continue;
		}
		flags.set(token.slice(2), true);
	}
	return flags;
}

/** The DB files that make up the legacy corpus, sorted for determinism. */
export function listLegacyDatabases(contentsDir) {
	return readdirSync(contentsDir)
		.filter((name) => name.startsWith('content-') && name.endsWith('.db'))
		.sort((left, right) => left.localeCompare(right, 'en'));
}

/**
 * The classification row a database maps to, or `null`.
 *
 * The join key is the DB file name (`content-Border.db`), not the content
 * id: Issue #78's classifier keys on the file and the two can differ in
 * case. A missing row is reported, never silently classified here — this
 * script does not own classification.
 */
export function indexClassification(classification) {
	const byDb = new Map();
	for (const row of classification?.classified ?? []) {
		if (typeof row?.db === 'string' && row.db.length > 0) byDb.set(row.db, row);
	}
	return byDb;
}

/**
 * Rights state for one legacy item.
 *
 * Fail-closed: an asset is `recorded` only when the inventory has an entry
 * whose `id` is this exact legacy key. Everything else is `unrecorded`,
 * which is what the ledger prints and what `src/legal/**` would refuse to
 * publish.
 */
export function rightsStateFor(legacyKey, inventoryIds) {
	return inventoryIds.has(legacyKey) ? 'recorded' : 'unrecorded';
}

/** The inventory's asset ids, as a Set. Missing/invalid inventory = empty. */
export function inventoryAssetIds(inventory) {
	const ids = new Set();
	for (const asset of inventory?.assets ?? []) {
		if (typeof asset?.id === 'string') ids.add(asset.id);
	}
	return ids;
}

/** Stable digest over the items, so `--check` can name drift cheaply. */
export function inventoryDigest(items) {
	return `sha256:${createHash('sha256').update(JSON.stringify(items)).digest('hex')}`;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * A table's presence, so a database written by an older legacy schema is
 * reported instead of throwing a SQL error.
 */
function hasTable(db, name) {
	const row = db
		.prepare("select name from sqlite_master where type = 'table' and name = ?")
		.get(name);
	return row !== undefined && row !== null;
}

/**
 * Measure one legacy database. Returns the ledger row plus the counts the
 * summary needs. `data` is never selected — only its length.
 */
function measureDatabase(db, { dbFile, classificationRow, inventoryIds }) {
	const contents = hasTable(db, 'contents')
		? db
				.prepare(
					'select id, public_url, visibility, status, published_at, updated_at from contents',
				)
				.all()
		: [];

	const media = hasTable(db, 'media')
		? db
				.prepare(
					'select content_id, mime_type, count(*) as files, coalesce(sum(length(data)), 0) as bytes from media group by content_id, mime_type',
				)
				.all()
		: [];

	// `media.content_id` is nullable (the legacy FK is ON DELETE SET NULL),
	// so a file with no owner is counted as unassigned rather than dropped.
	let mediaFiles = 0;
	let mediaBytes = 0;
	const mediaMime = {};
	const mediaByContent = new Map();
	for (const row of media) {
		const files = Number(row.files ?? 0);
		const bytes = Number(row.bytes ?? 0);
		mediaFiles += files;
		mediaBytes += bytes;
		const mime = typeof row.mime_type === 'string' ? row.mime_type : 'unknown';
		mediaMime[mime] = (mediaMime[mime] ?? 0) + files;
		const owner = typeof row.content_id === 'string' ? row.content_id : null;
		const bucket = mediaByContent.get(owner) ?? { files: 0, bytes: 0 };
		bucket.files += files;
		bucket.bytes += bytes;
		mediaByContent.set(owner, bucket);
	}

	const assets = hasTable(db, 'content_assets')
		? Number(db.prepare('select count(*) as n from content_assets').get().n ?? 0)
		: 0;
	const markdownPages = hasTable(db, 'markdown_pages')
		? Number(db.prepare('select count(*) as n from markdown_pages').get().n ?? 0)
		: 0;

	// One database carries one content row in the legacy corpus. If a
	// database ever carries more, every row is emitted rather than one being
	// picked — a silent pick would misattribute an old URL to an item.
	const rows = (contents.length > 0 ? contents : [null]).map((content) => {
		const contentId = typeof content?.id === 'string' ? content.id : null;
		const mediaBucket = mediaByContent.get(contentId) ?? { files: 0, bytes: 0 };
		const legacyKey = contentId ?? dbFile.replace(/^content-/, '').replace(/\.db$/, '');
		return {
			id: contentId ?? legacyKey,
			db: dbFile,
			// 種別: the classification's work facets, plus whether a content
			// row even exists. Not inferred here.
			facets: Array.isArray(classificationRow?.facets) ? classificationRow.facets : [],
			old_url: typeof content?.public_url === 'string' ? content.public_url : null,
			visibility: typeof content?.visibility === 'string' ? content.visibility : null,
			status: typeof content?.status === 'string' ? content.status : null,
			published_at: typeof content?.published_at === 'string' ? content.published_at : null,
			updated_at: typeof content?.updated_at === 'string' ? content.updated_at : null,
			migration_class: classificationRow?.migration_class ?? null,
			publication: classificationRow?.publication ?? null,
			publication_blockers: Array.isArray(classificationRow?.publication_blockers)
				? classificationRow.publication_blockers
				: [],
			media: { files: mediaBucket.files, bytes: mediaBucket.bytes },
			assets,
			markdown_pages: markdownPages,
			external_videos: Number(classificationRow?.external_video_count ?? 0),
			rights: rightsStateFor(legacyKey, inventoryIds),
			// 未決定の 2 列。どちらも agent は埋めない。
			notion_page: null,
			new_url: null,
		};
	});

	const orphan = mediaByContent.get(null) ?? { files: 0, bytes: 0 };

	return {
		rows,
		hasContentRow: contents.length > 0,
		orphanFiles: orphan.files,
		orphanBytes: orphan.bytes,
		mediaFiles,
		mediaBytes,
		mediaMime,
		assets,
		markdownPages,
	};
}

/**
 * Build the inventory document. Pure with respect to the filesystem: the
 * caller supplies the databases, the classification and the inventory.
 */
export function buildInventory({
	sourcePath,
	sourceHead,
	classificationPath,
	classification,
	inventory,
	now,
	openDatabase,
}) {
	const byDb = indexClassification(classification);
	const inventoryIds = inventoryAssetIds(inventory);
	const items = [];
	const problems = [];
	const totals = { mediaFiles: 0, mediaBytes: 0, assets: 0, markdownPages: 0 };
	let orphanFiles = 0;
	let orphanBytes = 0;
	const mediaMime = {};
	let databaseCount = 0;
	let emptyDatabases = 0;

	for (const dbFile of listLegacyDatabases(join(sourcePath, 'data/contents'))) {
		databaseCount += 1;
		let db;
		try {
			db = openDatabase(join(sourcePath, 'data/contents', dbFile));
			const measured = measureDatabase(db, {
				dbFile,
				classificationRow: byDb.get(dbFile) ?? null,
				inventoryIds,
			});
			if (!measured.hasContentRow) emptyDatabases += 1;
			for (const row of measured.rows) items.push(row);
			totals.mediaFiles += measured.mediaFiles;
			totals.mediaBytes += measured.mediaBytes;
			totals.assets += measured.assets;
			totals.markdownPages += measured.markdownPages;
			orphanFiles += measured.orphanFiles;
			orphanBytes += measured.orphanBytes;
			for (const [mime, files] of Object.entries(measured.mediaMime)) {
				mediaMime[mime] = (mediaMime[mime] ?? 0) + files;
			}
		} catch (error) {
			problems.push({ db: dbFile, reason: String(error?.code ?? error?.message ?? error) });
		} finally {
			try {
				db?.close();
			} catch {
				// A close failure is not a read failure; the read already succeeded.
			}
		}
	}

	items.sort((left, right) => {
		const byId = String(left.id).localeCompare(String(right.id), 'en');
		return byId !== 0 ? byId : String(left.db).localeCompare(String(right.db), 'en');
	});

	const withoutClassification = items.filter((item) => item.migration_class === null).length;
	const byState = {};
	for (const item of items) {
		const key = `${item.status ?? 'none'}/${item.visibility ?? 'none'}`;
		byState[key] = (byState[key] ?? 0) + 1;
	}
	const byPublication = {};
	for (const item of items) {
		const key = item.publication ?? 'unclassified';
		byPublication[key] = (byPublication[key] ?? 0) + 1;
	}

	return {
		schema: INVENTORY_SCHEMA,
		generated_at: now,
		source: {
			path: sourcePath,
			head: sourceHead,
			classification: classificationPath,
			classification_generated_at: classification?.generated_at ?? null,
		},
		counts: {
			databases: databaseCount,
			empty_databases: emptyDatabases,
			items: items.length,
			...totals,
			// `media.content_id` is nullable in the legacy schema, so a file can
			// exist with no item to attribute it to. It is counted here rather
			// than dropped: the ledger cannot invent an owner for it.
			unattributed_media: { files: orphanFiles, bytes: orphanBytes },
			without_classification: withoutClassification,
			by_state: byState,
			by_publication: byPublication,
			media_mime: mediaMime,
		},
		rights: {
			// Every legacy media byte starts here: `quality/asset-license-inventory.json`
			// records no legacy asset, so nothing may be published
			// until an owner decision records it (`src/legal/**` is fail-closed).
			recorded: items.filter((item) => item.rights === 'recorded').length,
			unrecorded: items.filter((item) => item.rights === 'unrecorded').length,
		},
		problems,
		content_digest: inventoryDigest(items),
		items,
	};
}

function resolveHead(sourcePath) {
	try {
		const headFile = join(sourcePath, '.git/HEAD');
		if (!existsSync(headFile)) return null;
		const head = readFileSync(headFile, 'utf8').trim();
		const ref = /^ref:\s*(.+)$/.exec(head);
		if (!ref) return head;
		const refFile = join(sourcePath, '.git', ref[1]);
		if (existsSync(refFile)) return readFileSync(refFile, 'utf8').trim();
		const packed = join(sourcePath, '.git/packed-refs');
		if (existsSync(packed)) {
			for (const line of readFileSync(packed, 'utf8').split('\n')) {
				const [sha, name] = line.trim().split(/\s+/);
				if (name === ref[1]) return sha ?? null;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Drift: everything except the fields that legitimately move between two
 * runs. `generated_at` is the observation instant; the source HEAD only
 * moves when the reference clone is updated, which IS drift worth seeing,
 * so it is compared.
 */
export function diffInventories(previous, next) {
	const differences = [];
	if (previous?.content_digest !== next.content_digest) {
		const before = new Map((previous?.items ?? []).map((item) => [item.id, item]));
		const after = new Map((next.items ?? []).map((item) => [item.id, item]));
		for (const [id, item] of after) {
			const old = before.get(id);
			if (old === undefined) differences.push(`added: ${id}`);
			else if (JSON.stringify(old) !== JSON.stringify(item)) differences.push(`changed: ${id}`);
		}
		for (const id of before.keys()) if (!after.has(id)) differences.push(`removed: ${id}`);
	}
	for (const key of ['databases', 'items', 'mediaFiles', 'mediaBytes', 'without_classification']) {
		if (previous?.counts?.[key] !== next.counts?.[key]) {
			differences.push(`counts.${key}: ${previous?.counts?.[key]} → ${next.counts?.[key]}`);
		}
	}
	if ((previous?.source?.head ?? null) !== (next.source?.head ?? null)) {
		differences.push(`source.head: ${previous?.source?.head ?? 'none'} → ${next.source?.head ?? 'none'}`);
	}
	return differences;
}

function printSummary(inventory, outPath) {
	const { counts, rights, problems } = inventory;
	const lines = [
		`[legacy-inventory] ${inventory.schema}`,
		`  source          ${inventory.source.path} @ ${inventory.source.head ?? 'unknown'}`,
		`  databases       ${counts.databases} (${counts.empty_databases} empty)`,
		`  items           ${counts.items} (${counts.without_classification} without a classification row)`,
		`  media           ${counts.mediaFiles} file(s), ${counts.mediaBytes} byte(s)`,
		`  unattributed    ${counts.unattributed_media.files} file(s), ${counts.unattributed_media.bytes} byte(s)`,
		`  assets/pages    ${counts.assets} asset(s), ${counts.markdownPages} markdown page(s)`,
		`  state           ${Object.entries(counts.by_state)
			.map(([key, value]) => `${key}=${value}`)
			.join(' ')}`,
		`  publication     ${Object.entries(counts.by_publication)
			.map(([key, value]) => `${key}=${value}`)
			.join(' ')}`,
		`  rights          recorded=${rights.recorded} unrecorded=${rights.unrecorded}`,
		`  digest          ${inventory.content_digest}`,
	];
	if (problems.length > 0) lines.push(`  problems        ${problems.length}`);
	if (outPath) lines.push(`  written         ${outPath}`);
	for (const line of lines) process.stdout.write(`${line}\n`);
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	const sourcePath = String(flags.get('source') ?? join(root, DEFAULT_SOURCE));
	const classificationPath = String(flags.get('classification') ?? join(root, DEFAULT_CLASSIFICATION));
	const outPath = flags.get('out') === undefined ? join(root, DEFAULT_OUT) : String(flags.get('out'));
	const format = String(flags.get('format') ?? 'summary');
	const check = flags.get('check') === true;

	const major = Number.parseInt(process.versions.node.split('.')[0], 10);
	if (major < 22) {
		process.stderr.write(
			`[legacy-inventory] node:sqlite requires Node ≥ 22; this environment is ${process.versions.node}.\n`,
		);
		return EXIT.INPUT;
	}
	if (!existsSync(join(sourcePath, 'data/contents'))) {
		process.stderr.write(
			`[legacy-inventory] no legacy corpus at ${sourcePath}/data/contents — pass --source=<clone>.\n`,
		);
		return EXIT.INPUT;
	}
	if (!existsSync(classificationPath)) {
		process.stderr.write(
			`[legacy-inventory] classification not found at ${classificationPath} — Issue #78 owns it.\n`,
		);
		return EXIT.INPUT;
	}

	const { DatabaseSync } = await import('node:sqlite');
	const classification = readJson(classificationPath);
	const inventoryRecordPath = join(root, 'quality/asset-license-inventory.json');
	const inventory = existsSync(inventoryRecordPath) ? readJson(inventoryRecordPath) : null;

	const document = buildInventory({
		sourcePath,
		sourceHead: resolveHead(sourcePath),
		classificationPath,
		classification,
		inventory,
		now: new Date().toISOString(),
		openDatabase: (file) => new DatabaseSync(file, { readOnly: true }),
	});

	if (document.problems.length > 0) {
		for (const problem of document.problems) {
			process.stderr.write(`[legacy-inventory] unreadable: ${problem.db} (${problem.reason})\n`);
		}
		process.stderr.write('[legacy-inventory] nothing was written.\n');
		return EXIT.UNREADABLE;
	}

	if (check) {
		if (!existsSync(outPath)) {
			process.stdout.write('[legacy-inventory] no committed inventory to compare against.\n');
			return EXIT.DRIFT;
		}
		const differences = diffInventories(readJson(outPath), document);
		if (differences.length === 0) {
			process.stdout.write('[legacy-inventory] no drift.\n');
			return EXIT.OK;
		}
		for (const line of differences.slice(0, 40)) process.stdout.write(`  ${line}\n`);
		if (differences.length > 40) {
			process.stdout.write(`  … ${differences.length - 40} more\n`);
		}
		process.stdout.write(`[legacy-inventory] drift: ${differences.length} difference(s).\n`);
		return EXIT.DRIFT;
	}

	if (format === 'json') {
		process.stdout.write(`${JSON.stringify(document, null, '\t')}\n`);
		return EXIT.OK;
	}

	writeFileSync(outPath, `${JSON.stringify(document, null, '\t')}\n`);
	printSummary(document, outPath);
	return EXIT.OK;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().then((code) => {
		process.exitCode = code;
	});
}
