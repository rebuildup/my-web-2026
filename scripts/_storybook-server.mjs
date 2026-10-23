#!/usr/bin/env node
/**
 * The local Storybook server for the axe audits (Issue #392).
 *
 * Why this file exists
 * --------------------
 * Two devices need a running Storybook: the audit entry point
 * (`scripts/run-storybook-axe-audit.mjs`, the CI gate) and the
 * capture script (`scripts/capture-a11y-axe-storybook.mjs`, the
 * verification artefact). Both need the SAME three facts to hold
 * before they may measure anything:
 *
 *   1. the server answers on loopback — the origin is up;
 *   2. the preview can RENDER a story — the origin being up is not
 *      enough. A Storybook whose preview entry cannot be resolved
 *      (the pnpm strict-layout problem Issue #392 fixed) answers
 *      `/index.json` with 200 and then renders NOTHING. Every story
 *      is then empty, the audit measures an empty document, and the
 *      result is "0 violations" — a green that measured nothing;
 *   3. the server's own output is readable afterwards, so a failed
 *      audit can say WHICH story failed to render and why.
 *
 * The third fact is why the server's output goes to a LOG FILE here
 * instead of straight to the console: a CI job prints the tail of
 * that file when the audit fails, and the log is the only place the
 * Vite resolution error appears.
 *
 * The cold start
 * --------------
 * A Storybook that has never been started in this checkout has not
 * optimised its Vite dependencies yet. The first preview requests
 * fail while the optimisation runs, and the first dozens of stories
 * fail together; after the optimisation the same stories pass. An
 * audit that starts the server and immediately runs the suite reads
 * that cold start as a broken audit. `waitForStoryRendered` therefore
 * probes a real story and waits until it renders BEFORE the suite
 * runs, which absorbs the cold start instead of reporting it.
 *
 * Nothing here reaches the network: the server is started on
 * 127.0.0.1 and the audit only ever reads the local Storybook.
 */

import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** How long the server may take to answer `/index.json`. */
export const SERVER_READY_TIMEOUT_MS = 180_000;

/** How long a story may take to render once the server answers. */
export const STORY_RENDER_TIMEOUT_MS = 120_000;

/** How long one probe waits for the preview root to fill. */
export const PROBE_TIMEOUT_MS = 15_000;

/** The error overlay Vite injects is chrome, not the component. */
export const STORY_ROOT_SELECTOR = '#storybook-root';

/** Wait a fixed number of milliseconds. */
export function delay(ms) {
	return new Promise((done) => setTimeout(done, ms));
}

/** The first line of an error, for a one-line log entry. */
export function firstLine(error) {
	const text = error instanceof Error ? error.message : String(error);
	return text.split('\n')[0] ?? text;
}

/** Is the loopback origin already answering? */
export async function isOriginReady(baseUrl) {
	try {
		const response = await fetch(`${baseUrl}/index.json`, { redirect: 'manual' });
		return response.status > 0;
	} catch {
		return false;
	}
}

/**
 * Start the local Storybook and wait until it answers.
 *
 * The server is the repository's own Storybook (`.storybook/main.ts`),
 * started on loopback with the CI flag. Nothing is deployed and no
 * binding outside the local state directory is touched.
 *
 * With `options.logPath` the server's output is written to that file
 * (and to nothing else), so the caller can print it when the audit
 * fails. Without it the output is inherited, which is what a local
 * run wants.
 */
export async function startStorybook(port, repoRoot = REPO_ROOT, options = {}) {
	const binary = join(repoRoot, 'node_modules', '.bin', 'storybook');
	if (!existsSync(binary)) {
		throw new Error('the Storybook binary is not installed; run `pnpm install` first');
	}
	const { logPath = null, readyTimeoutMs = SERVER_READY_TIMEOUT_MS } = options;
	let logFd = null;
	let stdio = ['ignore', 'ignore', 'inherit'];
	if (logPath) {
		logFd = openSync(logPath, 'a');
		stdio = ['ignore', logFd, logFd];
	}
	const child = spawn(
		binary,
		['dev', '-p', String(port), '--host', '127.0.0.1', '--ci', '--no-open', '--quiet'],
		{ cwd: repoRoot, stdio },
	);
	const baseUrl = `http://localhost:${port}`;
	try {
		await waitForOrigin(baseUrl, readyTimeoutMs, child);
	} catch (error) {
		child.kill('SIGTERM');
		if (logFd !== null) closeSync(logFd);
		throw error;
	}
	return { baseUrl, child, logPath, logFd };
}

/** Stop the server, and close its log file if one was opened. */
export function stopStorybook(server) {
	if (!server) return;
	try {
		server.child.kill('SIGTERM');
	} catch {
		// The process is already gone; nothing to stop.
	}
	if (server.logFd !== null && server.logFd !== undefined) {
		try {
			closeSync(server.logFd);
		} catch {
			// The descriptor is already closed; nothing to close.
		}
	}
}

/**
 * Wait until the origin answers.
 *
 * A server that exits before it answers is an error, not a timeout:
 * the caller has to know the difference between "slow" and "dead".
 */
export async function waitForOrigin(baseUrl, timeoutMs = SERVER_READY_TIMEOUT_MS, child = null) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isOriginReady(baseUrl)) return true;
		if (child && child.exitCode !== null) {
			throw new Error(`the local Storybook exited with code ${child.exitCode}`);
		}
		await delay(500);
	}
	throw new Error(`the local Storybook did not become ready within ${timeoutMs} ms`);
}

/**
 * The id of one published story, to probe the preview with.
 *
 * The probe needs A story that the running Storybook publishes; the
 * manifest is not consulted, because the point of the probe is to ask
 * the SERVER what it can render. The first story id (sorted, so the
 * probe is deterministic) is enough.
 */
export async function pickStoryId(baseUrl) {
	const response = await fetch(`${baseUrl}/index.json`);
	if (!response.ok) return null;
	const index = await response.json();
	const ids = Object.entries(index?.entries ?? {})
		.filter(([, entry]) => entry?.type === 'story')
		.map(([id]) => id)
		.sort();
	return ids[0] ?? null;
}

/**
 * Wait until the preview can actually RENDER a story.
 *
 * The origin answering is not enough (see the file header): a server
 * whose preview entry cannot be resolved answers `/index.json` and
 * renders nothing. This probe opens one real story and waits for the
 * preview root to have content, retrying while the cold start
 * optimises the Vite dependencies.
 */
export async function waitForStoryRendered(baseUrl, options = {}) {
	const {
		timeoutMs = STORY_RENDER_TIMEOUT_MS,
		probeTimeoutMs = PROBE_TIMEOUT_MS,
		attemptDelayMs = 2000,
		logger = () => {},
	} = options;
	let storyId = null;
	try {
		storyId = await pickStoryId(baseUrl);
	} catch (error) {
		return {
			rendered: false,
			storyId: null,
			reason: `the Storybook index is unreadable: ${firstLine(error)}`,
		};
	}
	if (!storyId) {
		return {
			rendered: false,
			storyId: null,
			reason: 'the Storybook index published no story, so nothing could be rendered',
		};
	}
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	const deadline = Date.now() + timeoutMs;
	let reason = 'the preview never rendered the story';
	try {
		while (Date.now() < deadline) {
			const page = await browser.newPage();
			try {
				await page.goto(`${baseUrl}/iframe.html?id=${storyId}&viewMode=story`, {
					waitUntil: 'domcontentloaded',
				});
				await page.waitForFunction(
					(selector) => {
						const root = document.querySelector(selector);
						return Boolean(root && root.childElementCount > 0);
					},
					STORY_ROOT_SELECTOR,
					{ timeout: probeTimeoutMs },
				);
				return { rendered: true, storyId };
			} catch (error) {
				reason = firstLine(error);
				logger(`[storybook] ${storyId} has not rendered yet: ${reason}`);
			} finally {
				await page.close();
			}
			await delay(attemptDelayMs);
		}
	} finally {
		await browser.close();
	}
	return { rendered: false, storyId, reason };
}

/**
 * The tail of the server log, for a failed audit.
 *
 * The log is the only place the Vite resolution error appears, so a
 * failed audit that does not print it leaves the reader without the
 * reason the stories did not render.
 */
export function readServerLog(logPath, maxLines = 80) {
	if (!logPath || !existsSync(logPath)) return '';
	const lines = readFileSync(logPath, 'utf8').split('\n');
	const tail = lines
		.slice(Math.max(0, lines.length - maxLines - 1))
		.join('\n')
		.trim();
	return tail;
}
