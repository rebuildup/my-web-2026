#!/usr/bin/env node

/**
 * Run-record producer for the release quality dashboard (Issue #493).
 *
 * The dashboard is read-only: it never runs a quality check, so it can
 * only report what somebody else produced. This script is that
 * "somebody else". It executes the commands
 * `quality/release-dashboard.json` declares, and writes one
 * machine-readable record describing *what ran and how it ended*:
 *
 *   .tmp/release-quality-runs.json
 *     { version, source_sha, captured_at, environment, runs[], skipped[] }
 *
 * Why the record is so small
 * --------------------------
 * A record is written into a working directory that gets committed,
 * screenshotted and pasted into a PR, so it may contain a signal id, an
 * exit code, a duration and an artefact inventory — and nothing else.
 * Stdout of a check is deliberately NOT captured (a check that prints a
 * value would put it in a review artefact; AGENTS.md §4 forbids that, and
 * `pnpm run log:redaction:check` is the reason). Child output still goes
 * to the operator's terminal, where a human asked for it by running this
 * command.
 *
 * Scope of a default run
 * ----------------------
 * Only signals whose `requirements` list is empty run. Anything that
 * needs a production build, the network, a browser or a running Worker is
 * recorded as `skipped` with the requirement spelled out, so the
 * dashboard can print *why* it is NOT RUN instead of inventing a
 * measurement. Widen deliberately with `--allow`:
 *
 *   node scripts/record-release-quality-runs.mjs --dry-run
 *   node scripts/record-release-quality-runs.mjs
 *   node scripts/record-release-quality-runs.mjs --only=bundle-budget --allow=build
 *   node scripts/record-release-quality-runs.mjs --allow=network --only=dependency-advisory
 *
 * Exit codes: 0 = the record was written (whatever the checks said —
 * a FAIL is a recorded fact, not a recorder failure), 1 = malformed
 * roster / unwritable record, 2 = bad CLI input.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DEFAULT_ROSTER_PATH,
	DEFAULT_RUN_RECORD_PATH,
	describeBrowser,
	headSha,
	loadRoster,
} from './release-quality-dashboard.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KNOWN_REQUIREMENTS = new Set(['build', 'network', 'browser', 'worker']);

/**
 * Decide, per signal, whether this invocation runs it or records it as
 * skipped. Pure, so the policy is fixture-tested rather than discovered
 * by running the wrong command.
 */
export function planRuns({ signals, allowed = [], only = [], skip = [] }) {
	const plan = [];
	for (const signal of signals) {
		if (signal.state !== 'implemented') continue;
		const entry = {
			id: signal.id,
			command: signal.command,
			requirements: signal.requirements ?? [],
		};
		if (only.length > 0 && !only.includes(signal.id)) continue;
		if (skip.includes(signal.id)) continue;
		const unmet = entry.requirements.filter((requirement) => !allowed.includes(requirement));
		if (unmet.length > 0) {
			plan.push({
				...entry,
				skipped: true,
				reason: `requires ${unmet.join(' + ')}（この実行では許可されていない）`,
			});
			continue;
		}
		plan.push(entry);
	}
	return plan;
}

/** One executed command: exit code + duration, never its output. */
export function runCommand({ command, cwd, env }) {
	const started = Date.now();
	try {
		execFileSync('sh', ['-c', command], {
			cwd,
			env: { ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
			stdio: 'inherit',
		});
		return { exitCode: 0, durationMs: Date.now() - started };
	} catch (error) {
		return {
			exitCode: typeof error?.status === 'number' ? error.status : 1,
			durationMs: Date.now() - started,
		};
	}
}

/** Size in bytes of each declared evidence path that is on disk. */
export function inventoryArtefacts({ paths = [], cwd }) {
	const artefacts = [];
	for (const path of paths) {
		try {
			artefacts.push({ path, bytes: statSync(resolve(cwd, path)).size });
		} catch {
			// A missing artefact is a reportable state, not an error here:
			// the dashboard turns "declared but absent" into NOT RUN.
		}
	}
	return artefacts;
}

/** Assemble the record. Pure, so tests can pin its shape. */
export function buildRunRecord({ sourceSha, capturedAt, environment, runs, skipped }) {
	return {
		version: 1,
		source_sha: sourceSha,
		captured_at: capturedAt,
		environment,
		runs: [...runs, ...skipped].sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function parseList(value) {
	if (!value) return [];
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function parseArg(argv, name) {
	for (const arg of argv) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

function main(argv) {
	const root = resolve(
		argv.includes('--root') ? (argv[argv.indexOf('--root') + 1] ?? REPO_ROOT) : REPO_ROOT,
	);
	const outPath = resolve(root, parseArg(argv, '--out') ?? DEFAULT_RUN_RECORD_PATH);
	const rosterPath = parseArg(argv, '--roster') ?? DEFAULT_ROSTER_PATH;
	const allowed = parseList(parseArg(argv, '--allow'));
	const only = parseList(parseArg(argv, '--only'));
	const skip = parseList(parseArg(argv, '--skip'));
	const dryRun = argv.includes('--dry-run');

	for (const requirement of allowed) {
		if (!KNOWN_REQUIREMENTS.has(requirement)) {
			process.stderr.write(
				`unknown requirement "${requirement}" (${[...KNOWN_REQUIREMENTS].join(' / ')})\n`,
			);
			return 2;
		}
	}

	const { errors, roster, families } = loadRoster({ root, rosterPath });
	if (errors.length > 0) {
		process.stderr.write(`record-release-quality-runs: ${errors.length} problem(s):\n`);
		for (const error of errors) process.stderr.write(`  - ${error}\n`);
		return 1;
	}

	const signals = roster.signals.map((signal) => ({
		...signal,
		state: signal.family
			? (families.gate_families.find((family) => family.id === signal.family)?.state ??
				signal.state)
			: signal.state,
	}));
	const plan = planRuns({ signals, allowed, only, skip });

	if (dryRun) {
		process.stdout.write(`dry run: ${plan.length} signal(s) selected\n`);
		for (const entry of plan) {
			process.stdout.write(
				entry.skipped
					? `  skip  ${entry.id} (${entry.reason})\n`
					: `  run   ${entry.id} — ${entry.command}\n`,
			);
		}
		return 0;
	}

	const runs = [];
	const skipped = [];
	let usedNetwork = false;
	for (const entry of plan) {
		if (entry.skipped) {
			skipped.push({ id: entry.id, skipped: true, reason: entry.reason });
			continue;
		}
		if (entry.requirements.includes('network')) usedNetwork = true;
		process.stdout.write(`> ${entry.id}: ${entry.command}\n`);
		const { exitCode, durationMs } = runCommand({
			command: entry.command,
			cwd: root,
			env: process.env,
		});
		runs.push({
			id: entry.id,
			exit_code: exitCode,
			duration_ms: durationMs,
			artifacts: inventoryArtefacts({
				paths: entry.evidence?.kind === 'artefact' ? entry.evidence.paths : [],
				cwd: root,
			}),
		});
	}

	const record = buildRunRecord({
		sourceSha: headSha(root),
		capturedAt: new Date().toISOString(),
		environment: {
			runner: process.env.CI ? 'ci' : 'local',
			node: process.version,
			cpu: describeCpu(),
			browser: describeBrowser(root),
			network: usedNetwork ? 'allowed (registry / origin reachable)' : 'not used',
		},
		runs,
		skipped,
	});

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
	const relative = outPath.startsWith(`${root}/`) ? outPath.slice(root.length + 1) : outPath;
	process.stdout.write(
		`wrote ${relative} (${record.runs.length} run, ${skipped.length} skipped) @ ${record.source_sha}\n`,
	);
	return 0;
}

function describeCpu() {
	return { model: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length };
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
