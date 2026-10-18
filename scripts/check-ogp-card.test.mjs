import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	evaluateCoverage,
	isSampleUnderRoute,
	parseRoutePaths,
	policyFromContract,
	publicSurfaces,
	readContract,
} from './check-ogp-card.mjs';
import {
	evaluateSocialCard,
	evaluateSocialCards,
	imageSourceOf,
	renderTextReport,
	summarizeSocialCard,
} from './ogp-card-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const CONTRACT = readContract();
const POLICY = policyFromContract(CONTRACT);

const CONTENT_IMAGE = 'https://media.rebuildup.dev/portfolio/my-web-2026/cover.png';

/** A document that satisfies the contract for `surface`, then perturbed. */
function goodCard(surface, overrides = {}) {
	const image = 'image' in overrides ? overrides.image : CONTENT_IMAGE;
	const fallback = image === POLICY.fallbackCardUrl;
	const tags = [
		{ property: 'og:type', content: surface.ogType },
		{ property: 'og:site_name', content: POLICY.siteName },
		{ property: 'og:locale', content: POLICY.siteLocale },
		{ property: 'og:title', content: 'my-web-2026' },
		{
			property: 'og:description',
			content: 'A description that clears any reasonable lower bound.',
		},
		{ property: 'og:url', content: `${POLICY.canonicalOrigin}${surface.samplePath}` },
		...(image === null
			? []
			: [
					{ property: 'og:image', content: image },
					{ property: 'og:image:alt', content: overrides.alt ?? 'カバー画像' },
					...(fallback
						? [
								{
									property: 'og:image:width',
									content: String(overrides.width ?? POLICY.fallbackCardWidth),
								},
								{
									property: 'og:image:height',
									content: String(overrides.height ?? POLICY.fallbackCardHeight),
								},
							]
						: []),
				]),
		{ name: 'twitter:card', content: 'summary_large_image' },
		{ name: 'twitter:title', content: overrides.twitterTitle ?? 'my-web-2026' },
		{
			name: 'twitter:description',
			content:
				overrides.twitterDescription ?? 'A description that clears any reasonable lower bound.',
		},
		...(image === null ? [] : [{ name: 'twitter:image', content: image }]),
	];
	return tags;
}

const PROJECT = CONTRACT.routes.find((route) => route.path === '/portfolio/$slug');
const HOME = CONTRACT.routes.find((route) => route.path === '/');

function evaluate(surface, tags) {
	return evaluateSocialCard({ surface, tags, policy: POLICY });
}

function rules(findings) {
	return findings.map((finding) => finding.rule);
}

describe('ogp card engine — a compliant document produces no findings', () => {
	it('accepts a content card', () => {
		const { findings, image } = evaluate(PROJECT, goodCard(PROJECT));
		assert.deepEqual(findings, []);
		assert.equal(image.source, 'content');
		assert.equal(image.url, CONTENT_IMAGE);
	});

	it('accepts the fallback card with the declared alt and size', () => {
		const tags = goodCard(PROJECT, { image: POLICY.fallbackCardUrl, alt: POLICY.fallbackCardAlt });
		const { findings, image } = evaluate(PROJECT, tags);
		assert.deepEqual(findings, []);
		assert.equal(image.source, 'fallback');
	});

	it('accepts a surface that declares it publishes no card', () => {
		const { findings, image } = evaluate(HOME, [
			{ property: 'og:title', content: 'my-web-2026' },
			{ name: 'twitter:card', content: 'summary' },
		]);
		assert.deepEqual(findings, []);
		assert.equal(image, null);
	});

	it('reports the image source a reader can act on', () => {
		assert.equal(imageSourceOf(POLICY.fallbackCardUrl, POLICY), 'fallback');
		assert.equal(imageSourceOf(CONTENT_IMAGE, POLICY), 'content');
		assert.equal(imageSourceOf(null, POLICY), 'none');
	});
});

describe('ogp card engine — every rule can fail', () => {
	it('reports a missing og:image (the missing-media case)', () => {
		const { findings } = evaluate(PROJECT, goodCard(PROJECT, { image: null }));
		assert.deepEqual(rules(findings), ['card.image-missing']);
		assert.match(findings[0].message, /fallback card/);
	});

	it('reports a relative og:image', () => {
		const { findings } = evaluate(PROJECT, goodCard(PROJECT, { image: '/portfolio/cover.png' }));
		assert.ok(rules(findings).includes('card.image-absolute'));
	});

	it('reports an og:image with no alt text', () => {
		const { findings } = evaluate(PROJECT, goodCard(PROJECT, { alt: '' }));
		assert.deepEqual(rules(findings), ['card.image-alt']);
	});

	it('reports a fallback card published with the wrong size', () => {
		const tags = goodCard(PROJECT, {
			image: POLICY.fallbackCardUrl,
			alt: POLICY.fallbackCardAlt,
			width: 800,
		});
		assert.deepEqual(rules(evaluate(PROJECT, tags).findings), ['card.image-width']);
	});

	it('reports a fallback card published without its declared alt', () => {
		const tags = goodCard(PROJECT, { image: POLICY.fallbackCardUrl, alt: '別の文章' });
		assert.ok(rules(evaluate(PROJECT, tags).findings).includes('card.image-alt'));
	});

	it('reports a twitter:image that does not mirror og:image', () => {
		const tags = goodCard(PROJECT).map((tag) =>
			tag.name === 'twitter:image' ? { ...tag, content: 'https://example.invalid/other.png' } : tag,
		);
		assert.deepEqual(rules(evaluate(PROJECT, tags).findings), ['card.twitter-image']);
	});

	it('reports a summary card that claims a large image', () => {
		const tags = goodCard(PROJECT).map((tag) =>
			tag.name === 'twitter:card' ? { ...tag, content: 'summary' } : tag,
		);
		assert.deepEqual(rules(evaluate(PROJECT, tags).findings), ['card.twitter-card']);
	});

	it('reports the wrong og:type', () => {
		const tags = goodCard(PROJECT).map((tag) =>
			tag.property === 'og:type' ? { ...tag, content: 'website' } : tag,
		);
		assert.deepEqual(rules(evaluate(PROJECT, tags).findings), ['card.og-type']);
	});

	it('reports a missing site name and locale', () => {
		const tags = goodCard(PROJECT).filter(
			(tag) => tag.property !== 'og:site_name' && tag.property !== 'og:locale',
		);
		assert.deepEqual(rules(evaluate(PROJECT, tags).findings), ['card.site-name', 'card.locale']);
	});

	it('reports a missing title or description', () => {
		const tags = goodCard(PROJECT).filter(
			(tag) => tag.property !== 'og:title' && tag.property !== 'og:description',
		);
		assert.deepEqual(rules(evaluate(PROJECT, tags).findings), [
			'card.title',
			'card.description',
			'card.twitter-title',
			'card.twitter-description',
		]);
	});

	it('reports an og:url that is not absolute or not canonical', () => {
		const relative = goodCard(PROJECT).map((tag) =>
			tag.property === 'og:url' ? { ...tag, content: '/portfolio/my-web-2026' } : tag,
		);
		assert.deepEqual(rules(evaluate(PROJECT, relative).findings), ['card.url']);

		const foreign = goodCard(PROJECT).map((tag) =>
			tag.property === 'og:url' ? { ...tag, content: 'https://example.invalid/x' } : tag,
		);
		assert.deepEqual(rules(evaluate(PROJECT, foreign).findings), ['card.url-origin']);
	});

	it('reports a malformed intrinsic size on a content image', () => {
		const tags = [
			...goodCard(PROJECT),
			{ property: 'og:image:width', content: '1600px' },
			{ property: 'og:image:height', content: '' },
		];
		const rules_ = rules(evaluate(PROJECT, tags).findings);
		assert.equal(rules_.length, 2, 'one finding per malformed dimension');
		assert.ok(rules_.every((rule) => rule === 'card.image-dimensions'));
	});

	it('reports an image on a surface that declares it publishes none', () => {
		const tags = [
			{ property: 'og:title', content: 'my-web-2026' },
			{ property: 'og:image', content: CONTENT_IMAGE },
			{ name: 'twitter:card', content: 'summary_large_image' },
		];
		assert.ok(rules(evaluate(HOME, tags).findings).includes('card.undeclared-image'));
	});

	it('reports a large card type on a surface that declares it publishes none', () => {
		const tags = [
			{ property: 'og:title', content: 'my-web-2026' },
			{ name: 'twitter:card', content: 'summary_large_image' },
		];
		assert.ok(rules(evaluate(HOME, tags).findings).includes('card.undeclared-card-type'));
	});

	it('reports an entry that claims a card without declaring a type', () => {
		const broken = { ...PROJECT, ogType: undefined };
		const { findings } = evaluateSocialCard({ surface: broken, tags: [], policy: POLICY });
		assert.deepEqual(rules(findings), ['card.inconsistent-entry']);
	});
});

describe('ogp card engine — inventory, no silent passes', () => {
	const surfaces = [PROJECT, HOME];

	it('reports a declared surface nobody observed', () => {
		const result = evaluateSocialCards({
			surfaces,
			observations: [{ path: PROJECT.samplePath, status: 200, tags: goodCard(PROJECT) }],
			policy: POLICY,
		});
		assert.deepEqual(
			result.findings.map((finding) => finding.rule),
			['inventory.unobserved'],
		);
		assert.equal(result.findings[0].path, HOME.path);
	});

	it('reports a request that errored instead of reading it as no card', () => {
		const result = evaluateSocialCards({
			surfaces: [PROJECT],
			observations: [
				{
					path: PROJECT.samplePath,
					status: null,
					tags: [],
					requestFailed: true,
					requestError: 'ECONNRESET',
				},
			],
			policy: POLICY,
		});
		assert.deepEqual(
			result.findings.map((finding) => finding.rule),
			['observation.request-failed'],
		);
		assert.match(result.findings[0].message, /ECONNRESET/);
	});

	it('reports a surface that answered something other than a document', () => {
		const result = evaluateSocialCards({
			surfaces: [PROJECT],
			observations: [{ path: PROJECT.samplePath, status: 404, tags: [] }],
			policy: POLICY,
		});
		assert.deepEqual(
			result.findings.map((finding) => finding.rule),
			['observation.status'],
		);
	});

	it('carries the image source into every row', () => {
		const result = evaluateSocialCards({
			surfaces,
			observations: [
				{
					path: PROJECT.samplePath,
					status: 200,
					tags: goodCard(PROJECT, {
						image: POLICY.fallbackCardUrl,
						alt: POLICY.fallbackCardAlt,
					}),
				},
				{ path: HOME.samplePath, status: 200, tags: [] },
			],
			policy: POLICY,
		});
		const project = result.rows.find((row) => row.path === PROJECT.path);
		const home = result.rows.find((row) => row.path === HOME.path);
		// The row reports what the DOCUMENT published, which is what
		// makes a missing-media fallback a visible row rather than an
		// absent one.
		assert.equal(project.image.source, 'fallback');
		assert.equal(project.ok, true);
		assert.equal(home.image, null);
		assert.equal(home.ok, true);
	});

	it('records a surface that published no image as null, never as content', () => {
		const result = evaluateSocialCards({
			surfaces: [PROJECT],
			observations: [
				{ path: PROJECT.samplePath, status: 200, tags: goodCard(PROJECT, { image: null }) },
			],
			policy: POLICY,
		});
		assert.equal(result.rows[0].image, null);
		assert.equal(result.rows[0].ok, false);
	});

	it('summarises only the first value of a duplicated tag', () => {
		const head = summarizeSocialCard([
			{ property: 'og:image', content: 'https://a.invalid/1.png' },
			{ property: 'og:image', content: 'https://a.invalid/2.png' },
		]);
		assert.equal(head.ogImage, 'https://a.invalid/1.png');
	});

	it('renders a text report that names the source of every image', () => {
		const result = evaluateSocialCards({
			surfaces: [PROJECT],
			observations: [
				{
					path: PROJECT.samplePath,
					status: 200,
					tags: goodCard(PROJECT, {
						image: POLICY.fallbackCardUrl,
						alt: POLICY.fallbackCardAlt,
					}),
				},
			],
			policy: POLICY,
		});
		const report = renderTextReport(result);
		assert.match(report, /fallback\s+https:\/\/rebuildup\.dev\/og\/default-card\.png/);
		assert.match(report, /no findings/);
	});
});

describe('ogp card contract coverage', () => {
	const routePaths = parseRoutePaths(readFileSync(join(REPO_ROOT, 'src/routeTree.gen.ts'), 'utf8'));

	it('accepts the committed contract against the committed route tree', () => {
		const { errors } = evaluateCoverage({ contract: CONTRACT, routePaths });
		assert.deepEqual(errors, []);
	});

	it('declares every non-admin route the router serves', () => {
		const publicRoutes = routePaths.filter((path) => !path.startsWith('/admin'));
		const declared = CONTRACT.routes.map((route) => route.path);
		assert.deepEqual(declared.sort(), publicRoutes.sort());
	});

	it('reports a route nobody declared', () => {
		const { errors } = evaluateCoverage({
			contract: CONTRACT,
			routePaths: [...routePaths, '/notes/$slug'],
		});
		assert.ok(errors.some((error) => error.includes('/notes/$slug')));
	});

	it('reports a stale claim about a route that no longer exists', () => {
		const { errors } = evaluateCoverage({
			contract: {
				...CONTRACT,
				routes: [...CONTRACT.routes, { ...PROJECT, path: '/portfolio/$gone' }],
			},
			routePaths,
		});
		assert.ok(errors.some((error) => error.includes('stale claim')));
	});

	it('reports an entry with no note', () => {
		const { errors } = evaluateCoverage({
			contract: { ...CONTRACT, routes: [{ ...PROJECT, note: '' }] },
			routePaths,
		});
		assert.ok(errors.some((error) => error.includes('note must say WHY')));
	});

	it('reports a fallback card that is not a committed asset', () => {
		const { errors } = evaluateCoverage({
			contract: {
				...CONTRACT,
				fallbackCard: { ...CONTRACT.fallbackCard, path: '/og/missing.png' },
			},
			routePaths,
		});
		assert.ok(errors.some((error) => error.includes('must be a real committed asset')));
	});

	it('reports an origin that is not the production origin', () => {
		const { errors } = evaluateCoverage({
			contract: { ...CONTRACT, canonicalOrigin: 'http://localhost:5173' },
			routePaths,
		});
		assert.ok(errors.some((error) => error.includes('canonicalOrigin')));
	});

	it('reports an implemented surface with no og:type', () => {
		const { errors } = evaluateCoverage({
			contract: {
				...CONTRACT,
				routes: [{ ...PROJECT, ogType: undefined }],
			},
			routePaths,
		});
		assert.ok(errors.some((error) => error.includes('og:type')));
	});

	it('reports a deferred surface that turned into a real route', () => {
		// Issue #421 names 記事. The moment an article route lands, this
		// must fail until the contract moves it out of `deferredSurfaces`.
		const { errors } = evaluateCoverage({
			contract: CONTRACT,
			routePaths: [...routePaths, '/articles/$slug'],
		});
		assert.ok(errors.some((error) => error.includes('now exists')));
	});

	it('reports a deferred surface with no reason', () => {
		const { errors } = evaluateCoverage({
			contract: { ...CONTRACT, deferredSurfaces: [{ id: 'articles', reason: 'later' }] },
			routePaths,
		});
		assert.ok(errors.some((error) => error.includes('deferredSurfaces[articles]')));
	});

	it('accepts a concrete sample for a dynamic route and rejects another route', () => {
		assert.equal(isSampleUnderRoute('/portfolio/$slug', '/portfolio/my-web-2026'), true);
		assert.equal(isSampleUnderRoute('/portfolio/$slug', '/about'), false);
		assert.equal(isSampleUnderRoute('/tools/', '/tools'), true);
	});

	it('evaluates exactly the public surfaces the contract declares', () => {
		// The live checker must not silently drop a declared surface
		// (e.g. by filtering on a field the contract does not set): an
		// omitted surface is an unverified surface.
		const evaluated = publicSurfaces(CONTRACT);
		assert.deepEqual(
			evaluated.map((surface) => surface.samplePath).sort(),
			CONTRACT.routes
				.filter((route) => route.public !== false)
				.map((route) => route.samplePath)
				.sort(),
		);
		assert.ok(evaluated.length > 0);
		for (const surface of evaluated) {
			assert.ok(surface.samplePath.startsWith('/'), `${surface.path} samplePath`);
		}
	});
});
