import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReportHtml, escapeHtml, renderMarkdownSummary } from './_content-link-report.mjs';
import {
	SEVERITY,
	buildSurfaceSets,
	checkExternalTargets,
	classifyReference,
	decodeHtmlEntities,
	groupFindings,
	parseHtmlDocument,
	parseMarkdownDocument,
	publicUrlPath,
	redactTarget,
	resolveInternalTarget,
	summarize,
	validateDocuments,
	validateMediaAlt,
} from './_content-links.mjs';
import { buildPortfolioDocuments, buildRoutePaths, scan } from './check-content-links.mjs';

const ORIGIN = 'https://rebuildup.dev';

/** The smallest surface that can resolve one internal anchor and one image. */
function fixtureSurface() {
	return buildSurfaceSets({
		publicFiles: [
			'public/share/example/index.html',
			'public/share/example/assets/image.webp',
			'public/share/example/assets/document.pdf',
		],
		routePaths: ['/', '/portfolio', '/portfolio/example-project', '/about'],
	});
}

function findingsOf({ html, markdown, urlPath = '/share/example/' }) {
	const surface = fixtureSurface();
	const document =
		html !== undefined
			? { ...parseHtmlDocument({ path: 'public/share/example/index.html', html }), urlPath }
			: {
					...parseMarkdownDocument({ path: 'src/portfolio/seed.ts#demo', markdown }),
					urlPath: '/portfolio/example-project',
				};
	const documentsById = new Map();
	if (document.kind === 'html') {
		documentsById.set('/share/example/', document);
		documentsById.set('/share/example/index.html', document);
	}
	return validateDocuments({ documents: [document], surface, origin: ORIGIN, documentsById });
}

describe('internal link resolution', () => {
	it('resolves a public directory and its index.html to the same target', () => {
		const surface = fixtureSurface();
		assert.equal(resolveInternalTarget('/share/example/', surface).exists, true);
		assert.equal(resolveInternalTarget('/share/example/index.html', surface).exists, true);
		assert.equal(resolveInternalTarget('/share/example/assets/image.webp', surface).exists, true);
	});

	it('resolves an exact route and refuses an unknown dynamic slug', () => {
		const surface = fixtureSurface();
		assert.equal(resolveInternalTarget('/portfolio/example-project', surface).exists, true);
		assert.equal(resolveInternalTarget('/portfolio/not-a-project', surface).exists, false);
	});

	it('treats a same-origin absolute URL as internal and a foreign host as external', () => {
		const internal = classifyReference('https://rebuildup.dev/about', {
			documentPath: '/',
			origin: ORIGIN,
		});
		assert.equal(internal.kind, 'internal');
		const external = classifyReference('https://example.com/x', {
			documentPath: '/',
			origin: ORIGIN,
		});
		assert.equal(external.kind, 'external');
	});

	it('keeps the authored path bytes (no normalization) when resolving', () => {
		const classified = classifyReference('/portfolio/%E3%83%86%E3%82%B9%E3%83%88', {
			documentPath: '/',
			origin: ORIGIN,
		});
		assert.equal(classified.kind, 'internal');
		assert.equal(classified.path, '/portfolio/%E3%83%86%E3%82%B9%E3%83%88');
	});
});

describe('validation severity', () => {
	it('fails the release on an internal 404', () => {
		const findings = findingsOf({ html: '<a href="/portfolio/missing">missing</a>' });
		assert.equal(findings.length, 1);
		assert.equal(findings[0].severity, SEVERITY.ERROR);
		assert.equal(findings[0].code, 'E105 internal-404');
		assert.equal(summarize(findings).verdict, 'fail');
	});

	it('does not fail on a missing fragment target in a route page (React owns ids)', () => {
		const findings = findingsOf({ html: '<a href="/about#section">about</a>' });
		assert.deepEqual(findings, []);
	});

	it('checks a fragment against the target static document', () => {
		const target = {
			...parseHtmlDocument({
				path: 'public/share/example/index.html',
				html: '<h2 id="present">present</h2>',
			}),
			urlPath: '/share/example/',
		};
		const document = {
			...parseHtmlDocument({
				path: 'public/share/example/index.html',
				html: '<a href="#present">ok</a><a href="#absent">bad</a>',
			}),
			urlPath: '/share/example/',
		};
		const findings = validateDocuments({
			documents: [document],
			surface: fixtureSurface(),
			origin: ORIGIN,
			documentsById: new Map([
				['/share/example/', target],
				['/share/example/index.html', target],
			]),
		});
		assert.equal(findings.length, 1);
		assert.equal(findings[0].code, 'E106 missing-fragment');
	});

	it('decodes a non-ASCII or percent-encoded fragment before comparing ids', () => {
		const target = {
			...parseHtmlDocument({
				path: 'public/share/example/index.html',
				html: '<h2 id="セクション">section</h2><h2 id="my section">spaced</h2>',
			}),
			urlPath: '/share/example/',
		};
		const document = {
			...parseHtmlDocument({
				path: 'public/share/example/index.html',
				html: '<a href="#セクション">unicode</a><a href="#my%20section">encoded space</a>',
			}),
			urlPath: '/share/example/',
		};
		const findings = validateDocuments({
			documents: [document],
			surface: fixtureSurface(),
			origin: ORIGIN,
			documentsById: new Map([
				['/share/example/', target],
				['/share/example/index.html', target],
			]),
		});
		assert.deepEqual(findings, []);
	});

	it('reads a quoted > as attribute data rather than the end of the tag', () => {
		const document = parseHtmlDocument({
			path: 'public/share/example/index.html',
			html: '<a href="/about?x=>">query</a><img alt="a > b" src="assets/image.webp">',
		});
		assert.deepEqual(
			document.references.map((item) => item.raw),
			['/about?x=>'],
		);
		assert.deepEqual(
			document.images.map((item) => item.raw),
			['assets/image.webp'],
		);
		assert.deepEqual(findingsOf({ html: '<a href="/about?x=>">query</a>' }), []);
	});

	it('records an external http target as a warning and never as an error', () => {
		const findings = findingsOf({ html: '<a href="http://example.com/x">x</a>' });
		const summary = summarize(findings);
		assert.equal(summary.error, 0);
		assert.equal(summary.warning, 1);
		assert.equal(summary.verdict, 'pass');
		assert.ok(findings.some((item) => item.code === 'W101 insecure-external'));
	});

	it('distinguishes a placeholder "#" from a 404', () => {
		const findings = findingsOf({ html: '<a href="#">open</a>' });
		assert.equal(findings.length, 1);
		assert.equal(findings[0].severity, SEVERITY.WARNING);
		assert.equal(findings[0].code, 'W102 placeholder-link');
		assert.equal(summarize(findings).verdict, 'pass');
	});

	it('rejects a forbidden scheme, credentials and a private host', () => {
		const findings = findingsOf({
			html: [
				'<a href="javascript:alert(1)">js</a>',
				'<a href="https://user:pass@example.com/x">credential</a>',
				'<a href="http://127.0.0.1/admin">loopback</a>',
			].join(''),
		});
		const codes = findings.map((item) => item.code);
		assert.ok(codes.includes('E102 forbidden-scheme'));
		assert.ok(codes.includes('E104 credential-url'));
		assert.ok(codes.includes('E110 private-host'));
		assert.equal(summarize(findings).verdict, 'fail');
	});

	it('rejects a scheme obfuscated with a control character', () => {
		// A browser strips TAB / LF / CR before the scheme parser runs, so
		// each of these navigates as `javascript:`. Entity and named-entity
		// spellings must not fall through to the external branch.
		const findings = findingsOf({
			html: [
				'<a href="java&#9;script:alert(1)">numeric tab</a>',
				'<a href="java&Tab;script:alert(1)">named tab</a>',
				'<a href="java\nscript:alert(1)">literal newline</a>',
				'<a href="javascript&colon;alert(1)">encoded colon</a>',
				'<img alt="x" src="java&#9;script:alert(1)">',
			].join(''),
		});
		const codes = findings.map((item) => item.code);
		assert.equal(codes.filter((code) => code === 'E111 control-character').length, 3);
		assert.ok(codes.includes('E102 forbidden-scheme'));
		assert.ok(codes.includes('E109 image-scheme'));
		assert.equal(summarize(findings).verdict, 'fail');
	});

	it('leaves an out-of-range numeric reference literal instead of throwing', () => {
		assert.equal(decodeHtmlEntities('&#x110000;'), '&#x110000;');
		assert.equal(decodeHtmlEntities('&#99999999;'), '&#99999999;');
		assert.doesNotThrow(() => findingsOf({ html: '<a href="&#x110000;">x</a>' }));
	});

	it('does not let %2F act as a path separator', () => {
		assert.equal(resolveInternalTarget('/share%2Fexample', fixtureSurface()).exists, false);
		assert.equal(resolveInternalTarget('/share/example', fixtureSurface()).exists, true);
	});
});

describe('image validation', () => {
	it('requires alt text and a resolvable src', () => {
		const findings = findingsOf({
			html: [
				'<img src="assets/image.webp">',
				'<img alt="broken" src="assets/missing.webp">',
				'<img alt="" src="assets/image.webp">',
				'<img alt="runtime">',
			].join(''),
		});
		const codes = findings.map((item) => item.code);
		assert.ok(codes.includes('E107 image-alt-missing'));
		assert.ok(codes.includes('E108 image-404'));
		assert.ok(codes.includes('W103 image-alt-empty'));
		assert.ok(codes.includes('W104 image-src-missing'));
	});

	it('warns on an empty src instead of silently accepting it', () => {
		const findings = findingsOf({ html: '<img alt="broken" src="">' });
		assert.equal(findings.length, 1);
		assert.equal(findings[0].code, 'W109 image-src-empty');
		assert.equal(findings[0].severity, SEVERITY.WARNING);
		assert.equal(summarize(findings).verdict, 'pass');
	});

	it('applies the credential and private-host rules to image sources', () => {
		const findings = findingsOf({
			html: [
				'<img alt="credential" src="https://user:pass@example.com/a.png">',
				'<img alt="loopback" src="http://127.0.0.1/a.png">',
			].join(''),
		});
		const codes = findings.map((item) => item.code);
		assert.ok(codes.includes('E104 credential-url'));
		assert.ok(codes.includes('E110 private-host'));
		assert.equal(summarize(findings).verdict, 'fail');
	});

	it('treats an explicitly decorative empty alt as valid', () => {
		const findings = findingsOf({
			html: '<img alt="" role="presentation" src="assets/image.webp">',
		});
		assert.deepEqual(findings, []);
	});

	it('checks media alt text authored in the portfolio seed', () => {
		assert.deepEqual(validateMediaAlt({ slug: 'x', media: [] }), []);
		const findings = validateMediaAlt({
			slug: 'x',
			media: [
				{ r2Key: 'a.webp', alt: 'cover' },
				{ r2Key: 'b.webp', alt: '' },
			],
		});
		assert.equal(findings.length, 1);
		assert.equal(findings[0].code, 'E107 image-alt-missing');
	});
});

describe('Markdown references', () => {
	it('extracts links and images but ignores code fences and inline code', () => {
		const document = parseMarkdownDocument({
			path: 'src/portfolio/seed.ts#demo',
			markdown: [
				'[ok](/about)',
				'![cover](/share/example/assets/image.webp)',
				'```md',
				'[not a link](/missing)',
				'```',
				'`[also not](/missing)`',
			].join('\n'),
		});
		assert.deepEqual(
			document.references.map((item) => item.raw),
			['/about'],
		);
		assert.deepEqual(
			document.images.map((item) => item.raw),
			['/share/example/assets/image.webp'],
		);
	});

	it('fails an unresolved Markdown link and warns on empty image alt', () => {
		const document = {
			...parseMarkdownDocument({
				path: 'src/portfolio/seed.ts#demo',
				markdown: '[bad](/portfolio/missing)\n\n![](/share/example/assets/image.webp)',
			}),
			urlPath: '/portfolio/example-project',
		};
		const findings = validateDocuments({
			documents: [document],
			surface: fixtureSurface(),
			origin: ORIGIN,
		});
		assert.ok(findings.some((item) => item.code === 'E105 internal-404'));
		assert.ok(findings.some((item) => item.code === 'W103 image-alt-empty'));
	});
});

describe('external dereference (opt-in)', () => {
	const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
	const external = classifyReference('https://example.com/x', {
		documentPath: '/',
		origin: ORIGIN,
	});

	it('classifies a timeout as a warning, not a release failure', async () => {
		const findings = await checkExternalTargets(['https://example.com/x'], {
			fetchImpl: async () => {
				throw timeoutError;
			},
			timeoutMs: 10,
			origin: ORIGIN,
		});
		assert.equal(findings.length, 1);
		assert.equal(findings[0].code, 'W106 external-timeout');
		assert.equal(findings[0].severity, SEVERITY.WARNING);
		assert.equal(summarize(findings).verdict, 'pass');
		assert.equal(external.kind, 'external');
	});

	it('classifies an unreachable host and a 5xx as warnings', async () => {
		const unreachable = await checkExternalTargets(['https://example.com/x'], {
			fetchImpl: async () => {
				throw new Error('ECONNREFUSED');
			},
			origin: ORIGIN,
		});
		assert.equal(unreachable[0].code, 'W107 external-unreachable');
		const serverError = await checkExternalTargets(['https://example.com/x'], {
			fetchImpl: async () => ({ ok: false, status: 503 }),
			origin: ORIGIN,
		});
		assert.equal(serverError[0].code, 'W105 external-http-status');
	});

	it('does not dereference anything when no fetch implementation is injected', async () => {
		assert.deepEqual(await checkExternalTargets(['https://example.com/x'], {}), []);
	});

	it('never dereferences a private host or a credential-bearing URL', async () => {
		const calls = [];
		const findings = await checkExternalTargets(
			[
				'http://127.0.0.1:8080/admin',
				'http://127.0.0.1./admin',
				'http://169.254.169.254/latest/meta-data/',
				'http://[::ffff:169.254.169.254]/latest/meta-data/',
				'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
				'http://localhost./x',
				'https://user:pass@example.com/x',
			],
			{
				fetchImpl: async (url, init) => {
					calls.push({ url, init });
					return { ok: true, status: 200 };
				},
				origin: ORIGIN,
			},
		);
		assert.deepEqual(calls, []);
		assert.deepEqual(findings, []);
	});

	it('aborts the request at the deadline and reports a timeout', async () => {
		let signal;
		const findings = await checkExternalTargets(['https://example.com/x'], {
			fetchImpl: (_url, init) => {
				signal = init.signal;
				return new Promise((_resolve, reject) => {
					signal.addEventListener(
						'abort',
						() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
						{ once: true },
					);
				});
			},
			timeoutMs: 20,
			origin: ORIGIN,
		});
		assert.equal(signal.aborted, true);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].code, 'W106 external-timeout');
	});

	it('does not follow a redirect automatically', async () => {
		let seen;
		const findings = await checkExternalTargets(['https://example.com/x'], {
			fetchImpl: async (_url, init) => {
				seen = init;
				return { ok: false, status: 302 };
			},
			origin: ORIGIN,
		});
		assert.equal(seen.redirect, 'manual');
		assert.equal(findings[0].code, 'W105 external-http-status');
		assert.equal(findings[0].severity, SEVERITY.WARNING);
	});
});

describe('credential redaction', () => {
	it('removes userinfo before a target is printed or rendered', () => {
		assert.equal(redactTarget('https://user:pass@example.com/x'), 'https://***:***@example.com/x');
		assert.equal(redactTarget('https://user@example.com/x?a=1'), 'https://***@example.com/x?a=1');
		assert.equal(redactTarget('https://example.com/x'), 'https://example.com/x');
		assert.equal(redactTarget('//user:pass@example.com/x'), '//***:***@example.com/x');
		assert.equal(redactTarget('javascript:alert(1)'), 'javascript:alert(1)');
		assert.equal(redactTarget(''), '');

		const finding = {
			severity: SEVERITY.ERROR,
			code: 'E104 credential-url',
			sourcePath: 'public/share/example/index.html',
			line: 1,
			target: 'https://user:pass@example.com/x',
			message: 'a published URL must not carry a username or password',
		};
		const html = buildReportHtml({
			scan: {
				sources: 1,
				references: 1,
				externalMode: false,
				findings: [finding],
				summary: summarize([finding]),
			},
			fixtures: [],
		});
		assert.ok(!html.includes('pass@'));
		assert.ok(html.includes('***:***@example.com'));

		const protocolRelative = {
			...finding,
			target: '//user:pass@example.com/x',
		};
		for (const rendered of [
			buildReportHtml({
				scan: {
					sources: 1,
					references: 1,
					externalMode: false,
					findings: [protocolRelative],
					summary: summarize([protocolRelative]),
				},
				fixtures: [],
			}),
			renderMarkdownSummary({
				scan: {
					sources: 1,
					references: 1,
					externalMode: false,
					findings: [protocolRelative],
					summary: summarize([protocolRelative]),
				},
				fixtures: [],
			}),
		]) {
			assert.ok(!rendered.includes('pass@'));
			assert.ok(rendered.includes('***:***@example.com'));
		}
	});
});

describe('surface / report helpers', () => {
	it('derives route targets from declarations and the real slug rosters', () => {
		const paths = buildRoutePaths({
			portfolioSlugs: ['demo'],
			toolSlugs: ['readmark'],
		});
		assert.ok(paths.includes('/'));
		assert.ok(paths.includes('/portfolio/demo'));
		assert.ok(paths.includes('/tools/readmark'));
		assert.ok(!paths.includes('/portfolio/not-a-slug'));
	});

	it('turns the seed into one document per project', () => {
		const { documents, mediaFindings } = buildPortfolioDocuments([
			{
				slug: 'demo',
				motivationMd: '[link](/about)',
				links: [{ url: 'https://example.com', label: 'example' }],
				media: [{ r2Key: 'a.webp', alt: '' }],
			},
		]);
		assert.equal(documents.length, 1);
		assert.deepEqual(
			documents[0].references.map((item) => item.raw),
			['/about', 'https://example.com'],
		);
		assert.equal(mediaFindings.length, 1);
		assert.equal(mediaFindings[0].code, 'E107 image-alt-missing');
	});

	it('maps a public index to its directory URL', () => {
		assert.equal(publicUrlPath('public/share/example/index.html'), '/share/example/');
		assert.equal(publicUrlPath('public/share/example/page.html'), '/share/example/page.html');
	});

	it('groups repeated findings and keeps the verdict driven by errors only', () => {
		const findings = [
			{
				severity: SEVERITY.WARNING,
				code: 'W1',
				sourcePath: 'a',
				line: 1,
				target: '#',
				message: 'm',
			},
			{
				severity: SEVERITY.WARNING,
				code: 'W1',
				sourcePath: 'a',
				line: 2,
				target: '#',
				message: 'm',
			},
		];
		const grouped = groupFindings(findings);
		assert.equal(grouped.length, 1);
		assert.equal(grouped[0].count, 2);
		assert.equal(summarize(findings).verdict, 'pass');
	});

	it('escapes untrusted link targets in the report', () => {
		const html = buildReportHtml({
			scan: {
				sources: 1,
				references: 1,
				externalMode: false,
				summary: { error: 1, warning: 0, info: 0, total: 1, verdict: 'fail' },
				findings: [
					{
						severity: 'error',
						code: 'E105 internal-404',
						sourcePath: 'x',
						line: 1,
						target: '<script>alert(1)</script>',
						message: '<img onerror=alert(1)>',
					},
				],
			},
			fixtures: [],
		});
		assert.ok(!html.includes('<script>alert(1)</script>'));
		assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
		assert.equal(escapeHtml('"<&>'), '&quot;&lt;&amp;&gt;');
	});

	it('renders a Markdown summary whose verdict matches the scan', () => {
		const markdown = renderMarkdownSummary({
			scan: {
				sources: 2,
				references: 3,
				externalMode: false,
				summary: { error: 0, warning: 1, info: 0, total: 1, verdict: 'pass' },
				findings: [],
			},
			fixtures: [],
		});
		assert.match(markdown, /verdict: \*\*PASS\*\*/);
	});
});

describe('real repository content', () => {
	it('has no internal 404, unsafe target or missing image alt', async () => {
		const { scan: report } = await scan({ external: false, externalTimeout: 5000 });
		assert.equal(report.summary.error, 0, JSON.stringify(report.findings, null, 2));
		assert.ok(report.sources >= 2, 'expected the static HTML document and portfolio content');
		assert.ok(report.references > 0);
	});
});
