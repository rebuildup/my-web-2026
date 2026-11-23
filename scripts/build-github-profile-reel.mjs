#!/usr/bin/env node
/**
 * GitHub profile work reel build (Issue #1204, ADR-0025).
 *
 * The `rebuildup/rebuildup` profile README shows selected works as ONE
 * compact animated WebP — a short reel that cycles through real motion
 * footage from the owner's own published portfolio videos. Unlike the
 * static `works/*.webp` derivatives this asset is NOT regenerable from
 * `/media` alone: its sources are the YouTube links recorded on the
 * public portfolio snapshot (`links[].kind === 'video'`).
 *
 * Source selection (fail-closed, same boundary as works.ts):
 *   - segment slugs resolve against `src/portfolio/notion/generated/
 *     snapshot.json` filtered to `published` + `public` — a work that
 *     leaves the public set drops out and the script fails;
 *   - the video URL comes from that same public record, never from an
 *     authored string in the manifest;
 *   - `fit` decides the composition: `crop` centre-crops to the canvas
 *     (landscape sources), `blur` fills with a blurred, darkened copy
 *     of the frame (vertical / square sources) — no meaningless black
 *     bars either way.
 *
 * Scene quality gate: each segment's first frame is probed for mean
 * luma; a segment that opens on a near-black or loading frame fails
 * the build so a bad intro can never ship silently. The manifest's
 * `at` fraction is the authored scene pick — adjust it after reviewing
 * the dumped review frames, not by guessing.
 *
 * Pipeline (build-time only; nothing here runs in the Worker):
 *   yt-dlp --download-sections -> ffprobe dims -> ffmpeg normalize
 *   (crop or blur-pad to canvas, fps) -> concat -> gif pipe ->
 *   sharp animated WebP.
 *
 * Usage:
 *   node scripts/build-github-profile-reel.mjs           # regenerate
 *   node scripts/build-github-profile-reel.mjs --review  # also dump
 *                                                     # first-frame PNGs
 *                                                     # to .tmp/reel-review/
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(REPO_ROOT, 'src/http/github-profile/reel.json');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const OUT_PATH = join(REPO_ROOT, 'public/github-profile/reel.webp');
const REVIEW_DIR = join(REPO_ROOT, '.tmp/reel-review');

const YT_ID = /(?:youtu\.be\/|[?&]v=)([\w-]{11})/;
const MIN_LUMA = 25; // mean YAVG below this ≈ a dark/loading frame

const REVIEW = process.argv.includes('--review');

function loadJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function videoUrlFor(project) {
	const link = (project.links ?? []).find(
		(l) => l.kind === 'video' && typeof l.url === 'string' && YT_ID.test(l.url),
	);
	return link?.url ?? null;
}

function run(cmd, args, opts = {}) {
	return execFileSync(cmd, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		...opts,
	});
}

function ytInfo(url) {
	// ffprobe cannot read YouTube URLs; yt-dlp's JSON dump carries the
	// duration and per-format dimensions without downloading anything.
	const out = run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url]);
	const data = JSON.parse(out);
	const formats = (data.formats ?? []).filter(
		(f) => f.vcodec && f.vcodec !== 'none' && (f.height ?? 9999) <= 480,
	);
	formats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
	const best = formats[0];
	return {
		duration: Number(data.duration ?? 0),
		width: best?.width ?? 0,
		height: best?.height ?? 0,
	};
}

function meanLuma(file) {
	// metadata=print writes the signalstats values to stderr; use
	// spawnSync so both streams are captured.
	const { stderr } = spawnSync(
		'ffmpeg',
		[
			'-v',
			'info',
			'-i',
			file,
			'-vf',
			'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
			'-frames:v',
			'1',
			'-f',
			'null',
			'-',
		],
		{ encoding: 'utf8' },
	);
	return Number(String(stderr ?? '').match(/YAVG=([\d.]+)/)?.[1] ?? 0);
}

// Baked-in letterbox bars survive every fit mode, so detect the region
// that carries visible content and crop to it. Per-frame cropdetect is
// unreliable here: a transient bright pixel stretches the union crop and
// leaves mostly-black columns at the foreground edge — the thin dark
// seam between the sharp frame and the blurred backdrop. Instead,
// sample frames across the video and keep only rows/columns whose mean
// luma clears a low threshold; a pure-black bar contributes exactly 0.
const CROP_SAMPLE_TARGET = 30;
const CROP_MIN_MEAN = 3;
const CROP_INSET = 2;

function detectCrop(videoPath) {
	const probe = spawnSync(
		'ffprobe',
		[
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=width,height:format=duration',
			'-of',
			'csv=p=0',
			videoPath,
		],
		{ encoding: 'utf8' },
	);
	const [srcW, srcH, duration] = String(probe.stdout ?? '')
		.trim()
		.split(/[,\n]/)
		.map(Number);
	if (!srcW || !srcH) return null;
	const interval = Math.max(1, Math.round((duration || 10) / CROP_SAMPLE_TARGET));
	const { stdout, status } = spawnSync(
		'ffmpeg',
		['-v', 'error', '-i', videoPath, '-vf', `fps=1/${interval},format=gray`, '-f', 'rawvideo', '-'],
		{ maxBuffer: 256 * 1024 * 1024 },
	);
	if (status !== 0 || !stdout?.length) return null;
	const frameBytes = srcW * srcH;
	const frames = Math.floor(stdout.length / frameBytes);
	if (frames === 0) return null;
	const colSum = new Float64Array(srcW);
	const rowSum = new Float64Array(srcH);
	for (let f = 0; f < frames; f++) {
		const base = f * frameBytes;
		for (let y = 0; y < srcH; y++) {
			const rowBase = base + y * srcW;
			let rowAcc = 0;
			for (let x = 0; x < srcW; x++) {
				const v = stdout[rowBase + x];
				colSum[x] += v;
				rowAcc += v;
			}
			rowSum[y] += rowAcc;
		}
	}
	const colMean = (x) => colSum[x] / (frames * srcH);
	const rowMean = (y) => rowSum[y] / (frames * srcW);
	const bounds = (mean, size) => {
		let lo = 0;
		let hi = size - 1;
		while (lo < size && mean(lo) <= CROP_MIN_MEAN) lo++;
		while (hi > lo && mean(hi) <= CROP_MIN_MEAN) hi--;
		return [lo, hi];
	};
	const [x0, xr] = bounds(colMean, srcW);
	const [y0, yr] = bounds(rowMean, srcH);
	// Require a meaningful trim; tiny jitters must not cut real pixels.
	if (xr - x0 >= srcW * 0.98 && yr - y0 >= srcH * 0.98) return null;
	const ix = Math.min(CROP_INSET, Math.floor((xr - x0) / 4));
	const iy = Math.min(CROP_INSET, Math.floor((yr - y0) / 4));
	return {
		w: xr - x0 - ix * 2 + 1,
		h: yr - y0 - iy * 2 + 1,
		x: x0 + ix,
		y: y0 + iy,
	};
}

function normalizeFilter(width, height, fit, canvas, crop) {
	const { width: W, height: H } = canvas;
	const pre = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : '';
	if (fit === 'blur') {
		// Fill the canvas with a blurred, dimmed copy of the frame, then
		// overlay the sharp source — no black bars for vertical/square
		// footage, and the backdrop stays part of the picture.
		return [
			`[0:v]${pre}split[bg][fg]`,
			`[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.15[bgout]`,
			`[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgout]`,
			`[bgout][fgout]overlay=(W-w)/2:(H-h)/2,fps=${canvas.fps},format=yuv420p`,
		].join(';');
	}
	return `${pre}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${canvas.fps},format=yuv420p`;
}

function segmentFile(videoPath, seg, index, canvas, workDir) {
	const out = join(workDir, `seg${index}.mp4`);
	const vf = normalizeFilter(0, 0, seg.fit, canvas, detectCrop(videoPath));
	run('ffmpeg', [
		'-y',
		'-v',
		'error',
		'-ss',
		String(seg.start),
		'-t',
		String(seg.duration),
		'-i',
		videoPath,
		'-vf',
		vf,
		'-an',
		'-c:v',
		'libx264',
		'-pix_fmt',
		'yuv420p',
		out,
	]);
	return out;
}

const manifest = loadJson(MANIFEST_PATH);
const snapshot = loadJson(SNAPSHOT_PATH);
const projects = (snapshot.records ?? []).filter(
	(r) => r.status === 'published' && r.visibility === 'public',
);
const bySlug = new Map(projects.map((p) => [p.slug, p]));

const canvas = { width: 640, height: 360, fps: 6, ...manifest.canvas };
const workDir = mkdtempSync(join(tmpdir(), 'reel-'));
const segments = [];
let failures = 0;

try {
	for (const [i, seg] of manifest.segments.entries()) {
		const project = bySlug.get(seg.slug);
		const url = project ? videoUrlFor(project) : null;
		if (!project || !url) {
			console.error(
				`[reel] ${seg.slug}: not a published+public work with a YouTube link — skipped`,
			);
			failures += 1;
			continue;
		}
		const info = ytInfo(url);
		const start = Math.min(seg.at * info.duration, Math.max(0, info.duration - seg.duration - 1));
		const absStart = Math.max(0, start);
		// Fetch only the needed range at <=480p.
		const raw = join(workDir, `src${i}.%(ext)s`);
		run('yt-dlp', [
			'-f',
			'bv*[height<=480]+ba/b[height<=480]',
			'--download-sections',
			`*${absStart.toFixed(2)}-${(absStart + seg.duration).toFixed(2)}`,
			'-o',
			raw,
			url,
		]);
		const srcFile = execFileSync('bash', ['-c', `ls ${workDir}/src${i}.* | head -1`], {
			encoding: 'utf8',
		}).trim();
		if (!existsSync(srcFile)) {
			console.error(`[reel] ${seg.slug}: yt-dlp produced no file`);
			failures += 1;
			continue;
		}
		// Luma gate on the segment's first frame.
		const firstPng = join(workDir, `first${i}.png`);
		run('ffmpeg', ['-y', '-v', 'error', '-i', srcFile, '-frames:v', '1', firstPng]);
		const luma = meanLuma(firstPng);
		if (REVIEW) {
			mkdirSync(REVIEW_DIR, { recursive: true });
			writeFileSync(join(REVIEW_DIR, `${seg.slug}-first.png`), readFileSync(firstPng));
		}
		if (luma < MIN_LUMA) {
			console.error(
				`[reel] ${seg.slug}: first frame too dark (YAVG=${luma.toFixed(1)}) — pick a different "at"`,
			);
			failures += 1;
			continue;
		}
		segments.push({
			slug: seg.slug,
			file: segmentFile(srcFile, { ...seg, start: 0, duration: seg.duration }, i, canvas, workDir),
		});
		console.log(
			`[reel] ${seg.slug}: ${absStart.toFixed(1)}s+${seg.duration}s luma=${luma.toFixed(0)}`,
		);
	}

	if (failures > 0) throw new Error(`${failures} segment(s) failed`);
	if (segments.length === 0) throw new Error('no segments');

	const listPath = join(workDir, 'list.txt');
	writeFileSync(listPath, `${segments.map((s) => `file '${s.file}'`).join('\n')}\n`);
	const joined = join(workDir, 'joined.mp4');
	run('ffmpeg', [
		'-y',
		'-v',
		'error',
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		listPath,
		'-c',
		'copy',
		joined,
	]);

	// gif pipe -> sharp animated WebP (ffmpeg here has no libwebp).
	const gifPath = process.env.REEL_GIF_OUT;
	const gif = execFileSync(
		'ffmpeg',
		gifPath
			? ['-y', '-v', 'error', '-i', joined, '-f', 'gif', gifPath]
			: ['-v', 'error', '-i', joined, '-f', 'gif', '-'],
		{
			encoding: gifPath ? 'utf8' : 'buffer',
			maxBuffer: 256 * 1024 * 1024,
		},
	);
	mkdirSync(dirname(OUT_PATH), { recursive: true });
	const webp = await sharp(gifPath ? readFileSync(gifPath) : gif, { animated: true })
		.webp({ quality: 35, effort: 6 })
		.toBuffer();
	writeFileSync(OUT_PATH, webp);
	if (gifPath) console.log(`[reel] gif comparison -> ${gifPath}`);
	console.log(`[reel] wrote ${OUT_PATH} (${webp.length} bytes, ${segments.length} segments)`);
} finally {
	rmSync(workDir, { recursive: true, force: true });
}
