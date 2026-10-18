#!/usr/bin/env node
/**
 * interaction-memory-profile — measure listener / DOM / heap growth under
 * repeated Reactions interaction and repeated client-side route changes
 * (Issue #488).
 *
 * What this measures, and what it deliberately does not
 * ----------------------------------------------------
 * MEASURED: how many DOM event listeners are still attached to a LONG-LIVED
 * target (`window`, `document`, or an element still connected to the
 * document) after each repetition of two real user journeys, plus the DOM
 * node count and the JS heap at the same instants.
 *
 * NOT MEASURED: a Lighthouse score, a Core Web Vitals budget, or any other
 * pass/fail quality GATE. Thresholds are Issue #384 (reproducible
 * Lighthouse command) / #385 (the release gate) / #386 (CWV budgets);
 * this ticket is measurement plus ONE element fix, and conflating
 * measurement, visualisation and gate is exactly what #488 forbids. The
 * command is deliberately not wired into `validate:*`.
 *
 * Why the leak shows up only on CLIENT-SIDE navigation
 * ----------------------------------------------------
 * A full document load (`page.goto`) tears the page down and every
 * listener with it, so a whole-page-reload loop can never observe an
 * accumulation. The accumulation this ticket found is a per-route-change
 * one, so leg `navigate` drives real in-app navigation:
 *
 *   `/tools` --(click the Tool link)--> `/tools/<slug>` --(browser Back)--> `/tools`
 *
 * `<Link>` in `src/routes/tools.index.tsx` is a TanStack Router link, so
 * the click is a client-side transition: the JavaScript context, the React
 * tree and the `document` object all survive it. That is verified, not
 * assumed — the snapshot records `listenersAdded`, which resets to zero on
 * a real reload and keeps climbing across a client-side transition.
 *
 * Why the browser instrumentation is injected, not polled
 * -------------------------------------------------------
 * Chromium exposes no API for "how many listeners are attached right now".
 * `page.addInitScript` patches `EventTarget.prototype.addEventListener` /
 * `removeEventListener` before any application code runs, so the ledger is
 * complete rather than sampled. Two details matter:
 *
 *   - registrations are matched by `(target, type, callback, capture)`,
 *     the same identity `removeEventListener` uses, so a listener the app
 *     genuinely removed is not counted as live;
 *   - a registration is counted as LIVE only when its target is
 *     `window` / `document` / a still-connected element. A listener on a
 *     discarded node is collected with the node and is reported separately
 *     as `detached` — counting it as a leak would make the report fire on
 *     ordinary unmount.
 *
 * Production is never touched: local `vite preview`, local D1 state only,
 * no secret value read or printed, nothing deployed.
 *
 * Usage:
 *   node scripts/interaction-memory-profile.mjs [options]
 *
 *   --cycles=<n>         repetitions per leg (default 5)
 *   --port=<n>           preview server port (default 15951)
 *   --base-url=<url>     measure an ALREADY RUNNING server
 *   --json-out=<path>    report destination
 *                        (default .tmp/interaction-memory-profile/report.json)
 *   --screenshot=<path>  committed capture destination
 *                        (default docs/verification/perf/interaction-memory-profile.webp)
 *   --cpu-throttle=<n>   CDP CPU throttling rate (default 4)
 *   --compare=<path>     a BEFORE report.json to render as a comparison
 *   --no-screenshot      skip the capture
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How many cycles are allowed to settle before growth is measured.
 *
 * The first repetition of a leg legitimately allocates — the emoji picker
 * chunk, the first route's data, React's first-pass event delegation — and
 * none of that repeats. Measuring from the first repetition would report
 * that warm-up as a leak; measuring from the last repetition would hide a
 * leak that only appears late. One settled cycle is the honest middle.
 */
export const DEFAULT_WARMUP_CYCLES = 1;

/**
 * Listener growth allowed across the settled cycles, per target class.
 *
 * Zero is the honest ceiling: a listener attached to `window` or
 * `document` lives until something removes it, so "the same journey ran
 * again and nothing was torn down" is a defect, not noise. Element-level
 * listeners on a component that re-mounts each cycle are matched by the
 * same rule and are expected to stay flat.
 */
export const LISTENER_GROWTH_TOLERANCE = 0;

/**
 * Committed captures are WebP: width cap, quality, size budget.
 *
 * Chromium can only write PNG, and the Issue names a `.png` path, but a
 * verification artefact does not justify a large binary in the tree. The
 * capture is converted with `sharp` and the temporary PNG is deleted; the
 * committed file is the `.webp` sibling of the Issue's path (the
 * substitution is stated in the PR body and in
 * `docs/verification/perf/interaction-memory-profile.md`).
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

/** The two listener classes the verdict is computed over. */
export const GROWTH_METRICS = ['liveGlobal', 'liveConnected'];

/**
 * Describe how one listener metric moved across a leg's samples (pure).
 *
 * `baseline` is the sample right after the page load, `settled` is the
 * first sample at or after `warmupCycles`, and growth is measured from
 * `settled` to the LAST sample. `perCycle` divides by the number of
 * intervals actually observed rather than by the cycle count, so a leg
 * that was cut short never reports a flattering rate.
 */
export function describeGrowth(samples, metric, warmupCycles = DEFAULT_WARMUP_CYCLES) {
	const values = (samples ?? []).map((s) => Number(s[metric] ?? 0));
	if (values.length === 0) return null;
	const settleIndex = Math.min(Math.max(warmupCycles, 1), values.length - 1);
	const settled = values[settleIndex];
	const last = values[values.length - 1];
	const intervals = values.length - 1 - settleIndex;
	return {
		metric,
		series: values,
		baseline: values[0],
		settledIndex: settleIndex,
		settled,
		last,
		delta: last - settled,
		perCycle: intervals > 0 ? Number(((last - settled) / intervals).toFixed(3)) : 0,
		monotonic: values.every((v, i) => i === 0 || v >= values[i - 1]),
	};
}

/**
 * Evaluate one leg against the documented criteria (pure).
 *
 * A leg PASSES when, across the settled cycles, neither long-lived
 * listener class grew at all. Both classes are required: `liveGlobal`
 * catches a leaked `window` / `document` listener, `liveConnected` also
 * catches a listener attached to an element that survives re-mounts. A
 * report that only looked at one of them could pass a real leak.
 *
 * Returns the failures rather than throwing so the caller can still write
 * the report — a FAIL report is the useful artefact.
 */
export function evaluateListenerGrowth(
	samples,
	{ label, warmupCycles = DEFAULT_WARMUP_CYCLES } = {},
) {
	const failures = [];
	const metrics = GROWTH_METRICS.map((metric) =>
		describeGrowth(samples, metric, warmupCycles),
	).filter(Boolean);
	if (metrics.length === 0) {
		failures.push('no listener samples were recorded — nothing was measured');
	}
	// A page-load sample, one warm-up repetition, and at least one settled
	// observation: fewer than that cannot distinguish "flat" from "not
	// measured yet", and reporting a flat line there would be the false
	// green this detector exists to prevent.
	if (samples.length < warmupCycles + 2) {
		failures.push(
			`only ${samples.length} sample(s) for ${samples.length - 1} repetition(s); at least ${
				warmupCycles + 2
			} are needed to observe growth`,
		);
	}
	for (const metric of metrics) {
		if (metric.delta > LISTENER_GROWTH_TOLERANCE) {
			failures.push(
				`${label}: ${metric.metric} grew by ${metric.delta} across ${
					metric.series.length - 1 - metric.settledIndex
				} settled repetition(s) (${metric.settled} -> ${metric.last}, ${metric.perCycle}/repetition)`,
			);
		}
	}
	return { pass: failures.length === 0, failures, metrics };
}

/**
 * Listener-growth verdict over BOTH legs (pure).
 *
 * A leg that could not run (`skipped`, with a recorded reason) is not a
 * pass and not a failure: it is reported so the reader can see that the
 * measurement did not happen rather than reading a green row.
 */
export function evaluateProfile(legs) {
	const verdicts = {};
	const failures = [];
	for (const [name, leg] of Object.entries(legs ?? {})) {
		if (leg.skipped) {
			verdicts[name] = { pass: null, skipped: true, reason: leg.skippedReason };
			continue;
		}
		const verdict = evaluateListenerGrowth(leg.series, {
			label: name,
			warmupCycles: leg.warmupCycles ?? DEFAULT_WARMUP_CYCLES,
		});
		verdicts[name] = { pass: verdict.pass, failures: verdict.failures, metrics: verdict.metrics };
		failures.push(...verdict.failures);
	}
	return { pass: failures.length === 0, failures, verdicts };
}

/** Parse the documented CLI surface. Exported for unit tests. */
export function parseArgs(argv) {
	const options = {
		cycles: 5,
		port: 15951,
		cpuThrottle: 4,
		baseUrl: null,
		jsonOut: '.tmp/interaction-memory-profile/report.json',
		screenshot: 'docs/verification/perf/interaction-memory-profile.webp',
		compare: null,
		noScreenshot: false,
	};
	for (const arg of argv) {
		// `pnpm run perf:interaction:memory -- --cycles=5` forwards a bare
		// `--` separator; the documented README invocation style uses it,
		// so it is consumed rather than rejected as an unknown option.
		if (arg === '--') continue;
		const [key, value] = arg.replace(/^--/, '').split('=');
		switch (key) {
			case 'cycles':
				options.cycles = Number(value);
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
			case 'compare':
				options.compare = value;
				break;
			case 'no-screenshot':
				options.noScreenshot = true;
				break;
			default:
				throw new Error(`unknown option: ${arg}`);
		}
	}
	if (!Number.isInteger(options.cycles) || options.cycles < 2) {
		throw new Error('--cycles must be an integer >= 2 (one repetition measures nothing)');
	}
	return options;
}

/**
 * Browser-side listener ledger, serialised into the page by
 * `page.addInitScript` before any application code runs.
 *
 * Must stay self-contained: no imports, no closure over Node values. The
 * snapshot separates the three fates of a registration so a report can
 * never call ordinary unmounting a leak.
 */
export const LISTENER_PROBE_SOURCE = `(() => {
  const live = new Map();
  const tokensFor = new WeakMap();
  let added = 0;
  let released = 0;
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    added += 1;
    const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
    const token = String(added);
    live.set(token, { target: this, type, capture });
    let tokens = tokensFor.get(listener);
    if (!tokens) { tokens = new Set(); tokensFor.set(listener, tokens); }
    tokens.add(token);
    return originalAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
    const tokens = tokensFor.get(listener);
    if (tokens) {
      for (const token of [...tokens]) {
        const entry = live.get(token);
        if (entry && entry.target === this && entry.type === type && entry.capture === capture) {
          live.delete(token);
          tokens.delete(token);
          released += 1;
          break;
        }
      }
    }
    return originalRemove.call(this, type, listener, options);
  };
  window.__interactionMemoryProbe = {
    version: 1,
    snapshot() {
      const byTarget = {};
      const byType = {};
      let liveGlobal = 0;
      let liveConnected = 0;
      let detached = 0;
      for (const entry of live.values()) {
        const isGlobal = entry.target === window || entry.target === document;
        const isConnected =
          isGlobal || (entry.target !== null && typeof entry.target === 'object' && entry.target.isConnected === true);
        if (!isConnected) { detached += 1; continue; }
        if (isGlobal) liveGlobal += 1;
        else liveConnected += 1;
        const targetLabel = isGlobal
          ? (entry.target === window ? 'window' : 'document')
          : String(entry.target.tagName || entry.target.constructor?.name || 'node').toLowerCase();
        const key = targetLabel + '::' + entry.type;
        byTarget[key] = (byTarget[key] || 0) + 1;
        byType[entry.type] = (byType[entry.type] || 0) + 1;
      }
      const memory = performance.memory;
      return {
        added,
        released,
        liveGlobal,
        liveConnected,
        liveTotal: liveGlobal + liveConnected,
        detached,
        byTarget,
        byType,
        domNodes: document.querySelectorAll('*').length,
        headLinks: document.head.querySelectorAll('link').length,
        headScripts: document.head.querySelectorAll('script').length,
        heapMb: memory ? Math.round((memory.usedJSHeapSize / 104857.6) * 10) / 10 : null,
        path: location.pathname,
      };
    },
  };
})();`;

/** Sorted top-N entries of a `{ key: count }` map, for the report panel. */
export function topEntries(counts, limit = 8) {
	return Object.entries(counts ?? {})
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([key, count]) => ({ key, count }));
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
		{ cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
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
 * Click a real emoji inside the open picker.
 *
 * The picker's category label is `position: sticky` and overlaps the first
 * emoji row, so `locator.click()` on the first match spends its whole
 * actionability budget retrying against an intercepting element and the
 * run dies before any number is recorded. This picks the first visible
 * emoji whose centre point is genuinely the topmost element at that
 * coordinate, and clicks it through the real input pipeline — a synthetic
 * `dispatchEvent` would exercise React's handler without exercising the
 * hit-testing the visitor actually performs.
 */
async function clickPickerEmoji(page, dialog) {
	const target = await dialog.evaluate((root) => {
		const emojiNodes = Array.from(root.querySelectorAll('.epr-emoji'));
		for (const node of emojiNodes) {
			const box = node.getBoundingClientRect();
			if (box.width === 0 || box.height === 0) continue;
			const x = box.left + box.width / 2;
			const y = box.top + box.height / 2;
			if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
			const hit = document.elementFromPoint(x, y);
			if (hit && (hit === node || node.contains(hit)))
				return { x, y, label: node.getAttribute('aria-label') };
		}
		return null;
	});
	if (!target) return null;
	await page.mouse.click(target.x, target.y);
	return target;
}

/**
 * Leg `react` — one real visitor journey on `/`: open the picker, type a
 * search, pick an emoji, close. The chip that appears is the optimistic
 * aggregate from the shipped widget.
 */
async function runReactionLeg(page, cycles) {
	const trigger = page.locator('[data-testid="home-reactions-open-picker"]');
	if ((await trigger.count()) === 0) {
		return {
			skipped: true,
			skippedReason:
				'the reactions widget is in its disabled state (no consumer API key in the local env), so the picker cannot be opened; set a dummy MY_WEB_2026_CONSUMER_API_KEY in .dev.vars to measure this leg',
			series: [],
		};
	}

	const sample = async () => page.evaluate(() => window.__interactionMemoryProbe.snapshot());
	const series = [{ cycle: 0, ...(await sample()) }];
	const picked = [];

	for (let cycle = 1; cycle <= cycles; cycle += 1) {
		await trigger.click();
		const dialog = page.locator('dialog[open]');
		await dialog.waitFor({ state: 'visible', timeout: 15_000 });
		const search = dialog.locator('.epr-search-input, input[type="text"]').first();
		if ((await search.count()) > 0) {
			await search.fill('thumbs');
			await page.waitForTimeout(400);
		}
		picked.push((await clickPickerEmoji(page, dialog))?.label ?? null);
		await page.waitForTimeout(600);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		const snapshot = await sample();
		series.push({
			cycle,
			chips: await page
				.locator('[data-testid="home-reactions-picker-skeleton"], fieldset button')
				.count(),
			...snapshot,
		});
	}
	return { skipped: false, series, picked };
}

/**
 * Leg `navigate` — one real route round trip: click the Tool link on
 * `/tools`, then browser Back. Both are client-side transitions, so the
 * ledger keeps its identity across them; `listenersAdded` in the snapshot
 * proves it (it resets on a real document load).
 */
async function runNavigateLeg(page, cycles, baseUrl) {
	const sample = async () => page.evaluate(() => window.__interactionMemoryProbe.snapshot());
	const series = [{ cycle: 0, ...(await sample()) }];

	for (let cycle = 1; cycle <= cycles; cycle += 1) {
		await page
			.getByRole('link')
			.filter({ hasText: /prototype/i })
			.first()
			.click();
		await page.waitForURL(/\/tools\/[^/]+$/, { timeout: 20_000 });
		await page.waitForTimeout(1200);
		const forward = await sample();
		await page.goBack();
		await page.waitForURL(/\/tools$/, { timeout: 20_000 });
		await page.waitForTimeout(1200);
		const back = await sample();
		series.push({
			cycle,
			leg: 'tool-route',
			...forward,
			returned: { liveGlobal: back.liveGlobal, liveConnected: back.liveConnected, path: back.path },
		});
	}
	return { skipped: false, series, baseUrl };
}

/**
 * Paint the measurement onto the page before the screenshot.
 *
 * The Issue asks for one image that carries the browser state and the
 * numbers, so the reviewer does not have to cross-reference a second
 * artefact. The panel is injected at runtime and is not part of the site.
 */
async function renderMeasurementPanel(page, report) {
	await page.evaluate((payload) => {
		const line = (k, v) => `${k} ${v}`;
		const growth = (metrics) =>
			(metrics ?? [])
				.map((m) => `${m.metric} ${m.settled}→${m.last} (${m.delta >= 0 ? '+' : ''}${m.delta})`)
				.join(' · ') || 'n/a';
		const rows = [
			line(
				'source SHA',
				`${payload.environment.sourceSha.slice(0, 12)}${payload.environment.workingTreeDirty ? ' (dirty)' : ''}`,
			),
			line('browser', payload.environment.browser),
			line(
				'viewport / DPR',
				`${payload.environment.viewport} / ${payload.environment.deviceScaleFactor}`,
			),
			line('CPU throttle', `${payload.environment.cpuThrottlingRate}x (CDP)`),
			line('network', payload.environment.networkProfile.label),
			line('repetitions', `${payload.options.cycles} per leg`),
			'',
			line(
				'leg react  verdict',
				payload.legs.react.skipped
					? `SKIPPED — ${payload.legs.react.skippedReason}`
					: payload.verdicts.react.pass
						? 'PASS'
						: 'FAIL',
			),
			line('  live window/document', growth(payload.verdicts.react.metrics)),
			line(
				'leg navigate verdict',
				payload.legs.navigate.skipped
					? 'SKIPPED'
					: payload.verdicts.navigate.pass
						? 'PASS'
						: 'FAIL',
			),
			line('  live window/document', growth(payload.verdicts.navigate.metrics)),
			'',
			line(
				'navigate last',
				`DOM ${payload.legs.navigate.series.at(-1)?.domNodes} nodes · heap ${payload.legs.navigate.series.at(-1)?.heapMb} MB · head links ${payload.legs.navigate.series.at(-1)?.headLinks}`,
			),
			line(
				'top live listeners',
				(payload.topListeners ?? []).map((e) => `${e.key} ${e.count}`).join(' · ') || 'n/a',
			),
		];
		if (payload.before) {
			rows.unshift(
				line(
					'BEFORE (compare)',
					`${payload.before.sourceShaShort} · navigate liveGlobal ${payload.before.navigateFrom}→${payload.before.navigateTo} · react liveGlobal ${payload.before.reactFrom}→${payload.before.reactTo}`,
				),
				'',
			);
		}
		if (payload.verdict.pass === false) {
			rows.push('', line('failures', payload.verdict.failures.join(' | ')));
		}
		const panel = document.createElement('section');
		panel.id = 'issue-488-measurement-panel';
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
			`Issue #488 — interaction listener / memory profile · measured ${payload.generatedAt}`,
			...rows,
		].join('\n');
		document.body.prepend(panel);
		panel.dataset.verdict = payload.verdict.pass ? 'PASS' : 'FAIL';
	}, report);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const baseUrl = options.baseUrl ?? `http://127.0.0.1:${options.port}`;
	const preview = options.baseUrl ? null : startPreview(options.port);
	let browser = null;
	try {
		if (preview) process.stdout.write(`interaction-memory-profile: preview on ${baseUrl}\n`);
		if (!(await waitForServer(`${baseUrl}/`))) {
			throw new Error(`interaction-memory-profile: ${baseUrl} did not become ready`);
		}

		browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const page = await context.newPage();
		await page.addInitScript(LISTENER_PROBE_SOURCE);

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

		const pageErrors = [];
		page.on('pageerror', (error) => pageErrors.push(String(error)));

		// ---- leg: react (one document load, repeated visitor journey) ----
		const homeResponse = await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
		if (!homeResponse || !homeResponse.ok()) {
			throw new Error(
				`interaction-memory-profile: GET / returned ${homeResponse ? homeResponse.status() : 'no response'}`,
			);
		}
		await page.waitForTimeout(1500);
		const react = await runReactionLeg(page, options.cycles);

		// ---- leg: navigate (one document load, repeated route changes) ----
		const toolsResponse = await page.goto(`${baseUrl}/tools`, { waitUntil: 'load' });
		if (!toolsResponse || !toolsResponse.ok()) {
			throw new Error(
				`interaction-memory-profile: GET /tools returned ${toolsResponse ? toolsResponse.status() : 'no response'}`,
			);
		}
		await page.waitForTimeout(1500);
		const navigate = await runNavigateLeg(page, options.cycles, baseUrl);

		const lastNavigate = navigate.series.at(-1);
		const lastReact = react.series.at(-1);

		const report = {
			issue: '#488',
			generatedAt: new Date().toISOString(),
			options: { cycles: options.cycles, cpuThrottle: options.cpuThrottle, baseUrl },
			environment: {
				sourceSha: git(['rev-parse', 'HEAD']),
				workingTreeDirty: git(['status', '--porcelain']).length > 0,
				browser: `Chromium ${browser.version()}`,
				playwright: playwrightVersion(),
				node: process.version,
				platform: `${process.platform} ${process.arch} ${process.release}`,
				viewport: '1280x900',
				deviceScaleFactor: 1,
				cpuThrottlingRate: options.cpuThrottle,
				networkProfile: {
					label: 'Slow 4G (CDP Network.emulateNetworkConditions)',
					latencyMs: networkCondition.latency,
					downloadKbps: Math.round((networkCondition.downloadThroughput * 8) / 1024),
					uploadKbps: Math.round((networkCondition.uploadThroughput * 8) / 1024),
				},
				surface: 'vite preview of `pnpm run build` (not a dev server)',
				productionTouched: false,
			},
			legs: { react, navigate },
			pageErrors,
			topListeners: topEntries(lastNavigate?.byTarget ?? {}),
			topListenerTypes: topEntries(lastNavigate?.byType ?? {}, 6),
		};
		report.verdict = evaluateProfile({ react, navigate });

		if (options.compare) {
			try {
				const before = JSON.parse(readFileSync(resolve(REPO_ROOT, options.compare), 'utf8'));
				const pick = (leg, metric) => {
					const s = before?.legs?.[leg]?.series ?? [];
					const settled = s[Math.min(1, s.length - 1)];
					const last = s.at(-1);
					return settled && last ? `${settled[metric]}→${last[metric]}` : 'n/a';
				};
				report.before = {
					path: options.compare,
					sourceSha: before?.environment?.sourceSha ?? 'unknown',
					sourceShaShort: (before?.environment?.sourceSha ?? 'unknown').slice(0, 12),
					generatedAt: before?.generatedAt ?? 'unknown',
					cycles: before?.options?.cycles ?? null,
					navigateFrom: pick('navigate', 'liveGlobal'),
					navigateTo: pick('navigate', 'liveGlobal'),
					reactFrom: pick('react', 'liveGlobal'),
					reactTo: pick('react', 'liveGlobal'),
					browser: before?.environment?.browser ?? 'unknown',
					verdict: before?.verdict?.pass ?? null,
				};
			} catch (error) {
				report.before = { path: options.compare, error: String(error?.message ?? error) };
			}
		}

		if (!options.noScreenshot) {
			await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
			await page.waitForTimeout(1200);
			await renderMeasurementPanel(page, report);
			const capture = await page.evaluate(() => {
				const panel = document.getElementById('issue-488-measurement-panel');
				return {
					verdict: panel?.dataset.verdict ?? 'missing',
					panelChars: panel?.textContent?.length ?? 0,
				};
			});
			const target = resolve(REPO_ROOT, options.screenshot);
			mkdirSync(dirname(target), { recursive: true });
			const rawCapture = join(REPO_ROOT, '.tmp', 'interaction-memory-profile', 'capture.png');
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
					`interaction-memory-profile: wrote ${options.screenshot} (${written.width}x${written.height}, ${budget.kb} kB webp, verdict=${capture.verdict})\n`,
				);
				if (!budget.withinBudget) {
					process.stderr.write(
						`interaction-memory-profile: WARNING — capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB verification-artefact budget\n`,
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
			`\ninteraction-memory-profile report (source ${report.environment.sourceSha.slice(0, 7)}, ${options.cycles} repetitions/leg)\n`,
		);
		for (const [name, leg] of Object.entries({ react, navigate })) {
			if (leg.skipped) {
				process.stdout.write(`  ${name.padEnd(9)} SKIPPED — ${leg.skippedReason}\n`);
				continue;
			}
			const verdict = report.verdict.verdicts[name];
			process.stdout.write(
				`  ${name.padEnd(9)} liveGlobal ${leg.series.map((s) => s.liveGlobal).join(' → ')} | liveConnected ${leg.series
					.map((s) => s.liveConnected)
					.join(' → ')} → ${verdict.pass ? 'PASS' : 'FAIL'}\n`,
			);
		}
		process.stdout.write(
			`  navigate  DOM ${lastNavigate?.domNodes} nodes · heap ${lastNavigate?.heapMb} MB · head links ${lastNavigate?.headLinks}\n`,
		);
		if (!react.skipped) {
			process.stdout.write(
				`  react     DOM ${lastReact?.domNodes} nodes · heap ${lastReact?.heapMb} MB\n`,
			);
		}
		process.stdout.write(`  verdict   ${report.verdict.pass ? 'PASS' : 'FAIL'}\n`);
		for (const failure of report.verdict.failures) process.stdout.write(`    - ${failure}\n`);
		process.stdout.write(`  report    ${options.jsonOut}\n`);

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
		process.stderr.write(`interaction-memory-profile: ${error?.stack ?? error}\n`);
		exitCode = 2;
	}
	process.exit(exitCode);
}
