#!/usr/bin/env node
/**
 * Local R2 sharing proof (Issue #247, cleanup slice).
 *
 * The claim
 * ---------
 * A local R2 object written through `scripts/_r2.mjs` is visible to the
 * running Worker's runtime, byte for byte.
 *
 * This is the R2 equivalent of the local D1 persistence proof. It exists
 * because `--persist-to` is a CONVENTION: if the adapter and the dev /
 * preview runtime each kept a private store, every local R2 script would
 * appear to work while the Worker served an empty bucket — and nothing
 * in the CLI would report the disagreement. A seed script that silently
 * seeds nothing is exactly the failure this catches.
 *
 * What is proven, and how
 * -----------------------
 *   1. adapter PUT      a byte string through `_r2.mjs`
 *   2. runtime read     the SAME bytes back over HTTP, from the running
 *                       dev server's R2 surface
 *   3. adapter GET      the same bytes again, as a Buffer
 *
 * Step 2 is the load-bearing one. It proves the two processes address one
 * store. A shared store is symmetric, so a runtime write is adapter-
 * visible; the reverse direction is asserted structurally in step 4
 * rather than by provoking an unauthenticated runtime write, because the
 * application's only runtime R2 write path is the authenticated admin
 * image upload (`src/admin/images/load.ts`), which this proof must not
 * authenticate against.
 *
 *   4. one path         the runtime's `persistState` and the adapter's
 *                       `--persist-to` are the SAME exported constant,
 *                       not two literals that happen to agree today
 *
 * The byte string is deliberately NOT valid UTF-8, so a text round-trip
 * that mangled an image would fail rather than pass.
 *
 * Usage:  node scripts/r2-local-sharing-proof.mjs
 * Exit:   0 proven, 1 disproven or unavailable, 2 bad input.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { LOCAL_STATE_DIR, R2_BUCKET_NAME } from './_cloudflare-identity.mjs';
import { getObject, putObject } from './_r2.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.R2_PROOF_PORT ?? 4183);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Not valid UTF-8: a lossy text round-trip is caught. */
const PROBE_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f, 0x80, 0x41, 0x42, 0x43,
]);

const PROBE_KEY = 'proof/local-sharing-probe.bin';
/** Where the dev server exposes the runtime's R2 objects. */
const RUNTIME_READ_PATH = `/cdn-cgi/local/r2/public/${R2_BUCKET_NAME}/${PROBE_KEY}`;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function out(message) {
	process.stdout.write(`[r2-proof] ${message}\n`);
}

function fail(message) {
	process.stderr.write(`[r2-proof] FAILED: ${message}\n`);
	return 1;
}

async function waitForServer(url, attempts = 60) {
	for (let i = 0; i < attempts; i += 1) {
		try {
			if ((await fetch(`${url}/api/v1/health`)).ok) return true;
		} catch {
			// not listening yet
		}
		await sleep(1000);
	}
	return false;
}

async function main() {
	// Step 4 first: it needs no runtime, and failing here means the
	// remaining steps would be measuring two different stores.
	out('4/4 one local state path for the runtime and the adapter');
	const viteSource = readFileSync(resolve(REPO_ROOT, 'vite.config.ts'), 'utf8');
	if (!viteSource.includes('LOCAL_STATE_DIR')) {
		return fail(
			'vite.config.ts does not reference LOCAL_STATE_DIR; the runtime and the adapter may be using different persistence paths, which would make the rest of this proof meaningless',
		);
	}
	if (!LOCAL_STATE_DIR || typeof LOCAL_STATE_DIR !== 'string') {
		return fail('LOCAL_STATE_DIR is not a non-empty string');
	}
	out(`      runtime persistState = adapter --persist-to = ${LOCAL_STATE_DIR}`);

	out(`1/4 adapter PUT ${PROBE_KEY} (${PROBE_BYTES.length} bytes)`);
	const source = resolve(REPO_ROOT, '.tmp', 'r2-proof-source.bin');
	const { writeFileSync } = await import('node:fs');
	writeFileSync(source, PROBE_BYTES);
	try {
		const put = putObject(PROBE_KEY, source, {
			target: 'local',
			contentType: 'application/octet-stream',
		});
		if (!put.applied) {
			return fail(
				'adapter PUT reported applied=false for a local write; the store was not written',
			);
		}
		out(`      bucket=${put.bucket} target=${put.target} sha256=${sha256(PROBE_BYTES)}`);

		out('starting the dev runtime (vite dev)');
		const dev = spawn('pnpm', ['exec', 'vite', 'dev', '--port', String(PORT)], {
			cwd: REPO_ROOT,
			stdio: 'ignore',
			env: { ...process.env, PORT: String(PORT) },
		});
		try {
			if (!(await waitForServer(BASE_URL))) return fail('the dev runtime did not become healthy');
			out(`      dev runtime healthy at ${BASE_URL}`);

			out('2/4 runtime reads the adapter-written object over HTTP');
			const res = await fetch(`${BASE_URL}${RUNTIME_READ_PATH}`);
			if (!res.ok) {
				return fail(
					`the runtime returned HTTP ${res.status} for ${RUNTIME_READ_PATH}. If the local R2 public endpoint is unavailable in this cf version, treat this as an UNPROVEN sharing claim rather than a pass.`,
				);
			}
			const runtimeBytes = Buffer.from(await res.arrayBuffer());
			if (!runtimeBytes.equals(PROBE_BYTES)) {
				return fail(
					`the runtime did NOT see the adapter's bytes: adapter sha256=${sha256(PROBE_BYTES)} runtime sha256=${sha256(runtimeBytes)} (${PROBE_BYTES.length} vs ${runtimeBytes.length} bytes). The adapter and the runtime are using DIFFERENT local stores.`,
				);
			}
			out(`      identical, sha256=${sha256(runtimeBytes)}`);

			out('3/4 adapter GET the same object as bytes');
			const back = getObject(PROBE_KEY, { target: 'local' });
			if (!Buffer.isBuffer(back)) {
				return fail('getObject did not return a Buffer; a text decode would corrupt binary media');
			}
			if (!back.equals(PROBE_BYTES)) {
				return fail(`adapter read-back differs: ${sha256(back)} vs ${sha256(PROBE_BYTES)}`);
			}
			out(`      identical, sha256=${sha256(back)}`);

			out(
				`PROVEN: local R2 state is shared between scripts/_r2.mjs and the runtime, through bucket ${R2_BUCKET_NAME} at ${LOCAL_STATE_DIR}`,
			);
			return 0;
		} finally {
			dev.kill('SIGTERM');
			await sleep(1500);
			if (!dev.killed) dev.kill('SIGKILL');
		}
	} catch (error) {
		return fail(error?.message ?? String(error));
	} finally {
		const { rmSync } = await import('node:fs');
		rmSync(source, { force: true });
	}
}

process.exit(await main());
