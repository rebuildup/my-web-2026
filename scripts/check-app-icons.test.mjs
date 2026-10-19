/**
 * Unit tests for the published-icon gate (Issue #504).
 *
 * The gate is only as trustworthy as its failure cases: a check that
 * silently passes a drifted icon family is worse than no check, because
 * `validate:fast` then reports "green" for a head that points at a file
 * which does not exist. So most of this file is mutation testing — each
 * case starts from a coherent fixture and breaks exactly one link in the
 * head / manifest / file / token chain, then asserts the specific error.
 *
 * Fixture construction deliberately derives the `<link>` table and the
 * manifest icon list from `APP_ICON_SPECS` (the generator's table) so a
 * future size change does not have to be mirrored here. The tests assert
 * the GATE's behaviour, not a hand-copied list.
 *
 * The first case runs the gate against the real repository root: the
 * shipped contract is the thing under test.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
	HEAD_ROUTE_PATH,
	TOKENS_PATH,
	checkAppIcons,
	markColorFromFavicon,
	parseHeadIconLinks,
	parseManifestIcons,
	parseThemeColorMetas,
	tokenPalette,
} from './check-app-icons.mjs';
import { APP_ICON_SPECS, generateAppIcons } from './generate-app-icons.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURE_FAVICON =
	'<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#0000ff" r="1"/></svg>';
const FIXTURE_TOKENS = `export const rawTokens = {
	colors: {
		neutral: { 0: { value: '#ffffff' } },
		brand: { 700: { value: '#0369a1' } },
		charcoal: { 950: { value: '#0a0b0e' } },
	},
};
`;
const FIXTURE_HEADERS = `/site.webmanifest
  Content-Type: application/manifest+json
  Cache-Control: public, max-age=0, must-revalidate

/icons/*
  Cache-Control: public, max-age=0, must-revalidate
`;

/** The `<link>` block the fixture head declares, derived from the generator table. */
function fixtureHeadLinks() {
	const svgLink = "\t{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },";
	const rasterLinks = APP_ICON_SPECS.filter((spec) => spec.rel !== null).map(
		(spec) =>
			`\t{ rel: '${spec.rel}', type: 'image/png', sizes: '${spec.size}x${spec.size}', href: '/icons/${spec.file}' },`,
	);
	return [
		"import { createRootRoute } from '@tanstack/react-router';",
		'',
		'const APP_ICON_LINKS = [',
		svgLink,
		...rasterLinks,
		"\t{ rel: 'manifest', href: '/site.webmanifest' },",
		'];',
		'',
		'export const Route = createRootRoute({',
		'\thead: () => ({',
		'\t\tlinks: [...APP_ICON_LINKS],',
		'\t}),',
		'\tcomponent: RootComponent,',
		'});',
		'',
		'function RootComponent() {',
		'\treturn (',
		'\t\t<html lang="ja">',
		'\t\t\t<head>',
		'\t\t\t\t<HeadContent />',
		'\t\t\t\t<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />',
		'\t\t\t\t<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0b0e" />',
		'\t\t\t</head>',
		'\t\t\t<body />',
		'\t\t</html>',
		'\t);',
		'}',
		'',
	].join('\n');
}

function fixtureManifest() {
	const declared = APP_ICON_SPECS.filter((spec) => spec.rel === null).map((spec) => ({
		src: `/icons/${spec.file}`,
		sizes: `${spec.size}x${spec.size}`,
		type: 'image/png',
		purpose: spec.kind === 'maskable' ? 'maskable' : 'any',
	}));
	return {
		name: 'my-web-2026',
		short_name: 'my-web-2026',
		lang: 'ja',
		dir: 'ltr',
		id: '/',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		background_color: '#ffffff',
		theme_color: '#0369a1',
		icons: declared,
	};
}

/** A coherent icon-family fixture rooted at a temp directory. */
async function stageFixture() {
	const root = mkdtempSync(join(tmpdir(), 'check-app-icons-'));
	mkdirSync(join(root, 'src/routes'), { recursive: true });
	mkdirSync(join(root, 'src/editorial'), { recursive: true });
	mkdirSync(join(root, 'public'), { recursive: true });
	writeFileSync(join(root, 'public/favicon.svg'), FIXTURE_FAVICON);
	writeFileSync(join(root, 'src/editorial/tokens.ts'), FIXTURE_TOKENS);
	writeFileSync(join(root, 'public/_headers'), FIXTURE_HEADERS);
	writeFileSync(join(root, 'public/site.webmanifest'), JSON.stringify(fixtureManifest(), null, 2));
	writeFileSync(join(root, HEAD_ROUTE_PATH), fixtureHeadLinks());
	await generateAppIcons({ root });
	return root;
}

function withFixture(fn) {
	let root;
	return async (...args) => {
		root = await stageFixture();
		try {
			return await fn(root, ...args);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	};
}

const editHead = withFixture(async (root, mutate) => {
	const path = join(root, HEAD_ROUTE_PATH);
	writeFileSync(path, mutate(readFileSync(path, 'utf8')));
	const result = await checkAppIcons({ root });
	return result;
});

const editManifest = withFixture(async (root, mutate) => {
	const path = join(root, 'public/site.webmanifest');
	const manifest = mutate(JSON.parse(readFileSync(path, 'utf8')));
	writeFileSync(path, JSON.stringify(manifest, null, 2));
	return checkAppIcons({ root });
});

describe('check-app-icons — shipped repository', () => {
	it('passes against the real repository root', async () => {
		const result = await checkAppIcons({ root: repoRoot });
		assert.deepEqual(result.errors, []);
		assert.equal(result.ok, true);
	});
});

describe('check-app-icons — parsers', () => {
	it('reads the icon links out of the head block only', () => {
		const links = parseHeadIconLinks(
			[
				'const APP_ICON_LINKS = [',
				"\t{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },",
				"\t{ rel: 'icon', type: 'image/png', sizes: '16x16', href: '/icons/icon-16x16.png' },",
				'];',
				"const UNRELATED = { rel: 'stylesheet', href: '/x.css' };",
			].join('\n'),
		);
		assert.deepEqual(links, [
			{ rel: 'icon', type: 'image/svg+xml', sizes: null, href: '/favicon.svg' },
			{ rel: 'icon', type: 'image/png', sizes: '16x16', href: '/icons/icon-16x16.png' },
		]);
	});

	it('returns null when the head declares no icon block', () => {
		assert.equal(parseHeadIconLinks('export const Route = createRootRoute({});'), null);
	});

	it('reads both appearance-conditioned theme-color metas', () => {
		const metas = parseThemeColorMetas(
			[
				"{ name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#ffffff' },",
				"{ name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a0b0e' },",
				'<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />',
			].join('\n'),
		);
		assert.deepEqual(metas, [
			{ media: '(prefers-color-scheme: light)', content: '#ffffff' },
			{ media: '(prefers-color-scheme: dark)', content: '#0a0b0e' },
			{ media: '(prefers-color-scheme: light)', content: '#ffffff' },
		]);
	});

	it('normalises manifest icon entries and tolerates a missing list', () => {
		assert.deepEqual(parseManifestIcons({ icons: [{ src: '/a.png' }] }), [
			{ src: '/a.png', sizes: null, type: null, purpose: null },
		]);
		assert.deepEqual(parseManifestIcons({}), []);
	});

	it('collects the token palette in lower case', () => {
		assert.deepEqual([...tokenPalette("a: '#FFFFFF' b: '#0369a1'")], ['#ffffff', '#0369a1']);
	});

	it('reads the mark colour only when the favicon has one flat fill', () => {
		assert.equal(markColorFromFavicon('<circle fill="#0000FF"/>'), '#0000ff');
		assert.equal(markColorFromFavicon('<circle fill="#0000ff"/><circle fill="#ffffff"/>'), null);
	});
});

describe('check-app-icons — coherent fixture passes', () => {
	it('accepts a head, manifest and icon set that agree', async () => {
		const root = await stageFixture();
		try {
			const result = await checkAppIcons({ root });
			assert.deepEqual(result.errors, []);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('accepts a mark colour that no design token owns — the favicon is the mark authority', async () => {
		// The published mark is `#0000FF`, which `src/editorial/tokens.ts`
		// does not own. That is a recorded decision, not an accident, so
		// this case locks the behaviour the decision doc describes: the
		// palette check covers the canvas and the declared document
		// colours, never the mark. If a future ticket promotes the mark
		// to a token, THIS test is the one that must change with it.
		const root = await stageFixture();
		try {
			const palette = tokenPalette(readFileSync(join(root, TOKENS_PATH), 'utf8'));
			assert.equal(palette.has('#0000ff'), false, 'the fixture tokens must not own the mark');

			const result = await checkAppIcons({ root });
			assert.deepEqual(result.errors, []);
			assert.equal(result.facts.mark, '#0000ff');
			assert.equal(result.facts.canvas, '#ffffff');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-app-icons — mark provenance', () => {
	it('fails when the favicon fill changes but the rasters are not regenerated', async () => {
		// The drift the palette check cannot see, and the reason the
		// centre-pixel comparison exists: the mark is favicon-owned, so
		// the only thing tying the shipped PNGs to it is the pixel test.
		const root = await stageFixture();
		try {
			writeFileSync(
				join(root, 'public/favicon.svg'),
				'<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#ff0000" r="1"/></svg>',
			);
			const result = await checkAppIcons({ root });
			assert.match(
				result.errors.join('\n'),
				/centre pixel is #0000ff, expected the favicon mark #ff0000/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-app-icons — head / manifest / file drift', () => {
	it('fails when a required apple-touch-icon size disappears from the head', async () => {
		const result = await editHead((source) =>
			source.replace(/\t\{ rel: 'apple-touch-icon'[^}]*180x180[^}]*\},\n/, ''),
		);
		assert.match(result.errors.join('\n'), /declares no apple-touch-icon at 180x180/);
	});

	it('fails when the SVG favicon is dropped', async () => {
		const result = await editHead((source) =>
			source.replace(/\t\{ rel: 'icon', type: 'image\/svg\+xml'[^\n]*\n/, ''),
		);
		assert.match(result.errors.join('\n'), /no longer declares the Issue #285 SVG favicon/);
	});

	it('fails when the manifest link is dropped', async () => {
		const result = await editHead((source) => source.replace(/\t\{ rel: 'manifest'[^\n]*\n/, ''));
		assert.match(result.errors.join('\n'), /declares no rel="manifest" link/);
	});

	it('fails when a declared size no longer matches the real pixels', async () => {
		const result = await editHead((source) =>
			source.replace("sizes: '180x180'", "sizes: '181x181'"),
		);
		assert.match(result.errors.join('\n'), /declared 181x181 but the file is 180x180/);
	});

	it('fails when a head link points at a missing file', async () => {
		const root = await stageFixture();
		try {
			rmSync(join(root, 'public/icons/apple-touch-icon-180x180.png'));
			const result = await checkAppIcons({ root });
			assert.match(
				result.errors.join('\n'),
				/rel="apple-touch-icon" points at a missing file \/icons\/apple-touch-icon-180x180\.png/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails when the manifest points at a missing file', async () => {
		const root = await stageFixture();
		try {
			rmSync(join(root, 'public/icons/icon-512x512.png'));
			const result = await checkAppIcons({ root });
			assert.match(result.errors.join('\n'), /site\.webmanifest points at a missing file/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails on an unreferenced file in public/icons/', async () => {
		const root = await stageFixture();
		try {
			cpSync(join(root, 'public/icons/icon-16x16.png'), join(root, 'public/icons/icon-64x64.png'));
			const result = await checkAppIcons({ root });
			assert.match(
				result.errors.join('\n'),
				/public\/icons\/icon-64x64\.png is not referenced by the document head or the manifest/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails when one file is referenced twice', async () => {
		const result = await editHead((source) =>
			source.replace(
				'];',
				"\t{ rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192x192.png' },\n];",
			),
		);
		assert.match(result.errors.join('\n'), /\/icons\/icon-192x192\.png is referenced 2 times/);
	});
});

describe('check-app-icons — raster facts', () => {
	it('fails on a PNG that carries an alpha channel', async () => {
		const root = await stageFixture();
		try {
			await sharp({
				create: {
					width: 180,
					height: 180,
					channels: 4,
					background: { r: 0, g: 0, b: 255, alpha: 0.4 },
				},
			})
				.png()
				.toFile(join(root, 'public/icons/apple-touch-icon-180x180.png'));
			const result = await checkAppIcons({ root });
			assert.match(result.errors.join('\n'), /carries an alpha channel/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails when the rendered mark is not the favicon mark', async () => {
		const root = await stageFixture();
		try {
			await sharp({
				create: {
					width: 512,
					height: 512,
					channels: 3,
					background: { r: 255, g: 255, b: 255 },
				},
			})
				.png()
				.toFile(join(root, 'public/icons/icon-512x512.png'));
			const result = await checkAppIcons({ root });
			assert.match(result.errors.join('\n'), /centre pixel is #ffffff, expected the favicon mark/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-app-icons — manifest scope and colours', () => {
	it('fails when the manifest grows a member this ticket did not decide', async () => {
		const result = await editManifest((manifest) => ({ ...manifest, share_target: {} }));
		assert.match(result.errors.join('\n'), /share_target/);
		assert.match(result.errors.join('\n'), /outside this ticket's contract/);
	});

	it('fails when a required manifest member is missing', async () => {
		const result = await editManifest((manifest) => {
			const { display, ...rest } = manifest;
			return rest;
		});
		assert.match(result.errors.join('\n'), /missing the required member "display"/);
	});

	it('fails on a colour the token palette does not own', async () => {
		const result = await editManifest((manifest) => ({ ...manifest, theme_color: '#ff00ff' }));
		assert.match(result.errors.join('\n'), /theme_color #ff00ff is not a colour in/);
	});

	it('fails when a theme-color meta contradicts the shipped appearances', async () => {
		const result = await editHead((source) =>
			source.replace(
				/\t*<meta name="theme-color" media="\(prefers-color-scheme: dark\)"[^\n]*\n/,
				'',
			),
		);
		assert.match(
			result.errors.join('\n'),
			/expected exactly one light and one dark theme-color meta/,
		);
	});

	it('fails when the manifest Content-Type pin is removed from _headers', async () => {
		const root = await stageFixture();
		try {
			writeFileSync(
				join(root, 'public/_headers'),
				'/icons/*\n  Cache-Control: public, max-age=0, must-revalidate\n',
			);
			const result = await checkAppIcons({ root });
			assert.match(result.errors.join('\n'), /does not pin Content-Type/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('check-app-icons — offline behaviour stays undeclared', () => {
	it('fails when a route registers a service worker', async () => {
		const result = await editHead((source) =>
			source.replace(
				'export const Route =',
				"export function boot() { navigator.serviceWorker.register('/sw.js'); }\nexport const Route =",
			),
		);
		assert.match(result.errors.join('\n'), /registers a service worker/);
	});

	it('fails when a JavaScript module in src/ registers a service worker', async () => {
		// The tripwire must not be TypeScript-only: a `.js` / `.mjs` module
		// could register a worker just as easily as a route.
		const root = await stageFixture();
		try {
			writeFileSync(
				join(root, 'src/boot.js'),
				"export function boot() {\n\tnavigator.serviceWorker.register('/sw.js');\n}\n",
			);
			const result = await checkAppIcons({ root });
			assert.match(result.errors.join('\n'), /src\/boot\.js registers a service worker/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
