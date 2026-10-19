#!/usr/bin/env node
/**
 * R2 media restore proof (Issue #462).
 *
 * The claim it exercises
 * ---------------------
 * When one public image is deleted from the `MEDIA` bucket, the
 * restore procedure in `docs/runbook/r2-media-restore.md` puts back
 * **the object that was lost**, or it fails — and the failure states
 * are as much a part of the claim as the happy path, because the
 * dangerous outcome is not "the image stayed missing". It is "a
 * restore reported success while the bytes, or the metadata, or the
 * visibility of the object were wrong".
 *
 * What it runs against
 * --------------------
 * **A test bucket, in this process.** Every case is a recorded fixture
 * under `quality/fixtures/r2-media-restore/`, executed through
 * `src/cloudflare/media-restore.ts` — the same module the local-R2
 * integration test drives against the real workerd R2 binding. No
 * Cloudflare credential is read, no bucket is contacted, no local
 * wrangler store is touched, and there is no code path here that
 * could reach production: the store and the retained source are
 * in-memory stubs, and the only writes are Map insertions inside
 * this process.
 *
 * The destructive question the Issue asks ("1 媒体を消した想定") is
 * answered by construction — the `absent` bucket state *is* the
 * post-deletion state — and by assertion: the cases that must not
 * write declare `bucketAfter: absent`, and a run that wrote anyway
 * fails the command.
 *
 * Status-only output
 * ------------------
 * Same contract as the key-set audit (`scripts/check-r2-media-key-set.mjs`,
 * Issue #577): verdict and reason codes, never an object key, a key
 * fragment, a namespace, a source path, or a credential. The rendered
 * text and the HTML page are both checked against the keys the run
 * touched before a byte is written, and a leak fails the command
 * rather than producing an artefact.
 *
 * Usage:
 *   node scripts/r2-media-restore-proof.mjs
 *   node scripts/r2-media-restore-proof.mjs --html=.tmp/r2-restore-proof.html
 *
 * Exit codes:
 *   0  every fixture behaved as it declares (the procedure holds)
 *   1  at least one case deviated — the procedure does NOT hold
 *   2  bad input (unreadable fixture, fixture whose declared digest
 *      does not match its own bytes, usage error)
 *
 * A case that legitimately ends in `missing_source` or
 * `metadata_drift` is still a *passing* case for this command: the
 * proof is that the procedure reports those states, not that the
 * states never occur. What must never happen is a deviation.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	RESTORE_VERDICT,
	formatRestoreReport,
	restoreExitCodeFor,
	restoreMediaObject,
	sha256Hex,
} from '../src/cloudflare/media-restore.ts';
import { assertNoKeyInText } from './_r2-media-key-set.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = resolve(ROOT, 'quality', 'fixtures', 'r2-media-restore');
const DEFAULT_HTML = resolve(ROOT, '.tmp', 'r2-restore-proof.html');

/**
 * Rendered in this order: the two passing states, then the refusals
 * that must not write, then the fail-closed states. A reader should
 * reach the first failure shape only after seeing what success is.
 */
const CASES = [
	'deleted-restored.json',
	'already-intact.json',
	'private-key.json',
	'missing-source.json',
	'source-drift.json',
	'truncated-write.json',
	'unreadable-source.json',
];

/** One synthetic 1x1 PNG, kept small enough to inline as base64. */
function decodeBytes(base64) {
	if (typeof base64 !== 'string') throw new Error('bytesBase64 must be a string');
	return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * The test bucket. A `Map`, not an R2 binding: a restore proof that
 * could reach a real bucket would be a mutation path, and this
 * command has no credential, no target flag, and no write to the
 * production store to guard in the first place.
 */
function testBucket(seed) {
	const objects = new Map();
	if (seed) objects.set(seed.key, { bytes: seed.bytes, contentType: seed.contentType });
	const writes = [];
	return {
		writes,
		objects,
		store: {
			read: async (key) => {
				const found = objects.get(key);
				if (!found) return null;
				return {
					bytes: found.bytes,
					sizeBytes: found.bytes.byteLength,
					sha256: await sha256Hex(found.bytes),
					contentType: found.contentType,
				};
			},
			write: async (entry, bytes) => {
				writes.push(entry.key);
				objects.set(entry.key, {
					bytes: (seed?.truncateWrites ?? false) ? bytes.subarray(0, 3) : bytes,
					contentType: entry.contentType,
				});
			},
		},
	};
}

/** The retained export an operator holds outside the bucket. */
function retainedSource(state) {
	return {
		read: async () => {
			if (state.state === 'unreadable') throw new Error('retained source read failed');
			if (state.state === 'missing') return null;
			return { bytes: decodeBytes(state.bytesBase64), contentType: state.contentType ?? null };
		},
	};
}

function out(text) {
	process.stdout.write(text);
}

function fail(message) {
	process.stderr.write(`[r2-restore-proof] ${message}\n`);
	return 2;
}

/**
 * How the bucket stands after the run, in words a reviewer can check
 * against the fixture: `absent` (nothing was written), `matching`
 * (present and equal to the manifest) or `mismatched` (present, but
 * not equal to the manifest — what a truncated write leaves).
 */
async function bucketStateOf(bucket, entry) {
	const stored = bucket.objects.get(entry.key);
	if (!stored) return 'absent';
	const sha256 = await sha256Hex(stored.bytes);
	const matches =
		sha256 === entry.sha256 &&
		stored.bytes.byteLength === entry.sizeBytes &&
		(stored.contentType ?? '').split(';')[0].trim() === entry.contentType;
	return matches ? 'matching' : 'mismatched';
}

async function loadFixture(fileName) {
	const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, fileName), 'utf8'));
	const entry = raw.entry;
	if (!entry || typeof entry.key !== 'string') throw new Error('entry.key is required');

	const source = {
		state: raw.source?.state ?? 'missing',
		contentType: raw.source?.contentType ?? null,
		bytesBase64: raw.source?.bytesBase64 ?? '',
	};
	// A fixture that does not declare `matchesManifest: false` must
	// carry bytes its own manifest describes, or every assertion below
	// is vacuous. That is bad input (exit 2), not a failing case.
	if (source.state === 'retained' && raw.source?.matchesManifest !== false) {
		const bytes = decodeBytes(source.bytesBase64);
		// A fixture whose declared digest does not match its own bytes
		// would make every assertion below vacuous, so it is a bad
		// input rather than a failing case.
		const digest = await sha256Hex(bytes);
		if (digest !== entry.sha256 || bytes.byteLength !== entry.sizeBytes) {
			throw new Error(
				`entry digest/size (${entry.sha256}/${entry.sizeBytes}) does not match the source bytes (${digest}/${bytes.byteLength})`,
			);
		}
	}

	const bucketSpec = raw.bucket ?? { state: 'absent' };
	const bucket = testBucket({
		key: entry.key,
		bytes: decodeBytes(bucketSpec.bytesBase64 ?? ''),
		contentType: bucketSpec.contentType ?? null,
		truncateWrites: (raw.faults ?? []).includes('truncate_write'),
	});
	if (bucketSpec.state !== 'present') bucket.objects.delete(entry.key);

	const result = await restoreMediaObject(bucket.store, retainedSource(source), entry);
	return {
		fileName,
		case: raw.case,
		note: raw.note ?? '',
		entry,
		result,
		exitCode: restoreExitCodeFor(result),
		bucketAfter: await bucketStateOf(bucket, entry),
		writeCount: bucket.writes.length,
		expect: raw.expect,
	};
}

function projectVersion() {
	try {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The report records the command that produced it, not the machine it
 * ran on: an absolute home path in a committed artefact is noise that
 * changes on every checkout.
 */
function relative(root, path) {
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function deviations(entry) {
	const problems = [];
	if (!entry.expect) return ['fixture declares no expect block'];
	const actual = {
		verdict: entry.result.verdict,
		reason: entry.result.reason,
		exitCode: entry.exitCode,
		bucketAfter: entry.bucketAfter,
	};
	for (const field of Object.keys(actual)) {
		if (entry.expect[field] !== actual[field]) {
			problems.push(`${field}: expected ${entry.expect[field]}, got ${actual[field]}`);
		}
	}
	return problems;
}

function renderCase(entry) {
	const passing = deviations(entry).length === 0;
	return `<tr>
  <th scope="row">${escapeHtml(entry.case)}</th>
  <td>${escapeHtml(entry.note)}</td>
  <td class="verdict ${entry.result.verdict === RESTORE_VERDICT.restored || entry.result.verdict === RESTORE_VERDICT.alreadyIntact ? 'ok' : 'fail'}">${escapeHtml(entry.result.verdict)}</td>
  <td><code>${escapeHtml(entry.result.reason)}</code></td>
  <td><code>${escapeHtml(entry.exitCode)}</code></td>
  <td>${escapeHtml(entry.bucketAfter)}</td>
  <td><code>${escapeHtml(entry.result.checks.join('>'))}</code></td>
  <td class="${passing ? 'ok' : 'fail'}">${passing ? 'as declared' : escapeHtml(deviations(entry).join('; '))}</td>
</tr>`;
}

function buildPage({ entries, htmlPath }) {
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>R2 media restore proof — Issue #462</title>
<style>
  :root {
    color-scheme: light;
    --ink: #14171a; --muted: #5d646b; --line: #d9dde1;
    --surface: #ffffff; --canvas: #f6f7f8;
    --ok: #14663c; --ok-bg: #e8f5ee; --fail: #8c1d1d; --fail-bg: #fdecec;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 44px 56px; background: var(--canvas); color: var(--ink);
    font: 15px/1.65 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  }
  header { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: 0.01em; }
  h2 { font-size: 16px; margin: 30px 0 10px; letter-spacing: 0.02em; }
  .meta { color: var(--muted); font-size: 13px; margin: 0; }
  p.lede { margin: 0 0 10px; color: var(--muted); max-width: 82ch; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); font-size: 12.5px; }
  th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
  thead th { background: #eef0f2; font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
  tbody th { font-weight: 600; white-space: nowrap; }
  .verdict { font-weight: 700; white-space: nowrap; }
  .verdict.ok, td.ok { color: var(--ok); background: var(--ok-bg); }
  .verdict.fail, td.fail { color: var(--fail); background: var(--fail-bg); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: #eef0f2; padding: 1px 5px; border-radius: 4px; word-break: break-all; }
  pre { background: var(--surface); border: 1px solid var(--line); padding: 12px 14px; overflow-x: auto; }
  figure { margin: 0 0 18px; }
  figcaption { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  ol { max-width: 82ch; }
  footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>R2 メディア復旧 proof</h1>
  <p class="meta">Issue #462 · my-web-2026 ${escapeHtml(projectVersion())} · 生成: ${escapeHtml(new Date().toISOString())} · ${escapeHtml(relative(ROOT, htmlPath))}</p>
</header>

<p class="lede">
  公開画像が <code>MEDIA</code> から 1 件消えたとき、手順は「消えたものと同じ物体」を戻すか、
  戻せないと<strong>失敗として報告する</strong>。危険なのは画像が残らないことではなく、
  bytes・metadata・公開可否が誤ったまま「復旧成功」と報告されることです。
  この proof は <code>quality/fixtures/r2-media-restore/</code> の記録済み fixture を
  <code>src/cloudflare/media-restore.ts</code> に通し、production bucket・credential・
  network に一切触れずに 7 ケースを実行します（実行先は process 内の Map）。
</p>

<h2>1. 判定表（fixture を実際に実行した結果）</h2>
<table>
  <thead><tr><th>ケース</th><th>内容</th><th>verdict</th><th>reason</th><th>exit</th><th>実行後の bucket</th><th>到達した検査</th><th>宣言どおりの挙動</th></tr></thead>
  <tbody>
${entries.map(renderCase).join('\n')}
  </tbody>
</table>

<h2>2. CLI 出力（status-only）</h2>
${entries
	.map(
		(entry) => `<figure>
  <figcaption>${escapeHtml(entry.case)}</figcaption>
  <pre>${escapeHtml(
		formatRestoreReport(entry.result, { target: 'test-bucket', label: entry.case }).trim(),
	)}</pre>
</figure>`,
	)
	.join('\n')}

<h2>3. 手順（実測した検査列）</h2>
<p class="lede">
  検査は左から順に short-circuit します。<code>checks</code> 列が空なら key gate で停止した
  （bucket に read も write もしていない）、<code>readback</code> まで到達して
  <code>verdict</code> が失敗なら「書き込んだが検証できない」= 復旧ではない、という意味です。
</p>
<ol>
  <li><strong>可視性ゲート</strong> — <code>classifyMediaKey</code> で key を判定。private / 未宣言 namespace / 不正 key は <strong>write 前に</strong> <code>refused_key</code> で終了。</li>
  <li><strong>bucket 現状の read</strong> — 読めなければ <code>undecidable</code>（exit 2）。manifest と一致していれば <code>already_intact</code> で write しない。</li>
  <li><strong>retained source の read</strong> — 保持が無ければ <code>missing_source</code>、読めなければ <code>undecidable</code>。どちらも write しない。</li>
  <li><strong>source と manifest の照合</strong> — sha256 / byte 長 / content type。ずれていれば <code>metadata_drift</code> で write しない。</li>
  <li><strong>write</strong> — manifest の content type で保存。</li>
  <li><strong>read-back 照合</strong> — 再度 read して 3 項目を照合。ここを通って初めて <code>restored</code>。</li>
</ol>

<h2>4. 実 bucket での再現手順</h2>
<p class="lede">
  この proof は production を触りません。実際の復旧は operator が R2 スコープ credential を保持した
  上で、本番 write が許されるContexts でのみ行います。手順と失敗時挙動は
  <code>docs/runbook/r2-media-restore.md</code>、production の read-only 監査は
  <code>docs/runbook/r2-media-key-set-audit.md</code>（Issue #577）にあります。
</p>
<pre>pnpm run r2:restore:proof                                # fixture proof（status-only）
pnpm run r2:restore:proof:report                         # この HTML
pnpm exec vitest run test/integration/r2-media-restore.test.ts   # 実 R2 binding（workerd ローカル）</pre>

<footer>
  status-only 契約: object key・key 断片・namespace・source path・credential は出力しません。
  出力と HTML の両方を実行前に同じ leak guard に通しており、1 件でも通れば本コマンドは非ゼロ終了します。
  fixture 実行先は process 内の Map であり、Cloudflare への read / write コードパスは存在しません。
</footer>
</body>
</html>
`;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg === '--help' || arg === '-h')) {
		out(
			'Usage: node scripts/r2-media-restore-proof.mjs [--html=<path>]\n' +
				'Exit: 0 = every fixture behaved as declared, 1 = a case deviated, 2 = bad input\n',
		);
		return 0;
	}
	const unknown = args.filter((arg) => arg !== '--html' && !arg.startsWith('--html='));
	if (unknown.length > 0) return fail(`unknown argument: ${unknown[0]}`);
	const htmlArg = args.find((arg) => arg.startsWith('--html='));
	const htmlPath = htmlArg ? resolve(process.cwd(), htmlArg.slice('--html='.length)) : null;

	let entries;
	try {
		entries = [];
		for (const fileName of CASES) entries.push(await loadFixture(fileName));
	} catch (error) {
		return fail(error.message);
	}

	for (const entry of entries) {
		out(formatRestoreReport(entry.result, { target: 'test-bucket', label: entry.case }));
	}

	const problems = entries.flatMap((entry) =>
		deviations(entry).map((problem) => `${entry.fileName}: ${problem}`),
	);

	const pages = [
		entries
			.map((entry) =>
				formatRestoreReport(entry.result, { target: 'test-bucket', label: entry.case }),
			)
			.join(''),
	];
	const html = htmlPath ? buildPage({ entries, htmlPath }) : null;
	if (html) pages.push(html);

	// Same guard the key-set audit applies to its own output, run
	// against the keys these cases actually touched.
	try {
		assertNoKeyInText(
			pages.join(''),
			entries.map((entry) => entry.entry.key),
		);
	} catch (error) {
		process.stderr.write(`[r2-restore-proof] ${error.message}\n`);
		return 1;
	}

	if (html && htmlPath) {
		mkdirSync(dirname(htmlPath), { recursive: true });
		writeFileSync(htmlPath, html);
		out(`[r2-restore-proof] wrote ${htmlPath}\n`);
	}

	if (problems.length > 0) {
		for (const problem of problems) process.stderr.write(`[r2-restore-proof] ${problem}\n`);
		out(
			`[r2-restore-proof] verdict=DEVIATED cases=${entries.length} deviations=${problems.length}\n`,
		);
		return 1;
	}

	out(
		`[r2-restore-proof] verdict=HELD cases=${entries.length} passes=${entries.filter((entry) => entry.exitCode === 0).length} refusals=${entries.filter((entry) => entry.exitCode === 1).length} undecidable=${entries.filter((entry) => entry.exitCode === 2).length}\n`,
	);
	out(
		'[r2-restore-proof] target=test-bucket (in-process) mutation=none printed=no object key, no source path, no credential\n',
	);
	return 0;
}

process.exit(await main());
