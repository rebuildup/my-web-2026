import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SECRET_NAMES, findSecretLikeFindings, readInputs } from './check-sbom.mjs';
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
		const findings = findSecretLikeFindings(html, { secretNames: SECRET_NAMES });
		assert.deepEqual(findings, [], findings.map((f) => f.detail).join('; '));
	});

	it('escapes hostile component content so the report cannot inject markup', () => {
		// A hand-built fixture, not the real lockfile: this assertion is
		// about escaping, so it must not depend on a live component
		// staying present in the repository's dependency set.
		const hostile = {
			bomFormat: 'CycloneDX',
			specVersion: '1.6',
			serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000000',
			metadata: {
				timestamp: '2026-01-01T00:00:00.000Z',
				component: { type: 'application', name: 'my-web-2026', version: '9.9.9' },
				properties: [],
			},
			components: [
				{
					'bom-ref': 'pkg:npm/left-pad@1.3.0',
					type: 'library',
					name: 'left-pad',
					version: '1.3.0',
					purl: 'pkg:npm/left-pad@1.3.0',
					licenses: [{ license: { name: 'MIT' } }],
					properties: [{ name: 'my-web-2026:dependency-group', value: 'dependencies' }],
				},
			],
			dependencies: [],
		};
		hostile.components[0].name = '<script>alert(1)</script>';
		const rendered = renderReport(hostile);
		assert.equal(rendered.includes('<script>alert(1)</script>'), false);
		assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
	});

	it('reads the deprecation flag back from the namespaced property', () => {
		// CycloneDX 1.6 has no `component.deprecated`, so the generator
		// writes `my-web-2026:deprecated`; the report must read that, or
		// the "Deprecated upstream" card would silently disappear.
		const fixture = structuredClone(bom);
		assert.equal(
			fixture.components.some((c) => 'deprecated' in c),
			false,
			'no CycloneDX 1.6 component may carry a deprecated field',
		);
		for (const component of fixture.components) {
			component.properties = (component.properties ?? []).filter(
				(p) => p.name !== 'my-web-2026:deprecated',
			);
		}
		const target = fixture.components.find((c) => c.name === 'glob');
		assert.ok(target, 'fixture must contain a package deprecated upstream');
		target.properties.push({ name: 'my-web-2026:deprecated', value: 'true' });
		const fixtureModel = buildReportModel(fixture);
		assert.deepEqual(fixtureModel.deprecated, ['glob@10.5.0']);
		assert.ok(
			renderReport(fixture, fixtureModel).includes(
				'Deprecated upstream: <span class="badge">glob@10.5.0</span>',
			),
		);
	});
});

describe('render-sbom-report — helpers', () => {
	it('re-exports the lockfile identity helper', () => {
		assert.equal(identityKey('hono', '4.13.7'), 'hono@4.13.7');
	});
});
