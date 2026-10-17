#!/usr/bin/env node
/**
 * perf-large-list — measure the `/portfolio` pagination boundary on a
 * large synthetic catalogue (Issue #490).
 *
 * What this measures, and what it deliberately does not
 * ----------------------------------------------------
 * MEASURED: DOM node count, JS heap, navigation timings, the "Load
 * more" append cost, and a small set of accessibility invariants on
 * a 100+ row catalogue.
 *
 * NOT MEASURED: a Lighthouse score, a Core Web Vitals budget, or any
 * other pass/fail quality GATE. Those belong to Issue #384
 * (reproducible Lighthouse reports), #385 (the release gate) and #386
 * (Web Vitals budgets). This script produces a REPORT. Deciding that
 * a number should ever fail a build is a different ticket with its
 * own noise budget — conflating measurement, visualisation and gate
 * is exactly what Issue #490 forbids.
 *
 * Why a seeded local D1 and a real browser
 * -----------------------------------------
 * The shipped catalogue is a handful of rows, so the pagination
 * boundary is never reached in normal use. This script seeds a
 * SYNTHETIC catalogue into the LOCAL D1 binding (`.tmp/d1state`),
 * serves the real Worker build with `vite preview`, and drives it
 * with a real Chromium: real route, real cursor loader, real client
 * hydration, real click on "Load more".
 *
 * Production is never touched:
 *   - every D1 call goes through `scripts/_d1.mjs` with
 *     `{ target: 'local' }`,
 *   - the fixture rows are removed again in a `finally` block,
 *   - cover media rows are NOT seeded by default, because
 *     `vite preview` binds `MEDIA_PUBLIC_BASE_URL` to the production
 *     media origin and a local measurement must not depend on
 *     (or issue requests against) it. The measured card is therefore
 *     the documented placeholder / text-only shape, and the report
 *     says so in `environment.mediaPublicBaseUrl`.
 *   - no secret value is read or printed, and nothing is deployed.
 *
 * Reproduction conditions (browser build, viewport, CPU throttle,
 * network profile, source SHA) are recorded in the JSON report so a
 * reviewer can tell which environment produced which number.
 *
 * Usage:
 *   node scripts/perf-large-list.mjs [options]
 *
 *   --count=<n>          catalogue size (default 120; >= 100 required)
 *   --page-size=<n>      expected first-page size (default 100)
 *   --port=<n>           preview server port (default 15921)
 *   --base-url=<url>     measure an ALREADY RUNNING server instead of
 *                        spawning a preview process
 *   --json-out=<path>    report destination
 *                        (default .tmp/perf-large-list/report.json)
 *   --screenshot=<path>  committed capture destination
 *                        (default docs/verification/perf/large-list-pagination.webp)
 *   --cpu-throttle=<n>   CDP CPU throttling rate (default 4)
 *   --keep-fixtures      leave the seeded rows in the local D1
 *   --no-screenshot      skip the capture
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { applyMigrations, executeBatch, runStatement } from './_d1.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Fixed clock, shared with `test/fixtures/large-portfolio-fixture.ts`. */
export const FIXTURE_EPOCH_MS = 1_700_000_000_000;

/** Every synthetic row id carries this prefix; cleanup is scoped to it. */
export const FIXTURE_ID_PREFIX = 'fx-';

/** Facets cycle through the closed enum so no row can invent a facet. */
const FACET_CYCLE = ['develop', 'design', 'video', 'other'];
const TECHNOLOGY_CYCLE = ['TypeScript', 'React', 'Cloudflare Workers', 'Panda CSS'];

/**
 * Per-card DOM node ceiling.
 *
 * The measured card is 19 nodes without cover media, so a ceiling of
 * 20 leaves exactly one node of headroom for a legitimate single
 * addition while still failing loudly if a card starts rendering a
 * sub-tree per facet, per technology or per link. It is a REGRESSION
 * CEILING ("one card must stop being one card"), not a performance
 * budget: nothing here is expressed in milliseconds.
 */
export const PER_CARD_NODE_CEILING = 20;

/**
 * Committed captures are WebP: width cap, quality, and size budget.
 *
 * Chromium can only write PNG, and the Issue names a `.png` path, but
 * a verification artefact does not justify a large binary in the tree.
 * The capture is therefore converted with `sharp` and the temporary
 * PNG is deleted; the committed file is the `.webp` sibling of the
 * Issue's path (the substitution is stated in the PR body and in
 * `docs/verification/perf/large-list-pagination.md`).
 */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/**
 * Roles that may carry `aria-label`.
 *
 * A bare `<div>` (implicit role `generic`) is absent on purpose:
 * `aria-label` on it is a prohibited attribute that exposes the name
 * to no accessibility API. See
 * `docs/verification/perf/large-list-pagination.md`.
 */
export const NAMING_ROLES = new Set([
	'alert',
	'banner',
	'button',
	'cell',
	'columnheader',
	'complementary',
	'contentinfo',
	'dialog',
	'figure',
	'form',
	'group',
	'img',
	'link',
	'list',
	'listitem',
	'main',
	'navigation',
	'region',
	'search',
	'status',
	'table',
	'toolbar',
]);

/**
 * Implicit roles of the native elements this repository renders.
 *
 * `aria-label` is conformant on `<nav aria-label>` and
 * `<a aria-label>` exactly as it is on `role="navigation"` /
 * `role="link"` — the implicit role is the role. Only elements whose
 * implicit role is `generic` (a bare `<div>` / `<span>`) are
 * violations, so the invariant has to resolve the implicit role
 * instead of reading the attribute alone.
 */
export const IMPLICIT_NAMING_ROLES = new Map([
	['a', 'link'], // `href` is always present on the anchors rendered here
	['aside', 'complementary'],
	['button', 'button'],
	['dialog', 'dialog'],
	['fieldset', 'group'],
	['figure', 'figure'],
	['footer', 'contentinfo'],
	['form', 'form'],
	['header', 'banner'],
	['img', 'img'],
	['main', 'main'],
	['nav', 'navigation'],
	['output', 'status'],
	['section', 'region'],
	['table', 'table'],
	['td', 'cell'],
	['th', 'columnheader'],
]);

/** Roles that do not expose a name even when they carry `aria-label`. */
const UNNAMED_ROLES = new Set(['generic', 'presentation', 'none']);

/** Effective role: the explicit attribute wins over the implicit one. */
export function resolveRole(tag, role) {
	if (typeof role === 'string' && role.length > 0) {
		return role.split(/\s+/)[0];
	}
	return IMPLICIT_NAMING_ROLES.get(tag) ?? 'generic';
}

const pad = (value, width) => String(value).padStart(width, '0');

/**
 * `count` synthetic public rows in canonical sort order
 * (`pinned DESC, display_order ASC, updated_at DESC, id ASC`).
 *
 * Every field is a numbered placeholder. This generator cannot
 * produce a real project, employer, date or person: a performance
 * fixture must never be able to invent portfolio facts.
 */
export function buildFixtureRows(count) {
	return Array.from({ length: count }, (_, index) => {
		const slug = `fixture-project-${pad(index, 3)}`;
		return {
			id: `${FIXTURE_ID_PREFIX}${pad(index, 4)}`,
			slug,
			title: `Fixture project ${pad(index, 3)}`,
			summary: `Synthetic row ${index} generated for the Issue #490 large-list boundary measurement. Not a real project.`,
			role: 'Synthetic fixture role',
			periodLabel: '2026',
			facet: FACET_CYCLE[index % FACET_CYCLE.length],
			technology: TECHNOLOGY_CYCLE[index % TECHNOLOGY_CYCLE.length],
			pinned: index % 10 === 0 ? 1 : 0,
			displayOrder: index,
			createdAt: FIXTURE_EPOCH_MS - index,
			updatedAt: FIXTURE_EPOCH_MS - index,
			mediaId: `${FIXTURE_ID_PREFIX}media-${pad(index, 4)}`,
			r2Key: `portfolio/${slug}/cover.webp`,
		};
	});
}

/** `INSERT OR REPLACE` for one fixture project row. */
export function fixtureProjectStatement(row) {
	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at';
	const values = [
		`'${row.id}'`,
		`'${row.slug}'`,
		`'${row.title}'`,
		`'${row.summary}'`,
		`'${row.role}'`,
		row.createdAt,
		'NULL',
		`'${row.periodLabel}'`,
		"''",
		`'["${row.facet}"]'`,
		`'["${row.technology}"]'`,
		"'public'",
		"'published'",
		row.pinned,
		row.displayOrder,
		row.createdAt,
		row.updatedAt,
	].join(', ');
	return `INSERT OR REPLACE INTO portfolio_project (${cols}) VALUES (${values})`;
}

/**
 * `INSERT OR REPLACE` for the fixture cover media row.
 *
 * Only used when `--with-media` is passed. The row itself carries no
 * bytes: `composeMediaUrl` still decides what URL (if any) the card
 * renders, and locally there is no media origin to point at.
 */
export function fixtureMediaStatement(row) {
	const cols =
		'id, project_id, r2_key, content_type, width, height, alt, caption, is_cover, display_order, created_at';
	const values = [
		`'${row.mediaId}'`,
		`'${row.id}'`,
		`'${row.r2Key}'`,
		"'image/webp'",
		1280,
		720,
		`'Synthetic cover artwork for ${row.slug}'`,
		'NULL',
		1,
		0,
		row.createdAt,
	].join(', ');
	return `INSERT OR REPLACE INTO portfolio_media (${cols}) VALUES (${values})`;
}

/** Batch payload for `executeBatch`; projects precede their media rows. */
export function fixtureBatchStatements(rows, { withMedia = false } = {}) {
	return [
		...rows.map((row) => ({ sql: fixtureProjectStatement(row), params: [] })),
		...(withMedia ? rows.map((row) => ({ sql: fixtureMediaStatement(row), params: [] })) : []),
	];
}

/** Scoped cleanup — only rows this script could have created. */
export const CLEANUP_SQL = [
	`DELETE FROM portfolio_media WHERE project_id LIKE '${FIXTURE_ID_PREFIX}%'`,
	`DELETE FROM portfolio_link WHERE project_id LIKE '${FIXTURE_ID_PREFIX}%'`,
	`DELETE FROM portfolio_project WHERE id LIKE '${FIXTURE_ID_PREFIX}%'`,
];

/**
 * Accessibility invariant: every element carrying `aria-label` must
 * expose a role that supports naming.
 *
 * `elements` is a plain `{ tag, role, ariaLabel }` array so this stays
 * a pure function (unit-tested with `node --test`) while the browser
 * side collects the same shape from the live DOM. The implicit role
 * of the element is resolved, because `aria-label` is conformant on
 * `<nav aria-label>` exactly as on `role="navigation"`.
 */
export function collectNamingViolations(elements, namingRoles = NAMING_ROLES) {
	return (elements ?? [])
		.filter((el) => typeof el.ariaLabel === 'string' && el.ariaLabel.length > 0)
		.filter((el) => {
			const role = resolveRole(el.tag, el.role);
			if (UNNAMED_ROLES.has(role)) return true;
			return !namingRoles.has(role);
		})
		.map((el) => `${el.tag}[aria-label="${el.ariaLabel}"]`);
}

/**
 * Evaluate the measurement against the documented ceilings.
 *
 * The accessibility ceiling is scoped to the LIST surface
 * (`#portfolio-list`): that is the surface whose defect count scales
 * with the catalogue, and therefore the one this Issue fixes. The
 * page-wide count is reported next to it but never gates, because the
 * chrome above the list (the facet filter, the nav) renders once per
 * page and is explicitly out of scope — see
 * `docs/verification/perf/large-list-pagination.md` §2.
 *
 * The script exits non-zero on failure so a terminal run is
 * reproducible, but this is deliberately NOT wired into
 * `validate:*` — see the file header.
 */
export function evaluateThresholds(report) {
	const failures = [];
	const perCard =
		report.cards.list > 0 ? report.domNodes.list / report.cards.list : Number.POSITIVE_INFINITY;
	if (report.cards.list < report.pageSize) {
		failures.push(
			`first page rendered ${report.cards.list} cards, expected the full page size ${report.pageSize}`,
		);
	}
	if (perCard > report.domNodes.perCardCeiling) {
		failures.push(
			`${perCard.toFixed(2)} DOM nodes per card exceeds the ceiling of ${report.domNodes.perCardCeiling}`,
		);
	}
	if (report.cards.afterLoadMore !== report.expectedTotal) {
		failures.push(
			`after the append the list shows ${report.cards.afterLoadMore} cards, expected the full catalogue ${report.expectedTotal}`,
		);
	}
	if (report.a11y.namingViolationsInList > 0) {
		failures.push(
			`${report.a11y.namingViolationsInList} list element(s) carry aria-label without a role that exposes it`,
		);
	}
	if (report.a11y.imagesWithoutAlt > 0) {
		failures.push(`${report.a11y.imagesWithoutAlt} image(s) render without an alt attribute`);
	}
	if (report.consoleErrors.length > 0) {
		failures.push(`${report.consoleErrors.length} uncaught page error(s) during the measurement`);
	}
	return { pass: failures.length === 0, failures };
}

/** Parse the documented CLI surface. Exported for unit tests. */
export function parseArgs(argv) {
	const options = {
		count: 120,
		pageSize: 100,
		port: 15921,
		cpuThrottle: 4,
		baseUrl: null,
		jsonOut: '.tmp/perf-large-list/report.json',
		screenshot: 'docs/verification/perf/large-list-pagination.webp',
		keepFixtures: false,
		noScreenshot: false,
		withMedia: false,
	};
	for (const arg of argv) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		switch (key) {
			case 'count':
				options.count = Number(value);
				break;
			case 'page-size':
				options.pageSize = Number(value);
				break;
			case 'port':
				options.port = Number(value);
				break;
			case 'cpu-throttle':
				options.cpuThrottle = Number(value);
				break;
			case 'base-url':
				options.baseUrl = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'keep-fixtures':
				options.keepFixtures = true;
				break;
			case 'no-screenshot':
				options.noScreenshot = true;
				break;
			case 'with-media':
				options.withMedia = true;
				break;
			default:
				throw new Error(`unknown option: ${arg}`);
		}
	}
	if (!Number.isInteger(options.count) || options.count < 100) {
		throw new Error('--count must be an integer >= 100 (Issue #490 measures the 100+ boundary)');
	}
	if (!Number.isInteger(options.pageSize) || options.pageSize < 1) {
		throw new Error('--page-size must be a positive integer');
	}
	if (options.count <= options.pageSize) {
		throw new Error('--count must exceed --page-size so a "Load more" boundary exists');
	}
	return options;
}

/**
 * Collect one measurement snapshot from inside the page.
 *
 * Serialised into the browser, so it must stay self-contained: no
 * imports and no closure over Node values.
 */
function collectPageMetrics() {
	const cards = document.querySelectorAll('#portfolio-list ol > li').length;
	const describe = (el) => ({
		tag: el.tagName.toLowerCase(),
		role: el.getAttribute('role'),
		ariaLabel: el.getAttribute('aria-label'),
	});
	const labelled = Array.from(document.querySelectorAll('[aria-label]')).map(describe);
	// The LIST surface only: the defect count that scales with the
	// catalogue lives here, so this is what the threshold gates on.
	const labelledInList = Array.from(document.querySelectorAll('#portfolio-list [aria-label]')).map(
		describe,
	);
	const nav = performance.getEntriesByType('navigation')[0];
	const memory = performance.memory;
	return {
		cards,
		domNodes: document.querySelectorAll('*').length,
		heapMb: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null,
		labelled,
		labelledInList,
		imagesWithoutAlt: Array.from(document.querySelectorAll('img')).filter(
			(img) => !img.getAttribute('alt'),
		).length,
		loadMoreButtons: Array.from(document.querySelectorAll('button')).filter((b) =>
			/load more/i.test(b.textContent ?? ''),
		).length,
		timings: nav
			? {
					responseEndMs: Math.round(nav.responseEnd),
					domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
					loadMs: Math.round(nav.loadEventEnd),
				}
			: null,
	};
}

async function waitForServer(url, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { redirect: 'follow' });
			if (res.ok) return true;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	return false;
}

function startPreview(port) {
	const child = spawn(
		process.execPath,
		[join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port)],
		{ cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
	);
	child.stdout.on('data', () => {});
	child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`));
	return child;
}

function git(args) {
	try {
		return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

function playwrightVersion() {
	try {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
		return pkg.devDependencies?.['@playwright/test'] ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * Paint the measurement onto the page before the screenshot.
 *
 * The Issue asks for one image that carries both the browser state and
 * the numbers, so the reviewer does not have to cross-reference a
 * second artefact. The panel is injected at runtime and is not part of
 * the site.
 */
async function renderMeasurementPanel(page, report, { pageSize }) {
	await page.evaluate(
		({ payload, boundaryIndex }) => {
			const rows = [
				['source SHA', payload.environment.sourceSha.slice(0, 12)],
				['browser', payload.environment.browser],
				[
					'viewport / DPR',
					`${payload.environment.viewport} / ${payload.environment.deviceScaleFactor}`,
				],
				['CPU throttle', `${payload.environment.cpuThrottlingRate}x (CDP)`],
				[
					'network',
					`${payload.environment.networkProfile.label} — ${payload.environment.networkProfile.latencyMs} ms RTT, ${payload.environment.networkProfile.downloadKbps} kbps down`,
				],
				['media', payload.environment.mediaPublicBaseUrl],
				[
					'catalogue',
					`${payload.fixture.count} synthetic rows in the LOCAL D1, page size ${payload.fixture.pageSize}`,
				],
				['cards', `${payload.cards.list} → ${payload.cards.afterLoadMore} after "Load more"`],
				[
					'DOM nodes',
					`${payload.domNodes.list} (${payload.domNodes.perCard}/card, ceiling ${payload.domNodes.perCardCeiling})`,
				],
				[
					'JS heap',
					`${payload.memory.heapMbInitial} MB → ${payload.memory.heapMbAfterLoadMore} MB`,
				],
				['navigation (load)', `${payload.timings.navigation.loadMs} ms`],
				['"Load more" append', `${payload.timings.appendMs} ms`],
				[
					'aria-label w/o naming role',
					`list ${payload.a11y.namingViolationsInList} (page ${payload.a11y.namingViolationsPage}${payload.a11y.namingViolationSamplesPage.length > 0 ? `, e.g. ${payload.a11y.namingViolationSamplesPage[0]}` : ''})`,
				],
				['AX nodes named "facets"', `${payload.a11y.axFacetGroupsAfterLoadMore}`],
				[
					'verdict',
					payload.verdict.pass ? 'PASS' : `FAIL — ${payload.verdict.failures.join('; ')}`,
				],
			];
			const panel = document.createElement('section');
			panel.id = 'issue-490-measurement-panel';
			panel.setAttribute('role', 'note');
			panel.style.cssText = [
				'position:sticky',
				'top:0',
				'z-index:2147483647',
				'margin:0',
				'padding:14px 20px',
				'background:#0b0f14',
				'color:#e6edf3',
				'border-bottom:2px solid #2ea043',
				'font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace',
				'white-space:pre-wrap',
			].join(';');
			panel.textContent = [
				`Issue #490 — /portfolio large-list pagination boundary · measured ${payload.generatedAt}`,
				...rows.map(([k, v]) => `${k} ${v}`),
			].join('\n');
			document.body.prepend(panel);

			// Park the viewport on the pagination boundary itself: the
			// last card of page 1 and the first card of page 2, with the
			// sticky panel still visible.
			const items = document.querySelectorAll('#portfolio-list ol > li');
			const boundary = items[boundaryIndex - 1];
			if (boundary) {
				const top = boundary.getBoundingClientRect().top + window.scrollY;
				window.scrollTo({ top: Math.max(0, top - 260), behavior: 'instant' });
			}
			// Returned through `dataset` so the Node side can record
			// WHERE the screenshot was taken; a PNG nobody can verify
			// is exactly the "stale evidence" this panel exists to avoid.
			panel.dataset.scrollY = String(Math.round(window.scrollY));
			panel.dataset.boundaryCard = boundary
				? (boundary.textContent ?? '').trim().slice(0, 40)
				: 'missing';
			panel.dataset.boundaryNextCard = items[boundaryIndex]
				? (items[boundaryIndex].textContent ?? '').trim().slice(0, 40)
				: 'missing';
			panel.dataset.cardCount = String(items.length);
		},
		{ payload: report, boundaryIndex: pageSize },
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const rows = buildFixtureRows(options.count);

	process.stdout.write(
		`perf-large-list: seeding ${rows.length} synthetic rows into the LOCAL D1 binding\n`,
	);
	applyMigrations({ target: 'local', execute: true });
	for (const sql of CLEANUP_SQL) runStatement(sql, { target: 'local' });

	const workDir = join(REPO_ROOT, '.tmp', 'perf-large-list');
	mkdirSync(workDir, { recursive: true });
	const batchPath = join(workDir, 'fixture-batch.json');
	writeFileSync(
		batchPath,
		JSON.stringify(fixtureBatchStatements(rows, { withMedia: options.withMedia }), null, 2),
	);
	try {
		executeBatch(batchPath, { target: 'local' });
	} finally {
		rmSync(batchPath, { force: true });
	}

	const baseUrl = options.baseUrl ?? `http://127.0.0.1:${options.port}`;
	const preview = options.baseUrl ? null : startPreview(options.port);
	let browser = null;
	try {
		if (preview) {
			process.stdout.write(`perf-large-list: starting vite preview on ${baseUrl}\n`);
		}
		if (!(await waitForServer(`${baseUrl}/portfolio`))) {
			throw new Error(`perf-large-list: ${baseUrl}/portfolio did not become ready`);
		}

		browser = await chromium.launch({
			// Precise heap numbers instead of Chromium's 5 MB bucketed default.
			args: ['--enable-precise-memory-info'],
		});
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const page = await context.newPage();

		const networkCondition = {
			offline: false,
			latency: 150,
			downloadThroughput: (1.6 * 1024 * 1024) / 8,
			uploadThroughput: (750 * 1024) / 8,
		};
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', networkCondition);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });
		await cdp.send('Accessibility.enable');

		const consoleErrors = [];
		page.on('pageerror', (error) => consoleErrors.push(String(error)));

		const response = await page.goto(`${baseUrl}/portfolio`, { waitUntil: 'load' });
		if (!response || !response.ok()) {
			throw new Error(
				`perf-large-list: GET /portfolio returned ${response ? response.status() : 'no response'} — refusing to measure a non-OK page`,
			);
		}
		await page.waitForSelector('#portfolio-list ol > li', { timeout: 30_000 });
		await page.waitForFunction(
			(expected) => document.querySelectorAll('#portfolio-list ol > li').length >= expected,
			options.pageSize,
			{ timeout: 30_000 },
		);

		const initial = await page.evaluate(collectPageMetrics);
		const axInitial = await cdp.send('Accessibility.getFullAXTree');

		// Real interaction: click "Load more" and wait for the appended
		// page to land in the DOM.
		const appendStartedAt = Date.now();
		await page.getByRole('button', { name: /load more/i }).click();
		await page.waitForFunction(
			(expected) => document.querySelectorAll('#portfolio-list ol > li').length >= expected,
			rows.length,
			{ timeout: 30_000 },
		);
		const appendMs = Date.now() - appendStartedAt;
		const after = await page.evaluate(collectPageMetrics);
		const axAfterLoadMore = await cdp.send('Accessibility.getFullAXTree');

		const facetGroupsNamed = (tree) =>
			tree.nodes.filter((node) => node.role?.value === 'group' && node.name?.value === 'facets')
				.length;
		const violations = collectNamingViolations(initial.labelled);
		const violationsInList = collectNamingViolations(initial.labelledInList);

		/** Distinct labelled shapes on the page, for the report. */
		const inventory = new Map();
		for (const el of initial.labelled) {
			const key = `${el.tag}|${resolveRole(el.tag, el.role)}`;
			const entry = inventory.get(key) ?? {
				tag: el.tag,
				role: resolveRole(el.tag, el.role),
				count: 0,
				sample: el.ariaLabel,
			};
			entry.count += 1;
			inventory.set(key, entry);
		}

		const report = {
			issue: '#490',
			generatedAt: new Date().toISOString(),
			environment: {
				sourceSha: git(['rev-parse', 'HEAD']),
				workingTreeDirty: git(['status', '--porcelain']).length > 0,
				browser: `Chromium ${browser.version()}`,
				playwright: playwrightVersion(),
				node: process.version,
				platform: `${process.platform} ${process.arch}`,
				viewport: '1280x900',
				deviceScaleFactor: 1,
				cpuThrottlingRate: options.cpuThrottle,
				networkProfile: {
					label: 'Slow 4G (CDP Network.emulateNetworkConditions)',
					latencyMs: networkCondition.latency,
					downloadKbps: Math.round((networkCondition.downloadThroughput * 8) / 1024),
					uploadKbps: Math.round((networkCondition.uploadThroughput * 8) / 1024),
				},
				mediaPublicBaseUrl: options.withMedia
					? 'cover media rows seeded; URL resolution follows the bound MEDIA_PUBLIC_BASE_URL'
					: 'not seeded — cards render the documented placeholder / text-only shape',
			},
			fixture: {
				count: rows.length,
				pageSize: options.pageSize,
				idsPrefixed: FIXTURE_ID_PREFIX,
				target: 'local D1 (.tmp/d1state)',
			},
			expectedTotal: rows.length,
			pageSize: options.pageSize,
			cards: { list: initial.cards, afterLoadMore: after.cards },
			domNodes: {
				list: initial.domNodes,
				afterLoadMore: after.domNodes,
				perCard: Number((initial.domNodes / Math.max(1, initial.cards)).toFixed(2)),
				perCardCeiling: PER_CARD_NODE_CEILING,
			},
			memory: {
				heapMbInitial: initial.heapMb,
				heapMbAfterLoadMore: after.heapMb,
				heapMbDelta:
					initial.heapMb !== null && after.heapMb !== null
						? Number((after.heapMb - initial.heapMb).toFixed(1))
						: null,
			},
			timings: {
				navigation: initial.timings,
				appendMs,
			},
			a11y: {
				namingViolationsInList: violationsInList.length,
				namingViolationSamplesInList: violationsInList.slice(0, 3),
				namingViolationsPage: violations.length,
				namingViolationSamplesPage: violations.slice(0, 3),
				labelledInventory: [...inventory.values()].sort((a, b) => b.count - a.count),
				imagesWithoutAlt: initial.imagesWithoutAlt,
				axFacetGroupsInitial: facetGroupsNamed(axInitial),
				axFacetGroupsAfterLoadMore: facetGroupsNamed(axAfterLoadMore),
				axNodesInitial: axInitial.nodes.length,
				axNodesAfterLoadMore: axAfterLoadMore.nodes.length,
			},
			consoleErrors,
		};
		report.verdict = evaluateThresholds(report);

		if (!options.noScreenshot) {
			const target = resolve(REPO_ROOT, options.screenshot);
			mkdirSync(dirname(target), { recursive: true });
			await renderMeasurementPanel(page, report, { pageSize: options.pageSize });
			const capture = await page.evaluate(() => {
				const panel = document.getElementById('issue-490-measurement-panel');
				return {
					scrollY: Number(panel?.dataset.scrollY ?? '0'),
					boundaryCard: panel?.dataset.boundaryCard ?? 'missing',
					boundaryNextCard: panel?.dataset.boundaryNextCard ?? 'missing',
					cardCount: Number(panel?.dataset.cardCount ?? '0'),
				};
			});
			// Chromium only writes PNG; the committed artefact is WebP.
			const rawCapture = join(REPO_ROOT, '.tmp', 'perf-large-list', 'capture.png');
			await page.screenshot({ path: rawCapture, fullPage: false });
			try {
				const written = await sharp(rawCapture)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(target);
				const budget = screenshotBudgetVerdict(written.size);
				report.screenshot = {
					path: options.screenshot,
					format: 'webp',
					viewport: '1280x900',
					maxWidth: SCREENSHOT_MAX_WIDTH,
					quality: SCREENSHOT_QUALITY,
					bytes: budget.bytes,
					kb: budget.kb,
					withinBudget: budget.withinBudget,
					...capture,
				};
				process.stdout.write(
					`perf-large-list: wrote ${options.screenshot} (${written.width}x${written.height}, ${budget.kb} kB webp, scrollY=${capture.scrollY}, boundary card #${options.pageSize} = "${capture.boundaryCard}")\n`,
				);
				if (!budget.withinBudget) {
					process.stderr.write(
						`perf-large-list: WARNING — capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB verification-artefact budget\n`,
					);
				}
			} finally {
				rmSync(rawCapture, { force: true });
			}
		}

		const jsonTarget = resolve(REPO_ROOT, options.jsonOut);
		mkdirSync(dirname(jsonTarget), { recursive: true });
		writeFileSync(jsonTarget, `${JSON.stringify(report, null, 2)}\n`);

		await context.close();

		process.stdout.write(
			`\nperf-large-list report (source ${report.environment.sourceSha.slice(0, 7)})\n`,
		);
		process.stdout.write(`  catalogue rows       ${rows.length}\n`);
		process.stdout.write(
			`  cards initial/after  ${report.cards.list} / ${report.cards.afterLoadMore}\n`,
		);
		process.stdout.write(
			`  DOM nodes            ${report.domNodes.list} (${report.domNodes.perCard}/card, ceiling ${PER_CARD_NODE_CEILING})\n`,
		);
		process.stdout.write(
			`  JS heap              ${report.memory.heapMbInitial} MB → ${report.memory.heapMbAfterLoadMore} MB\n`,
		);
		process.stdout.write(`  navigation load      ${initial.timings?.loadMs ?? 'n/a'} ms\n`);
		process.stdout.write(`  append latency       ${appendMs} ms\n`);
		process.stdout.write(
			`  aria-label w/o role  list ${report.a11y.namingViolationsInList} / page ${report.a11y.namingViolationsPage}\n`,
		);
		process.stdout.write(`  AX groups "facets"   ${report.a11y.axFacetGroupsAfterLoadMore}\n`);
		process.stdout.write(`  verdict              ${report.verdict.pass ? 'PASS' : 'FAIL'}\n`);
		for (const failure of report.verdict.failures) process.stdout.write(`    - ${failure}\n`);
		process.stdout.write(`  report               ${options.jsonOut}\n`);

		return report.verdict.pass;
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (preview) preview.kill();
	}
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

let exitCode = 0;
if (invokedDirectly) {
	try {
		exitCode = (await main()) ? 0 : 1;
	} catch (error) {
		process.stderr.write(`perf-large-list: ${error?.stack ?? error}\n`);
		exitCode = 2;
	} finally {
		// Fail-safe cleanup: a crashed measurement must not leave 120
		// synthetic rows behind in the local D1 state.
		if (process.argv.includes('--keep-fixtures')) {
			process.stdout.write('perf-large-list: --keep-fixtures — rows left in the local D1\n');
		} else {
			try {
				for (const sql of CLEANUP_SQL) runStatement(sql, { target: 'local' });
				process.stdout.write('perf-large-list: local fixture rows removed\n');
			} catch (error) {
				process.stderr.write(`perf-large-list: cleanup failed — ${error?.message ?? error}\n`);
			}
		}
	}
	process.exit(exitCode);
}
