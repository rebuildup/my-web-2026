#!/usr/bin/env node
/**
 * CI-only pnpm install wrapper.
 *
 * pnpm 12.3.4 can intermittently fail on GitHub-hosted runners while
 * creating a virtual-store slot with:
 *
 *   ERR_PNPM_PACKAGE_MANAGER_CREATE_SLOT_DIR ... File exists (os error 17)
 *
 * That failure happens before repository validation and has been observed
 * with different packages on otherwise identical release PRs. Retry only
 * that exact infrastructure failure; every other install error is terminal.
 *
 * Issue #210.
 */

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const MAX_ATTEMPTS = 3;
const RETRYABLE_ERROR = 'ERR_PNPM_PACKAGE_MANAGER_CREATE_SLOT_DIR';

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
	const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
		stdio: ['inherit', 'pipe', 'pipe'],
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
	});

	const stdout = result.stdout ?? '';
	const stderr = result.stderr ?? '';
	if (stdout) process.stdout.write(stdout);
	if (stderr) process.stderr.write(stderr);

	if (result.status === 0) {
		process.exit(0);
	}

	const retryable = `${stdout}\n${stderr}`.includes(RETRYABLE_ERROR);
	const hasRetryLeft = attempt < MAX_ATTEMPTS;
	if (!retryable || !hasRetryLeft) {
		process.exit(result.status ?? 1);
	}

	console.error(
		`[ci-install] pnpm virtual-store slot race on attempt ${attempt}/${MAX_ATTEMPTS}; cleaning node_modules and retrying`,
	);
	rmSync('node_modules', { recursive: true, force: true });
}

process.exit(1);
