#!/usr/bin/env node
/**
 * GitHub profile works asset build (Issue #1196, ADR-0025).
 *
 * The `rebuildup/rebuildup` profile README embeds real portfolio works
 * as independent images. GitHub/Camo fetches each `<img>` URL once and
 * caches it, so the bytes behind
 * `https://rebuildup.dev/github-profile/works/<slug>.webp` must already
 * be display-sized: this script regenerates the committed WebP
 * derivatives under `public/github-profile/works/` from the SAME public
 * media the portfolio publishes — never from mockups or self-made art.
 *
 * Source selection (fail-closed, mirrors `model.ts#coverMediaCandidates`):
 *   - project resolved by slug from `src/portfolio/notion/generated/
 *     snapshot.json` (the committed public snapshot),
 *   - `isCover` raster media only, in `displayOrder` — the recorded
 *     licence condition in `quality/asset-license-inventory.json`
 *     (`github-profile-works`) is cover-only, so non-cover rasters are
 *     never candidates here,
 *   - each candidate is fetched through the production `/media/<key>`
 *     route, so a key that fails the public-media boundary answers 403
 *     and is skipped — the script cannot publish a private object.
 *
 * Stale-asset rule (Issue #1199): after processing the manifest, every
 * `<slug>.webp` under `public/github-profile/works/` that this run did
 * not produce — because the slug left `works.json`, the project left
 * the published+public snapshot, or no cover is publicly servable — is
 * removed (build mode) or reported (check mode). Static Assets serves
 * `public/` verbatim, so a leftover derivative would keep publishing
 * bytes for a work that is no longer public.
 *
 * Output: one `<slug>.webp` per manifest entry, max width 1200px,
 * WebP q80 via `sharp` (already a devDependency). Deterministic enough
 * for review: re-running on unchanged sources reproduces equivalent
 * bytes; the diff is the review surface.
 *
 * Usage:
 *   node scripts/build-github-profile-works.mjs          # regenerate
 *   node scripts/build-github-profile-works.mjs --check  # verify only
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(REPO_ROOT, 'src/http/github-profile/works.json');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const OUT_DIR = join(REPO_ROOT, 'public/github-profile/works');
const MEDIA_BASE = 'https://rebuildup.dev/media';
const MAX_WIDTH = 1200;
const WEBP_QUALITY = 80;

const RASTER_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const CHECK_ONLY = process.argv.includes('--check');

function loadJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function coverCandidates(project) {
	return (project.media ?? [])
		.filter((media) => media.isCover && RASTER_CONTENT_TYPES.has(media.contentType))
		.sort((a, b) => a.displayOrder - b.displayOrder)
		.map((media) => media.r2Key)
		.filter((key) => typeof key === 'string' && key.length > 0);
}

async function fetchPublicMedia(key) {
	const response = await fetch(`${MEDIA_BASE}/${key}`);
	if (!response.ok) return null;
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.startsWith('image/')) return null;
	return Buffer.from(await response.arrayBuffer());
}

async function renderWebp(sourceBytes) {
	return sharp(sourceBytes)
		.resize({ width: MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: WEBP_QUALITY })
		.toBuffer();
}

const manifest = loadJson(MANIFEST_PATH);
const snapshot = loadJson(SNAPSHOT_PATH);
// Mirror `notionProjects()`: only records the CMS marks published+public
// may back a public asset. `unavailable` snapshots keep their records.
const projects = (snapshot.records ?? []).filter(
	(record) => record.status === 'published' && record.visibility === 'public',
);
const bySlug = new Map(projects.map((project) => [project.slug, project]));

const results = [];
const produced = new Set();
let failures = 0;

for (const entry of manifest.works) {
	const project = bySlug.get(entry.slug);
	const outPath = join(OUT_DIR, `${entry.slug}.webp`);
	if (!project) {
		console.error(`[works] ${entry.slug}: not in public snapshot — skipped`);
		failures += 1;
		continue;
	}
	let bytes = null;
	let usedKey = null;
	for (const key of coverCandidates(project)) {
		const candidate = await fetchPublicMedia(key);
		if (candidate) {
			bytes = candidate;
			usedKey = key;
			break;
		}
	}
	if (!bytes) {
		console.error(`[works] ${entry.slug}: no publicly servable cover media`);
		failures += 1;
		continue;
	}
	const webp = await renderWebp(bytes);
	produced.add(`${entry.slug}.webp`);
	if (CHECK_ONLY) {
		const current = existsSync(outPath) ? readFileSync(outPath) : null;
		if (!current || !current.equals(webp)) {
			console.error(`[works] ${entry.slug}: committed asset is stale or missing`);
			failures += 1;
			continue;
		}
	} else {
		mkdirSync(OUT_DIR, { recursive: true });
		writeFileSync(outPath, webp);
	}
	results.push(`${entry.slug}.webp ${webp.length}B <- ${usedKey}`);
}

// Stale-asset sweep: a derivative this run did not produce must not keep
// being served — `public/` is delivered verbatim by Static Assets.
if (existsSync(OUT_DIR)) {
	for (const file of readdirSync(OUT_DIR)) {
		if (!file.endsWith('.webp') || produced.has(file)) continue;
		const stalePath = join(OUT_DIR, file);
		if (CHECK_ONLY) {
			console.error(`[works] ${file}: stale derived asset (not produced by this run)`);
			failures += 1;
		} else {
			rmSync(stalePath);
			console.log(`[works] removed stale ${file}`);
		}
	}
}

for (const line of results) console.log(`[works] ${line}`);
if (failures > 0) {
	console.error(`[works] ${failures} entr${failures === 1 ? 'y' : 'ies'} failed`);
	process.exit(1);
}
console.log(
	`[works] ${results.length} asset(s) ${CHECK_ONLY ? 'verified' : 'written'} to public/github-profile/works/`,
);
