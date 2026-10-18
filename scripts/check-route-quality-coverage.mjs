#!/usr/bin/env node

/**
 * Public route ↔ quality-gate coverage gate (Issue #492).
 *
 * Why this gate exists
 * --------------------
 * The quality gates of this repository are declared in many places:
 * Playwright specs under `e2e/`, future Lighthouse / axe / SEO /
 * cross-browser / security-header runners, `quality/profile.yaml`. The
 * roster of *published routes* lived only in the TanStack file-route
 * tree. Nothing compared the two, so adding a page could land with
 * zero quality-gate coverage and no PR could notice: the missing
 * target is invisible until a real defect ships.
 *
 * This gate makes the published route roster and its gate coverage one
 * reviewable artefact (`quality/route-coverage.json`) and fails when
 * the two drift apart. It is a **coverage ledger**, not a gate runner:
 * it proves that every route has a decision, not that the decision's
 * checks pass. Running Lighthouse or axe is #384–#387's job.
 *
 * What it checks (cheap by design — text scan only, no browser):
 *
 *   1. `quality/route-coverage.json` parses and declares `version: 1`.
 *   2. Every gate family declares an `id`, a non-empty `contract`, an
 *      `evidence_kind`, and a `state` of `implemented` / `planned`.
 *   3. The published roster is derived from the filesystem — every file
 *      under `src/routes/**` that calls `createFileRoute('<id>')` is a
 *      route — and the manifest has exactly one entry per route file.
 *      A new route with no entry fails ("add the target or a justified
 *      exclusion"); an entry with no route file fails too.
 *   4. Each entry's `path` equals the path published by its route id,
 *      so renaming a route cannot silently desync the manifest.
 *   5. `src/routeTree.gen.ts` (the generated tree the Worker actually
 *      serves) lists exactly the same route ids. A stale generated
 *      file fails, because otherwise the check would police a roster
 *      the deployment does not serve.
 *   6. Every (route, gate family) cell is resolved: `covered` with at
 *      least one evidence path, or `excluded` with a non-empty reason.
 *      An unresolved cell is the "対象漏れ" this Issue is about.
 *   7. `covered` evidence must obey the family's `evidence_kind`, exist
 *      on disk, and actually mention the route's probe path
 *      (`sample_path` for dynamic routes, otherwise `path`). A coverage
 *      claim cannot be satisfied by naming an unrelated spec.
 *   8. A `planned` family may not claim `covered`, and an `implemented`
 *      family may not be excluded for every route (an implemented gate
 *      nobody is measured against is dead configuration).
 *   9. Every `public` + addressable route has at least one `covered`
 *      family, so a new public page cannot skip the gates by
 *      exclusion alone.
 *  10. Addressable paths are unique; a non-addressable route states
 *      why; a dynamic route states the concrete sample it was
 *      measured at.
 *
 * Scanner limits (documented, not hidden):
 *
 *   - Route discovery reads `createFileRoute('<id>')` textually. A route
 *     that passed its id through a variable would not be seen; the
 *     generated-tree cross-check (#5) catches that as a mismatch
 *     rather than a silent omission.
 *   - Evidence matching is `content.includes(probe)`. It proves the
 *     route is *named* in the evidence, not that the assertion still
 *     runs; the specs themselves remain the authority for that.
 *
 * Exit codes: 0 = manifest and published routes agree, 1 = drift or a
 * malformed manifest, 2 = bad input (unreadable manifest / route root).
 *
 * Authority: Issue #492. Paired with
 * `docs/verification/quality/route-quality-coverage.md` and the
 * `route_quality_coverage` block in `quality/profile.yaml`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_MANIFEST_PATH = 'quality/route-coverage.json';
export const ROUTE_ROOT = 'src/routes';
export const ROUTE_TREE = 'src/routeTree.gen.ts';

/** Gate families this ledger knows about, in report order. */
const EVIDENCE_KINDS = new Set(['spec', 'doc', 'spec_or_doc']);
const FAMILY_STATES = new Set(['implemented', 'planned']);
const AUDIENCES = new Set(['public', 'admin', 'internal']);

/** Reasons that mean "the author wrote nothing". */
const PLACEHOLDER_REASONS = new Set(['tbd', 'todo', 'n/a', 'na', 'none', 'later', '-']);

/** `createFileRoute('/admin/invitations_/accept')` — the route id. */
const ROUTE_ID_PATTERN = /createFileRoute\(\s*(['"])([^'"]+)\1/;

/**
 * Normalise a TanStack route id to the path a visitor types.
 *
 * The id carries two conventions that are not part of the URL: a
 * trailing `_` opts a segment out of nesting (`/admin/invitations_`
 * is the URL `/admin/invitations`), and an index route keeps a trailing
 * slash (`/portfolio/`). Both are directory/parent mechanics.
 */
export function publishedPathForId(id) {
	const segments = id
		.split('/')
		.filter((segment) => segment.length > 0)
		.map((segment) => segment.replace(/_$/, ''));
	return `/${segments.join('/')}`;
}

/** A route is dynamic when any segment is a `$param`. */
export function isDynamicId(id) {
	return id.split('/').some((segment) => segment.startsWith('$'));
}

function escapeRegExp(value) {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is `sample` a concrete instance of the route published as `id`?
 *
 * A dynamic segment (`$slug`) is a placeholder, so it matches exactly
 * one concrete segment: `/portfolio/my-web-2026` is an instance of
 * `/portfolio/$slug`, while `/portfolio` and `/portfolio/a/b` are not.
 */
export function isSampleUnderRoute(id, sample) {
	const pattern = id
		.split('/')
		.filter((segment) => segment.length > 0)
		.map((segment) => (segment.startsWith('$') ? '[^/]+' : escapeRegExp(segment.replace(/_$/, ''))))
		.join('/');
	return new RegExp(`^/${pattern}$`).test(sample);
}

/**
 * Every route file under `src/routes`, in stable (sorted) order.
 *
 * A file is a route when it calls `createFileRoute('<id>')`.
 * `__root.tsx` calls `createRootRoute` and is therefore not a route,
 * and co-located components (`routes/design-system/DesignSystemPage.tsx`,
 * `routes/design-system/sections/*.tsx`) are not routes either — the
 * same rule the router's own generator applies.
 *
 * @param {{ root?: string }} options
 * @returns {Array<{ source: string, id: string, path: string, dynamic: boolean }>}
 */
export function deriveRoutesFromFiles({ root = REPO_ROOT } = {}) {
	const routeRoot = join(root, ROUTE_ROOT);
	const out = [];
	for (const file of walk(routeRoot)) {
		const text = readFileSync(file, 'utf8');
		const match = text.match(ROUTE_ID_PATTERN);
		if (!match) continue;
		const id = match[2];
		out.push({
			source: relative(root, file).split(sep).join('/'),
			id,
			path: publishedPathForId(id),
			dynamic: isDynamicId(id),
		});
	}
	return out.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Route ids declared by the generated tree the Worker serves.
 *
 * `src/routeTree.gen.ts` is generated and committed; if it disagrees
 * with `src/routes/**`, the deployment serves a different roster than
 * the one this gate reads, so the mismatch is a failure, not a warning.
 */
export function parseRouteTreeIds(text) {
	const start = text.indexOf('interface FileRoutesByPath {');
	if (start === -1) return [];
	// The interface runs until the next top-level statement, so a later
	// block that happens to use quoted keys cannot leak into the id list.
	const rest = text.slice(start);
	const tailIndex = rest.slice(1).search(/\n(?=(?:interface|declare|const|export|type)\s)/);
	const block = tailIndex === -1 ? rest : rest.slice(0, tailIndex + 1);
	return [...block.matchAll(/^\s*'([^']+)':\s*\{\s*$/gm)].map((match) => match[1]).sort();
}

/** A short reason must be a reason: prose, not a placeholder. */
function isRealReason(reason) {
	return (
		typeof reason === 'string' &&
		reason.trim().length >= 8 &&
		!PLACEHOLDER_REASONS.has(reason.trim().toLowerCase())
	);
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

function readEvidenceText(root, evidencePath) {
	try {
		return readFileSync(join(root, evidencePath), 'utf8');
	} catch {
		return null;
	}
}

function evidenceKindMatches(kind, evidencePath) {
	if (kind === 'spec') return /^e2e\/.+\.spec\.tsx?$/.test(evidencePath);
	if (kind === 'doc') return /^docs\/.+\.md$/.test(evidencePath);
	return /^e2e\/.+\.spec\.tsx?$/.test(evidencePath) || /^docs\/.+\.md$/.test(evidencePath);
}

/**
 * Evaluate the manifest against the published routes.
 *
 * Pure with respect to the filesystem: everything it reads is passed in,
 * so the fixture test drives it with synthetic repos.
 *
 * @returns {{ errors: string[], rows: Array<object>, families: Array<object> }}
 */
export function evaluateCoverage({ manifest, routes, routeTreeIds = [], evidence = {} }) {
	const errors = [];
	const families = Array.isArray(manifest?.gate_families) ? manifest.gate_families : [];

	if (manifest?.version !== 1) {
		errors.push('manifest: `version` must be 1');
	}
	if (families.length === 0) {
		errors.push('manifest: `gate_families` must declare at least one gate family');
	}

	const familyIds = [];
	for (const family of families) {
		const label = `gate_families.${family?.id ?? '<missing id>'}`;
		if (typeof family?.id !== 'string' || family.id.length === 0) {
			errors.push(`${label}: missing id`);
			continue;
		}
		if (familyIds.includes(family.id)) {
			errors.push(`${label}: duplicate gate family id`);
			continue;
		}
		familyIds.push(family.id);
		if (!isRealReason(family.contract)) {
			errors.push(`${label}.contract: state what the family measures (a real sentence)`);
		}
		if (!EVIDENCE_KINDS.has(family.evidence_kind)) {
			errors.push(
				`${label}.evidence_kind: "${family.evidence_kind}" not in {${[...EVIDENCE_KINDS].join(', ')}}`,
			);
		}
		if (!FAMILY_STATES.has(family.state)) {
			errors.push(`${label}.state: "${family.state}" not in {implemented, planned}`);
		}
	}

	const entries = Array.isArray(manifest?.routes) ? manifest.routes : [];
	if (entries.length === 0 && routes.length > 0) {
		errors.push('manifest.routes: the published routes are not covered at all');
	}

	const seenSources = new Set();
	const addressablePaths = new Set();
	const coverageByFamily = new Map(familyIds.map((id) => [id, 0]));

	for (const [index, entry] of entries.entries()) {
		const label = `routes[${entry?.source ?? index}]`;
		if (typeof entry?.source !== 'string' || entry.source.length === 0) {
			errors.push(`${label}: missing \`source\` (the repo-relative route file)`);
			continue;
		}
		if (seenSources.has(entry.source)) {
			errors.push(`${label}: duplicate source`);
			continue;
		}
		seenSources.add(entry.source);

		const route = routes.find((candidate) => candidate.source === entry.source);
		if (!route) {
			errors.push(
				`${label}: ${entry.source} is not a published route (no createFileRoute call under ${ROUTE_ROOT}/). Delete the entry, or add the route file back.`,
			);
			continue;
		}
		if (entry.path !== route.path) {
			errors.push(
				`${label}.path: manifest says "${entry.path}" but ${entry.source} publishes "${route.path}" (route id "${route.id}")`,
			);
		}
		if (!AUDIENCES.has(entry.audience)) {
			errors.push(`${label}.audience: "${entry.audience}" not in {${[...AUDIENCES].join(', ')}}`);
		}
		if (typeof entry.addressable !== 'boolean') {
			errors.push(`${label}.addressable: required boolean`);
		}
		if (entry.addressable === false && !isRealReason(entry.addressable_reason)) {
			errors.push(
				`${label}.addressable_reason: a non-addressable route must say why it is not addressable`,
			);
		}
		if (entry.addressable === true && addressablePaths.has(entry.path)) {
			errors.push(`${label}.path: "${entry.path}" is claimed by two addressable routes`);
		}
		if (entry.addressable === true) {
			addressablePaths.add(entry.path);
		}

		const probe = typeof entry.sample_path === 'string' ? entry.sample_path : entry.path;
		if (route.dynamic) {
			if (!isRealReason(entry.sample_path)) {
				errors.push(
					`${label}.sample_path: a dynamic route must name the concrete path it was measured at`,
				);
			} else if (!isSampleUnderRoute(route.id, entry.sample_path)) {
				errors.push(
					`${label}.sample_path: "${entry.sample_path}" is not a concrete instance of "${route.path}"`,
				);
			}
		} else if (typeof entry.sample_path === 'string') {
			errors.push(
				`${label}.sample_path: only a dynamic route needs a sample (its published path is ${route.path})`,
			);
		}

		const gates = entry.gates && typeof entry.gates === 'object' ? entry.gates : {};
		for (const family of families) {
			const gateLabel = `${label}.gates.${family.id}`;
			const cell = gates[family.id];
			if (!cell || typeof cell !== 'object') {
				errors.push(
					`${gateLabel}: unresolved — every route must be covered or explicitly excluded for every gate family`,
				);
				continue;
			}
			if (cell.status === 'covered') {
				if (family.state === 'planned') {
					errors.push(`${gateLabel}: family state is "planned", so it cannot claim coverage yet`);
				}
				if (!Array.isArray(cell.evidence) || cell.evidence.length === 0) {
					errors.push(`${gateLabel}.evidence: covered needs at least one evidence path`);
					continue;
				}
				coverageByFamily.set(family.id, coverageByFamily.get(family.id) + 1);
				for (const evidencePath of cell.evidence) {
					if (typeof evidencePath !== 'string' || evidencePath.length === 0) {
						errors.push(`${gateLabel}.evidence: every evidence entry must be a path`);
						continue;
					}
					if (!evidenceKindMatches(family.evidence_kind, evidencePath)) {
						errors.push(
							`${gateLabel}.evidence: "${evidencePath}" does not match the family's evidence_kind "${family.evidence_kind}"`,
						);
						continue;
					}
					const text = evidence[evidencePath];
					if (text === undefined || text === null) {
						errors.push(`${gateLabel}.evidence: "${evidencePath}" does not exist`);
						continue;
					}
					if (!text.includes(probe)) {
						errors.push(
							`${gateLabel}.evidence: "${evidencePath}" never mentions "${probe}" — the route is not actually a target there`,
						);
					}
				}
				continue;
			}
			if (cell.status === 'excluded') {
				if (!isRealReason(cell.reason)) {
					errors.push(`${gateLabel}.reason: an exclusion must say why, in a real sentence`);
				}
				if (cell.evidence !== undefined) {
					errors.push(`${gateLabel}.evidence: an exclusion carries no evidence`);
				}
				continue;
			}
			errors.push(`${gateLabel}.status: "${cell.status}" not in {covered, excluded}`);
		}

		const coveredFamilies = families.filter((family) => gates[family.id]?.status === 'covered');
		if (entry.addressable === true && entry.audience === 'public' && coveredFamilies.length === 0) {
			errors.push(
				`${label}: a public addressable route needs at least one covered gate family (currently ${coveredFamilies.length})`,
			);
		}
	}

	for (const route of routes) {
		if (!seenSources.has(route.source)) {
			errors.push(
				`routes: ${route.source} (${route.path}) is published but has no manifest entry — add the gate target, or exclude it with a reason for every family`,
			);
		}
	}

	if (routeTreeIds.length > 0) {
		const fromFiles = routes.map((route) => route.id).sort();
		const fromTree = [...routeTreeIds].sort();
		for (const id of fromFiles) {
			if (!fromTree.includes(id)) {
				errors.push(
					`${ROUTE_TREE}: route id "${id}" exists in ${ROUTE_ROOT}/ but not in the generated tree — regenerate it (the generated file is stale)`,
				);
			}
		}
		for (const id of fromTree) {
			if (!fromFiles.includes(id)) {
				errors.push(
					`${ROUTE_TREE}: route id "${id}" is in the generated tree but has no route file under ${ROUTE_ROOT}/`,
				);
			}
		}
	}

	for (const family of families) {
		if (family.state === 'implemented' && coverageByFamily.get(family.id) === 0) {
			errors.push(
				`gate_families.${family.id}: state "implemented" but no route claims coverage — dead configuration, delete the family or implement its target`,
			);
		}
	}

	const rows = entries.map((entry) => ({
		source: entry.source ?? '<missing>',
		path: entry.path ?? '<missing>',
		audience: entry.audience ?? '<missing>',
		addressable: entry.addressable !== false,
		sample_path: entry.sample_path ?? null,
		gates: gatesFor(entry, familyIds),
	}));

	return { errors, rows, families };
}

function gatesFor(entry, familyIds) {
	const gates = entry?.gates ?? {};
	return familyIds.map((id) => {
		const cell = gates[id];
		if (cell?.status === 'covered') {
			return { id, status: 'covered', detail: (cell.evidence ?? []).join(', ') };
		}
		return { id, status: 'excluded', detail: cell?.reason ?? '<unresolved>' };
	});
}

/**
 * Run the gate over a checkout.
 *
 * @returns {{ errors: string[], rows: Array<object>, families: Array<object>, manifest: object }}
 */
export function checkRouteQualityCoverage({
	root = REPO_ROOT,
	manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
	const absoluteManifest = resolve(root, manifestPath);
	if (!existsSync(absoluteManifest)) {
		return {
			errors: [`manifest: ${manifestPath} does not exist`],
			rows: [],
			families: [],
			manifest: null,
		};
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8'));
	} catch (error) {
		return {
			errors: [`manifest: ${manifestPath} is not valid JSON (${error.message})`],
			rows: [],
			families: [],
			manifest: null,
		};
	}

	const routes = deriveRoutesFromFiles({ root });
	if (routes.length === 0) {
		return {
			errors: [`routes: no route file with createFileRoute found under ${ROUTE_ROOT}/`],
			rows: [],
			families: [],
			manifest,
		};
	}

	const routeTreePath = join(root, ROUTE_TREE);
	const routeTreeIds = existsSync(routeTreePath)
		? parseRouteTreeIds(readFileSync(routeTreePath, 'utf8'))
		: [];

	const evidence = {};
	for (const entry of Array.isArray(manifest.routes) ? manifest.routes : []) {
		for (const cell of Object.values(entry?.gates ?? {})) {
			for (const evidencePath of cell?.evidence ?? []) {
				if (typeof evidencePath !== 'string' || evidence[evidencePath] !== undefined) continue;
				evidence[evidencePath] = readEvidenceText(root, evidencePath);
			}
		}
	}

	const { errors, rows, families } = evaluateCoverage({
		manifest,
		routes,
		routeTreeIds,
		evidence,
	});
	return { errors, rows, families, manifest };
}

function escapeHtml(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Render the coverage matrix as a static HTML report.
 *
 * Deterministic: the same working tree renders byte-identical HTML
 * except for the `source sha` line, so the committed screenshot can be
 * regenerated from a clean checkout without a browser or a network.
 */
export function renderReport({ manifest, routes, result, sourceSha }) {
	const families = result.families;
	const coveredCount = result.rows.reduce(
		(total, row) => total + row.gates.filter((gate) => gate.status === 'covered').length,
		0,
	);
	const totalCells = result.rows.length * families.length;
	const verdict = result.errors.length === 0 ? 'PASS' : 'FAIL';

	// Identical exclusion reasons are shared by many routes, so the
	// report numbers them once and prints the prose in a legend. The
	// screenshot stays readable instead of repeating 90-character
	// sentences in every cell.
	const reasonIds = new Map();
	const reasonList = [];
	for (const row of result.rows) {
		for (const gate of row.gates) {
			if (gate.status !== 'excluded' || reasonIds.has(gate.detail)) continue;
			reasonIds.set(gate.detail, `R${reasonList.length + 1}`);
			reasonList.push({ id: `R${reasonList.length + 1}`, reason: gate.detail });
		}
	}

	const familyHeaders = families
		.map(
			(family) =>
				`<th><code>${escapeHtml(family.id)}</code><div class="state">${escapeHtml(family.state)}</div></th>`,
		)
		.join('');

	const routeRows = result.rows
		.map((row) => {
			const cells = row.gates
				.map((gate) =>
					gate.status === 'covered'
						? `<td class="covered"><span class="mark">covered</span><div class="detail">${escapeHtml(gate.detail)}</div></td>`
						: `<td class="excluded"><span class="mark">excluded</span><div class="detail">${escapeHtml(reasonIds.get(gate.detail) ?? '—')}</div></td>`,
				)
				.join('');
			const probe = row.sample_path ?? row.path;
			return `<tr>
      <td class="route"><code>${escapeHtml(row.path)}</code><div class="probe">probe: <code>${escapeHtml(probe)}</code></div></td>
      <td class="meta"><code>${escapeHtml(row.source)}</code><div class="probe">${escapeHtml(row.audience)}${row.addressable ? '' : ' · layout (not addressable)'}</div></td>
      ${cells}
    </tr>`;
		})
		.join('\n');

	const familyList = families
		.map(
			(family) =>
				`<li><code>${escapeHtml(family.id)}</code> <span class="state">${escapeHtml(family.state)}</span> — ${escapeHtml(family.contract)}</li>`,
		)
		.join('\n');

	const reasonRows = reasonList
		.map(
			({ id, reason }) =>
				`<tr><td class="rid"><code>${escapeHtml(id)}</code></td><td>${escapeHtml(reason)}</td></tr>`,
		)
		.join('\n');

	const errorBlock =
		result.errors.length === 0
			? ''
			: `<h2>drift (${result.errors.length})</h2><ul class="errors">${result.errors
					.map((error) => `<li><code>${escapeHtml(error)}</code></li>`)
					.join('')}</ul>`;

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>public route × quality gate coverage — Issue #492</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #fbfbf9; color: #14140f;
         font: 13px/1.5 -apple-system, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.01em; }
  h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  .sub { margin: 0 0 16px; font-size: 12.5px; color: #3d3d33; max-width: 1100px; }
  .cards { display: flex; gap: 12px; margin-bottom: 8px; }
  .card { border: 1px solid #dedcd2; background: #fff; padding: 12px 16px; min-width: 130px; }
  .card .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #77776a; }
  .card .v { font-size: 24px; font-weight: 600; }
  .ok { color: #1c6b3a; }
  .ng { color: #a12020; }
  table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #dedcd2; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eceadf; vertical-align: top; }
  th { background: #f3f1e8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a4e; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  td.route { width: 190px; }
  td.meta { width: 230px; }
  .probe { font-size: 11px; color: #77776a; margin-top: 2px; }
  .state { font-size: 11px; color: #77776a; font-family: inherit; text-transform: none; letter-spacing: 0; }
  .mark { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  td.covered .mark { color: #1c6b3a; }
  td.excluded .mark { color: #8a6d1f; }
  .detail { font-size: 11px; color: #3d3d33; margin-top: 2px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 4px; }
  ul.errors li { color: #a12020; }
  footer { margin-top: 22px; color: #77776a; font-size: 12px; }
</style>
</head>
<body>
  <h1>public route × quality gate coverage</h1>
  <p class="sub">
    公開 route roster は <code>${ROUTE_ROOT}/**</code> の <code>createFileRoute</code> 呼び出しから一拍で取得し、
    品質ゲートの対象は <code>${DEFAULT_MANIFEST_PATH}</code>（schema v${escapeHtml(manifest?.version ?? '?')}）が 1 ソース。
    両者がずれたときだけ fail する coverage ledger であり、ゲート自体の実行（#384–#387）ではない。
  </p>

  <div class="cards">
    <div class="card"><div class="k">verdict</div><div class="v ${verdict === 'PASS' ? 'ok' : 'ng'}">${verdict}</div></div>
    <div class="card"><div class="k">routes</div><div class="v">${routes.length}</div></div>
    <div class="card"><div class="k">gate families</div><div class="v">${families.length}</div></div>
    <div class="card"><div class="k">cells</div><div class="v">${coveredCount}<span style="font-size:14px"> / ${totalCells}</span></div></div>
    <div class="card"><div class="k">source sha</div><div class="v" style="font-size:15px">${escapeHtml(sourceSha)}</div></div>
  </div>

  <h2>gate families</h2>
  <ul>
${familyList}
  </ul>

  <h2>route × gate</h2>
  <table>
    <thead><tr><th>route</th><th>source / audience</th>${familyHeaders}</tr></thead>
    <tbody>
${routeRows}
    </tbody>
  </table>

  <h2>除外理由 (exclusion reasons)</h2>
  <table>
    <thead><tr><th style="width:44px">id</th><th>reason — 同じ文言は route 間で共有される</th></tr></thead>
    <tbody>
${reasonRows}
    </tbody>
  </table>

  ${errorBlock}

  <footer>
    my-web-2026 · Issue #492 · regenerate with <code>pnpm run routes:quality:report</code> ·
    rendered from the working tree only (no browser, no network, no Worker, no secret) ·
    committed as <code>docs/verification/quality/route-quality-coverage.webp</code>.
  </footer>
</body>
</html>
`;
}

function headSha(root) {
	try {
		return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
	} catch {
		return 'unknown';
	}
}

function parseArg(argv, name) {
	for (const arg of argv) {
		if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
	}
	return null;
}

function main(argv) {
	const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : REPO_ROOT);
	const manifestPath = parseArg(argv, '--manifest') ?? DEFAULT_MANIFEST_PATH;
	const reportPath = parseArg(argv, '--report');

	const result = checkRouteQualityCoverage({ root, manifestPath });
	const routes = deriveRoutesFromFiles({ root });

	if (reportPath) {
		const html = renderReport({
			manifest: result.manifest,
			routes,
			result,
			sourceSha: headSha(root),
		});
		writeFileSync(resolve(root, reportPath), html);
		process.stdout.write(`wrote ${reportPath}\n`);
	}

	if (result.errors.length === 0) {
		const covered = result.rows.reduce(
			(total, row) => total + row.gates.filter((gate) => gate.status === 'covered').length,
			0,
		);
		process.stdout.write(
			`route quality coverage OK: ${routes.length} published routes, ${result.families.length} gate families, ${covered} covered cell(s)\n`,
		);
		return 0;
	}

	process.stderr.write(
		`route quality coverage: ${result.errors.length} problem(s) in ${manifestPath} / ${ROUTE_TREE}:\n`,
	);
	for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
	process.stderr.write(
		[
			'',
			'Every published route needs a decision: cover it with evidence, or exclude it with a reason.',
			`Add the route to ${manifestPath}, or record why it is not a target. A new route file with no`,
			'entry fails this gate on purpose — see docs/verification/quality/route-quality-coverage.md.',
			'',
		].join('\n'),
	);
	return 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
	process.exit(main(process.argv.slice(2)));
}
