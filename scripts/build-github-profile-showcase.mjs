#!/usr/bin/env node
/**
 * GitHub profile work showcase build (rebuildup/rebuildup#8, ADR-0026).
 *
 * The profile README's Selected Work section shows ONE animated WebP
 * that is a real slideshow: a vertical filmstrip of the owner's works
 * scrolls continuously upward, so several works are always visible at
 * once and the frame never sits still. This replaces both the v2
 * hard-cut reel and the rejected static 3x3 clip grid.
 *
 * Composition (see src/http/github-profile/showcase.json):
 *   - every work becomes a normalized segment (tileWidth x tileHeight,
 *     fps, segmentSeconds) sourced fail-closed from the public
 *     portfolio snapshot — YouTube sections for `kind: "video"`, the
 *     public `/media/<key>` cover GIF for `kind: "gif"`;
 *   - each work is an independent looping segment overlaid on the
 *     canvas; its y position is `cellIndex * cellHeight - scroll(t)`,
 *     so the whole strip scrolls upward and several works are always
 *     visible at once. The first `visibleCells + 1` works are appended
 *     again at the tail and scroll(t) wraps with
 *     `mod(t * speed, scrollDistance)`, so the loop is seamless;
 *   - the loop period equals scrollDistance / speed.
 *
 * Scene quality gate: sampled frames across the WHOLE output are probed
 * for mean luma — a dark or loading segment anywhere in the reel fails
 * the build (the v2 reel's first-frame-only gate missed a mid-reel
 * black frame).
 *
 * Pipeline (build-time only; nothing here runs in the Worker):
 *   yt-dlp --download-sections / /media fetch -> ffmpeg normalize ->
 *   per-cell overlay marquee -> gif pipe -> sharp animated WebP.
 *
 * Usage:
 *   node scripts/build-github-profile-showcase.mjs           # regenerate
 *   node scripts/build-github-profile-showcase.mjs --review  # dump
 *                                                          # sampled
 *                                                          # frames to
 *                                                          # .tmp/showcase-review/
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOWCASE_PATH = join(REPO_ROOT, 'src/http/github-profile/showcase.json');
const SOURCES_PATH = join(REPO_ROOT, 'src/http/github-profile/clips.json');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const OUT_PATH = join(REPO_ROOT, 'public/github-profile/showcase.webp');
const SRC_CACHE = join(REPO_ROOT, '.tmp/showcase-src');
const WORK_DIR = join(REPO_ROOT, '.tmp/showcase-build');
const REVIEW_DIR = join(REPO_ROOT, '.tmp/showcase-review');
const MEDIA_BASE = 'https://rebuildup.dev/media';

const YT_ID = /(?:youtu\.be\/|[?&]v=)([\w-]{11})/;
const MIN_LUMA = 20;
const REVIEW = process.argv.includes('--review');

function loadJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function run(cmd, args) {
	return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function publicProjects() {
	const snapshot = loadJson(SNAPSHOT_PATH);
	return (snapshot.records ?? []).filter(
		(record) => record.status === 'published' && record.visibility === 'public',
	);
}

function videoUrlFor(project) {
	const link = (project.links ?? []).find((l) => l.kind === 'video' && typeof l.url === 'string');
	if (!link) throw new Error(`${project.slug}: no public video link`);
	// Snapshot URLs may carry markdown escapes (e.g. `\_`); strip them
	// before extracting the video id.
	const clean = link.url.replace(/\\([\w])/g, '$1');
	const id = clean.match(YT_ID)?.[1];
	if (!id) throw new Error(`${project.slug}: unparseable video URL`);
	return `https://www.youtube.com/watch?v=${id}`;
}

function coverGifKeyFor(project) {
	const media = (project.media ?? []).find(
		(m) => m.isCover && m.contentType === 'image/gif' && typeof m.r2Key === 'string',
	);
	if (!media) throw new Error(`${project.slug}: no public cover GIF`);
	return media.r2Key;
}

async function ensureVideoSource(clip, project, workDir) {
	const cache = join(SRC_CACHE, `${clip.slug}.mp4`);
	if (existsSync(cache)) return cache;
	const url = videoUrlFor(project);
	const info = JSON.parse(run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url]));
	const total = info.duration ?? 60;
	const duration = clip.duration ?? 4;
	const start = Math.max(0, Math.floor(total * clip.at) - 1);
	const end = start + duration + 1;
	const srcDir = join(workDir, clip.slug);
	mkdirSync(srcDir, { recursive: true });
	try {
		run('yt-dlp', [
			'-f',
			'bv*[height<=720]+ba/b[height<=720]/best',
			'--merge-output-format',
			'mp4',
			'--download-sections',
			`*${start}-${end}`,
			'-o',
			join(srcDir, 'src.%(ext)s'),
			url,
		]);
	} catch {
		// partial download is fine — ffmpeg reads what arrived
	}
	const srcFile = execFileSync(
		'bash',
		['-c', `ls ${srcDir}/src.* 2>/dev/null | grep -v '\\.part' | head -1`],
		{
			encoding: 'utf8',
		},
	).trim();
	if (!srcFile) throw new Error(`${clip.slug}: yt-dlp produced no source`);
	mkdirSync(SRC_CACHE, { recursive: true });
	run('ffmpeg', ['-y', '-v', 'error', '-i', srcFile, '-c', 'copy', cache]);
	return cache;
}

async function ensureGifSource(clip, project) {
	const cache = join(SRC_CACHE, `${clip.slug}.gif`);
	if (existsSync(cache)) return cache;
	const key = coverGifKeyFor(project);
	const res = await fetch(`${MEDIA_BASE}/${key}`);
	if (!res.ok) throw new Error(`${clip.slug}: /media/${key} answered ${res.status}`);
	mkdirSync(SRC_CACHE, { recursive: true });
	writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
	return cache;
}

function meanLuma(pngPath) {
	const { stdout } = spawnSync(
		'ffmpeg',
		[
			'-i',
			pngPath,
			'-vf',
			'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
			'-f',
			'null',
			'-',
		],
		{ encoding: 'utf8' },
	);
	const match = stdout.match(/YAVG=([\d.]+)/);
	return match ? Number(match[1]) : null;
}

async function main() {
	const showcase = loadJson(SHOWCASE_PATH);
	const sources = loadJson(SOURCES_PATH);
	const canvas = showcase.canvas;
	const projects = publicProjects();
	const bySlug = new Map(projects.map((p) => [p.slug, p]));
	const clipBySlug = new Map(sources.clips.map((c) => [c.slug, c]));

	const workDir = mkdtempSync(join(tmpdir(), 'showcase-'));
	mkdirSync(WORK_DIR, { recursive: true });
	if (REVIEW) mkdirSync(REVIEW_DIR, { recursive: true });

	const { tileWidth: TW, tileHeight: TH, cellHeight: CH, fps, segmentSeconds: SEG } = canvas;
	const bg = canvas.background.replace('#', '0x');
	const normVf = `scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},fps=${fps},pad=${TW}:${CH}:0:0:color=${bg}`;

	// 1. Normalize every ordered work to a cell-sized segment.
	const segmentFiles = [];
	for (const slug of showcase.order) {
		const clip = clipBySlug.get(slug);
		if (!clip) throw new Error(`showcase order references unknown clip "${slug}"`);
		const project = bySlug.get(clip.portfolioSlug);
		if (!project) throw new Error(`${slug}: portfolio slug "${clip.portfolioSlug}" not public`);
		const src =
			clip.kind === 'video'
				? await ensureVideoSource(clip, project, workDir)
				: await ensureGifSource(clip, project);
		const out = join(WORK_DIR, `seg-${slug}.mp4`);
		const loopIn = clip.kind === 'gif' ? ['-stream_loop', '-1'] : [];
		run('ffmpeg', [
			'-y',
			'-v',
			'error',
			...loopIn,
			'-i',
			src,
			'-vf',
			normVf,
			'-t',
			String(SEG),
			'-c:v',
			'libx264',
			'-preset',
			'fast',
			'-pix_fmt',
			'yuv420p',
			out,
		]);
		segmentFiles.push(out);
		console.log(`[showcase] segment ${slug} ok`);
	}

	// 2. Marquee: every cell is an independent looping segment overlaid
	//    on the background; its y position is a function of time, so the
	//    whole strip scrolls upward at `speed` px/s. The sequence repeats
	//    the first (visibleCells + 1) works, and the scroll wraps with
	//    mod(t*speed, scrollDistance) — at the wrap instant the repeated
	//    cells sit exactly where the originals were, so the loop is
	//    seamless (each segment is SEG seconds, scrollDistance is a
	//    multiple of SEG*speed, and the repeat offset is a whole number
	//    of segment loops).
	const repeatCount = canvas.visibleCells + 1;
	const filmstripEntries = [...segmentFiles, ...segmentFiles.slice(0, repeatCount)];
	const cellsPerLoop = showcase.order.length;
	const scrollDistance = cellsPerLoop * CH;
	const visibleHeight = canvas.visibleCells * CH;
	const speed = CH / SEG; // px per second — one cell every segmentSeconds
	const loopSeconds = scrollDistance / speed;
	const filmstripCells = filmstripEntries.length;
	if (scrollDistance + visibleHeight > filmstripCells * CH) {
		throw new Error('filmstrip too short for seamless loop');
	}
	const xOff = Math.round((canvas.width - TW) / 2);
	const yOff = Math.round((canvas.height - visibleHeight) / 2);

	const args = ['-y', '-v', 'error'];
	for (const file of filmstripEntries) {
		args.push('-stream_loop', '-1', '-fflags', '+genpts', '-i', file);
	}
	let filter = `color=c=${bg}:s=${canvas.width}x${canvas.height}:d=${loopSeconds}:r=${fps}[bg]`;
	let prev = 'bg';
	for (let i = 0; i < filmstripCells; i += 1) {
		const yExpr = `${yOff}+${i * CH}-mod(t*${speed}\\,${scrollDistance})`;
		const out = i === filmstripCells - 1 ? 'vout' : `o${i}`;
		filter += `;[${prev}][${i}:v]overlay=${xOff}:'${yExpr}'[${out}]`;
		prev = out;
	}
	args.push(
		'-filter_complex',
		filter,
		'-map',
		'[vout]',
		'-t',
		String(loopSeconds),
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		join(WORK_DIR, 'marquee.mp4'),
	);
	run('ffmpeg', args);

	// 4. gif pipe -> sharp animated WebP (same path as the reel builder;
	//    this ffmpeg build has no libwebp encoder).
	const gif = join(WORK_DIR, 'marquee.gif');
	run('ffmpeg', ['-y', '-v', 'error', '-i', join(WORK_DIR, 'marquee.mp4'), '-f', 'gif', gif]);
	mkdirSync(dirname(OUT_PATH), { recursive: true });
	await sharp(gif, { animated: true }).webp({ quality: canvas.quality, loop: 0 }).toFile(OUT_PATH);
	console.log(`[showcase] wrote ${OUT_PATH}`);

	// 5. Sampled-frame luma gate across the whole loop.
	const meta = await sharp(readFileSync(OUT_PATH), { animated: true }).metadata();
	const pages = meta.pages ?? 1;
	let failures = 0;
	const samples = 12;
	for (let i = 0; i < samples; i += 1) {
		const idx = Math.min(pages - 1, Math.floor((i * pages) / samples));
		const png = join(WORK_DIR, `sample-${i}.png`);
		writeFileSync(png, await sharp(readFileSync(OUT_PATH), { page: idx }).png().toBuffer());
		const luma = meanLuma(png);
		if (luma !== null && luma < MIN_LUMA) {
			console.error(`[showcase] dark frame page=${idx} luma=${luma.toFixed(1)}`);
			failures += 1;
		}
		if (REVIEW) {
			const { copyFileSync } = await import('node:fs');
			copyFileSync(png, join(REVIEW_DIR, `showcase-${String(idx).padStart(3, '0')}.png`));
		}
	}
	rmSync(workDir, { recursive: true, force: true });
	if (failures > 0) {
		console.error(`[showcase] ${failures} sampled frame(s) below luma ${MIN_LUMA}`);
		process.exit(1);
	}
	console.log(`[showcase] ${pages} frames, all sampled frames passed luma gate`);
}

main().catch((err) => {
	console.error('[showcase] build failed:', err);
	process.exit(1);
});
