#!/usr/bin/node
/**
 * `.dev.vars` parser for the LOCAL_API_MODE=mock dev-server passthrough
 * (Issue #186).
 *
 * Why this helper exists
 * ----------------------
 * `wrangler.jsonc#secrets.required` declares the secret names that
 * wrangler's `getVarsForDev` lets through from `.dev.vars` into the
 * Worker bindings. Any `.dev.vars` entry that is NOT in `vars` AND
 * NOT in `secrets.required` is silently dropped (see wrangler
 * `getVarsForDev` in `node_modules/wrangler/wrangler-dist/cli.js`:
 *   `if (key in result || requiredSecrets.includes(key))`).
 *
 * `LOCAL_API_MODE` is intentionally NOT declared in
 * `wrangler.jsonc#vars` (production must never see it — see the gate
 * at `src/http/hono.ts`) and NOT in `secrets.required` (it is not a
 * secret and adding it would widen the deploy contract). So
 * `LOCAL_API_MODE=mock` in `.dev.vars` never reaches `c.env` at
 * runtime, the gate falls through to the real routers, and the
 * design-verification layer is silently dead.
 *
 * The fix: read `.dev.vars` once at vite-config-load time and inject
 * `LOCAL_API_MODE` (only) into `workerConfig.vars` via the
 * `@cloudflare/vite-plugin`'s `config()` callback. Injecting into
 * `vars` makes the key satisfy `key in result` in wrangler's filter,
 * so the existing `.dev.vars` flow carries it through to workerd as
 * a plain-text var. Production is unaffected because
 * `workerConfig.vars` is only mutated when `.dev.vars` has the entry.
 *
 * Pure helper: takes injected fs accessors + the file contents so
 * unit tests can exercise every branch without touching disk. Mirrors
 * the `parseToggleBody` / `readDefaultEnvironmentCandidate` pattern
 * used by `scripts/_run-dev.mjs`.
 *
 * Format (subset of dotenv we actually need for `.dev.vars`):
 *   - `# …` and blank lines are skipped
 *   - `KEY=value` (no spaces around `=`)
 *   - surrounding single or double quotes are stripped from `value`
 *   - inline `# comment` is NOT supported (`.dev.vars` does not
 *     currently use it; add when needed)
 */
import { bindings } from 'cf/config';

import { existsSync, readFileSync } from 'node:fs';

/**
 * Parse `.dev.vars` contents into a plain `{ KEY: value }` map.
 *
 * Pure: caller supplies the file contents as a string. Returns an
 * empty object when the input is empty / all blank / all comments.
 *
 * Exported for unit-testing via `scripts/_dev-vars-reader.test.mjs`.
 */
export function parseDevVarsContents(contents) {
	const out = {};
	if (typeof contents !== 'string' || contents.length === 0) return out;
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		if (line.startsWith('#')) continue;
		const eqIdx = line.indexOf('=');
		if (eqIdx <= 0) continue; // `=foo` and `foo=` (no key) are skipped
		const key = line.slice(0, eqIdx).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = line.slice(eqIdx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

/**
 * Read `.dev.vars` from disk and parse it. Returns an empty object
 * when the file is missing (which is the production-build case —
 * vite.config.ts is also evaluated during `vite build`, where the
 * mock layer must NOT be enabled).
 *
 * Pure: takes injected fs accessors so the function can be unit-
 * tested with fake accessors without touching disk.
 */
export function readDevVars(
	devVarsPath,
	{ fsExistsSync = existsSync, fsReadFileSync = readFileSync } = {},
) {
	if (!fsExistsSync(devVarsPath)) return {};
	const contents = fsReadFileSync(devVarsPath, 'utf8');
	return parseDevVarsContents(contents);
}

/**
 * Build the worker-config override that injects `LOCAL_API_MODE`
 * (and ONLY `LOCAL_API_MODE`) from `.dev.vars` into
 * `workerConfig.vars`. Returns `undefined` when `.dev.vars` does not
 * carry the entry — the dev server then behaves exactly as before
 * (mock layer off, production routers run).
 *
 * Returning `undefined` is the documented contract of the
 * `@cloudflare/vite-plugin`'s `config()` callback when no override
 * is needed; returning a partial config triggers `defu` merge with
 * the rest of `workerConfig`.
 */
export function buildLocalApiModeConfigOverride(workerConfig, devVars) {
	if (!devVars || typeof devVars.LOCAL_API_MODE !== 'string') return undefined;
	const value = devVars.LOCAL_API_MODE;
	if (value.length === 0) return undefined;
	// Issue #247: the Cloudflare Vite Plugin 2 config exposes plain
	// bindings under `env` (there is no `vars` field any more), and
	// `config` is a customizer that RETURNS a partial config rather
	// than mutating the one it is handed. Both are real API changes
	// from plugin 1.x, not renames.
	return {
		env: { ...(workerConfig?.env ?? {}), LOCAL_API_MODE: bindings.text(value) },
	};
}
