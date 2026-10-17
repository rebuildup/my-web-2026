import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findSecretLikeFindings, readInputs, readRequiredSecretNames } from './check-sbom.mjs';
import { generateSbom } from './generate-sbom.mjs';
import { buildReportModel, identityKey, renderReport } from './render-sbom-report.mjs';

const inputs = readInputs();
const { bom } = generateSbom();
const model = buildReportModel(bom);
const toolsManifest = JSON.parse(inputs.toolsManifestText);

describe('render-sbom-report — report model', () => {
	it('counts npm components, Tool artifacts and dependency edges', () => {
		assert.equal(model.counts.npm + model.counts.tools, model.counts.total);
		assert.ok(model.counts.npm > 0);
		assert.equal(model.counts.tools, toolsManifest.tools.length);
		assert.ok(model.counts.edges > model.counts.npm);
	});

	it('separates direct dependencies from transitive ones', () => {
		assert.ok(model.direct.length > 0);
		assert.ok(model.direct.length < model.counts.npm);
		for (const dep of model.direct) {
			assert.notEqual(dep.group, 'transitive');
			assert.ok(dep.version.length > 0);
		}
	});

	it('sorts direct dependencies by group then name', () => {
		const keys = model.direct.map((d) => `${d.group}/${d.name}`);
		assert.deepEqual(keys, [...keys].sort());
	});

	it('lists every Tool Registry artifact with its pinned SHA', () => {
		assert.equal(model.tools.length, toolsManifest.tools.length);
		for (const tool of toolsManifest.tools) {
			const row = model.tools.find((t) => t.slug === tool.slug);
			assert.ok(row, `missing tool row for ${tool.slug}`);
			assert.equal(row.sha, tool.source.pinned_sha);
			assert.equal(row.repo, tool.source.canonical_repo);
			assert.equal(row.delivery, tool.delivery.kind);
		}
	});

	it('separates not-installed licenses from undeclared ones', () => {
		assert.ok(model.licenseResolution['not-installed'] > 0);
		assert.equal(
			model.licenseResolution['not-installed'] +
				(model.licenseResolution.declared ?? 0) +
				(model.licenseResolution.undeclared ?? 0),
			model.counts.npm,
		);
	});

	it('records the patched dependency declared in pnpm-workspace.yaml', () => {
		assert.deepEqual(model.patched, ['cf@1.0.0-beta.12']);
	});
});

describe('render-sbom-report — rendered HTML', () => {
	const html = renderReport(bom, model);

	it('is a self-contained document with no external asset reference', () => {
		assert.match(html, /^<!doctype html>/);
		assert.equal(/<script\b/i.test(html), false);
		assert.equal(/<(link|img)\b[^>]*\b(src|href)=["']https?:/i.test(html), false);
	});

	it('shows the build identity and the inventory headline', () => {
		assert.ok(html.includes(model.serialNumber));
		assert.ok(html.includes(`CycloneDX ${model.specVersion}`));
		assert.ok(html.includes(String(model.counts.total)));
		assert.ok(
			html.includes('my-web-2026:source-digests') === false,
			'property names stay internal',
		);
		assert.ok(html.includes('pnpm-lock.yaml=sha256:'));
	});

	it('renders every direct dependency row and every Tool row', () => {
		for (const dep of model.direct) {
			assert.ok(html.includes(dep.name), `missing row for ${dep.name}`);
		}
		for (const tool of model.tools) {
			assert.ok(html.includes(tool.slug), `missing row for ${tool.slug}`);
		}
	});

	it('publishes neither a credential shape nor a declared runtime secret name', () => {
		assert.deepEqual(findSecretLikeFindings(html, { secretNames: [] }), []);
		const findings = findSecretLikeFindings(html, {
			secretNames: readRequiredSecretNames(inputs.wranglerText),
		});
		assert.deepEqual(findings, [], findings.map((f) => f.detail).join('; '));
	});

	it('escapes hostile component content so the report cannot inject markup', () => {
		const hostile = structuredClone(bom);
		const target = hostile.components.find((c) =>
			(c.properties ?? []).some((p) => p.value === 'dependencies'),
		);
		target.name = '<script>alert(1)</script>';
		const rendered = renderReport(hostile);
		assert.equal(rendered.includes('<script>alert(1)</script>'), false);
		assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
	});
});

describe('render-sbom-report — helpers', () => {
	it('re-exports the lockfile identity helper', () => {
		assert.equal(identityKey('hono', '4.13.7'), 'hono@4.13.7');
	});
});
