import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rewriteAssetPaths } from './rewrite-asset-paths.mjs';

/**
 * Tests for `scripts/rewrite-asset-paths.mjs` — the namespace
 * rewriter shared by the Tool build orchestrator and the
 * `dist/client/tools/<slug>/app/` collection path.
 *
 * The contract: a Tool's Vite-emitted `index.html` uses root-absolute
 * paths like `/assets/index-XXX.js`. When the artifact is served at
 * `/tools/<slug>/app/index.html`, those paths resolve against the
 * host origin and 404 — the actual assets live at
 * `/tools/<slug>/app/assets/...`. This helper rewrites every
 * `src="..."` and `href="..."` attribute that points at a
 * root-absolute path so the browser resolves it against the
 * artifact namespace instead.
 */

describe('rewriteAssetPaths — root-absolute prefix', () => {
	it('prefixes src= and href= with the artifact namespace', () => {
		const input = `<!doctype html>
<html>
	<head>
		<script type="module" crossorigin src="/assets/index-XYZ.js"></script>
		<link rel="stylesheet" crossorigin href="/assets/index-XYZ.css">
	</head>
	<body><div id="root"></div></body>
</html>`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.match(output, /src="\/tools\/prototype\/app\/assets\/index-XYZ\.js"/);
		assert.match(output, /href="\/tools\/prototype\/app\/assets\/index-XYZ\.css"/);
	});
});

describe('rewriteAssetPaths — idempotence', () => {
	it('does NOT prefix paths that are already under the artifact namespace', () => {
		const input = `<script src="/tools/prototype/app/assets/index-XYZ.js"></script>`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.equal(output, input);
	});
});

describe('rewriteAssetPaths — external URL safety', () => {
	it('does NOT touch https://, http://, data:, blob:, mailto:, javascript:', () => {
		const input = `<link rel="preconnect" href="https://fonts.googleapis.com">
<script src="data:text/javascript,alert(1)"></script>
<link rel="preload" href="blob:https://example.com/abc">
<a href="mailto:hi@example.com">x</a>
<a href="javascript:void(0)">y</a>`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.equal(output, input);
	});
});

describe('rewriteAssetPaths — slash normalization', () => {
	it('produces single-slash prefix even when artifactPath has leading/trailing slashes', () => {
		const input = `<script src="/assets/index-XYZ.js"></script>`;
		const out1 = rewriteAssetPaths(input, '/tools/prototype/app');
		const out2 = rewriteAssetPaths(input, 'tools/prototype/app');
		const out3 = rewriteAssetPaths(input, '/tools/prototype/app/');
		for (const out of [out1, out2, out3]) {
			assert.match(out, /\/tools\/prototype\/app\/assets\/index-XYZ\.js/);
			// The bug we explicitly protect against: `//tools/...`
			// (the browser interprets it as protocol-relative).
			assert.doesNotMatch(out, /\/\/tools/);
		}
	});
});

describe('rewriteAssetPaths — passthrough', () => {
	it('leaves the input untouched when there are no matching tags', () => {
		const input = '<!doctype html><html><body><p>hello</p></body></html>';
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.equal(output, input);
	});
});

describe('rewriteAssetPaths — attribute preservation', () => {
	it('preserves non-crossorigin attributes between the tag name and src/href', () => {
		const input = `<link rel="stylesheet" crossorigin href="/assets/index-XYZ.css">`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		// `crossorigin` is stripped from the rewritten tag (see
		// `rewriteAssetPaths — crossorigin stripping` below). The
		// other attribute (`rel`) is preserved as-is.
		assert.match(
			output,
			/rel="stylesheet"\s+href="\/tools\/prototype\/app\/assets\/index-XYZ\.css"/,
		);
		assert.doesNotMatch(output, /crossorigin/);
	});

	it('handles both single and double quotes around the attribute value', () => {
		const single = `<script src='/assets/index-XYZ.js'></script>`;
		const double = `<script src="/assets/index-XYZ.js"></script>`;
		assert.match(
			rewriteAssetPaths(single, '/tools/prototype/app'),
			/src='\/tools\/prototype\/app\/assets\/index-XYZ\.js'/,
		);
		assert.match(
			rewriteAssetPaths(double, '/tools/prototype/app'),
			/src="\/tools\/prototype\/app\/assets\/index-XYZ\.js"/,
		);
	});
});

describe('rewriteAssetPaths — crossorigin stripping', () => {
	// Vite emits `crossorigin` on the entry `<script type="module">`
	// and `<link rel="stylesheet">` so the browser uses
	// `modulepreload`. In a sandboxed iframe (`allow-scripts` only)
	// the document origin is opaque, which converts any
	// same-origin-with-crossorigin fetch into a real CORS request.
	// The static-asset server (Cloudflare Workers Static Assets,
	// `vite preview`) does not respond with
	// `Access-Control-Allow-Origin`, so the bundle would fail to
	// load. Stripping `crossorigin` falls back to the default
	// same-origin fetch path, which has no CORS requirement.

	it('strips crossorigin from a rewritten script tag', () => {
		const input = `<script type="module" crossorigin src="/assets/index-XYZ.js"></script>`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.match(
			output,
			/<script type="module"\s+src="\/tools\/prototype\/app\/assets\/index-XYZ\.js"/,
		);
		assert.doesNotMatch(output, /crossorigin/);
	});

	it('strips crossorigin from a rewritten link tag', () => {
		const input = `<link rel="stylesheet" crossorigin href="/assets/index-XYZ.css">`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.match(
			output,
			/<link rel="stylesheet"\s+href="\/tools\/prototype\/app\/assets\/index-XYZ\.css"/,
		);
		assert.doesNotMatch(output, /crossorigin/);
	});

	it('strips crossorigin="anonymous" (with value) from a rewritten script', () => {
		const input = `<script type="module" crossorigin="anonymous" src="/assets/index-XYZ.js"></script>`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.match(
			output,
			/<script type="module"\s+src="\/tools\/prototype\/app\/assets\/index-XYZ\.js"/,
		);
		assert.doesNotMatch(output, /crossorigin/);
	});

	it('does NOT strip crossorigin from img (we only touch script/link for crossorigin)', () => {
		const input = `<img crossorigin src="/assets/image-XYZ.png" alt="">`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		// For img, crossorigin is preserved (img fetches are not the
		// source of the CORS issue we are working around).
		assert.match(
			output,
			/<img crossorigin\s+src="\/tools\/prototype\/app\/assets\/image-XYZ\.png"/,
		);
	});

	it('does NOT touch crossorigin on tags that were not rewritten (path is already in namespace)', () => {
		const input = `<script type="module" crossorigin src="/tools/prototype/app/assets/index-XYZ.js"></script>`;
		const output = rewriteAssetPaths(input, '/tools/prototype/app');
		assert.equal(output, input);
	});
});
