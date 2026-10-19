#!/usr/bin/env node
/**
 * check-html-standards — HTML standards gate (Issue #412).
 *
 * Two modes over ONE engine (`scripts/html-standards-contract.mjs`):
 *
 *   1. OFFLINE (default) — no server, no network, no build. It
 *      re-runs the two committed fixtures through the engine, checks
 *      the declared route roster against `src/routes/**` and the
 *      generated route tree, and checks that the manifest's rule table
 *      and the engine's rule catalogue agree in both directions. This
 *      is what `pnpm run html:standards:check` runs inside
 *      `validate:fast`, and it is cheap because it reads two HTML files
 *      and two source files.
 *   2. LIVE (`--live <baseUrl>`) — fetch every declared renderable
 *      route from a real server (dev server, `vite preview`, or any
 *      origin the operator already trusts) and evaluate the same
 *      engine over the SSR documents. This is the report surface and
 *      the local reproduction of `test/integration/html-standards.test.ts`,
 *      which is the half that runs in CI against the real Worker.
 *
 * Nothing is uploaded anywhere. The public Nu validator would send every
 * rendered document — including `/admin/*` pages and their copy — to a
 * third-party host, so this gate is offline by construction.
 *
 * Usage:
 *   node scripts/check-html-standards.mjs
 *   node scripts/check-html-standards.mjs --json
 *   node scripts/check-html-standards.mjs --live http://127.0.0.1:3000 [--html <out>] [--json]
 *   node scripts/check-html-standards.mjs --help
 *
 * Exit codes:
 *   0  gate passed (warnings and excluded routes allowed)
 *   1  at least one error-level finding, or a fixture that stopped failing
 *   2  usage error / unusable manifest
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	RULE_IDS,
	effectiveFindings,
	evaluateRoutes,
	renderHtmlReport,
	renderTextReport,
	severitiesFrom,
	validateHtml,
} from './html-standards-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
export const DEFAULT_MANIFEST = 'quality/html-standards.json';

const USAGE = `check-html-standards — HTML standards gate (Issue #412)

  node scripts/check-html-standards.mjs [--json]
  node scripts/check-html-standards.mjs --live <baseUrl> [--html <out.html>] [--json]

  offline (default)   fixtures + route inventory + rule catalogue; no server, no network
  --live <baseUrl>    fetch every declared renderable route and validate the SSR document
  --manifest <path>   declaration file (default ${DEFAULT_MANIFEST})
  --html <path>       write the self-contained HTML report
  --json              print the machine-readable result instead of text
`;

export class ManifestError extends Error {}

const ROUTE_ID_PATTERN = /createFileRoute\(\s*(['"])([^'"]+)\1/;

/**
 * Route id → published path.
 *
 * The same normalization the router's own generator applies: TanStack
 * nesting markers (`admin/invitations_/accept`) and the layout route's
 * trailing slash (`/portfolio/`) are not part of the URL, so comparing a
 * raw id against a raw id would report a mismatch for every nested route.
 */
export function publishedPathForId(id) {
	const segments = id
		.split('/')
		.filter((segment) => segment.length > 0)
		.map((segment) => segment.replace(/_$/, ''));
	return `/${segments.join('/')}`;
}

/* ------------------------------------------------------------------ *
 * manifest
 * ------------------------------------------------------------------ */

/**
 * Load and validate the declaration file.
 *
 * A short reason must be a reason: prose, not a placeholder. Every rule
 * the engine can emit has to be declared with a severity and a reason,
 * and every rule the manifest declares has to exist in the engine — in
 * both directions, because a manifest that silently drops a rule would
 * otherwise downgrade it to "not checked" without a diff showing it.
 */
export function loadManifest(path) {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new ManifestError(`unreadable manifest ${path}: ${error.message}`);
	}
	if (manifest.version !== 1) {
		throw new ManifestError(`unsupported manifest version: ${JSON.stringify(manifest.version)}`);
	}

	const errors = [];
	const declared = Object.keys(manifest.rules ?? {}).sort();
	// `RULE_IDS` is the engine's own sorted projection of its catalogue,
	// so the two directions of this comparison cannot drift by sorting.
	const implemented = RULE_IDS;

	for (const rule of declared) {
		if (!implemented.includes(rule)) {
			errors.push(`rules.${rule}: declared, but the engine implements no such rule`);
			continue;
		}
		const entry = manifest.rules[rule];
		if (entry.severity !== 'error' && entry.severity !== 'warning') {
			errors.push(`rules.${rule}.severity: must be "error" or "warning"`);
		}
		if (!isRealReason(entry.reason)) errors.push(`rules.${rule}.reason: missing or placeholder`);
	}
	for (const rule of implemented) {
		if (!declared.includes(rule)) {
			errors.push(
				`rules.${rule}: the engine can emit this rule but the manifest does not declare it`,
			);
		}
	}

	const seen = new Set();
	for (const route of manifest.routes ?? []) {
		if (seen.has(route.route_id)) {
			errors.push(`routes: duplicate entry for ${route.route_id}`);
		}
		seen.add(route.route_id);
		if (route.mode !== 'render' && route.mode !== 'excluded') {
			errors.push(`routes.${route.route_id}.mode: must be "render" or "excluded"`);
		}
		if (route.mode === 'excluded' && !isRealReason(route.reason)) {
			errors.push(`routes.${route.route_id}.reason: an excluded route must record why`);
		}
		if (route.mode === 'render' && !isRealReason(route.why)) {
			errors.push(
				`routes.${route.route_id}.why: a rendered route must record why it is a representative surface`,
			);
		}
	}

	for (const kind of ['valid', 'invalid']) {
		// A manifest that dropped a fixture path must be "unusable"
		// (exit 2), not a raw `TypeError` out of `runOfflineCheck`.
		if (typeof manifest.fixtures?.[kind] !== 'string' || manifest.fixtures[kind].trim() === '') {
			errors.push(`fixtures.${kind}: must name a fixture file relative to the repository root`);
		}
	}
	for (const key of ['expect', 'forbidden']) {
		const list = manifest.fixtures?.[key];
		if (list === undefined) continue;
		if (!Array.isArray(list) || list.some((rule) => typeof rule !== 'string')) {
			errors.push(`fixtures.${key}: must be a list of rule ids`);
		}
	}

	for (const waiver of manifest.waivers ?? []) {
		if (!isRealReason(waiver.reason)) {
			errors.push(`waivers: the waiver for ${waiver.rule} has no reason`);
		}
		// A waiver must scope itself. One that names neither the routes nor
		// the message shape it covers would mute a whole rule across the
		// whole site, which is exactly the blanket this ledger must not
		// be able to express.
		if ((waiver.route_id === undefined || waiver.route_id === '*') && !waiver.message_pattern) {
			errors.push(
				`waivers: the waiver for ${waiver.rule} must declare route_id or message_pattern`,
			);
		}
		if (waiver.message_pattern) {
			try {
				new RegExp(waiver.message_pattern);
			} catch (error) {
				errors.push(
					`waivers: the waiver for ${waiver.rule} has an invalid message_pattern (${
						error instanceof Error ? error.message : String(error)
					})`,
				);
			}
		}
		if (
			waiver.rule &&
			!declared.includes(waiver.rule) &&
			!String(waiver.rule).startsWith('html.')
		) {
			errors.push(`waivers: ${waiver.rule} is neither a rule nor an engine finding id`);
		}
	}

	if (errors.length > 0) throw new ManifestError(errors.join('\n  - '));
	return manifest;
}

function isRealReason(reason) {
	return typeof reason === 'string' && reason.trim().length >= 12;
}

/* ------------------------------------------------------------------ *
 * route inventory
 * ------------------------------------------------------------------ */

/** Every route file under `src/routes`, discovered the way the router does. */
export function deriveRouteIds(routesDir) {
	const out = new Set();
	for (const file of walk(routesDir)) {
		const match = readFileSync(file, 'utf8').match(ROUTE_ID_PATTERN);
		if (match) out.add(publishedPathForId(match[2]));
	}
	return out;
}

/** Route ids declared by the generated tree the Worker actually serves. */
export function parseRouteTreeIds(text) {
	const start = text.indexOf('interface FileRoutesByPath {');
	if (start === -1) return [];
	const rest = text.slice(start);
	const tail = rest.slice(1).search(/\n(?=(?:interface|declare|const|export|type)\s)/);
	const block = tail === -1 ? rest : rest.slice(0, tail + 1);
	return [...block.matchAll(/^\s*'([^']+)':\s*\{\s*$/gm)].map((match) =>
		publishedPathForId(match[1]),
	);
}

/**
 * Compare the manifest roster with what the repository actually serves.
 *
 * Both directions fail: an undeclared route is a surface nothing
 * validates, and a declared route that no longer exists is a roster
 * entry that reads as coverage while checking nothing.
 */
export function evaluateInventory({ manifest, fileRouteIds, treeRouteIds }) {
	const declared = new Set(manifest.routes.map((route) => route.route_id));
	const published = new Set([...fileRouteIds, ...treeRouteIds]);
	const errors = [];
	for (const routeId of [...published].sort()) {
		if (!declared.has(routeId)) {
			errors.push(
				`inventory.unlisted: ${routeId} is a published route but the manifest does not declare it; render it or exclude it with a reason`,
			);
		}
	}
	for (const routeId of [...declared].sort()) {
		if (!published.has(routeId)) {
			errors.push(
				`inventory.missing: ${routeId} is declared but no route file / generated tree entry publishes it`,
			);
		}
	}
	return errors;
}

function walk(dir) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.flatMap((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return walk(path);
			return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
		})
		.sort();
}

/* ------------------------------------------------------------------ *
 * offline check
 * ------------------------------------------------------------------ */

/**
 * The offline half of the gate: fixtures + inventory + rule catalogue.
 *
 * @returns {{ errors: string[], fixtures: object[], inventory: string[] }}
 */
export function runOfflineCheck({ root = REPO_ROOT, manifest }) {
	const errors = [];
	const severities = severitiesFrom(manifest);
	const fixtures = [];

	for (const kind of ['valid', 'invalid']) {
		const relativePath = manifest.fixtures[kind];
		const path = join(root, relativePath);
		if (!existsSync(path)) {
			errors.push(`fixtures.${kind}: ${relativePath} is missing`);
			fixtures.push({ kind, path: relativePath, error: 1, error_rules: [], warning_rules: [] });
			continue;
		}
		const result = validateHtml(readFileSync(path, 'utf8'), { severities });
		const errorRules = [
			...new Set(result.messages.filter((m) => m.severity === 'error').map((m) => m.rule)),
		].sort();
		const warningRules = [
			...new Set(result.messages.filter((m) => m.severity === 'warning').map((m) => m.rule)),
		].sort();
		fixtures.push({
			kind,
			path: relativePath,
			error: result.stats.errors,
			warning: result.stats.warnings,
			error_rules: errorRules,
			warning_rules: warningRules,
		});

		if (kind === 'valid' && result.stats.errors > 0) {
			errors.push(
				`fixtures.valid: the valid fixture must validate clean, but it produced ${result.stats.errors} error(s): ${result.messages
					.filter((m) => m.severity === 'error')
					.map((m) => `${m.rule}@${m.line}`)
					.join(', ')}`,
			);
		}
		if (kind === 'invalid') {
			// Issue acceptance: the invalid fixture MUST fail. A gate that
			// cannot detect the seeded defects must not report green.
			if (result.stats.errors === 0) {
				errors.push(
					'fixtures.invalid: the invalid fixture produced no error-level finding; the gate can no longer detect the seeded defects',
				);
			}
			for (const rule of manifest.fixtures.expect ?? []) {
				const produced = result.messages.some((message) => message.rule === rule);
				if (!produced) {
					errors.push(
						`fixtures.invalid: expected rule "${rule}" did not fire on the invalid fixture`,
					);
				}
			}
			for (const rule of manifest.fixtures.forbidden ?? []) {
				if (result.messages.some((message) => message.rule === rule)) {
					errors.push(
						`fixtures.invalid: forbidden rule "${rule}" fired; the engine is reporting something the fixture does not contain`,
					);
				}
			}
		}
	}

	const inventory = evaluateInventory({
		manifest,
		fileRouteIds: deriveRouteIds(join(root, 'src/routes')),
		treeRouteIds: parseRouteTreeIds(readFileSync(join(root, 'src/routeTree.gen.ts'), 'utf8')),
	});

	return { errors: [...errors, ...inventory], fixtures, inventory };
}

/* ------------------------------------------------------------------ *
 * live check
 * ------------------------------------------------------------------ */

async function observe(baseUrl, entry) {
	const url = `${baseUrl.replace(/\/+$/, '')}${entry.path}`;
	try {
		const response = await fetch(url, {
			redirect: 'manual',
			headers: { accept: 'text/html' },
			signal: AbortSignal.timeout(20_000),
		});
		return {
			routeId: entry.route_id,
			path: entry.path,
			status: response.status,
			contentType: response.headers.get('content-type'),
			html: await response.text(),
			requestFailed: false,
		};
	} catch (error) {
		return {
			routeId: entry.route_id,
			path: entry.path,
			status: null,
			contentType: null,
			html: '',
			requestFailed: true,
			note: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function runLiveCheck({ baseUrl, manifest }) {
	const observations = [];
	for (const entry of manifest.routes) {
		if (entry.mode !== 'render') continue;
		observations.push(await observe(baseUrl, entry));
	}
	return evaluateRoutes({ manifest, observations, severities: severitiesFrom(manifest) });
}

/* ------------------------------------------------------------------ *
 * reporting
 * ------------------------------------------------------------------ */

function renderOfflineText(offline, manifest) {
	const lines = [];
	lines.push(`HTML standards gate (${manifest.profile}) — offline`);
	lines.push(
		`fixtures: ${offline.fixtures.map((fixture) => `${fixture.kind}=${fixture.error} error(s)`).join(' / ')}`,
	);
	for (const fixture of offline.fixtures) {
		lines.push(`  ${fixture.error === 0 ? 'PASS' : 'FAIL'}  ${fixture.path}`);
		if (fixture.error_rules.length > 0) {
			lines.push(`          error rules: ${fixture.error_rules.join(', ')}`);
		}
		if (fixture.warning_rules.length > 0) {
			lines.push(`          warning rules: ${fixture.warning_rules.join(', ')}`);
		}
	}
	lines.push(
		`inventory: ${manifest.routes.filter((route) => route.mode === 'render').length} renderable / ${manifest.routes.filter((route) => route.mode === 'excluded').length} excluded / ${offline.inventory.length} mismatch(es)`,
	);
	lines.push(
		`rules: ${Object.keys(manifest.rules).length} declared, ${manifest.waivers.length} waiver(s)`,
	);
	if (offline.errors.length > 0) {
		lines.push('');
		lines.push(`errors (${offline.errors.length})`);
		for (const error of offline.errors) lines.push(`  FAIL  ${error}`);
	}
	return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
	const options = { live: null, html: null, json: false, manifest: DEFAULT_MANIFEST };
	for (let i = 0; i < argv.length; i += 1) {
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
		if (arg === '--manifest') {
			options.manifest = argv[++i] ?? null;
			continue;
		}
		return { error: `unknown argument: ${arg}` };
	}
	return { options };
}

async function main(argv) {
	const parsed = parseArgs(argv);
	if (parsed.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	if (parsed.error) {
		process.stderr.write(`${parsed.error}\n\n${USAGE}`);
		return 2;
	}

	let manifest;
	try {
		manifest = loadManifest(resolve(REPO_ROOT, parsed.options.manifest));
	} catch (error) {
		process.stderr.write(`html-standards manifest is unusable: ${error.message}\n`);
		return 2;
	}

	const offline = runOfflineCheck({ root: REPO_ROOT, manifest });
	const live = parsed.options.live
		? await runLiveCheck({ baseUrl: parsed.options.live, manifest })
		: null;

	const payload = {
		profile: manifest.profile,
		offline,
		live,
		manifest: {
			rules: Object.fromEntries(
				Object.entries(manifest.rules).map(([rule, entry]) => [
					rule,
					{ severity: entry.severity, nu_type: entry.nu_type, reason: entry.reason },
				]),
			),
			routes: manifest.routes.length,
			waivers: manifest.waivers.length,
		},
	};

	const errors = [
		...offline.errors,
		...(live ? effectiveFindings(live.findings).map((f) => `${f.rule}: ${f.message}`) : []),
	];

	if (parsed.options.json) {
		process.stdout.write(
			`${JSON.stringify({ ok: errors.length === 0, errors, ...payload }, null, 2)}\n`,
		);
	} else {
		process.stdout.write(`${renderOfflineText(offline, manifest)}\n`);
		if (live) {
			process.stdout.write(`\n${renderTextReport({ ...live, profile: manifest.profile })}\n`);
		}
		if (parsed.options.html && live) {
			writeFileSync(
				parsed.options.html,
				renderHtmlReport(
					{ ...live, profile: manifest.profile, rules: payload.manifest.rules },
					{
						baseUrl: parsed.options.live,
						generatedAt: new Date().toISOString(),
					},
				),
			);
		}
	}

	return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await main(process.argv.slice(2));
}
