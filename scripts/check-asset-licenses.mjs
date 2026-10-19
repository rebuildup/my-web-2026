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
 * Exit codes: 0 = no error-severity finding, 1 = at least one error,
 * 2 = unusable input (unreadable record / root).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateAssetInventory } from '../src/legal/contract.ts';
import { parseAssetInventory } from '../src/legal/inventory.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** The reviewed record: the only place a human records what they saw. */
export const RECORD_RELATIVE_PATH = 'quality/asset-license-inventory.json';

/**
 * The audited scope, declared here rather than inferred.
 *
 * `public/**` is the set of bytes a visitor can fetch verbatim from the
 * Static Assets binding. Tool build output is NOT in it: those bytes are
 * produced from `external/<slug>/` and are owned by Issue #466's gate,
 * which already records each Tool's licence file, lockfile and outbound
 * hosts. Two owners for one byte set is how a record stops meaning
 * anything.
 */
export const AUDITED_ROOTS = ['public'];

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
export function renderConsoleReport({ verdict, reviews, findings, auditedFileCount, recordPath }) {
	const lines = [];
	lines.push(`asset license review — ${verdict}`);
	lines.push(`record: ${recordPath}`);
	lines.push(`audited files: ${auditedFileCount}`);
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
	const auditedFiles = collectAuditedFiles(options.root);
	if (auditedFiles.length === 0) {
		process.stderr.write(`no audited files under ${AUDITED_ROOTS.join(', ')}\n`);
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

	const result = evaluateAssetInventory({
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

	process.stdout.write(
		renderConsoleReport({
			verdict: result.verdict,
			reviews: result.reviews,
			findings: result.findings,
			auditedFileCount: auditedFiles.length,
			recordPath: options.record,
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
