import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	ROUTE_DIR_INERT_FILES,
	SNAPSHOT_SCHEMA,
	SURFACE_DECLARATIONS,
	assertRouteCoverage,
	buildSurface,
	canonicalOriginFromSource,
	classifyUrl,
	diffSurfaces,
	extractExternalBoundaryPrefixes,
	extractIntegratedToolSlugs,
	extractPortfolioSeedSlugs,
	extractUrlLiterals,
	firstPartyDomainOf,
	invariantFindings,
	isPrivateHost,
	normalizeUrl,
	parseSnapshot,
	renderHtmlReport,
	renderMarkdownReport,
	sameOriginStaticToolSubmodules,
	serializeSnapshot,
	serializeSurfaceCore,
	staticAssetPublicPaths,
	stripComments,
	transitionOf,
	verdictOf,
} from './publication-surface.mjs';

/**
 * Publication surface contract tests (Issue #505).
 *
 * Every case runs on an independent fixture — never on the live
 * repository — so the contract is provable without a Worker, without
 * a build, and without the source tree staying put. The live tree
 * is exercised by `pnpm run publication:check` itself.
 *
 * Fixture origins use example.test hosts and non-`0.x.y` version
 * shapes so scripts/check-release-version.mjs never flags this file.
 */

const ORIGIN = 'https://rebuildup.test';
const CTX = { origin: ORIGIN, firstPartyDomain: firstPartyDomainOf(ORIGIN) };

const routeFiles = SURFACE_DECLARATIONS.flatMap((declaration) => declaration.files).sort();

const sourceFixture = (text, path = 'src/fixture.ts') => [{ path, text }];

describe('publication-surface — canonical origin derivation', () => {
	it('reads the origin out of the constant that already owns it', () => {
		const source = [
			'/** Canonical production origin for JSON-LD. */',
			"export const BREADCRUMB_ORIGIN = 'https://example.test' as const;",
		].join('\n');
		assert.equal(canonicalOriginFromSource(source), 'https://example.test');
	});

	it('tolerates an explicit type annotation on the constant', () => {
		const source = 'export const BREADCRUMB_ORIGIN: string = "https://typed.test";';
		assert.equal(canonicalOriginFromSource(source), 'https://typed.test');
	});

	it('throws instead of guessing when the constant is absent', () => {
		assert.throws(() => canonicalOriginFromSource('export const OTHER = 1;'));
	});

	it('derives the first-party domain from the origin, not from a literal', () => {
		assert.equal(firstPartyDomainOf('https://rebuildup.dev'), 'rebuildup.dev');
		assert.equal(firstPartyDomainOf('https://rebuildup.dev'), 'rebuildup.dev');
		assert.equal(firstPartyDomainOf('https://build.internal.test'), 'internal.test');
	});
});

describe('publication-surface — comment stripping', () => {
	it('drops line and block comments', () => {
		assert.equal(stripComments('a // gone\nb'), 'a \nb');
		assert.equal(stripComments('a /* gone */ b'), 'a  b');
	});

	it('keeps // inside a string literal', () => {
		assert.equal(stripComments('const u = "https://kept.test";'), 'const u = "https://kept.test";');
	});

	it('keeps a bare URL in JSX-style text outside quotes', () => {
		assert.match(stripComments('<a>https://kept.test</a>'), /https:\/\/kept\.test/);
	});

	it('recovers from an unterminated apostrophe instead of swallowing the file', () => {
		const out = stripComments("don't panic; const u = 'https://kept.test';");
		assert.match(out, /https:\/\/kept\.test/);
	});
});

describe('publication-surface — URL literal extraction', () => {
	it('finds quoted, bare and templated URLs', () => {
		const text = [
			'const a = "https://one.test/a";',
			'<a href="https://two.test/b">two</a>',
			'<p>three https://three.test/c。</p>',
			'const d = `${BASE}/x`;',
			"const e = 'https://four.test/${slug}';",
		].join('\n');
		assert.deepEqual(extractUrlLiterals(text), [
			'https://four.test',
			'https://one.test/a',
			'https://three.test/c',
			'https://two.test/b',
		]);
	});

	it('ignores URLs that only appear in comments', () => {
		const text = ['// see https://commented.test/a', 'const b = "https://live.test/b";'].join('\n');
		assert.deepEqual(extractUrlLiterals(text), ['https://live.test/b']);
	});

	it('deduplicates a trailing-slash variant of the same URL', () => {
		assert.deepEqual(extractUrlLiterals('"https://dup.test/" "https://dup.test"'), [
			'https://dup.test',
		]);
	});

	it('drops trailing prose punctuation', () => {
		assert.deepEqual(extractUrlLiterals('x: https://tail.test/path.'), ['https://tail.test/path']);
	});

	it('is empty for source without absolute URLs', () => {
		assert.deepEqual(extractUrlLiterals('const a = 1;'), []);
	});
});

describe('publication-surface — URL normalisation and classification', () => {
	it('lower-cases scheme and host but keeps the path case', () => {
		assert.equal(normalizeUrl('HTTPS://Host.TEST/Path'), 'https://host.test/Path');
	});

	it('drops a bare trailing slash', () => {
		assert.equal(normalizeUrl('https://host.test/'), 'https://host.test');
	});

	it('cuts a template literal at the interpolation marker', () => {
		assert.equal(normalizeUrl('https://host.test/p/${slug}'), 'https://host.test/p');
	});

	it('separates the canonical origin from first-party infrastructure', () => {
		assert.equal(classifyUrl('https://rebuildup.test/about', CTX).kind, 'origin');
		assert.equal(classifyUrl('https://media.rebuildup.test/x.jpg', CTX).kind, 'first-party');
		assert.equal(classifyUrl('https://elsewhere.test/x', CTX).kind, 'external');
	});

	it('flags a credential-bearing URL', () => {
		const entry = classifyUrl('https://user:pass@leaky.test/x', CTX);
		assert.equal(entry.userinfo, true);
	});

	it('flags loopback hosts', () => {
		assert.equal(classifyUrl('http://127.0.0.1:3000/x', CTX).privateHost, true);
		assert.equal(classifyUrl('http://localhost:8787/x', CTX).privateHost, true);
		assert.equal(classifyUrl('http://localhost./x', CTX).privateHost, true);
	});

	it('flags RFC 1918, CGNAT and link-local hosts over https', () => {
		for (const host of [
			'10.0.0.5',
			'172.16.0.9',
			'192.168.1.10',
			'169.254.169.254',
			'100.64.0.1',
		]) {
			assert.equal(classifyUrl(`https://${host}/x`, CTX).privateHost, true, host);
		}
	});

	it('flags site-local suffixes and the Docker host alias', () => {
		for (const host of ['printer.local', 'db.internal', 'host.docker.internal', 'box.home.arpa']) {
			assert.equal(classifyUrl(`https://${host}/x`, CTX).privateHost, true, host);
		}
	});

	it('flags unique-local and link-local IPv6', () => {
		assert.equal(classifyUrl('https://[fd00::1]/x', CTX).privateHost, true);
		assert.equal(classifyUrl('https://[fe80::1]/x', CTX).privateHost, true);
		assert.equal(classifyUrl('https://[::1]:8787/x', CTX).privateHost, true);
	});

	it('reduces IPv4-mapped IPv6 and trailing-dot hostnames before the check', () => {
		for (const host of [
			'[::ffff:169.254.169.254]',
			'[::ffff:a9fe:a9fe]',
			'::ffff:127.0.0.1',
			'127.0.0.1.',
			'localhost.',
		]) {
			assert.equal(isPrivateHost(host), true, host);
		}
		assert.equal(isPrivateHost('[::ffff:8.8.8.8]'), false);
	});

	it('does not flag a routable address or host', () => {
		for (const host of ['8.8.8.8', '1.1.1.1', 'cdn.test', 'rebuildup.dev', '[2606:4700::1111]']) {
			assert.equal(isPrivateHost(host), false, host);
		}
	});

	it('flags http on a dereferenced external host but not on an identifier namespace', () => {
		assert.equal(classifyUrl('http://cdn.test/a.js', CTX).insecure, true);
		assert.equal(classifyUrl('http://schema.org', CTX).insecure, false);
		assert.equal(classifyUrl('http://www.w3.org/2000/svg', CTX).insecure, false);
		assert.equal(classifyUrl('https://cdn.test/a.js', CTX).insecure, false);
	});
});

describe('publication-surface — dynamic expansion inputs', () => {
	it('extracts seed slugs from quoted entries only', () => {
		const source = [
			'export interface PortfolioSeedEntry {',
			'\tslug: string;',
			'}',
			"export const PORTFOLIO_SEED = [{ slug: 'beta' }, { slug: 'alpha' }, { slug: 'beta' }];",
		].join('\n');
		assert.deepEqual(extractPortfolioSeedSlugs(source), ['alpha', 'beta']);
	});

	it('expands only tools with an embeddable delivery kind', () => {
		const manifest = {
			tools: [
				{ slug: 'live', delivery: { kind: 'same_origin_static' } },
				{ slug: 'later', delivery: { kind: 'host_disabled' } },
				{ slug: 'foreign', delivery: { kind: 'external_exception' } },
				{ slug: 'unintegrated', delivery: { kind: 'not_integrable_yet' } },
			],
		};
		assert.deepEqual(extractIntegratedToolSlugs(manifest), ['foreign', 'live']);
	});

	it('tolerates a manifest without a tools array', () => {
		assert.deepEqual(extractIntegratedToolSlugs({}), []);
	});

	it('reads the external HTTP boundary prefixes out of the worker entry point', () => {
		const source = [
			'const EXTERNAL_BOUNDARY_PREFIXES = [',
			"\t'/api/v1',",
			"\t'/webhooks',",
			'] as const;',
		].join('\n');
		assert.deepEqual(extractExternalBoundaryPrefixes(source), ['/api/v1', '/webhooks']);
	});

	it('lists only the Tool checkouts this origin serves', () => {
		const manifest = {
			tools: [
				{
					slug: 'live',
					delivery: { kind: 'same_origin_static' },
					source: { submodule_path: 'external/live', pinned_sha: 'abc' },
				},
				{ slug: 'disabled', delivery: { kind: 'host_disabled' }, source: {} },
				{ slug: 'foreign', delivery: { kind: 'external_exception' }, source: {} },
			],
		};
		assert.deepEqual(sameOriginStaticToolSubmodules(manifest), [
			{ slug: 'live', submodulePath: 'external/live', pinnedSha: 'abc' },
		]);
	});
});

describe('publication-surface — Static Assets public pages', () => {
	it('maps served HTML paths, not file paths', () => {
		const paths = staticAssetPublicPaths([
			'public/_headers',
			'public/favicon.svg',
			'public/index.html',
			'public/share/procon2026/index.html',
			'public/legal/terms.html',
		]);
		assert.deepEqual(paths, ['/', '/legal/terms.html', '/share/procon2026/']);
	});

	it('ignores non-HTML assets and paths outside the served namespace', () => {
		assert.deepEqual(staticAssetPublicPaths(['public/robots.txt', 'src/routes/index.tsx']), []);
	});
});

describe('publication-surface — route coverage contract', () => {
	it('accepts a route tree that matches the declarations', () => {
		assert.deepEqual(assertRouteCoverage(routeFiles).findings, []);
	});

	it('rejects an undeclared route file', () => {
		const result = assertRouteCoverage([...routeFiles, 'src/routes/secret.tsx']);
		assert.equal(result.ok, false);
		assert.equal(result.findings[0].code, 'E005 undeclared-route-file');
	});

	it('rejects a declaration whose file is gone', () => {
		const missing = routeFiles.filter((file) => file !== 'src/routes/contact.tsx');
		const result = assertRouteCoverage(missing);
		assert.equal(result.ok, false);
		assert.equal(result.findings[0].code, 'E006 orphan-surface-declaration');
	});

	it('does not require the inert route-directory files to be declared', () => {
		const withInert = [...routeFiles, ...ROUTE_DIR_INERT_FILES];
		assert.deepEqual(assertRouteCoverage(withInert).findings, []);
	});
});

describe('publication-surface — surface construction', () => {
	const surface = buildSurface({
		routeFiles,
		sourceFiles: sourceFixture(
			[
				'const home = "https://rebuildup.test/";',
				'const media = "https://media.rebuildup.test/a.jpg";',
				'const cdn = "https://cdn.test/lib.js";',
				'const ns = "http://schema.org";',
			].join('\n'),
		),
		publicFiles: ['public/share/briefing/index.html'],
		toolSourceFiles: [
			{ path: 'external/live/index.html', text: '<link href="https://fonts.test/css" />' },
		],
		origin: ORIGIN,
		portfolioSeedSource: "export const PORTFOLIO_SEED = [{ slug: 'alpha' }, { slug: 'beta' }];",
		toolsManifest: {
			tools: [
				{ slug: 'live', delivery: { kind: 'same_origin_static' } },
				{ slug: 'later', delivery: { kind: 'host_disabled' } },
			],
		},
		workerEntrySource: "const EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1', '/webhooks'] as const;",
	});

	it('expands only the sitemap-true declarations into the sitemap list', () => {
		assert.ok(surface.sitemap.includes('/portfolio/alpha'));
		assert.ok(surface.sitemap.includes('/portfolio/beta'));
		// Issue #734: the Tool shell declares `robots: noindex` in its own
		// head, so the sitemap membership rule (b) keeps the tool pages
		// out of the document even though they are publicly reachable.
		assert.ok(!surface.sitemap.includes('/tools/live'));
		assert.ok(!surface.sitemap.includes('/tools/later'));
	});

	it('keeps a publicly reachable but non-sitemap surface off the sitemap list', () => {
		assert.ok(
			surface.surfaces.some((s) => s.id === '/admin/login' && s.classification === 'public'),
		);
		assert.ok(!surface.sitemap.includes('/admin/login'));
		// Issue #734: `/design-system` is public, indexable and nav-linked,
		// so it satisfies the same membership rule the sitemap generator
		// applies and IS a sitemap target.
		assert.ok(surface.sitemap.includes('/design-system'));
	});

	it('compares every reachable URL, not only the sitemap targets', () => {
		// 6 static sitemap surfaces + 2 portfolio slugs. The integrated
		// tool page is reachable but not a sitemap target (Issue #734).
		assert.equal(surface.sitemap.length, 8);
		for (const url of ['/admin/login', '/admin/invitations/accept', '/design-system']) {
			assert.ok(surface.publicUrls.includes(url), url);
		}
		assert.ok(surface.publicUrls.includes('/tools/live'));
		assert.ok(!surface.publicUrls.includes('/admin/keys'));
	});

	it('counts a Static Assets page as a public URL', () => {
		assert.deepEqual(surface.staticAssetPages, ['/share/briefing/']);
		assert.ok(surface.publicUrls.includes('/share/briefing/'));
		assert.ok(!surface.sitemap.includes('/share/briefing/'));
	});

	it('audits the URLs a Tool ships into its iframe', () => {
		assert.deepEqual(surface.externalHosts, ['cdn.test', 'fonts.test', 'schema.org']);
		assert.deepEqual(surface.externalUrls.find((e) => e.host === 'fonts.test').files, [
			'external/live/index.html',
		]);
	});

	it('records every declared URL exactly once', () => {
		const flattened = surface.surfaces.filter((s) => s.sitemap).flatMap((s) => s.urls);
		assert.equal(new Set(flattened).size, flattened.length);
	});

	it('splits hosts into first-party, external and origin', () => {
		assert.deepEqual(surface.externalHosts, ['cdn.test', 'fonts.test', 'schema.org']);
		assert.deepEqual(surface.firstPartyHosts, ['media.rebuildup.test']);
		assert.ok(surface.externalUrls.some((e) => e.kind === 'origin'));
	});

	it('carries the external HTTP boundary prefixes through', () => {
		assert.deepEqual(surface.externalBoundaryPrefixes, ['/api/v1', '/webhooks']);
	});

	it('records no coverage findings for a matching route tree', () => {
		assert.deepEqual(invariantFindings(surface), []);
	});
});

describe('publication-surface — unauditable Tool checkout', () => {
	it('fails closed instead of silently skipping a missing Tool source', () => {
		const surface = buildSurface({
			routeFiles,
			sourceFiles: [],
			origin: ORIGIN,
			portfolioSeedSource: 'const PORTFOLIO_SEED = [];',
			toolsManifest: { tools: [] },
			toolSourcesMissing: ['external/live'],
		});
		const finding = invariantFindings(surface).find((f) => f.code === 'E013 tool-source-missing');
		assert.ok(finding);
		assert.equal(finding.severity, 'error');
		assert.match(finding.message, /submodule update --init --recursive/);
	});
});

describe('publication-surface — invariant findings', () => {
	const withUrls = (urls) =>
		buildSurface({
			routeFiles,
			sourceFiles: sourceFixture(urls.map((url) => `const u = "${url}";`).join('\n')),
			origin: ORIGIN,
			portfolioSeedSource: 'const PORTFOLIO_SEED = [];',
			toolsManifest: { tools: [] },
		});

	it('rejects a loopback URL in shipped source', () => {
		const codes = invariantFindings(withUrls(['http://127.0.0.1:3000/secrets'])).map((f) => f.code);
		assert.ok(codes.includes('E009 loopback-or-private-host-url'));
	});

	it('rejects an embedded credential', () => {
		const codes = invariantFindings(withUrls(['https://user:pass@cdn.test/a'])).map((f) => f.code);
		assert.ok(codes.includes('E008 external-url-with-userinfo'));
	});

	it('rejects http on a dereferenced external host', () => {
		const codes = invariantFindings(withUrls(['http://cdn.test/a.js'])).map((f) => f.code);
		assert.ok(codes.includes('E007 insecure-external-url'));
	});

	it('accepts http on a declared identifier namespace', () => {
		assert.deepEqual(invariantFindings(withUrls(['http://www.w3.org/2000/svg'])), []);
	});

	it('propagates the coverage error into the invariant list', () => {
		const surface = buildSurface({
			routeFiles: [...routeFiles, 'src/routes/undeclared.tsx'],
			sourceFiles: [],
			origin: ORIGIN,
			portfolioSeedSource: 'const PORTFOLIO_SEED = [];',
			toolsManifest: { tools: [] },
		});
		assert.ok(invariantFindings(surface).some((f) => f.code === 'E005 undeclared-route-file'));
	});
});

describe('publication-surface — delta rules', () => {
	const base = (overrides = {}) => ({
		schema: SNAPSHOT_SCHEMA,
		origin: ORIGIN,
		firstPartyDomain: 'rebuildup.test',
		externalBoundaryPrefixes: ['/api/v1'],
		surfaces: [
			{
				id: '/',
				path: '/',
				classification: 'public',
				sitemap: true,
				dynamic: null,
				files: [],
				urls: ['/'],
				reason: '',
			},
			{
				id: '/about',
				path: '/about',
				classification: 'public',
				sitemap: true,
				dynamic: null,
				files: [],
				urls: ['/about'],
				reason: '',
			},
			{
				id: '/admin/keys',
				path: '/admin/keys',
				classification: 'internal',
				sitemap: false,
				dynamic: null,
				files: [],
				urls: ['/admin/keys'],
				reason: '',
			},
		],
		sitemap: ['/', '/about'],
		publicUrls: ['/', '/about', '/admin/login', '/share/briefing/'],
		externalHosts: ['cdn.test'],
		firstPartyHosts: [],
		externalUrls: [
			{
				url: 'https://cdn.test/a.js',
				host: 'cdn.test',
				kind: 'external',
				identifier: false,
				files: [],
			},
		],
		...overrides,
	});

	const codes = (findings) => findings.map((f) => f.code);

	it('fails closed when no snapshot exists', () => {
		const diff = diffSurfaces({ baseline: null, current: base() });
		assert.deepEqual(codes(diff.findings), ['E010 snapshot-missing']);
	});

	it('raises E001 when a public URL disappears', () => {
		const diff = diffSurfaces({ baseline: base(), current: base({ publicUrls: ['/', '/about'] }) });
		assert.ok(codes(diff.findings).includes('E001 removed-public-url'));
		assert.deepEqual(diff.removedPublicUrls, ['/admin/login', '/share/briefing/']);
	});

	it('raises E001 for a non-sitemap public route, not only sitemap targets', () => {
		const diff = diffSurfaces({
			baseline: base(),
			current: base({ publicUrls: ['/', '/about', '/share/briefing/'] }),
		});
		assert.deepEqual(diff.removedPublicUrls, ['/admin/login']);
		assert.ok(codes(diff.findings).includes('E001 removed-public-url'));
	});

	it('treats a public URL addition as review information, not a failure', () => {
		const diff = diffSurfaces({
			baseline: base(),
			current: base({
				sitemap: ['/', '/about', '/contact'],
				publicUrls: ['/', '/about', '/admin/login', '/contact', '/share/briefing/'],
			}),
		});
		assert.deepEqual(diff.addedPublicUrls, ['/contact']);
		assert.equal(codes(diff.findings).includes('E001 removed-public-url'), false);
		assert.equal(verdictOf(diff.findings), 'review');
	});

	it('raises E012 when an external HTTP boundary prefix is removed', () => {
		const diff = diffSurfaces({
			baseline: base(),
			current: base({ externalBoundaryPrefixes: [] }),
		});
		assert.ok(codes(diff.findings).includes('E012 external-boundary-prefix-removed'));
		assert.deepEqual(diff.removedBoundaryPrefixes, ['/api/v1']);
		assert.equal(verdictOf(diff.findings), 'fail');
	});

	it('treats a new external HTTP boundary prefix as review information', () => {
		const diff = diffSurfaces({
			baseline: base(),
			current: base({ externalBoundaryPrefixes: ['/api/v1', '/webhooks'] }),
		});
		assert.deepEqual(diff.addedBoundaryPrefixes, ['/webhooks']);
		assert.deepEqual(codes(diff.findings), ['W005 external-boundary-prefix-added']);
		assert.equal(verdictOf(diff.findings), 'review');
	});

	it('reads a snapshot without a public URL set through the sitemap fallback', () => {
		const legacy = base();
		legacy.publicUrls = undefined;
		const diff = diffSurfaces({ baseline: legacy, current: legacy });
		assert.deepEqual(diff.addedPublicUrls, []);
		assert.deepEqual(diff.removedPublicUrls, []);
		assert.deepEqual(codes(diff.findings), []);
	});

	it('raises E003 when an internal surface becomes public', () => {
		const next = base({
			sitemap: ['/', '/about', '/admin/keys'],
			publicUrls: ['/', '/about', '/admin/keys', '/admin/login', '/share/briefing/'],
		});
		next.surfaces = base().surfaces.map((s) =>
			s.id === '/admin/keys' ? { ...s, classification: 'public', sitemap: true } : s,
		);
		const diff = diffSurfaces({ baseline: base(), current: next });
		assert.ok(codes(diff.findings).includes('E003 internal-surface-published'));
	});

	it('raises E002 when a public surface is withdrawn', () => {
		const next = base({
			sitemap: [],
			publicUrls: ['/admin/login', '/share/briefing/'],
		});
		next.surfaces = base({ sitemap: [] }).surfaces.map((s) =>
			s.id === '/about' ? { ...s, classification: 'internal', sitemap: false, urls: [] } : s,
		);
		const diff = diffSurfaces({ baseline: base(), current: next });
		assert.ok(codes(diff.findings).includes('E002 public-surface-withdrawn'));
	});

	it('raises E004 for a new external host but not for a new path on a known host', () => {
		const withNewPath = base({
			externalUrls: [
				...base().externalUrls,
				{
					url: 'https://cdn.test/b.js',
					host: 'cdn.test',
					kind: 'external',
					identifier: false,
					files: [],
				},
			],
		});
		const pathDiff = diffSurfaces({ baseline: base(), current: withNewPath });
		assert.equal(codes(pathDiff.findings).includes('E004 external-host-added'), false);
		assert.ok(codes(pathDiff.findings).includes('W002 external-url-added'));

		const withNewHost = base({ externalHosts: ['cdn.test', 'new.test'] });
		const hostDiff = diffSurfaces({ baseline: base(), current: withNewHost });
		assert.ok(codes(hostDiff.findings).includes('E004 external-host-added'));
		assert.deepEqual(hostDiff.addedExternalHosts, ['new.test']);
	});

	it('is quiet when nothing changed', () => {
		assert.deepEqual(diffSurfaces({ baseline: base(), current: base() }).findings, []);
	});

	it('maps severities onto pass / review / fail', () => {
		assert.equal(verdictOf([]), 'pass');
		assert.equal(verdictOf([{ severity: 'warn' }]), 'review');
		assert.equal(verdictOf([{ severity: 'warn' }, { severity: 'error' }]), 'fail');
	});
});

describe('publication-surface — snapshot + report determinism', () => {
	const surface = buildSurface({
		routeFiles,
		sourceFiles: sourceFixture('const u = "https://cdn.test/a.js";'),
		origin: ORIGIN,
		portfolioSeedSource: "const PORTFOLIO_SEED = [{ slug: 'alpha' }];",
		toolsManifest: { tools: [{ slug: 'live', delivery: { kind: 'same_origin_static' } }] },
		workerEntrySource: "const EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1'] as const;",
	});
	const baseline = serializeSurfaceCore(surface);
	const transition = transitionOf(diffSurfaces({ baseline: null, current: surface }));

	it('serialises deterministically', () => {
		assert.equal(serializeSurfaceCore(surface), baseline);
	});

	it('round-trips through the snapshot envelope', () => {
		const parsed = parseSnapshot(serializeSnapshot(surface, transition));
		assert.equal(parsed.schema, SNAPSHOT_SCHEMA);
		assert.equal(serializeSurfaceCore(parsed.surface), baseline);
		assert.deepEqual(parsed.approvedTransition.addedPublicUrls, transition.addedPublicUrls);
		assert.ok(parsed.surface.publicUrls.includes('/admin/login'));
	});

	it('rejects an unknown schema tag', () => {
		assert.throws(
			() => parseSnapshot('{"schema":"other.v9"}'),
			/unsupported publication-surface schema/,
		);
	});

	it('rejects a snapshot with no surface block', () => {
		assert.throws(
			() => parseSnapshot(`{"schema":"${SNAPSHOT_SCHEMA}"}`),
			/no usable surface block/,
		);
	});

	it('renders the same Markdown for the same inputs', () => {
		const first = renderMarkdownReport({ surface, transition });
		assert.equal(renderMarkdownReport({ surface, transition }), first);
		assert.match(first, /# Publication surface diff report/);
		assert.match(first, /`\/portfolio\/alpha`/);
	});

	it('renders the same HTML for the same inputs, with no external asset', () => {
		const first = renderHtmlReport({ surface, transition });
		assert.equal(renderHtmlReport({ surface, transition }), first);
		assert.match(first, /<!doctype html>/i);
		assert.equal(/<link\b|@import|<script\b/i.test(first), false);
	});

	it('survives a transition-less report request', () => {
		assert.match(renderMarkdownReport({ surface, transition: null }), /No findings/);
		assert.match(renderHtmlReport({ surface, transition: null }), /No findings/);
	});
});

describe('publication-surface — load contract (Issue #505 DoD)', () => {
	it('stays within a wall-clock bound on a surface far larger than the live one', () => {
		const many = Array.from({ length: 4000 }, (_, i) => ({ slug: `slug-${i}` }));
		const started = process.hrtime.bigint();
		const surface = buildSurface({
			routeFiles,
			sourceFiles: sourceFixture(
				Array.from({ length: 4000 }, (_, i) => `const u${i} = "https://host${i}.test/p";`).join(
					'\n',
				),
				'src/big.ts',
			),
			origin: ORIGIN,
			portfolioSeedSource: `export const PORTFOLIO_SEED = [${many
				.map((entry) => `{ slug: '${entry.slug}' }`)
				.join(',')}];`,
			toolsManifest: {
				tools: many.map((entry) => ({ ...entry, delivery: { kind: 'same_origin_static' } })),
			},
		});
		const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
		// Issue #734: six static sitemap surfaces (`/`, `/about`,
		// `/contact`, `/design-system`, `/portfolio`, `/tools`) plus the
		// 4000 portfolio slugs. The 4000 Tool shells are NOT sitemap
		// targets — the shell declares `robots: noindex` in its own head.
		assert.equal(surface.sitemap.length, 6 + 4000);
		assert.equal(surface.externalHosts.length, 4000);
		// The public surfaces outside the sitemap: the four static ones
		// (`/admin/login`, `/admin/invitations/accept`, `/keyboard`
		// (Issue #620) and `/projects/dotfiles` (Issue #621)) plus the
		// 4000 Tool shells the noindex rule keeps out.
		assert.equal(surface.publicUrls.length, surface.sitemap.length + 4 + 4000);
		assert.ok(elapsedMs < 10000, `surface build took ${elapsedMs.toFixed(0)}ms`);
	});
});
