#!/usr/bin/env node
/**
 * Asset rights / license review gate (Issue #497).
 *
 * Usage:
 *   node scripts/check-asset-licenses.mjs
 *   node scripts/check-asset-licenses.mjs --report=markdown
 *   node scripts/check-asset-licenses.mjs --report=html --report-out=.tmp/asset-license-review.html
 *   node scripts/check-asset-licenses.mjs --root=<dir> --record=<file>
 *
 * Why this exists
 * ---------------
 * `scripts/check-tool-artifact-inventory.mjs` (Issue #466) answers
 * "what licence does the pinned Tool ship?" for the submodules. Nothing
 * answered the same question for the bytes THIS repository ships and
 * references: the PWA icons, the CLS fixtures, the OG card — all
 * generated, all fine — and the conference guide under
 * `public/share/procon2026/`, which bundles 50 web fonts, 6 PDFs and 35
 * screenshots whose provenance is recorded nowhere in the tree.
 *
 * Two failures this gate is built against:
 *
 *   1. **An asset nobody reviewed.** Coverage is the part a hand-written
 *      inventory cannot guarantee: a new file under `public/` is shipped
 *      to visitors before any record claims it. Every file in the audited
 *      scope must be claimed by exactly one record (`L001` / `L002`).
 *   2. **A record that asserts instead of showing.** The reviewed record
 *      in `quality/asset-license-inventory.json` is a human decision, so
 *      a `sha256` on licence evidence pins the bytes that decision was
 *      made about, and a changed licence file forces a re-review
 *      (`L005`) instead of inheriting a stale clearance.
 *
 * The rules themselves live in `src/legal/contract.ts`, so this script,
 * the review screen (`src/legal/AssetLicenseReview.tsx`) and the tests
 * cannot disagree about what "publishable" means.
 *
 * Severity contract
 * -----------------
 *   error → the release stops. Contradictions (a file nobody claims, two
 *           records claiming one file, evidence that is missing or has
 *           drifted, a licence id that cannot mean anything here) and a
 *           record whose shape is unusable.
 *   warn  → review, do not block. Chiefly `L010`: an asset the contract
 *           holds is still declared published. Whether to unpublish it
 *           is an owner publication decision, so the gate keeps it
 *           visible every run instead of resolving it here.
 *   info  → the state itself (`hold`, `provider-terms`), recorded so a
 *           reader of the report sees why a decision is what it is.
 *
 * Properties that make the output safe to paste into a PR
 * ---------------------------------------------------------
 * Offline and status-only: no network, no environment variable, no
 * secret file, no Cloudflare binding, no deploy. It reads the committed
 * tree, the committed record and nothing else. URLs are reduced to their
 * hostname (`new URL(...).hostname`), so a reference carrying a path,
 * a port or a credential cannot reach the report, and licence evidence
 * is verified by digest rather than printed.
 *
 * Scope (Issue #780)
 * ------------------
 * `public/**` is not the only byte a visitor receives: Vite also emits
 * every static asset imported from `src/**` as `/assets/<hash>`. The
 * audited set is therefore `public/**` UNION the assets the source tree
 * imports, and the second half is DERIVED from the import graph rather
 * than declared in a list — a list would be the same convention-over-
 * evidence the gate exists to replace. See `collectServedSourceAssets`.
 *
 * A derived scope makes the gate red for bytes whose rights nobody has
 * recorded yet, and those bytes cannot be cleared by a script: clearing
 * them is a rights decision. `quality/asset-license-pending.json` is the
 * one place to DECLARE an asset as known-unreviewed instead — it records
 * the absence of a decision, never a licence. A declared file is still
 * uncovered (it shows as `S002` on every run); anything not declared is
 * `L001` and fails. The ledger cannot silently absorb a new byte, and a
 * ledger entry that has been covered by a real record is `S003`, so the
 * deferral cannot outlive its reason.
 *
 * Exit codes: 0 = no error-severity finding, 1 = at least one error,
 * 2 = unusable input (unreadable record / root / ledger).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateAssetInventory, summarizeAssetReview } from '../src/legal/contract.ts';
import { parseAssetInventory } from '../src/legal/inventory.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** The reviewed record: the only place a human records what they saw. */
export const RECORD_RELATIVE_PATH = 'quality/asset-license-inventory.json';

/**
 * The verbatim half of the audited scope.
 *
 * `public/**` is the set of bytes a visitor can fetch verbatim from the
 * Static Assets binding. Tool build output is NOT in it: those bytes are
 * produced from `external/<slug>/` and are owned by Issue #466's gate,
 * which already records each Tool's licence file, lockfile and outbound
 * hosts. Two owners for one byte set is how a record stops meaning
 * anything.
 *
 * The other half — assets Vite emits from `src/**` — is derived, not
 * listed: see `collectServedSourceAssets` (Issue #780).
 */
export const AUDITED_ROOTS = ['public'];

/**
 * Where served source assets are looked for. The scan starts at `src`
 * because that is the tree Vite's client build reads; a file outside it
 * never reaches `dist/client`.
 */
export const SOURCE_ROOTS = ['src'];

/**
 * Extensions Vite emits as an `/assets/<hash>` file when imported.
 *
 * The list is the gate's definition of "a byte a browser downloads", so
 * it is deliberately an allowlist: a new extension has to be added here
 * once, visibly, instead of being picked up by a rule that guesses.
 */
export const SERVED_SOURCE_ASSET_EXTENSIONS = new Set([
	'.webp',
	'.png',
	'.jpg',
	'.jpeg',
	'.avif',
	'.gif',
	'.svg',
	'.ico',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.mp4',
	'.webm',
	'.mp3',
	'.wav',
	'.pdf',
]);

/** Files a client build never includes, so their imports ship nothing. */
const NON_SHIPPED_SOURCE_FILE = /\.(?:test|spec|stories)\.[^/]+$/;

/** Source files whose text can name an asset. */
const SOURCE_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']);

/** `vite.config.ts` maps `~` onto `src`; keep the two in step. */
const SOURCE_PATH_ALIAS = { prefix: '~/', target: 'src/' };

/** Every way a module names another file that we care about. */
const SPECIFIER_PATTERNS = [
	/\bfrom\s*['"]([^'"]+)['"]/g,
	/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	/\bimport\s+['"]([^'"]+)['"]/g,
	/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** `url(...)` in a stylesheet. */
const CSS_URL_PATTERN = /\burl\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Drop `?url` / `?inline` / `?raw` and any fragment. */
function withoutQuery(specifier) {
	const end = specifier.search(/[?#]/);
	return end === -1 ? specifier : specifier.slice(0, end);
}

/**
 * Resolve a specifier to a repository-relative path, or `null` when it
 * does not name a file in this repository (a package, an absolute URL,
 * a virtual `~` import that is not an asset).
 */
function resolveSpecifier(importerRelativePath, specifier) {
	if (specifier.startsWith(SOURCE_PATH_ALIAS.prefix)) {
		return posix.normalize(
			`${SOURCE_PATH_ALIAS.target}${specifier.slice(SOURCE_PATH_ALIAS.prefix.length)}`,
		);
	}
	if (!specifier.startsWith('.')) return null;
	return posix.normalize(posix.join(posix.dirname(importerRelativePath), specifier));
}

/** Every specifier one source file names. */
function specifiersIn(text, extension) {
	const found = [];
	for (const pattern of SPECIFIER_PATTERNS) {
		for (const match of text.matchAll(pattern)) found.push(match[1]);
	}
	if (extension === '.css') {
		for (const match of text.matchAll(CSS_URL_PATTERN)) found.push(match[2]);
	}
	return found;
}

/**
 * The second half of the audited scope: assets `src/**` imports and Vite
 * therefore emits to `/assets/<hash>`.
 *
 * Derived from the import graph rather than declared, because a declared
 * list is the convention this gate exists to replace: the question is
 * "what does the build actually ship?", and the answer is the set of
 * asset imports, not a list somebody remembered to update.
 *
 * `missing` is not swallowed: an import that names an asset extension
 * but resolves to no file is a scope hole (the gate would otherwise
 * quietly audit one file fewer), so it comes back as a finding.
 */
export function collectServedSourceAssets(root, sourceRoots = SOURCE_ROOTS) {
	const files = new Set();
	const missing = [];

	const readSource = (relativePath) => {
		const full = join(root, relativePath);
		let text;
		try {
			text = readFileSync(full, 'utf8');
		} catch {
			return;
		}
		const extension = extname(relativePath).toLowerCase();
		for (const raw of specifiersIn(text, extension)) {
			const specifier = withoutQuery(raw);
			const resolved = resolveSpecifier(relativePath, specifier);
			if (resolved === null) continue;
			if (resolved.startsWith('../') || posix.isAbsolute(resolved)) continue;
			if (!SERVED_SOURCE_ASSET_EXTENSIONS.has(extname(resolved).toLowerCase())) continue;
			if (existsSync(join(root, resolved))) files.add(resolved);
			else missing.push({ importer: relativePath, target: resolved });
		}
	};

	const walk = (directory) => {
		if (!existsSync(directory)) return;
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		)) {
			const full = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name.startsWith('.')) continue;
				walk(full);
				continue;
			}
			if (!entry.isFile()) continue;
			const relativePath = relative(root, full).split('\\').join('/');
			if (NON_SHIPPED_SOURCE_FILE.test(relativePath)) continue;
			if (!SOURCE_MODULE_EXTENSIONS.has(extname(relativePath).toLowerCase())) continue;
			readSource(relativePath);
		}
	};
	for (const sourceRoot of sourceRoots) walk(join(root, sourceRoot));

	return { files: [...files].sort(), missing };
}

/** The reviewed-deferral ledger (Issue #780). */
export const PENDING_LEDGER_RELATIVE_PATH = 'quality/asset-license-pending.json';
export const PENDING_LEDGER_SCHEMA = 'asset-license-pending.v1';

/** A reason is a sentence. A one-word reason is a disabled gate. */
const MIN_PENDING_REASON_LENGTH = 20;

/**
 * Read the ledger that declares an asset as KNOWN-UNREVIEWED.
 *
 * This is deliberately not part of `quality/asset-license-inventory.json`:
 * that file records rights, and a reader that mixed "we cleared this" with
 * "we have not looked yet" would let the second read as the first. Here a
 * path is only ever a statement of absence — it carries no licence, no
 * rights holder and no evidence, so it cannot clear anything.
 */
export function readPendingLedger(root, relativePath = PENDING_LEDGER_RELATIVE_PATH) {
	const full = join(root, relativePath);
	if (!existsSync(full)) return { present: false, entries: [], problems: [] };
	let value;
	try {
		value = JSON.parse(readFileSync(full, 'utf8'));
	} catch {
		return { present: true, entries: [], problems: ['ledger is not valid JSON'] };
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { present: true, entries: [], problems: ['ledger is not an object'] };
	}
	if (value.schema !== PENDING_LEDGER_SCHEMA) {
		return {
			present: true,
			entries: [],
			problems: [`ledger schema must be "${PENDING_LEDGER_SCHEMA}"`],
		};
	}
	if (!Array.isArray(value.entries)) {
		return { present: true, entries: [], problems: ['ledger entries must be an array'] };
	}

	const problems = [];
	const entries = [];
	const seen = new Set();
	value.entries.forEach((entry, index) => {
		const at = `entries[${index}]`;
		const problemsBefore = problems.length;
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			problems.push(`${at} is not an object`);
			return;
		}
		const path = entry.path;
		if (
			typeof path !== 'string' ||
			path.trim().length === 0 ||
			posix.isAbsolute(path) ||
			path.startsWith('..') ||
			path.includes('/../')
		) {
			problems.push(`${at}.path must be a repository-relative path`);
			return;
		}
		if (seen.has(path)) problems.push(`${at}.path is listed twice`);
		seen.add(path);
		if (
			typeof entry.reason !== 'string' ||
			entry.reason.trim().length < MIN_PENDING_REASON_LENGTH
		) {
			problems.push(
				`${at}.reason must explain the absence in at least ${MIN_PENDING_REASON_LENGTH} characters`,
			);
		}
		// The only state this ledger can hold: a decision has NOT been made.
		// "excluded" would be a publication decision, and that belongs in the
		// inventory with evidence, not here.
		if (entry.ownerDecision !== 'pending') {
			problems.push(`${at}.ownerDecision must be "pending"`);
		}
		if (problems.length === problemsBefore) {
			entries.push({ path, reason: entry.reason, ownerDecision: 'pending' });
		}
	});

	return { present: true, entries, problems };
}

/**
 * Re-label the findings for assets the ledger declares unreviewed.
 *
 * The contract still decides coverage: `L001` is produced exactly as
 * before for every uncovered file. This function only answers the
 * question the contract does not — "has the owner already said this one
 * is known-unreviewed?" — by turning that one finding into a warning
 * that names the deferral. Everything else stays an error:
 *
 *   - a ledger entry whose file is no longer audited is `S003` (stale),
 *   - a ledger entry whose file a record now claims is `S003` (superseded),
 *   - an uncovered file the ledger does not name is still `L001`.
 */
export function applyPendingLedger({ findings, reviews, auditedFiles, entries, uncoveredFiles }) {
	const declared = new Map(entries.map((entry) => [entry.path, entry]));
	const audited = new Set(auditedFiles);
	const claimed = new Set(reviews.flatMap((review) => review.files));
	const next = [];
	const deferred = [];

	for (const item of findings) {
		if (item.code === 'L001' && declared.has(item.subject)) {
			deferred.push(item.subject);
			next.push({
				code: 'S002',
				severity: 'warn',
				subject: item.subject,
				message:
					'監査対象のファイルに資産記録がありません。未レビューであることは台帳に宣言されていますが、権利は記録されていません（owner 判断待ち）。',
				remedy: 'owner が判断したら、資産記録を追加して台帳の該当行を削除する。',
			});
			continue;
		}
		next.push(item);
	}

	for (const entry of entries) {
		if (!audited.has(entry.path)) {
			next.push({
				code: 'S003',
				severity: 'error',
				subject: entry.path,
				message:
					'台帳の行に対応する監査対象ファイルがありません（台帳が資産より長生きしています）。',
				remedy: 'ファイルが消えたなら行を削除し、パスが変わったなら台帳を直す。',
			});
			continue;
		}
		if (claimed.has(entry.path)) {
			next.push({
				code: 'S003',
				severity: 'error',
				subject: entry.path,
				message:
					'台帳の行に当たるファイルを資産記録が主張しています（台帳が記録より長生きしています）。',
				remedy: '資産記録ができたので、台帳の行を削除する。',
			});
		}
	}

	const summary = summarizeAssetReview({
		reviews,
		findings: next,
		auditedFiles: auditedFiles.length,
		uncoveredFiles,
	});

	return { findings: next, summary, verdict: summary.verdict, deferred };
}

/** Collect the audited files, repository-relative and sorted. */
export function collectAuditedFiles(root, auditedRoots = AUDITED_ROOTS) {
	const files = [];
	const walk = (directory) => {
		if (!existsSync(directory)) return;
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : 1,
		)) {
			const full = join(directory, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile()) {
				files.push(relative(root, full).split('\\').join('/'));
			}
		}
	};
	for (const audited of auditedRoots) walk(join(root, audited));
	return files.sort();
}

/** sha256 of a repository-relative file, or `null` when unreadable. */
export function sha256OfFile(root, path) {
	try {
		return createHash('sha256')
			.update(readFileSync(join(root, path)))
			.digest('hex');
	} catch {
		return null;
	}
}

const SEVERITY_MARK = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };

/**
 * Status-only report text.
 *
 * One line per record (id / kind / decision / files / licence / origin)
 * and one line per finding. A licence evidence path is printed as a path;
 * a provider reference is printed as a hostname, because the path or the
 * query of someone else's URL is not this gate's business.
 */
export function renderConsoleReport({
	verdict,
	reviews,
	findings,
	auditedFileCount,
	recordPath,
	pendingCount = 0,
}) {
	const lines = [];
	lines.push(`asset license review — ${verdict}`);
	lines.push(`record: ${recordPath}`);
	lines.push(`audited files: ${auditedFileCount}`);
	if (pendingCount > 0) {
		lines.push(`pending, declared unreviewed: ${pendingCount}`);
	}
	for (const review of reviews) {
		lines.push(
			`  ${review.decision.padEnd(15)} ${review.id.padEnd(28)} ${review.kind.padEnd(9)} ${String(review.files.length).padStart(3)} files  ${review.spdx.padEnd(12)} ${review.origin}`,
		);
	}
	for (const item of findings) {
		lines.push(`  ${SEVERITY_MARK[item.severity]} ${item.code} ${item.subject}: ${item.message}`);
		lines.push(`         remedy: ${item.remedy}`);
	}
	return `${lines.join('\n')}\n`;
}

/** Human-facing Markdown record of one run (written by `--report=markdown`). */
export function renderMarkdownReport({
	verdict,
	reviews,
	findings,
	summary,
	recordPath,
	auditedFileCount,
}) {
	const lines = [];
	lines.push('# 資産の権利 / 出典 / ライセンス検証 — 記録');
	lines.push('');
	lines.push(
		`- 判定: **${verdict}** / 記録: \`${recordPath}\` / 監査対象ファイル: ${auditedFileCount}`,
	);
	lines.push(
		`- 資産記録 ${summary.records} 件（公開可 ${summary.publishable} / 保留 ${summary.hold} / 提供者条件 ${summary.providerTerms}）`,
	);
	lines.push(
		`- 記録済みファイル ${summary.claimedFiles} / 未記録 ${summary.uncoveredFiles} / findings ${summary.findings}（error ${summary.errors} / warn ${summary.warnings} / info ${summary.infos}）`,
	);
	lines.push('');
	lines.push('| 判定 | 記録 id | 種別 | 対象ファイル | 由来 | 公開状態 |');
	lines.push('| --- | --- | --- | --- | --- | --- |');
	for (const review of reviews) {
		lines.push(
			`| ${review.decision} | \`${review.id}\` | ${review.kind} | ${review.files.length} | ${review.origin} | ${review.publication} |`,
		);
	}
	lines.push('');
	if (findings.length === 0) {
		lines.push('findings なし。');
		return `${lines.join('\n')}\n`;
	}
	lines.push('## findings');
	lines.push('');
	for (const item of findings) {
		lines.push(`- **${item.code}** (${item.severity}) \`${item.subject}\` — ${item.message}`);
		lines.push(`  - remedy: ${item.remedy}`);
	}
	return `${lines.join('\n')}\n`;
}

/** Standalone HTML review screen (written by `--report=html`). */
export function renderHtmlReport({
	verdict,
	reviews,
	findings,
	summary,
	recordPath,
	auditedFileCount,
}) {
	const escapeHtml = (value) =>
		value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
	const rows = reviews
		.map(
			(review) => `<tr>
				<td><code>${escapeHtml(review.decision)}</code></td>
				<td><code>${escapeHtml(review.id)}</code></td>
				<td>${escapeHtml(review.kind)}</td>
				<td>${review.files.length}</td>
				<td>${escapeHtml(review.origin)}</td>
				<td>${escapeHtml(review.publication)}</td>
			</tr>`,
		)
		.join('\n');
	const items = findings.length
		? findings
				.map(
					(item) =>
						`<li><code>${escapeHtml(item.code)}</code> <span class="sev sev-${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span> <code>${escapeHtml(item.subject)}</code><p>${escapeHtml(item.message)}</p><p class="remedy">${escapeHtml(item.remedy)}</p></li>`,
				)
				.join('\n')
		: '<li>findings なし。</li>';
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>asset license review (#497)</title>
		<style>
			body { font-family: system-ui, sans-serif; margin: 0; padding: 32px; color: #14161c; background: #ffffff; }
			h1 { font-size: 20px; margin: 0 0 4px; }
			p.summary { margin: 0 0 24px; color: #454a55; }
			table { border-collapse: collapse; width: 100%; font-size: 14px; }
			th, td { border-bottom: 1px solid #d8dbe2; padding: 8px 10px; text-align: left; vertical-align: top; }
			th { background: #f5f6f8; }
			code { font-size: 13px; }
			ul.findings { list-style: none; padding: 0; font-size: 14px; }
			ul.findings li { border-bottom: 1px solid #d8dbe2; padding: 10px 0; }
			ul.findings p { margin: 4px 0; }
			p.remedy { color: #454a55; }
			.sev { font-size: 12px; padding: 1px 6px; border-radius: 999px; }
			.sev-error { background: #fdeaea; color: #8c1c1c; }
			.sev-warn { background: #fdf3e2; color: #7a4a05; }
			.sev-info { background: #eef1f6; color: #39404f; }
		</style>
	</head>
	<body>
		<h1>資産の権利 / 出典 / ライセンス検証（Issue #497）</h1>
		<p class="summary">
			判定 <strong>${escapeHtml(verdict)}</strong> / 記録 <code>${escapeHtml(recordPath)}</code> /
			監査対象ファイル ${auditedFileCount} / 資産記録 ${summary.records} 件
			（公開可 ${summary.publishable} / 保留 ${summary.hold} / 提供者条件 ${summary.providerTerms}）
		</p>
		<table>
			<thead>
				<tr><th>判定</th><th>記録 id</th><th>種別</th><th>対象ファイル</th><th>由来</th><th>公開状態</th></tr>
			</thead>
			<tbody>
${rows}
			</tbody>
		</table>
		<h2>findings</h2>
		<ul class="findings">
${items}
		</ul>
	</body>
</html>
`;
}

function parseArgs(argv) {
	const options = { report: null, reportOut: null, root: repoRoot, record: RECORD_RELATIVE_PATH };
	for (const arg of argv) {
		if (arg.startsWith('--report=')) options.report = arg.slice('--report='.length);
		else if (arg.startsWith('--report-out=')) options.reportOut = arg.slice('--report-out='.length);
		else if (arg.startsWith('--root='))
			options.root = resolve(process.cwd(), arg.slice('--root='.length));
		else if (arg.startsWith('--record=')) options.record = arg.slice('--record='.length);
		else throw new Error(`unknown option: ${arg}`);
	}
	return options;
}

/**
 * Run the gate. Exported so the suite can drive it over a fixture root
 * instead of re-implementing the refusals (see
 * `scripts/check-asset-licenses.test.mjs`).
 */
export function main(argv = process.argv.slice(2)) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n`);
		return 2;
	}

	const recordPath = join(options.root, options.record);
	if (!existsSync(recordPath)) {
		process.stderr.write(`unreadable record: ${options.record}\n`);
		return 2;
	}
	// Issue #780 — the audited set is the verbatim half (`public/**`) plus
	// the half Vite emits from the source tree.
	const servedSourceAssets = collectServedSourceAssets(options.root);
	const auditedFiles = [...collectAuditedFiles(options.root), ...servedSourceAssets.files].sort();
	if (auditedFiles.length === 0) {
		process.stderr.write(
			`no audited files under ${AUDITED_ROOTS.join(', ')} or imported from ${SOURCE_ROOTS.join(', ')}\n`,
		);
		return 2;
	}

	const ledger = readPendingLedger(options.root);
	if (ledger.problems.length > 0) {
		process.stderr.write(`unusable ledger ${PENDING_LEDGER_RELATIVE_PATH}:\n`);
		for (const problem of ledger.problems) process.stderr.write(`  ${problem}\n`);
		return 2;
	}

	const read = parseAssetInventory(readFileSync(recordPath, 'utf8'));
	if (!read.ok) {
		process.stderr.write(
			renderConsoleReport({
				verdict: 'FAIL',
				reviews: [],
				findings: read.findings,
				auditedFileCount: auditedFiles.length,
				recordPath: options.record,
			}),
		);
		return 1;
	}

	const evaluation = evaluateAssetInventory({
		records: read.records,
		auditedFiles,
		observations: {
			evidenceExists: (path) => {
				const full = join(options.root, path);
				return existsSync(full) && statSync(full).isFile();
			},
			sha256Of: (path) => sha256OfFile(options.root, path),
		},
	});

	// A source import that names an asset but resolves to no file is a
	// hole in the scope itself, so it is an error even though no byte is
	// shipped from it: the gate must not audit a smaller set than the
	// build does.
	const scopeFindings = servedSourceAssets.missing.map(({ importer, target }) => ({
		code: 'S001',
		severity: 'error',
		subject: target,
		message: `${importer} が存在しないアセットを import しています。`,
		remedy: 'import 先を直すか、ファイルを追加する（監査対象が実態より小さくなるため放置しない）。',
	}));

	const deferred = applyPendingLedger({
		findings: [...evaluation.findings, ...scopeFindings],
		reviews: evaluation.reviews,
		auditedFiles,
		entries: ledger.entries,
		uncoveredFiles: evaluation.summary.uncoveredFiles,
	});
	const result = {
		reviews: evaluation.reviews,
		findings: deferred.findings,
		summary: deferred.summary,
		verdict: deferred.verdict,
	};

	process.stdout.write(
		renderConsoleReport({
			verdict: result.verdict,
			reviews: result.reviews,
			findings: result.findings,
			auditedFileCount: auditedFiles.length,
			recordPath: options.record,
			pendingCount: deferred.deferred.length,
		}),
	);

	if (options.report !== null) {
		const out =
			options.reportOut ??
			join('.tmp', `asset-license-review.${options.report === 'markdown' ? 'md' : 'html'}`);
		const render =
			options.report === 'markdown'
				? renderMarkdownReport
				: options.report === 'html'
					? renderHtmlReport
					: null;
		if (render === null) {
			process.stderr.write(`unknown --report=${options.report} (markdown | html)\n`);
			return 2;
		}
		mkdirSync(dirname(resolve(process.cwd(), out)), { recursive: true });
		writeFileSync(
			resolve(process.cwd(), out),
			render({
				verdict: result.verdict,
				reviews: result.reviews,
				findings: result.findings,
				summary: result.summary,
				recordPath: options.record,
				auditedFileCount: auditedFiles.length,
			}),
		);
		process.stdout.write(`report: ${out}\n`);
	}

	return result.verdict === 'FAIL' ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exit(main());
}
