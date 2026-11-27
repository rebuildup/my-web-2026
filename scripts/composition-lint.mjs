#!/usr/bin/env node

/**
 * composition:lint — orchestrator for the rendered-composition lint
 * (ADR-0023, Issue #1133).
 *
 * Reads composition-model/v1 JSON files (produced by
 * `scripts/collect-composition.mjs`) and judges each route across its
 * viewport set with the pure judge. Prints a status-only verdict table
 * and exits non-zero when any route has a Blocking verdict.
 *
 * Usage:
 *   node scripts/composition-lint.mjs [--models-dir=DIR] [--json]
 *
 * `--models-dir` defaults to `.tmp/composition-models`. Missing models
 * are reported as 「未実行」 and counted as failures — an unrun cell is
 * never a silent pass (same rule as the viewport grid report).
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateVerdict, judgeRoute, loadContract } from './judge-composition.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * HEAD of this checkout — compared against each model's
 * `provenance.headSha` so a model collected before the last commit
 * surfaces as a warning instead of judging silently (Issue #1280).
 */
function currentHeadSha() {
	try {
		return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return null;
	}
}

/**
 * Provenance verdicts for one route's model set. A model without
 * `provenance` predates Issue #1280 and cannot prove freshness — warn,
 * never fail (re-collection clears it). A `headSha` that differs from
 * HEAD means the page may have changed since collection — same warn.
 * The verdict shape matches the judge's so it aggregates normally.
 */
function provenanceVerdicts(models, headSha) {
	const verdicts = [];
	const missing = [];
	const stale = [];
	for (const [stem, model] of Object.entries(models)) {
		const prov = model?.provenance;
		if (!prov || typeof prov !== 'object') {
			missing.push(stem);
			continue;
		}
		if (headSha && prov.headSha && prov.headSha !== headSha) {
			stale.push(`${stem}@${String(prov.headSha).slice(0, 7)}`);
		}
	}
	if (missing.length > 0) {
		verdicts.push({
			rule: 'PROV',
			severity: 'warning',
			verdict: 'warn',
			detail: `model(s) lack provenance (pre-#1280 format): ${missing.join(', ')} — staleness undetectable, re-collect`,
		});
	}
	if (stale.length > 0) {
		verdicts.push({
			rule: 'PROV',
			severity: 'warning',
			verdict: 'warn',
			detail: `model(s) collected at a different HEAD: ${stale.join(', ')} (HEAD ${headSha.slice(0, 7)}) — re-collect before judging`,
		});
	}
	return verdicts;
}

function parseArgs(argv) {
	const out = {};
	for (const arg of argv) {
		const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
		if (m) out[m[1]] = m[2] ?? true;
	}
	return out;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const contract = loadContract();
	const modelsDir = resolve(REPO_ROOT, opts['models-dir'] ?? '.tmp/composition-models');
	const asJson = Boolean(opts.json);

	const files = existsSync(modelsDir)
		? readdirSync(modelsDir).filter((f) => f.endsWith('.json'))
		: [];
	// Group <slug>.<stem>.json per route.
	const byRoute = new Map();
	for (const file of files) {
		const m = /^(.*)\.(w\d+)\.json$/.exec(file);
		if (!m) continue;
		const [, slug, stem] = m;
		if (!byRoute.has(slug)) byRoute.set(slug, {});
		byRoute.get(slug)[stem] = join(modelsDir, file);
	}

	const results = [];
	let failures = 0;
	const headSha = currentHeadSha();
	for (const route of contract.routes) {
		const cells = byRoute.get(route.slug) ?? {};
		const expectedStems = contract.viewports.map((v) => v.stem);
		const missing = expectedStems.filter((s) => !cells[s]);
		if (missing.length > 0) {
			results.push({ route: route.slug, verdict: 'fail', detail: `未実行: ${missing.join(',')}` });
			failures += 1;
			continue;
		}
		const models = {};
		for (const stem of expectedStems) {
			models[stem] = JSON.parse(readFileSync(cells[stem], 'utf8'));
		}
		const verdicts = judgeRoute(models, contract, route);
		verdicts.push(...provenanceVerdicts(models, headSha));
		const verdict = aggregateVerdict(verdicts);
		if (verdict === 'fail') failures += 1;
		results.push({
			route: route.slug,
			verdict,
			warnings: verdicts.filter((v) => v.verdict === 'warn').length,
			blocking: verdicts.filter((v) => v.verdict === 'fail').map((v) => v.rule),
			verdicts,
		});
	}

	if (asJson) {
		process.stdout.write(`${JSON.stringify({ modelsDir, results }, null, 2)}\n`);
	} else {
		process.stdout.write('composition:lint — rendered composition verdicts\n');
		for (const r of results) {
			const mark = r.verdict === 'pass' ? 'PASS' : r.verdict === 'warn' ? 'WARN' : 'FAIL';
			const extra = r.blocking?.length
				? ` [${r.blocking.join(',')}]`
				: r.detail
					? ` ${r.detail}`
					: '';
			const warn = r.warnings ? ` (${r.warnings} warning)` : '';
			process.stdout.write(`  ${mark.padEnd(4)} ${r.route}${extra}${warn}\n`);
		}
		process.stdout.write(
			`[composition:lint] ${results.length} route(s), ${failures} failing cell(s)\n`,
		);
	}
	process.exit(failures > 0 ? 1 : 0);
}

main();
