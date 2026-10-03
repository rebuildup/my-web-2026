import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Production portfolio smoke (release-window post-publish contract).
//
// Companion to e2e/prod-smoke.spec.ts. Run via pnpm run
// e2e:prod:portfolio (= cross-env
// PLAYWRIGHT_BASE_URL=https://rebuildup.dev playwright test
// e2e/prod-portfolio.spec.ts).
//
// This spec is deliberately NOT part of `pnpm run e2e:prod` (Smoke #2)
// nor `pnpm run e2e:prod:transition` (Smoke #1). Those two gates run
// against a production Worker where the Portfolio candidates are
// still unpublished, so the per-detail assertions below cannot pass.
// See the G15 acceptance contract at the bottom of this header.
//
// playwright.config.ts testIgnore rules:
//   - localhost PLAYWRIGHT_BASE_URL: any spec matching the
//     prod-*.spec.ts glob is ignored (so pnpm run e2e cannot
//     accidentally hit production).
//   - production PLAYWRIGHT_BASE_URL: any spec matching the
//     portfolio.spec.ts glob is ignored (so pnpm run e2e:prod
//     cannot accidentally run the local D1-mutating portfolio
//     spec).
//
// Strictly READ-ONLY against the canonical production origin
// https://rebuildup.dev and the R2 custom domain
// https://media.rebuildup.dev:
//
//   - No D1 writes, no R2 writes, no auth mutations.
//   - No reset / clearCookies against any production storage.
//   - release-assets/portfolio/<version>/manifest.json is treated
//     as the source of truth; the version segment is derived from
//     package.json#version at test load time. Every assertion
//     iterates over assets[] rather than hard-coding the current
//     release candidates, so the next publication window reuses
//     this spec without edits.
//
// G15 acceptance contract (see release operator packet v3):
//   - This spec is the end-to-end public-surface verification
//     AFTER G14 (--operation=publish) lands. Until G14, the
//     candidates remain visibility=draft and the per-detail OGP /
//     canonical assertions will fail; that is by design, the spec
//     lands before G14, but its semantic assertion is only valid
//     post-G14.
//   - G7 publication-driver verify is the cryptographic SHA-256 /
//     byte integrity gate; G15 does NOT duplicate that contract,
//     only the public-surface reachability + OGP contract.

interface ManifestAsset {
	candidate_id: string;
	slug: string;
	title: string;
	asset_filename: string;
	asset_relative_path: string;
	r2_key: string;
	content_type: string;
	byte_size: number;
	width: number;
	height: number;
	sha256: string;
	alt: string;
	is_cover: boolean;
}

interface Manifest {
	release: string;
	r2_bucket: string;
	r2_bucket_binding: string;
	assets: ManifestAsset[];
}

const CANONICAL_ORIGIN = 'https://rebuildup.dev';
const MEDIA_ORIGIN = 'https://media.rebuildup.dev';

function loadManifest(): Manifest {
	const here = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(here, '..');
	const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
		version: string;
	};
	const manifestPath = resolve(
		repoRoot,
		'release-assets',
		'portfolio',
		pkg.version,
		'manifest.json',
	);
	return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

test.describe('production portfolio smoke (release-window post-publish contract)', () => {
	const manifest = loadManifest();
	const coverAssets = manifest.assets.filter((a) => a.is_cover);

	test('manifest shape: every entry has slug + r2_key + content_type + sha256', () => {
		expect(manifest.assets.length, 'manifest.assets must be non-empty').toBeGreaterThan(0);
		for (const a of manifest.assets) {
			expect(a.slug, `${a.candidate_id}: slug`).toMatch(/^[a-z0-9-]+$/);
			expect(a.r2_key, `${a.candidate_id}: r2_key`).toMatch(/^portfolio\//);
			expect(a.content_type, `${a.candidate_id}: content_type`).toMatch(/^[a-z]+\/[a-z0-9+.-]+$/);
			expect(a.sha256, `${a.candidate_id}: sha256`).toMatch(/^[a-f0-9]{64}$/);
		}
	});

	test('GET /portfolio returns 200 (public list)', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/portfolio`);
		expect(res.status(), 'GET /portfolio').toBe(200);
		expect(res.url().startsWith('https://')).toBe(true);
	});

	test('every published manifest entry appears on /portfolio', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/portfolio`);
		expect(res.status()).toBe(200);
		const body = await res.text();
		for (const a of coverAssets) {
			expect(body, `published slug "${a.slug}" must be on /portfolio list`).toContain(a.slug);
		}
	});

	for (const asset of coverAssets) {
		test(`GET /portfolio/${asset.slug} returns 200 + canonical + OGP (${asset.candidate_id})`, async ({
			request,
		}) => {
			const res = await request.get(`${CANONICAL_ORIGIN}/portfolio/${asset.slug}`);
			expect(res.status(), `GET /portfolio/${asset.slug}`).toBe(200);
			const body = await res.text();

			// Canonical link points at the canonical production origin.
			expect(body, `link[rel=canonical] for ${asset.slug}`).toMatch(
				/<link\s+rel="canonical"\s+href="https:\/\/rebuildup\.dev\/portfolio\/[a-z0-9-]+"\s*\/?>/,
			);

			// OGP / Twitter card metadata contract.
			expect(body, `og:type for ${asset.slug}`).toMatch(/property="og:type"\s+content="article"/);
			expect(body, `og:title for ${asset.slug}`).toMatch(/property="og:title"\s+content="[^"]+"/);
			expect(body, `og:image for ${asset.slug}`).toMatch(
				/property="og:image"\s+content="https:\/\/media\.rebuildup\.dev\/portfolio\//,
			);
			expect(body, `twitter:card for ${asset.slug}`).toMatch(
				/name="twitter:card"\s+content="[^"]+"/,
			);

			// Image URL matches the expected R2 key.
			expect(
				body,
				`${asset.slug}: og:image references https://media.rebuildup.dev/${asset.r2_key}`,
			).toContain(`https://media.rebuildup.dev/${asset.r2_key}`);
		});
	}

	for (const asset of coverAssets) {
		test(`GET https://media.rebuildup.dev/${asset.r2_key} returns 200 + ${asset.content_type}`, async ({
			request,
		}) => {
			const res = await request.get(`${MEDIA_ORIGIN}/${asset.r2_key}`);
			expect(res.status(), `GET ${MEDIA_ORIGIN}/${asset.r2_key}`).toBe(200);
			const ct = res.headers()['content-type'] ?? '';
			expect(ct, `Content-Type for ${asset.r2_key}`).toContain(asset.content_type);
		});
	}
});
