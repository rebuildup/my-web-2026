#!/usr/bin/env node
/**
 * Tool artefact license + dependency inventory gate (Issue #466).
 *
 * Usage:
 *   node scripts/check-tool-artifact-inventory.mjs
 *   node scripts/check-tool-artifact-inventory.mjs --update
 *   node scripts/check-tool-artifact-inventory.mjs --report=markdown
 *   node scripts/check-tool-artifact-inventory.mjs --report=html --report-out=.tmp/tool-artifact-inventory.html
 *   node scripts/check-tool-artifact-inventory.mjs --root=<dir> --record=<file>
 *
 * Why this exists
 * ---------------
 * `scripts/check-tools-manifest.mjs` (#80) proves the manifest is
 * well-formed and that a shipped Tool's pin matches the gitlink.
 * `scripts/check-submodule-provenance.mjs` (#473) proves where those
 * bytes were fetched from and that the checkout is the pinned commit.
 * Neither answers the two questions a published artefact raises:
 *
 *   1. **Is the declared license true?** `"license": "MIT"` is a string
 *      an operator typed. Nothing read the Tool's license file, so a
 *      Tool whose pinned commit ships AGPL-3.0 — or no license at all —
 *      passed the gate carrying the same MIT claim as one that ships the
 *      MIT text.
 *   2. **Which dependencies produced the artefact?** The Tools build
 *      inside `external/<slug>/` from their own lockfile, so no file
 *      in this repository recorded the dependency set that produced
 *      `/tools/<slug>/app/`. A lockfile rewrite changed what is
 *      published without changing anything a reviewer sees here.
 *
 * This gate closes both, plus the third fact the Issue names: the
 * artefact's outbound references. It records, per Tool, in
 * `quality/tool-artifact-inventory.json` (the reviewed record) the
 * commit plus the sha256 of the license file and of the lockfile, and
 * compares what is on disk against that record. The rules themselves
 * live in `src/tools/artifact-inventory.ts`, so this script, the build
 * refusal in `scripts/build-tools.mjs` and the synthetic fixture cannot
 * disagree about what "verified" means.
 *
 * Severity contract
 * -----------------
 *   - `same_origin_static` (this repository builds and serves the
 *     bytes) → `error`. `pnpm run build` refuses the Tool.
 *   - any other delivery kind → `warn` (hold) when bytes exist to
 *     inspect, `info` when the entry is inventory-only.
 *
 * Properties that make the output safe to paste into a PR
 * ---------------------------------------------------------
 * Offline and status-only: no network fetch, no environment variable,
 * no secret file, no Cloudflare binding. It reads the committed tree,
 * the local submodule checkout and, when a build has run, the collected
 * artefact. Hostnames are extracted with `new URL(...)` and printed as
 * `hostname` only, so a userinfo or port in an artefact URL can never
 * reach the report.
 *
 * Exit codes: 0 = no error-severity finding, 1 = at least one error,
 * 2 = unusable input (unreadable root / manifest / record).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	LICENSE_FILE_CANDIDATES,
	LOCKFILE_CANDIDATES_BY_PACKAGE_MANAGER,
	buildReviewedRecord,
	evaluateToolArtifactInventory,
	summarizeToolInventory,
} from '../src/tools/artifact-inventory.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** The reviewed record: the only place a human records what they saw. */
export const RECORD_RELATIVE_PATH = 'quality/tool-artifact-inventory.json';

/**
 * Where `build-tools.mjs` mirrors a collected artefact. The scan reads
 * the *collected* copy, because that is the bytes the Worker serves;
 * reading `external/<slug>/dist` would report the Tool's build output
 * before the path rewrite, which is not what ships.
 */
const COLLECTED_ARTIFACT_ROOT = 'dist/client';

/**
 * Static-scan limits. A Tool bundle is large but finite, and a gate
 * that walked an unbounded tree would turn a supply-chain check into a
 * build-cost regression. The caps are far above the current artefacts
 * (ProtoType's collected output is ~9 files / ~1.8 MB) so the scan is
 * complete for every Tool the repository ships.
 */
const SCAN_MAX_FILES = 2000;
const SCAN_MAX_FILE_BYTES = 4 * 1024 * 1024;
const SCAN_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * One outbound reference inside an artefact: an absolute URL (`https:`,
 * `http:`, `ws:`, `wss:`) or a protocol-relative `//host/path`. The
 * protocol-relative branch requires a host-looking first character and
 * is not preceded by `:` or a word character, so the `//` inside
 * `https://` and `file:///` is not read as a network reference. The
 * preceding-character class also excludes base64 punctuation
 * (`+`, `/`, `=`, `-`, `.`): a payload can contain `//` followed by
 * alphanumerics, which is not a reference.
 */
const ABSOLUTE_URL_PATTERN =
	/(?:https?|wss?):\/\/[^\s"'`\\)<>]+|(?<![\w:/+=-])\/\/[a-z0-9][^\s"'`\\)<>]*/gi;

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

// ---------------------------------------------------------------------------
// filesystem observation
// ---------------------------------------------------------------------------

function sha256File(path) {
	const digest = createHash('sha256');
	digest.update(readFileSync(path));
	return digest.digest('hex');
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * The first license file that exists in the checkout, per
 * `LICENSE_FILE_CANDIDATES`. The candidate list is policy and lives in
 * the shared module, so a caller cannot widen it per invocation.
 */
export function findLicenseFile(checkoutPath) {
	for (const candidate of LICENSE_FILE_CANDIDATES) {
		const full = join(checkoutPath, candidate);
		if (existsSync(full) && statSync(full).isFile()) return candidate;
	}
	return null;
}

/** The lockfile a Tool's declared package manager would consume. */
export function findLockfile(checkoutPath, packageManager) {
	for (const candidate of LOCKFILE_CANDIDATES_BY_PACKAGE_MANAGER[packageManager] ?? []) {
		const full = join(checkoutPath, candidate);
		if (existsSync(full) && statSync(full).isFile()) return candidate;
	}
	return null;
}

/**
 * Every absolute URL host referenced by the collected artefact.
 *
 * The path is walked, not globbed, and each file is decoded as UTF-8
 * and skipped when it contains a NUL byte (binary). Only `hostname`
 * survives: `new URL()` discards userinfo, port, path and query, so a
 * credential-shaped URL inside a bundle cannot reach the report.
 */
export function scanArtifactHosts(artifactDir) {
	const hosts = new Set();
	if (!existsSync(artifactDir)) return { present: false, hosts: [] };
	let files = 0;
	let totalBytes = 0;
	const stack = [artifactDir];
	while (stack.length > 0 && files < SCAN_MAX_FILES && totalBytes < SCAN_MAX_TOTAL_BYTES) {
		const dir = stack.pop();
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile()) continue;
			const size = statSync(full).size;
			if (size > SCAN_MAX_FILE_BYTES) continue;
			files += 1;
			totalBytes += size;
			if (totalBytes > SCAN_MAX_TOTAL_BYTES) break;
			const text = readFileSync(full).toString('utf8');
			if (text.includes('\u0000')) continue; // binary (NUL byte): not a text reference
			for (const match of text.matchAll(ABSOLUTE_URL_PATTERN)) {
				try {
					const protocolRelative = match[0].startsWith('//');
					// A protocol-relative reference has no scheme of its own;
					// prepending one lets `URL` extract the hostname without
					// treating the path as part of it.
					const raw = protocolRelative ? `https:${match[0]}` : match[0];
					const hostname = new URL(raw).hostname.toLowerCase();
					if (hostname === '') continue;
					// A real protocol-relative host carries a dot (or is the
					// loopback name); a base64 fragment does not. Without
					// this check a bundle's inline payload invents hosts.
					if (protocolRelative && !hostname.includes('.') && hostname !== 'localhost') {
						continue;
					}
					hosts.add(hostname);
				} catch {
					// A truncated or malformed reference is not a host;
					// skipping it keeps the scan status-only.
				}
			}
		}
	}
	return { present: true, hosts: [...hosts].sort() };
}

/**
 * Observe one Tool: checkout presence, license evidence, dependency
 * evidence and — when a build has run — the artefact's outbound hosts.
 * Every value comes from the local tree; nothing here fetches anything.
 */
export function observeTool(root, tool) {
	const checkoutPath = join(root, tool.source.submodule_path);
	const checkoutPresent =
		existsSync(join(checkoutPath, '.git')) && existsSync(join(checkoutPath, 'package.json'));

	let declared = typeof tool.license === 'string' ? tool.license.trim() : '';
	if (declared === '' || declared === 'null') declared = null;

	let license = {
		declared,
		evidenceFile: null,
		evidenceSha256: null,
		evidenceText: null,
		packageLicenseField: null,
	};
	let dependencies = {
		lockfile: null,
		lockfileSha256: null,
		runtimeDependencies: [],
		devDependencyCount: 0,
	};
	if (checkoutPresent) {
		const licenseFile = findLicenseFile(checkoutPath);
		license = {
			declared,
			evidenceFile: licenseFile,
			evidenceSha256: licenseFile === null ? null : sha256File(join(checkoutPath, licenseFile)),
			evidenceText:
				licenseFile === null ? null : readFileSync(join(checkoutPath, licenseFile), 'utf8'),
			packageLicenseField: null,
		};
		const pkg = readJson(join(checkoutPath, 'package.json')) ?? {};
		license = {
			...license,
			packageLicenseField: typeof pkg.license === 'string' ? pkg.license : null,
		};
		const lockfile = findLockfile(checkoutPath, tool.build?.package_manager ?? 'pnpm');
		dependencies = {
			lockfile,
			lockfileSha256: lockfile === null ? null : sha256File(join(checkoutPath, lockfile)),
			runtimeDependencies: Object.keys(pkg.dependencies ?? {}).sort(),
			devDependencyCount: Object.keys(pkg.devDependencies ?? {}).length,
		};
	}

	const artifactDir =
		typeof tool.delivery?.artifact_path === 'string'
			? join(root, COLLECTED_ARTIFACT_ROOT, tool.delivery.artifact_path.replace(/^\/+/, ''))
			: null;
	const artifact =
		artifactDir === null || !checkoutPresent
			? { present: false, hosts: [] }
			: scanArtifactHosts(artifactDir);

	return {
		slug: tool.slug,
		deliveryKind: tool.delivery?.kind ?? 'host_disabled',
		pinnedSha: tool.source.pinned_sha,
		checkoutPresent,
		license,
		dependencies,
		outbound: artifact,
	};
}

/**
 * Evaluate every Tool in a manifest against the reviewed record.
 *
 * Exported so `scripts/build-tools.mjs` can refuse a build using the
 * same verdict this gate reports — the build gate and the commit-time
 * gate must never hold different opinions about the same checkout.
 */
export function collectToolInventory({ root, manifest, record }) {
	const rows = [];
	const findings = [];
	for (const tool of manifest.tools) {
		const input = observeTool(root, tool);
		const evaluated = evaluateToolArtifactInventory({
			...input,
			reviewed: record?.tools?.[tool.slug] ?? null,
		});
		rows.push(evaluated.rows[0]);
		findings.push(...evaluated.findings);
	}
	findings.sort(
		(a, b) =>
			SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.subject.localeCompare(b.subject),
	);
	const counts = { error: 0, warn: 0, info: 0 };
	for (const item of findings) counts[item.severity] += 1;
	return {
		rows,
		findings,
		counts,
		ok: counts.error === 0,
		summary: summarizeToolInventory(rows),
	};
}

/**
 * Evaluate ONE Tool against the reviewed record.
 *
 * Exported for `scripts/build-tools.mjs`: the build gate and the
 * commit-time gate must return the same verdict for the same checkout,
 * and the cheapest way to guarantee that is for both to call this
 * function rather than each restating the rules.
 */
export function evaluateToolForBuild({ root, tool, record }) {
	const input = observeTool(root, tool);
	return evaluateToolArtifactInventory({ ...input, reviewed: record?.tools?.[tool.slug] ?? null });
}

/**
 * Read the manifest + reviewed record and evaluate. `record` may be
 * `null` (no reviewed record on disk yet); that is reported per Tool,
 * not treated as "everything is unreviewed".
 */
export function readInventoryInputs(root, recordRelPath = RECORD_RELATIVE_PATH) {
	const manifestPath = join(root, 'src/tools/manifest.json');
	if (!existsSync(manifestPath)) {
		throw new Error(`manifest not found: ${manifestPath}`);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const recordPath = join(root, recordRelPath);
	const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
	return { manifest, record };
}

/** Render the reviewed record from the current observations. */
export function renderRecord(manifest, root) {
	const tools = {};
	for (const tool of manifest.tools) {
		const input = observeTool(root, tool);
		tools[tool.slug] = buildReviewedRecord(input);
	}
	return {
		schema: 1,
		generated_by: 'scripts/check-tool-artifact-inventory.mjs --update',
		note: 'Reviewed record for Issue #466. Evidence is per commit: regenerate with `pnpm run tools:artifact:update` and review the diff in the PR that changed the pin, the license file or the lockfile. Regenerate after `scripts/build-tools.mjs` has collected an artefact so `outbound.hosts` reflects the shipped bytes.',
		tools,
	};
}

function writeRecord(root, record, outPath) {
	const target = outPath === null ? join(root, RECORD_RELATIVE_PATH) : resolve(root, outPath);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, `${JSON.stringify(record, null, '\t')}\n`);
	// Biome owns JSON layout in this repository (ADR: Biome replaces
	// Prettier/ESLint), and `JSON.stringify`'s own layout is not it. A
	// generated file that `pnpm run format:check` rejects would make
	// `--update` a command that always leaves the tree dirty, so the
	// generator formats with the same tool the gate runs. When the
	// binary is absent (a stripped checkout) the write still happens and
	// the format gate reports it on the next `pnpm run format`.
	const biome = join(repoRoot, 'node_modules', '.bin', 'biome');
	if (existsSync(biome)) {
		const formatted = spawnSync(biome, ['format', '--write', target], {
			cwd: repoRoot,
			encoding: 'utf8',
		});
		if (formatted.status !== 0) {
			process.stderr.write(
				`[check-tool-artifact-inventory] biome could not format ${target}: ${formatted.stderr}\n`,
			);
		}
	} else {
		process.stderr.write(
			'[check-tool-artifact-inventory] biome is not installed; run `pnpm exec biome format --write` on the record before committing\n',
		);
	}
	return target;
}

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

const dash = (value) => (value === null || value === undefined || value === '' ? '—' : value);
const list = (value) => (value.length === 0 ? '—' : value.join(', '));

export function renderMarkdownReport(result) {
	const lines = [];
	lines.push('# Tool artefact license & dependency inventory report');
	lines.push('');
	lines.push(
		`Result: **${result.ok ? 'PASS' : 'FAIL'}** — ${result.summary.tools} tool(s), ` +
			`${result.summary.shipped} shipped, ${result.summary.passed} pass / ` +
			`${result.summary.warned} warn / ${result.summary.failed} fail, ` +
			`${result.summary.inventoryOnly} inventory-only, findings: ${result.counts.error} error / ` +
			`${result.counts.warn} warn / ${result.counts.info} info`,
	);
	lines.push('');
	lines.push(
		'| slug | delivery | license | declared | evidence | detected | deps | lockfile | runtime deps | outbound | verdict |',
	);
	lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
	for (const row of result.rows) {
		lines.push(
			`| ${row.slug} | ${row.delivery_kind} | ${row.license_status} | ${dash(row.license_declared)} | ` +
				`${dash(row.license_evidence)} | ${list(row.license_detected)} | ${row.dependencies_status} | ` +
				`${dash(row.lockfile)} | ${row.runtime_dependencies} | ` +
				`${row.outbound_status}${row.outbound_new.length > 0 ? ` (+${row.outbound_new.length} undeclared)` : ''} | ` +
				`${row.verdict} |`,
		);
	}
	lines.push('');
	if (result.findings.length === 0) {
		lines.push(
			"No findings: every shipped Tool's license and dependency evidence matches its reviewed record.",
		);
	} else {
		lines.push('## Findings');
		lines.push('');
		for (const item of result.findings) {
			lines.push(`- \`${item.code}\` (${item.severity}) **${item.subject}** — ${item.message}`);
			lines.push(`  - remedy: ${item.remedy}`);
		}
	}
	lines.push('');
	lines.push(
		'> Status-only report: no credential, secret value, or remote fetch is involved. Every value is read from the committed tree, the local submodule checkout and the collected artefact.',
	);
	return `${lines.join('\n')}\n`;
}

export function renderJsonReport(result) {
	return `${JSON.stringify(result, null, 2)}\n`;
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function renderHtmlReport(result) {
	const rows = result.rows
		.map(
			(row) => `      <tr class="${row.verdict.toLowerCase()}">
        <td>${escapeHtml(row.slug)}</td>
        <td>${escapeHtml(row.delivery_kind)}</td>
        <td><span class="badge ${row.license_status === 'verified' ? 'pass' : row.license_status === 'mismatch' ? 'fail' : 'warn'}">${escapeHtml(row.license_status)}</span></td>
        <td>${escapeHtml(dash(row.license_declared))}</td>
        <td><code>${escapeHtml(dash(row.license_evidence))}</code></td>
        <td>${escapeHtml(list(row.license_detected))}</td>
        <td><span class="badge ${row.dependencies_status === 'verified' ? 'pass' : 'warn'}">${escapeHtml(row.dependencies_status)}</span></td>
        <td><code>${escapeHtml(dash(row.lockfile))}</code></td>
        <td>${row.runtime_dependencies}</td>
        <td>${escapeHtml(row.outbound_status)}${row.outbound_new.length > 0 ? ` <span class="badge warn">+${escapeHtml(row.outbound_new.join(', '))}</span>` : ''}</td>
        <td><span class="badge ${row.verdict.toLowerCase()}">${escapeHtml(row.verdict)}</span></td>
      </tr>`,
		)
		.join('\n');
	const findings = result.findings
		.map(
			(item) => `      <li class="${item.severity}"><code>${escapeHtml(item.code)}</code>
        <strong>${escapeHtml(item.subject)}</strong> — ${escapeHtml(item.message)}<br />
        <em>remedy:</em> ${escapeHtml(item.remedy)}</li>`,
		)
		.join('\n');
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Tool artefact license &amp; dependency inventory report</title>
    <style>
      :root { color-scheme: light; }
      body { font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 32px; color: #16181d; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .meta { color: #5b6270; margin-bottom: 20px; }
      .summary { border: 1px solid #d8dce3; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; background: #f7f8fa; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border-bottom: 1px solid #e3e6ec; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f2f3f6; font-weight: 600; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .badge { font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
      .badge.pass { background: #dcf5e5; color: #12633a; }
      .badge.warn { background: #fdf0d5; color: #7a5300; }
      .badge.fail { background: #fbdcdc; color: #8c1d1d; }
      .badge.info { background: #e4ecfa; color: #234a86; }
      tr.fail td { background: #fff7f7; }
      tr.warn td { background: #fffdf5; }
      ul.findings { list-style: none; padding: 0; margin: 0; }
      ul.findings li { border-left: 3px solid #d8dce3; padding: 8px 12px; margin-bottom: 8px; background: #fafbfc; }
      ul.findings li.error { border-left-color: #c0392b; }
      ul.findings li.warn { border-left-color: #d99b1a; }
      ul.findings li.info { border-left-color: #3f6fb5; }
      .note { margin-top: 24px; color: #5b6270; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>Tool artefact license &amp; dependency inventory report</h1>
    <div class="meta">
      my-web-2026 &middot; <code>scripts/check-tool-artifact-inventory.mjs</code> &middot; Issue #466 &middot;
      status-only output derived from a local repository fixture
    </div>
    <div class="summary">
      Result: <strong>${result.ok ? 'PASS' : 'FAIL'}</strong> &middot;
      ${result.summary.tools} tool(s) &middot; ${result.summary.shipped} shipped &middot;
      ${result.summary.passed} pass / ${result.summary.warned} warn / ${result.summary.failed} fail &middot;
      ${result.summary.inventoryOnly} inventory-only &middot;
      findings ${result.counts.error} error / ${result.counts.warn} warn / ${result.counts.info} info
    </div>
    <table>
      <thead>
        <tr>
          <th>slug</th><th>delivery</th><th>license</th><th>declared</th><th>evidence</th>
          <th>detected</th><th>dependencies</th><th>lockfile</th><th>runtime deps</th>
          <th>outbound</th><th>verdict</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
    ${
			result.findings.length === 0
				? "<p>No findings: every shipped Tool's license and dependency evidence matches its reviewed record.</p>"
				: `<h2>Findings</h2>\n    <ul class="findings">\n${findings}\n    </ul>`
		}
    <p class="note">
      Status-only report. No credential, secret value, or remote fetch is involved: every value is read from the
      committed tree, the local submodule checkout and the collected artefact. Hostnames are reduced with
      <code>new URL()</code>, so userinfo and ports never reach this report.
    </p>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArg(args, name) {
	for (const arg of args) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

export function main(argv) {
	const args = argv.slice(2);
	const rootArg = parseArg(args, '--root');
	const recordArg = parseArg(args, '--record');
	const reportFormat = parseArg(args, '--report');
	const reportOut = parseArg(args, '--report-out');
	const update = args.includes('--update');
	const root = rootArg === null ? repoRoot : resolve(process.cwd(), rootArg);

	if (args.includes('--help') || args.includes('-h')) {
		process.stdout.write(
			[
				'Usage: node scripts/check-tool-artifact-inventory.mjs [options]',
				'',
				'  --update              regenerate the reviewed record, then re-evaluate',
				'  --root=<dir>          inspect another repository (fixture / sandbox reproduction)',
				'  --record=<file>       reviewed record path (default quality/tool-artifact-inventory.json)',
				'  --report=<format>     markdown | json | html',
				'  --report-out=<file>   write the report to a file instead of stdout',
				'',
			].join('\n'),
		);
		return 0;
	}

	let manifest;
	let record;
	try {
		const inputs = readInventoryInputs(root, recordArg ?? RECORD_RELATIVE_PATH);
		manifest = inputs.manifest;
		record = inputs.record;
	} catch (error) {
		process.stderr.write(`[check-tool-artifact-inventory] unusable input: ${error.message}\n`);
		return 2;
	}

	if (update) {
		const generated = renderRecord(manifest, root);
		const target = writeRecord(root, generated, recordArg);
		process.stderr.write(
			`[check-tool-artifact-inventory] reviewed record written: ${target.replace(`${root}/`, '')}\n`,
		);
		record = JSON.parse(readFileSync(target, 'utf8'));
	}

	const result = collectToolInventory({ root, manifest, record });

	if (reportFormat !== null) {
		const rendered =
			reportFormat === 'json'
				? renderJsonReport(result)
				: reportFormat === 'html'
					? renderHtmlReport(result)
					: renderMarkdownReport(result);
		if (reportOut !== null) {
			const target = resolve(root, reportOut);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, rendered);
			process.stderr.write(
				`[check-tool-artifact-inventory] ${reportFormat} report written: ${target}\n`,
			);
		} else {
			process.stdout.write(rendered);
		}
	}

	const lines = [
		`[check-tool-artifact-inventory] ${result.counts.error} error(s), ${result.counts.warn} warning(s), ${result.counts.info} note(s):`,
	];
	for (const item of result.findings) {
		lines.push(`  [${item.severity}] ${item.code} ${item.subject}: ${item.message}`);
		lines.push(`      remedy: ${item.remedy}`);
	}
	if (result.summary.inventoryOnly > 0) {
		lines.push(
			`  [info] INVENTORY_ONLY ${result.summary.inventoryOnly} manifest entr(y/ies) have no checked-out source in this tree; their \`license\` field is unreviewed documentation, not evidence, and nothing is published from them`,
		);
	}
	lines.push(
		`[check-tool-artifact-inventory] ${result.summary.tools} tool(s) inspected: ` +
			`${result.summary.shipped} shipped, ${result.summary.passed} pass, ${result.summary.warned} warn, ` +
			`${result.summary.failed} fail, ${result.summary.inventoryOnly} inventory-only. Result: ${result.ok ? 'PASS' : 'FAIL'}`,
	);
	const stream = result.ok ? process.stdout : process.stderr;
	stream.write(`${lines.join('\n')}\n`);
	return result.ok ? 0 : 1;
}

function invokedAsScript() {
	const entry = process.argv[1];
	return entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (invokedAsScript()) {
	process.exitCode = main(process.argv);
}
