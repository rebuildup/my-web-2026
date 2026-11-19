#!/usr/bin/env node

/**
 * Worker-entry failure-boundary gate (Issue #995).
 *
 * Why this gate exists
 * --------------------
 * `src/server.ts` is the Worker entrypoint and the ONE layer outside
 * every framework failure surface. PR #999 wrapped its dispatch in
 * try/catch so a throw still produces a defined 500 that flows through
 * anomaly observation and the security-header chain — but nothing
 * stopped a later edit from removing the catch, or from re-introducing
 * a bare `new Response('Internal Server Error')` that answers in no
 * contract the boundary publishes.
 *
 * The workerd vitest pool cannot `vi.mock` the framework imports
 * (`@tanstack/react-start/server-entry`, `./http/hono`) that a real
 * dispatch-throw test would need, so — like the frame-ancestors and
 * index-boundary gates — this contract is pinned TEXTUALLY against
 * `src/server.ts`. Each assertion names the invariant, not the
 * formatting:
 *
 *   1. the dispatch (`externalBoundary.fetch` / `handler.fetch`) sits
 *      inside a `try` whose `catch` records `dispatch-failure`;
 *   2. the catch builds its fallback through the two defined
 *      constructors — `dispatchInternalErrorResponse` for the external
 *      boundary, `createSsrFailureResponse` for document paths — and
 *      never a bare runtime 500;
 *   3. `observeRequestAnomaly` still runs AFTER the try/catch, so a
 *      dispatch failure is counted on the same footing as a response;
 *   4. the security-header chain (`applySecurityHeaders`,
 *      `applyFrameAncestorsPolicy`, CSP report-only, HSTS) still runs
 *      after observation, so the fallback 500 carries the same headers
 *      a success does.
 *
 * Exit codes: 0 = every invariant present, 1 = at least one missing,
 * 2 = bad input.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PATH = 'src/server.ts';

/**
 * The ordered choke points every Worker-generated response must pass.
 * Indices into the source, ascending — the same order `fetch` runs.
 */
const ORDERED_MARKERS = [
	'dispatch-failure',
	'observeRequestAnomaly(',
	'applySecurityHeaders(',
	'applyFrameAncestorsPolicy(',
	'applyContentSecurityPolicyReportOnly(',
	'applyTransportSecurityPolicy(',
];

/** Fallback constructors the catch is allowed to use. */
const ALLOWED_FALLBACKS = ['dispatchInternalErrorResponse', 'createSsrFailureResponse'];

/**
 * Check one `src/server.ts` source text.
 *
 * @param {string} source file contents
 * @returns {string[]} violations, empty when the boundary holds
 */
export function checkDispatchFailureBoundary(source) {
	const violations = [];

	// 1. The catch must exist and record the failure. `dispatch-failure`
	//    is the audit event name; its absence means the catch (or the
	//    record) was removed.
	const catchAt = source.indexOf('dispatch-failure');
	if (catchAt === -1) {
		violations.push('missing `dispatch-failure` audit record in the dispatch catch');
		return violations;
	}

	// 2. The fallback must use a defined constructor, never a bare
	//    runtime-shaped 500.
	for (const marker of ALLOWED_FALLBACKS) {
		// The CALL form (`name(`), not the bare identifier: the import
		// statement would keep a deleted call site looking alive.
		if (!source.includes(`${marker}(`)) {
			violations.push(`dispatch catch no longer builds its fallback via ${marker}`);
		}
	}
	if (source.includes("new Response('Internal Server Error'")) {
		violations.push(
			'dispatch catch answers a bare `Internal Server Error` text response — ' +
				'use dispatchInternalErrorResponse / createSsrFailureResponse',
		);
	}

	// 3+4. The choke points must appear in dispatch order AFTER the
	//      catch. `lastIndexOf` on each marker keeps a docblock mention
	//      from satisfying the check: the LAST occurrence of each name
	//      is the call site (definitions sit earlier in the file).
	let previous = catchAt;
	for (const marker of ORDERED_MARKERS.slice(1)) {
		const at = source.lastIndexOf(marker);
		if (at === -1) {
			violations.push(`missing choke point ${marker}`);
			continue;
		}
		if (at < previous) {
			violations.push(`${marker} runs before the dispatch-failure catch — order broken`);
		}
		previous = at;
	}

	return violations;
}

function main(argv) {
	const root = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : REPO_ROOT;
	const path = resolve(root, SERVER_PATH);
	let source;
	try {
		source = readFileSync(path, 'utf8');
	} catch {
		process.stderr.write(`${SERVER_PATH} not found\n`);
		return 2;
	}
	const violations = checkDispatchFailureBoundary(source);
	if (violations.length === 0) {
		process.stdout.write('dispatch failure boundary OK: src/server.ts\n');
		return 0;
	}
	for (const violation of violations) {
		process.stderr.write(`  - ${violation}\n`);
	}
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
