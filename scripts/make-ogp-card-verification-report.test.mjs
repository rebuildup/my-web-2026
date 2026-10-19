import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FALLBACK_CARD } from './generate-og-fallback-card.mjs';
import { renderReport } from './make-ogp-card-verification-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CONTRACT = JSON.parse(
	readFileSync(join(ROOT, 'src/editorial/social-card/contract.json'), 'utf8'),
);
const SNAPSHOT = JSON.parse(
	readFileSync(join(ROOT, 'test/integration/fixtures/ogp-card-snapshot.json'), 'utf8'),
);

const FALLBACK_URL = `${CONTRACT.canonicalOrigin}${CONTRACT.fallbackCard.path}`;
const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';

/** A vitest JSON report shaped like the one `--reporter=json` writes. */
function reportWith(titles) {
	return {
		testResults: [
			{
				startTime: 0,
				endTime: 1200,
				assertionResults: titles.map((title, index) => ({
					title,
					fullName: title,
					status: index === 0 ? 'failed' : 'passed',
					duration: 100 + index,
				})),
			},
		],
	};
}

function render(report = reportWith(['a passing case', 'a failing case'])) {
	return renderReport({
		report,
		contract: CONTRACT,
		snapshot: SNAPSHOT,
		fallbackImageDataUri: DATA_URI,
	});
}

describe('ogp card verification report', () => {
	it('renders one card per observed representative URL', () => {
		const html = render();
		for (const samplePath of Object.keys(SNAPSHOT)) {
			assert.ok(html.includes(samplePath), `${samplePath} missing from the report`);
		}
		assert.equal(
			(html.match(/class="card card-/g) ?? []).length,
			Object.keys(SNAPSHOT).length,
			'one card per observed surface',
		);
	});

	it('inlines the fallback card so the missing-media row renders an image', () => {
		const html = render();
		assert.ok(html.includes(DATA_URI), 'the fallback card is embedded');
		assert.ok(html.includes('class="card card-fallback"'), 'fallback rows are labelled');
		assert.ok(html.includes('og:image source: fallback'), 'the fallback row names its source');
	});

	it('never embeds a remote media URL (an offline run must render the same)', () => {
		// The committed snapshot only holds the fallback branch (the test
		// pool leaves the media domain unbound on purpose), so the
		// `content` branch is driven here with a synthetic surface: a
		// report that inlined a media-host URL would render differently
		// offline than on CI.
		const html = renderReport({
			report: reportWith(['a passing case']),
			contract: CONTRACT,
			snapshot: {
				'/portfolio/content-branch': {
					ogType: 'article',
					ogTitle: 'content branch',
					ogDescription: 'A surface whose own media resolves.',
					ogUrl: 'https://rebuildup.dev/portfolio/content-branch',
					ogImage: 'https://media.rebuildup.dev/portfolio/content-branch/cover.png',
					ogImageAlt: 'カバー',
					twitterCard: 'summary_large_image',
					twitterImage: 'https://media.rebuildup.dev/portfolio/content-branch/cover.png',
				},
			},
			fallbackImageDataUri: DATA_URI,
		});
		assert.ok(!/<img[^>]+src="https:\/\//.test(html), 'no remote <img> in the report');
		assert.ok(
			html.includes('リモート URL のため埋め込まない'),
			'remote images are explained, not embedded',
		);
		assert.ok(html.includes('og:image source: content'), 'the content row names its source');
	});

	it('shows the declared surfaces with no card as such', () => {
		const html = render();
		assert.ok(html.includes('contract が cardPolicy none と宣言'));
	});

	it('renders the contract, including the deferred surfaces', () => {
		const html = render();
		assert.ok(html.includes('deferred'), 'deferred surfaces are listed');
		for (const entry of CONTRACT.deferredSurfaces) {
			assert.ok(html.includes(entry.id), `${entry.id} missing`);
		}
	});

	it('prints the gate run, failures included', () => {
		const html = render();
		assert.ok(html.includes('a passing case'));
		assert.ok(html.includes('a failing case'));
		// A green report must not be reachable by hiding a failure: the
		// failed counter is rendered with the `bad` class.
		assert.ok(html.includes('class="v bad">1</div>'), 'the failed count is rendered as 1');
		assert.ok(html.includes('FAIL'), 'the failing row is not restyled into a pass');
	});

	it('never hardcodes the release version (it is derived from package.json)', () => {
		const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
		const html = render();
		assert.ok(!html.includes(`v${version}`), 'the report does not name a release version');
	});

	it('agrees with the committed fallback card generator', () => {
		// The contract and the generator are two files that must not
		// drift: a fallback card rendered at a different size than the
		// one the contract declares would make the report a picture of
		// something nobody ships.
		assert.equal(FALLBACK_CARD.width, CONTRACT.fallbackCard.width);
		assert.equal(FALLBACK_CARD.height, CONTRACT.fallbackCard.height);
		assert.equal(FALLBACK_CARD.path, CONTRACT.fallbackCard.path);
		assert.ok(
			readFileSync(join(ROOT, 'public', CONTRACT.fallbackCard.path)).length > 0,
			'the committed card exists',
		);
	});
});
