#!/usr/bin/env node
/**
 * Human-readable SBOM inspection report (Issue #471 — supply chain).
 *
 * The Issue requires the PR screenshot to come from a publishable
 * inspection report rather than from hand-edited mock output, so this
 * renders a self-contained HTML summary **from the generated SBOM**.
 * The report contains no credential, no environment value and no
 * `.dev.vars` content: every figure below is derived from the same
 * tracked files the SBOM itself is derived from, which is exactly why
 * the report is safe to publish in a public PR.
 *
 * What it shows:
 *   - the build identity (spec version, serial, source digests),
 *   - inventory counts by scope and by declared license,
 *   - the direct dependency table with exact pinned versions,
 *   - the Tool Registry artifacts with their pinned commit SHAs,
 *   - the license-resolution split, so "not installed on this platform"
 *     is never confused with "upstream declares no license".
 *
 * Usage:
 *   node scripts/render-sbom-report.mjs [--out=<path>] [--open]
 *
 * Default output: `.tmp/sbom-report.html` (gitignored scratch space).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSbom, identityKey } from './generate-sbom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export const DEFAULT_REPORT_PATH = '.tmp/sbom-report.html';

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function propertyValue(component, name) {
	return component.properties?.find((p) => p.name === name)?.value ?? '';
}

/** Aggregate the report model from an SBOM document. */
export function buildReportModel(bom) {
	const components = bom.components ?? [];
	const npm = components.filter((c) => c.purl?.startsWith('pkg:npm/'));
	const tools = components.filter((c) => c.purl?.startsWith('pkg:generic/my-web-2026-tool/'));
	const direct = npm.filter(
		(c) => propertyValue(c, 'my-web-2026:dependency-group') !== 'transitive',
	);
	const byScope = {};
	for (const component of npm) {
		const scope = component.scope ?? 'unspecified';
		byScope[scope] = (byScope[scope] ?? 0) + 1;
	}
	const byLicense = new Map();
	for (const component of components) {
		const license = component.licenses?.[0]?.license?.name ?? 'NOASSERTION';
		byLicense.set(license, (byLicense.get(license) ?? 0) + 1);
	}
	const licenseResolution = {};
	for (const component of npm) {
		const state = propertyValue(component, 'my-web-2026:license-resolution') || 'unknown';
		licenseResolution[state] = (licenseResolution[state] ?? 0) + 1;
	}
	const patched = npm.filter((c) => propertyValue(c, 'my-web-2026:patched') === 'true');
	const deprecated = npm.filter((c) => c.deprecated);
	return {
		specVersion: bom.specVersion,
		bomFormat: bom.bomFormat,
		serialNumber: bom.serialNumber,
		timestamp: bom.metadata?.timestamp,
		root: bom.metadata?.component ?? {},
		properties: bom.metadata?.properties ?? [],
		counts: {
			total: components.length,
			npm: npm.length,
			tools: tools.length,
			direct: direct.length,
			edges: (bom.dependencies ?? []).reduce((sum, d) => sum + (d.dependsOn?.length ?? 0), 0),
		},
		byScope,
		byLicense: [...byLicense.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
		licenseResolution,
		patched: patched.map((c) => `${c.name}@${c.version}`),
		deprecated: deprecated.map((c) => `${c.name}@${c.version}`),
		direct: direct
			.map((c) => ({
				name: c.name,
				version: c.version,
				group: propertyValue(c, 'my-web-2026:dependency-group'),
				license: c.licenses?.[0]?.license?.name ?? 'NOASSERTION',
				integrity: c.hashes?.[0]?.content ?? '—',
			}))
			.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
		tools: tools
			.map((c) => ({
				slug: c.name,
				sha: c.version,
				repo: c.externalReferences?.find((r) => r.type === 'vcs')?.url ?? '',
				delivery: propertyValue(c, 'my-web-2026:tool-delivery-kind'),
				license: c.licenses?.[0]?.license?.name ?? 'NOASSERTION',
			}))
			.sort((a, b) => a.slug.localeCompare(b.slug)),
	};
}

function countTable(title, rows) {
	if (rows.length === 0) return '';
	const max = Math.max(...rows.map(([, value]) => value));
	return `
      <section class="card">
        <h2>${escapeHtml(title)}</h2>
        <table>
          <thead><tr><th>value</th><th>components</th><th>share</th></tr></thead>
          <tbody>
            ${rows
							.map(
								([label, value]) => `
              <tr>
                <td class="mono">${escapeHtml(label)}</td>
                <td class="num">${value}</td>
                <td><span class="bar" style="width: ${Math.round((value / max) * 100)}%"></span></td>
              </tr>`,
							)
							.join('')}
          </tbody>
        </table>
      </section>`;
}

/** Render the standalone HTML report. */
export function renderReport(bom, model = buildReportModel(bom)) {
	const scopeRows = Object.entries(model.byScope).sort((a, b) => b[1] - a[1]);
	const licenseRows = model.byLicense.slice(0, 12);
	const provenance =
		model.properties.find((p) => p.name === 'my-web-2026:source-digests')?.value ?? '';
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>my-web-2026 supply-chain SBOM report</title>
    <style>
      :root {
        color-scheme: light dark;
        --ink: #16181d;
        --muted: #5b6472;
        --line: #d7dbe2;
        --paper: #fbfbfd;
        --card: #ffffff;
        --accent: #2f5bd7;
      }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #e8eaee; --muted: #9aa4b2; --line: #2c313a; --paper: #101216; --card: #171a1f; --accent: #7fa0ff; }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 40px; background: var(--paper); color: var(--ink);
        font: 14px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      }
      main { max-width: 1080px; margin: 0 auto; }
      h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
      h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 12px; }
      .lede { color: var(--muted); margin: 0 0 24px; }
      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
      .stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
      .stat b { display: block; font-size: 24px; letter-spacing: -0.02em; }
      .stat span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-bottom: 1px solid var(--line); padding: 6px 8px; }
      td { padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, var(--line) 45%, transparent); }
      tr:last-child td { border-bottom: none; }
      .mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 12px; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .bar { display: inline-block; height: 8px; border-radius: 4px; background: var(--accent); min-width: 2px; }
      .hash { color: var(--muted); }
      .badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; font-size: 11px; color: var(--muted); }
      footer { color: var(--muted); font-size: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1>my-web-2026 — CycloneDX ${escapeHtml(model.specVersion)} supply-chain report</h1>
      <p class="lede">
        Generated by <span class="mono">scripts/render-sbom-report.mjs</span> from
        <span class="mono">pnpm run sbom:build</span> output. Every value below is derived from
        tracked repository files (<span class="mono">pnpm-lock.yaml</span>,
        <span class="mono">package.json</span>, <span class="mono">pnpm-workspace.yaml</span>,
        <span class="mono">src/tools/manifest.json</span>) — no credential, environment variable or
        <span class="mono">.dev.vars</span> value is read.
      </p>

      <div class="grid">
        <div class="stat"><b>${model.counts.total}</b><span>components</span></div>
        <div class="stat"><b>${model.counts.npm}</b><span>npm packages</span></div>
        <div class="stat"><b>${model.counts.tools}</b><span>tool artifacts</span></div>
        <div class="stat"><b>${model.counts.edges}</b><span>dependency edges</span></div>
      </div>

      <section class="card">
        <h2>Build identity</h2>
        <table>
          <tbody>
            <tr><td>root component</td><td class="mono">${escapeHtml(model.root.name ?? '')}@${escapeHtml(model.root.version ?? '')}</td></tr>
            <tr><td>format</td><td class="mono">${escapeHtml(model.bomFormat)} ${escapeHtml(model.specVersion)}</td></tr>
            <tr><td>serial number</td><td class="mono">${escapeHtml(model.serialNumber ?? '')}</td></tr>
            <tr><td>timestamp</td><td class="mono">${escapeHtml(model.timestamp ?? '')}</td></tr>
            <tr><td>input digests</td><td class="mono hash">${escapeHtml(provenance)}</td></tr>
          </tbody>
        </table>
      </section>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        ${countTable('Components by CycloneDX scope', scopeRows)}
        ${countTable(`Licenses (top ${licenseRows.length} of ${model.byLicense.length})`, licenseRows)}
      </div>

      <section class="card">
        <h2>License resolution — declared vs. not installed</h2>
        <p class="lede">
          A platform-specific optional binary (a Windows Rollup shim while generating on
          darwin-arm64) is reported as <span class="badge">not-installed</span>, not as an unknown
          license. Only <span class="badge">undeclared</span> means upstream ships no
          <span class="mono">license</span> field at all.
        </p>
        <table>
          <tbody>
            ${Object.entries(model.licenseResolution)
							.sort()
							.map(
								([state, count]) =>
									`<tr><td>${escapeHtml(state)}</td><td class="num">${count}</td></tr>`,
							)
							.join('')}
          </tbody>
        </table>
        ${
					model.patched.length === 0
						? ''
						: `<p class="lede">Patched via <span class="mono">pnpm patchedDependencies</span>: ${model.patched
								.map((p) => `<span class="badge">${escapeHtml(p)}</span>`)
								.join(' ')}</p>`
				}
        ${
					model.deprecated.length === 0
						? ''
						: `<p class="lede">Deprecated upstream: ${model.deprecated
								.slice(0, 10)
								.map((p) => `<span class="badge">${escapeHtml(p)}</span>`)
								.join(
									' ',
								)}${model.deprecated.length > 10 ? ` +${model.deprecated.length - 10} more` : ''}</p>`
				}
      </section>

      <section class="card">
        <h2>Direct dependencies (${model.direct.length})</h2>
        <table>
          <thead>
            <tr><th>package</th><th>pinned version</th><th>group</th><th>license</th><th>SHA-512</th></tr>
          </thead>
          <tbody>
            ${model.direct
							.map(
								(dep) => `
              <tr>
                <td class="mono">${escapeHtml(dep.name)}</td>
                <td class="mono">${escapeHtml(dep.version)}</td>
                <td>${escapeHtml(dep.group)}</td>
                <td class="mono">${escapeHtml(dep.license)}</td>
                <td class="mono hash">${escapeHtml(dep.integrity.slice(0, 24))}…</td>
              </tr>`,
							)
							.join('')}
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Tool Registry artifacts (${model.tools.length})</h2>
        <table>
          <thead>
            <tr><th>slug</th><th>pinned commit SHA</th><th>delivery</th><th>license</th><th>canonical repo</th></tr>
          </thead>
          <tbody>
            ${model.tools
							.map(
								(tool) => `
              <tr>
                <td class="mono">${escapeHtml(tool.slug)}</td>
                <td class="mono">${escapeHtml(tool.sha.slice(0, 12))}…</td>
                <td>${escapeHtml(tool.delivery)}</td>
                <td class="mono">${escapeHtml(tool.license)}</td>
                <td class="mono hash">${escapeHtml(tool.repo.replace(/^https:\/\/github\.com\//, ''))}</td>
              </tr>`,
							)
							.join('')}
          </tbody>
        </table>
      </section>

      <footer>
        Verification gate: <span class="mono">pnpm run sbom:check</span> fails closed when this
        inventory drifts from the lockfile, when a declared digest stops matching
        <span class="mono">pnpm-lock.yaml</span>, or when secret-shaped content or a declared
        runtime-secret name appears in the document. Normal / abnormal observation and remediation
        are recorded in <span class="mono">docs/runbook/sbom.md</span>.
      </footer>
    </main>
  </body>
</html>
`;
}

function parseArg(argv, name) {
	const prefix = `--${name}=`;
	const found = argv.find((value) => value.startsWith(prefix));
	return found ? found.slice(prefix.length) : null;
}

function main() {
	const argv = process.argv.slice(2);
	const out = parseArg(argv, 'out') ?? DEFAULT_REPORT_PATH;
	const { bom } = generateSbom();
	const target = resolve(repoRoot, out);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, renderReport(bom), 'utf8');
	console.log(`[render-sbom-report] OK: ${bom.components.length} components -> ${out}`);
}

// ESM main-module guard: importing this file for testing must not run
// the CLI (same pattern as scripts/check-release-assets.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (error) {
		console.error(`[render-sbom-report] FAIL: ${error.message}`);
		process.exit(1);
	}
}

// `identityKey` is re-exported so report consumers can join a report
// row back to a lockfile identity without importing the generator.
export { identityKey };
