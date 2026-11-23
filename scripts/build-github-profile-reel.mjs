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

function normalizeFilter(width, height, fit, canvas) {
	const { width: W, height: H } = canvas;
	if (fit === 'blur') {
		// Fill the canvas with a blurred, dimmed copy of the frame, then
		// overlay the sharp source — no black bars for vertical/square
		// footage, and the backdrop stays part of the picture.
		return [
			'[0:v]split[bg][fg]',
			`[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.15[bgout]`,
			`[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgout]`,
			`[bgout][fgout]overlay=(W-w)/2:(H-h)/2,fps=${canvas.fps},format=yuv420p`,
		].join(';');
	}
	return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${canvas.fps},format=yuv420p`;
}

function segmentFile(videoPath, seg, index, canvas, workDir) {
	const out = join(workDir, `seg${index}.mp4`);
	const vf = normalizeFilter(0, 0, seg.fit, canvas);
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
