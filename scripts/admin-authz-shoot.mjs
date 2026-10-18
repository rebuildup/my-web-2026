#!/usr/bin/env node
/**
 * admin-authz-shoot — render the admin authorization matrix as the
 * verification artefact for Issue #441.
 *
 * Output: `docs/verification/security/admin-authorization-matrix.webp`
 *
 * What it does
 * ------------
 * 1. Starts the local stack (migrations + seed + `vite preview` against
 *    `.tmp/d1state`) through `scripts/e2e-local-bootstrap.mjs` — the
 *    same bootstrap Playwright's `webServer` uses, so the artefact
 *    describes the environment the gate runs against. Pass a base URL
 *    as the first argument to probe an already-running server instead.
 * 2. Seeds the authorization fixture (two synthetic identities, one
 *    invited row, two scoped API keys) into the LOCAL binding.
 * 3. Fails closed if the fixture session cannot authenticate, so a
 *    degraded probe can never be rendered as a passing matrix.
 * 4. Probes the whole matrix (admin UI routes x three identities,
 *    internal APIs x three credential states) over real HTTP and
 *    compares each observation against the shared expectations in
 *    `scripts/admin-authz-fixture.mjs`.
 * 5. Renders the observed matrix and writes it as WebP.
 *
 * Why WebP
 * ---------
 * The Issue names a `.png` artefact. A rendered matrix is flat colour
 * and text, which WebP compresses far smaller at the same legibility,
 * and repository bloat is a review cost: PNG would land ~4-8x the
 * bytes of the WebP this script writes (quality 80, width capped at
 * 1600px, well under 300KB). The path is therefore the Issue's path
 * with the `.webp` extension; nothing else about the artefact changes.
 * Playwright can only encode PNG/JPEG, so the capture is taken into a
 * Buffer and re-encoded with the existing `sharp` devDependency. No
 * intermediate PNG is written to disk, and the target extension is
 * asserted to be `.webp` so a PNG can never drift back into `docs/`.
 * `sharp` stays a devDependency and is never imported by the Worker /
 * SSR.
 *
 * This script is committed so the required screenshot has a reviewable,
 * reproducible source instead of an uncommitted helper. It reads no
 * secret: the fixture seeds synthetic `.invalid` identities into the
 * LOCAL D1 binding and signs its session cookie with Better Auth's
 * published fallback secret.
 *
 *   node scripts/admin-authz-shoot.mjs
 *   pnpm run verify:admin-authz-screenshot   # same thing
 *
 * Secrets
 * -------
 * The rendered page contains status codes, redirect targets, and marker
 * LABELS only. No session token, API key plaintext, address, or any
 * other fixture value is drawn, and a mismatch reports labels rather
 * than values (AGENTS.md §4: agents must not surface credential values;
 * Issue #441: do not log secret values or internal personal data).
 *
 * Exit code is non-zero when any observation misses its expectation, so
 * this doubles as a local gate: a stale screenshot cannot be produced
 * from a run that actually failed.
 *
 * Usage:
 *   node scripts/admin-authz-shoot.mjs [baseUrl] [outPath]
 *
 * Defaults: baseUrl http://127.0.0.1:3111 (the script starts the
 * server), outPath docs/verification/security/admin-authorization-matrix.webp
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import {
	API_COLUMNS,
	API_EXPECTED,
	API_LABELS,
	IDENTITIES,
	IDENTITY_LABELS,
	assertFixtureAuthenticates,
	assertPortFree,
	collectMatrix,
	seedAdminAuthzFixture,
	waitForServer,
} from './admin-authz-fixture.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.ADMIN_AUTHZ_PORT ?? '3111';
const EXTERNAL_BASE_URL = process.argv[2] ?? null;
const OUT_PATH = resolve(
	REPO_ROOT,
	process.argv[3] ?? 'docs/verification/security/admin-authorization-matrix.webp',
);
const BASE_URL = EXTERNAL_BASE_URL ?? `http://127.0.0.1:${PORT}`;
/** WebP settings: bounded width, readable text, repository-friendly size. */
const IMAGE = Object.freeze({ width: 1600, quality: 80 });

let server = null;

function startLocalServer() {
	server = spawn(process.execPath, ['scripts/e2e-local-bootstrap.mjs', `--port=${PORT}`], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
	});
	const stop = () => {
		if (server && server.exitCode === null) server.kill('SIGTERM');
	};
	process.on('exit', stop);
	process.on('SIGINT', () => {
		stop();
		process.exit(130);
	});
}

function escapeHtml(value) {
	return String(value).replace(
		/[&<>"]/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char],
	);
}

/** `redirect:/admin/login` → `307 → /admin/login`; `page` → `200`. */
function observedRouteCell(row, identity) {
	const observed = row.observed[identity];
	const detail = observed.location ? ` → ${observed.location}` : '';
	const seen = observed.markers.length > 0 ? ` / ${observed.markers.join(', ')}` : '';
	return {
		text: `${observed.status}${detail}${seen}`,
		ok: observed.matched,
	};
}

function observedApiCell(row, column) {
	const observed = row.observed[column];
	const seen = observed.markers.length > 0 ? ` / ${observed.markers.join(', ')}` : '';
	return {
		text: `${observed.status}${seen}`,
		ok: observed.matched,
	};
}

function cell(value) {
	return `<td class="${value.ok ? 'ok' : 'ng'}">${escapeHtml(value.text)}</td>`;
}

function mismatches(matrix) {
	return [
		...matrix.routes.flatMap((row) =>
			IDENTITIES.filter((id) => !observedRouteCell(row, id).ok).map((id) => `${row.path} / ${id}`),
		),
		...matrix.api.flatMap((row) =>
			API_COLUMNS.filter((column) => !observedApiCell(row, column).ok).map(
				(column) => `${row.label} / ${column}`,
			),
		),
	];
}

function renderReport(matrix, { generatedAt, baseUrl }) {
	const routeRows = matrix.routes
		.map(
			(row) =>
				`<tr><th>${escapeHtml(row.path)}</th>${IDENTITIES.map((id) =>
					cell(observedRouteCell(row, id)),
				).join('')}</tr>`,
		)
		.join('');
	const apiRows = matrix.api
		.map(
			(row) =>
				`<tr><th>${escapeHtml(row.label)}<span class="sub">${escapeHtml(row.scope)}:${escapeHtml(
					row.action,
				)}</span></th>${API_COLUMNS.map((column) => cell(observedApiCell(row, column))).join('')}</tr>`,
		)
		.join('');
	const failures = mismatches(matrix);
	const verdict = failures.length === 0;

	return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>admin authorization matrix</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Helvetica Neue", "Noto Sans JP", sans-serif; margin: 0; padding: 32px 40px; color: #14161a; background: #ffffff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #5a6472; margin: 0 0 20px; line-height: 1.7; }
  h2 { font-size: 15px; margin: 26px 0 8px; letter-spacing: 0.04em; text-transform: uppercase; color: #384150; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #d7dce4; padding: 7px 10px; text-align: left; vertical-align: top; }
  thead th { background: #f2f4f8; font-size: 12px; }
  tbody th { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; background: #fafbfd; white-space: nowrap; }
  .sub { display: block; font-weight: 400; color: #5a6472; font-size: 11px; }
  td.ok { background: #eefaf0; color: #10502a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  td.ng { background: #fdeeee; color: #8a1c1c; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .verdict { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: 700; }
  .verdict.pass { background: #10502a; color: #fff; }
  .verdict.fail { background: #8a1c1c; color: #fff; }
  .foot { margin-top: 22px; font-size: 11px; color: #5a6472; line-height: 1.7; border-top: 1px solid #d7dce4; padding-top: 12px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style></head>
<body>
  <h1>管理画面の認可マトリクス — admin authorization matrix</h1>
  <p class="meta">
    Issue #441 / local workerd (<code>.tmp/d1state</code>, 破壊的操作なし) / base URL <code>${escapeHtml(baseUrl)}</code><br>
    取得日時 (UTC): ${escapeHtml(generatedAt)} —
    <span class="verdict ${verdict ? 'pass' : 'fail'}">${verdict ? '期待どおり / all as expected' : '不一致あり / mismatch'}</span>
  </p>

  <h2>1. 管理UI route × 呼び出し元</h2>
  <table>
    <thead><tr><th>route</th>${IDENTITIES.map(
			(id) => `<th>${escapeHtml(IDENTITY_LABELS[id])}</th>`,
		).join('')}</tr></thead>
    <tbody>${routeRows}</tbody>
  </table>

  <h2>2. 内部API × API key スコープ</h2>
  <table>
    <thead><tr><th>endpoint / required scope</th>${API_COLUMNS.map(
			(column) =>
				`<th>${escapeHtml(API_LABELS[column])}<span class="sub">expected ${API_EXPECTED[column]}</span></th>`,
		).join('')}</tr></thead>
    <tbody>${apiRows}</tbody>
  </table>

  <div class="foot">
    確認したアカウント権限: <code>role=admin</code>（管理者）、<code>role=user</code>（非管理者）、未認証（Cookie なし）。API key はスコープごとに 1 枚ずつ、local D1 に発行（<code>access_counter</code> / <code>reactions</code>）。<br>
    未認証・非管理者・内部API の各行に、以下が出現しないことを検査: ${matrix.markers
			.map((marker) => `<code>${escapeHtml(marker.label)}</code>`)
			.join(
				' / ',
			)}。管理者セルに出ている識別子は、そのroute が描画すべき値（<code>adminEmail</code> / <code>keyName</code> / <code>inviteeEmail</code>）だけで、それ以外は漏えい扱い。<br>
    スクリーンショットには秘密値・個人情報・実際の宛先を一切描画していない（値ではなくラベルとステータスのみ）。<br>
    検証手順: <code>node scripts/admin-authz-shoot.mjs</code> / ゲート: <code>e2e/admin-authorization.spec.ts</code> と <code>test/integration/admin-authorization.test.ts</code>。
  </div>
</body></html>`;
}

async function main() {
	if (!EXTERNAL_BASE_URL) {
		await assertPortFree(BASE_URL);
		startLocalServer();
	}
	await waitForServer(BASE_URL);
	const fixture = await seedAdminAuthzFixture();
	await assertFixtureAuthenticates(BASE_URL, fixture.cookies);

	const matrix = await collectMatrix({ baseUrl: BASE_URL, fixture });
	const html = renderReport(matrix, { generatedAt: new Date().toISOString(), baseUrl: BASE_URL });

	// The HTML report is a debugging aid and belongs in `.tmp/`
	// (AGENTS.md §9). Only the WebP is an artefact, and only the WebP
	// is committed.
	const htmlPath = resolve(REPO_ROOT, '.tmp/admin-authorization-matrix.html');
	await mkdir(dirname(htmlPath), { recursive: true });
	await writeFile(htmlPath, html, 'utf8');

	if (extname(OUT_PATH) !== '.webp') {
		const remedy =
			'A PNG screenshot bloats the repository for no evidentiary gain (see the WebP note in the script header).';
		throw new Error(`the artefact path must end in .webp (got ${OUT_PATH}). ${remedy}`);
	}

	const browser = await chromium.launch();
	let capture;
	try {
		const page = await browser.newPage({ viewport: { width: IMAGE.width, height: 900 } });
		await page.setContent(html, { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		// fullPage: the report is taller than one viewport, and a
		// clipped picture would hide the API table it exists to show.
		// The PNG bytes stay in memory only — nothing is written to disk
		// except the WebP below.
		capture = await page.screenshot({ fullPage: true });
	} finally {
		await browser.close();
	}

	// PNG -> WebP: the screenshot is flat colour and text, so WebP at
	// quality 80 keeps it legible at a fraction of the bytes.
	await mkdir(dirname(OUT_PATH), { recursive: true });
	await sharp(capture)
		.resize({ width: IMAGE.width, withoutEnlargement: true })
		.webp({ quality: IMAGE.quality })
		.toFile(OUT_PATH);

	for (const row of matrix.routes) {
		for (const id of IDENTITIES) {
			const value = observedRouteCell(row, id);
			process.stdout.write(`${value.ok ? 'PASS' : 'FAIL'} ${row.path} [${id}] ${value.text}\n`);
		}
	}
	for (const row of matrix.api) {
		for (const column of API_COLUMNS) {
			const value = observedApiCell(row, column);
			process.stdout.write(
				`${value.ok ? 'PASS' : 'FAIL'} ${row.label} [${column}] ${value.text}\n`,
			);
		}
	}
	process.stdout.write(`\nwrote ${OUT_PATH}\n`);

	const failures = mismatches(matrix);
	if (failures.length > 0) {
		process.stderr.write(
			`\nadmin-authz-shoot: ${failures.length} mismatch(es)\n${failures.join('\n')}\n`,
		);
		process.exitCode = 1;
	}
	if (server && server.exitCode === null) server.kill('SIGTERM');
}

main().catch((error) => {
	process.stderr.write(`admin-authz-shoot failed: ${error?.stack ?? error}\n`);
	if (error?.cause) process.stderr.write(`cause: ${error.cause?.stack ?? error.cause}\n`);
	if (server && server.exitCode === null) server.kill('SIGTERM');
	process.exit(1);
});
