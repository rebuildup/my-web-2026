/**
 * Shared operational helpers for the scheduled sync scripts
 * (Issue #1254).
 *
 * Two failure modes the daily launchd jobs kept hitting silently:
 *
 *   - Multi-run: a manual `kickstart`, a wake-catch-up firing while a
 *     previous run is still alive, or an operator re-run overlapping
 *     the schedule would put two syncs on the same upstream APIs and
 *     race the same D1 snapshot row. `acquireSyncLock` makes the
 *     second run a clean no-op instead of a duplicate.
 *   - Transient push failure: a single 5xx / 429 / dropped connection
 *     on the ingest PUT used to end the run until the next day.
 *     `pushWithRetry` retries ONLY transient outcomes with a bounded
 *     backoff; a 4xx (schema rejection, 413, auth) still fails fast
 *     because retrying it changes nothing.
 *
 * Lock files live under the gitignored `.tmp/` directory and carry
 * `{pid, startedAt, label}` so a stale lock (dead pid or ancient
 * timestamp) is reclaimed instead of wedging the schedule forever.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A lock older than this is assumed abandoned even if the pid looks alive. */
export const SYNC_LOCK_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Try to take the sync lock at `lockPath`.
 *
 * @returns {{release: () => void}|null} the held lock, or null when
 *   another live run already holds it.
 */
export function acquireSyncLock(lockPath, { staleMs = SYNC_LOCK_STALE_MS, label = 'sync' } = {}) {
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			writeFileSync(
				lockPath,
				`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), label })}\n`,
				{ flag: 'wx' },
			);
			return {
				release() {
					try {
						rmSync(lockPath, { force: true });
					} catch {
						// Lock cleanup is best-effort; a leftover stale lock
						// is reclaimed by the next run's stale check.
					}
				},
			};
		} catch (err) {
			if (err?.code !== 'EEXIST') throw err;
		}
		// Lock exists — decide whether its owner is still alive.
		let stale = false;
		try {
			const info = JSON.parse(readFileSync(lockPath, 'utf8'));
			const age = Date.now() - Date.parse(info.startedAt ?? '');
			if (Number.isFinite(age) && age > staleMs) {
				stale = true;
			} else if (typeof info.pid === 'number') {
				try {
					process.kill(info.pid, 0);
				} catch {
					stale = true; // pid is gone
				}
			} else {
				stale = true; // unreadable lock — reclaim it
			}
		} catch {
			stale = true;
		}
		if (!stale) return null;
		try {
			rmSync(lockPath, { force: true });
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Statuses worth retrying: rate limiting and server-side faults.
 * Everything else (400/401/403/404/413/422…) is a contract or
 * credential problem that a retry cannot fix.
 */
export function isTransientStatus(status) {
	return status === 429 || status >= 500;
}

/**
 * PUT `body` to `url` with bounded retries on transient failures.
 *
 * @param {string} url ingest endpoint
 * @param {object} init fetch init (method/headers/body)
 * @param {{retries?: number, backoffMs?: number, sleep?: (ms:number)=>Promise<void>, label?: string}} [options]
 * @returns {Promise<Response>} the first non-transient response, or the
 *   last transient response after retries are exhausted (caller still
 *   sees the failure status and throws its usual error).
 */
export async function pushWithRetry(url, init, options = {}) {
	const retries = options.retries ?? 3;
	const backoffMs = options.backoffMs ?? 5_000;
	const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const label = options.label ?? url;
	let lastError = null;
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		if (attempt > 0) {
			const delay = backoffMs * 2 ** (attempt - 1);
			console.error(`${label}: transient failure — retry ${attempt}/${retries} in ${delay}ms`);
			await sleep(delay);
		}
		try {
			const res = await fetch(url, init);
			if (res.ok || !isTransientStatus(res.status)) return res;
			lastError = new Error(`ingest ${url} -> ${res.status}`);
		} catch (err) {
			// Network error / timeout — transient by definition.
			lastError = err;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
