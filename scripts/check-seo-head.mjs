#!/usr/bin/env node
/**
 * check-seo-head — public-route `<head>` metadata check + report
 * (Issue #418).
 *
 * This is the LIVE front-end of the gate. The policy itself lives in
 * `scripts/seo-head-contract.mjs`; the CI gate that runs on every PR
 * is `test/integration/seo-head.test.ts`, which drives the real Worker
 * through `SELF.fetch` and calls the same engine. This script exists
 * for the two things a test cannot do: pointing the gate at a real
 * origin (dev server, `vite preview`, or a deployed environment) and
 * rendering the human-readable report that
 * `docs/verification/seo/head-metadata-check.webp` is a screenshot of.
 *
 * Usage:
 *   node scripts/check-seo-head.mjs --live <baseUrl> [--html <out>] [--json]
 *   node scripts/check-seo-head.mjs --help
 *
 * Options:
 *   --live <baseUrl>   fetch every discovered route from <baseUrl> and
 *                      evaluate the observed <head>. Required.
 *   --html <path>      also write the self-contained HTML report.
 *   --json             print the machine-readable result instead of text.
 *
 * Exit codes:
 *   0  no findings
 *   1  at least one finding (or a route that could not be fetched)
 *   2  usage error
 *
 * No silent passes: every discovered route appears in the report with
 * an explicit PASS / FAIL / SKIP verdict, and a route whose request
 * errored is a FAIL, never a skip. Admin routes other than
 * `/admin/login` are the only SKIPs, because an anonymous request to
 * them is a 307 with no document to evaluate — they are still
 * discovered, still listed, and the CI gate asserts the same policy
 * through the admin layout's inherited head.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CANONICAL_ORIGIN,
	DYNAMIC_ROUTE_SAMPLES,
	NON_PUBLIC_SAMPLE_PATH,
	NOT_FOUND_PROBES,
	QUERY_STRING_PROBES,
	buildInventory,
	discoverRouteModules,
	evaluateHeadInventory,
	parseHeadTags,
	renderHtmlReport,
	renderTextReport,
	summarizeHead,
} from './seo-head-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const ROUTES_DIR = resolve(REPO_ROOT, 'src/routes');

const USAGE = `check-seo-head — public-route <head> metadata gate (Issue #418)

  node scripts/check-seo-head.mjs --live <baseUrl> [--html <out.html>] [--json]

  --live <baseUrl>  origin to fetch the routes from (e.g. http://localhost:5173)
  --html <path>     write the self-contained HTML report
  --json            print JSON instead of the text report
`;

function parseArgs(argv) {
	const options = { live: null, html: null, json: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') return { help: true };
		if (arg === '--json') {
			options.json = true;
			continue;
		}
		if (arg === '--live') {
			options.live = argv[++i] ?? null;
			continue;
		}
		if (arg === '--html') {
			options.html = argv[++i] ?? null;
			continue;
		}
		return { error: `unknown argument: ${arg}` };
	}
	if (!options.live) return { error: '--live <baseUrl> is required' };
	return { options };
}

async function fetchDocument(baseUrl, path) {
	const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
	try {
		const response = await fetch(url, {
			redirect: 'manual',
			headers: { accept: 'text/html' },
			signal: AbortSignal.timeout(20_000),
		});
		const body = await response.text();
		return {
			status: response.status,
			html: body,
			error: null,
		};
	} catch (error) {
		return {
			status: null,
			html: '',
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Fetch one route and turn the response into an observation. */
async function observeRoute(baseUrl, entry) {
	const { status, html, error } = await fetchDocument(baseUrl, entry.path);

	if (error) {
		return {
			routeId: entry.routeId,
			path: entry.path,
			surface: entry.kind,
			status: null,
			expectedCanonical: entry.expectedCanonical,
			tags: [],
			head: summarizeHead([]),
			requestFailed: true,
			findings: [
				{
					rule: 'observation.request-failed',
					severity: 'error',
					routeId: entry.routeId,
					path: entry.path,
					message: `GET ${entry.path} failed: ${error}`,
				},
			],
		};
	}

	const isRedirect = status >= 300 && status < 400;
	if (isRedirect) {
		return {
			routeId: entry.routeId,
			path: entry.path,
			surface: entry.kind,
			status,
			expectedCanonical: entry.expectedCanonical,
			tags: [],
			head: summarizeHead([]),
			skipped: true,
			note: `anonymous request answers ${status} (auth gate) — no document to evaluate; the noindex policy is asserted on ${NON_PUBLIC_SAMPLE_PATH}`,
			findings: [],
		};
	}

	const tags = parseHeadTags(html);
	return {
		routeId: entry.routeId,
		path: entry.path,
		surface: entry.kind,
		status,
		expectedCanonical: entry.expectedCanonical,
		tags,
		head: summarizeHead(tags),
		findings: [],
	};
}

async function observeNotFound(baseUrl, probe) {
	const { status, html, error } = await fetchDocument(baseUrl, probe.path);
	const tags = error ? [] : parseHeadTags(html);
	return {
		routeId: probe.id,
		path: probe.path,
		surface: 'not-found',
		status: error ? null : status,
		expectedCanonical: null,
		tags,
		head: summarizeHead(tags),
		findings: [],
	};
}

/** Fetch `<path>?<query>` for every search-query probe. */
async function observeQueryProbe(baseUrl, probe) {
	const path = `${probe.routeId}?${probe.query}`;
	const { status, html, error } = await fetchDocument(baseUrl, path);
	const tags = error ? [] : parseHeadTags(html);
	return {
		routeId: probe.routeId,
		path,
		surface: 'public',
		query: probe.query,
		queryProbe: true,
		status: error ? null : status,
		expectedCanonical: null,
		tags,
		head: summarizeHead(tags),
		findings: [],
	};
}

async function collect(baseUrl) {
	const modules = discoverRouteModules(ROUTES_DIR);
	const inventory = buildInventory(modules, DYNAMIC_ROUTE_SAMPLES);
	const observations = [];

	for (const entry of inventory) {
		// The admin surface renders a document only at `/admin/login`;
		// every other admin route is auth-gated (see the note emitted
		// by observeRoute).
		if (entry.kind === 'non-public' && entry.path !== NON_PUBLIC_SAMPLE_PATH) {
			observations.push({
				routeId: entry.routeId,
				path: entry.path,
				surface: entry.kind,
				status: null,
				expectedCanonical: entry.expectedCanonical,
				tags: [],
				head: summarizeHead([]),
				skipped: true,
				note: `anonymous request is auth-gated; the noindex policy is asserted on ${NON_PUBLIC_SAMPLE_PATH}`,
				findings: [],
			});
			continue;
		}
		observations.push(await observeRoute(baseUrl, entry));
	}

	for (const probe of NOT_FOUND_PROBES) {
		observations.push(await observeNotFound(baseUrl, probe));
	}
	for (const probe of QUERY_STRING_PROBES) {
		observations.push(await observeQueryProbe(baseUrl, probe));
	}

	return { inventory, observations };
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	if (parsed.error) {
		process.stderr.write(`${parsed.error}\n\n${USAGE}`);
		return 2;
	}

	const { inventory, observations } = await collect(parsed.options.live);
	const result = evaluateHeadInventory({ inventory, observations });

	// A route whose request failed is a finding the per-row evaluator
	// already produced; make sure it reaches the top-level findings
	// list so the exit code and the report agree.
	for (const row of result.rows) {
		for (const item of row.findings ?? []) {
			if (item.rule === 'observation.request-failed') result.findings.push(item);
		}
	}
	result.stats.errors = result.findings.length;

	if (parsed.options.json) {
		process.stdout.write(
			`${JSON.stringify({ canonicalOrigin: CANONICAL_ORIGIN, ...result }, null, 2)}\n`,
		);
	} else {
		process.stdout.write(`${renderTextReport(result)}\n`);
	}

	if (parsed.options.html) {
		writeFileSync(
			parsed.options.html,
			renderHtmlReport(result, {
				baseUrl: parsed.options.live,
				capturedAt: new Date().toISOString(),
			}),
		);
	}

	return result.findings.length > 0 ? 1 : 0;
}

// Entrypoint guard: importing this module (e.g. from its unit test)
// must not start fetching a base URL.
const invokedDirectly =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	process.exitCode = await main();
}
