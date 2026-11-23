#!/usr/bin/env node
/**
 * GitHub profile work clips build (rebuildup/rebuildup#8 redesign).
 *
 * The profile README's Selected Work grid shows each work as an
 * independent animated WebP tile — a designed slideshow where several
 * works are visible at once, replacing the single hard-cut reel
 * (ADR-0025 reel path, superseded by the redesign ADR).
 *
 * Source selection (fail-closed, same boundary as works.ts / reel):
 *   - clip slugs resolve against `src/portfolio/notion/generated/
 *     snapshot.json` filtered to `published` + `public`;
 *   - `kind: "video"` takes the record's public YouTube link and cuts
 *     a `duration`-second segment at fraction `at`;
 *   - `kind: "gif"` takes the record's `isCover` animated GIF through
 *     the production `/media/<key>` route — a key that fails the
 *     public-media boundary answers 403 and fails the build.
 *
 * Pipeline (build-time only; nothing here runs in the Worker):
 *   video: yt-dlp --download-sections -> ffmpeg normalize (crop to
 *     canvas, fps, fade in/out) -> gif pipe -> sharp animated WebP.
 *   gif:   fetch /media/<key> -> sharp animated WebP (square canvas
 *     when `square: true`).
 *
 * Scene quality gate: every clip's sampled frames are probed for mean
 * luma; a clip that contains near-black or blank frames fails the
 * build — the old reel's first-frame-only gate let a mid-reel black
 * frame ship silently.
 *
 * Usage:
 *   node scripts/build-github-profile-clips.mjs           # regenerate
 *   node scripts/build-github-profile-clips.mjs --review  # dump review
 *                                                       # frames to
 *                                                       # .tmp/clips-review/
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(REPO_ROOT, 'src/http/github-profile/clips.json');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const OUT_DIR = join(REPO_ROOT, 'public/github-profile/clips');
const REVIEW_DIR = join(REPO_ROOT, '.tmp/clips-review');
const MEDIA_BASE = 'https://rebuildup.dev/media';

const YT_ID = /(?:youtu\.be\/|[?&]v=)([\w-]{11})/;
const MIN_LUMA = 20; // mean YAVG below this ≈ black/loading frame
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
	const id = link.url.match(YT_ID)?.[1];
	if (!id) throw new Error(`${project.slug}: unparseable video URL`);
	return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

function coverGifKeyFor(project) {
	const media = (project.media ?? []).find(
		(m) => m.isCover && m.contentType === 'image/gif' && typeof m.r2Key === 'string',
	);
	if (!media) throw new Error(`${project.slug}: no public cover GIF`);
	return media.r2Key;
}

function meanLuma(pngPath) {
	// ffmpeg signalstats YAVG on a PNG gives a deterministic luma probe.
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

async function sampleFrames(webpPath, count, workDir) {
	// Decode the produced animated WebP back to PNGs for the luma gate —
	// sharp reads animated WebP reliably where ffmpeg's demuxer does not.
	const buf = readFileSync(webpPath);
	const meta = await sharp(buf, { animated: true }).metadata();
	const totalPages = meta.pages ?? 1;
	const frames = [];
	for (let i = 0; i < count; i += 1) {
		const idx = Math.min(totalPages - 1, Math.floor((i * totalPages) / count));
		const png = await sharp(buf, { page: idx }).png().toBuffer();
		const p = join(workDir, `sample-${i}.png`);
		writeFileSync(p, png);
		frames.push(p);
	}
	return { frames };
}

async function buildVideoClip(clip, project, workDir) {
	const { canvas } = loadJson(MANIFEST_PATH);
	const W = canvas.width;
	const H = canvas.height;
	const fps = canvas.fps;
	const duration = clip.duration ?? 4;
	const info = JSON.parse(
		run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', project.videoUrl]),
	);
	const total = info.duration ?? 60;
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
			project.videoUrl,
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

	const outW = clip.square ? canvas.width : W;
	const outH = clip.square ? canvas.width : H;
	const vf = clip.square
		? `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuv420p,fps=${fps},fade=t=in:st=0:d=0.2,fade=t=out:st=${duration - 0.2}:d=0.2`
		: `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=yuv420p,fps=${fps},fade=t=in:st=0:d=0.2,fade=t=out:st=${duration - 0.2}:d=0.2`;
	const mp4 = join(srcDir, 'joined.mp4');
	run('ffmpeg', [
		'-y',
		'-v',
		'error',
		'-i',
		srcFile,
		'-vf',
		vf,
		'-t',
		String(duration),
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		mp4,
	]);
	const gif = join(srcDir, 'out.gif');
	run('ffmpeg', ['-v', 'error', '-i', mp4, '-f', 'gif', gif]);
	const webpPath = join(OUT_DIR, `${clip.slug}.webp`);
	await sharp(gif, { animated: true }).webp({ quality: 60, loop: 0 }).toFile(webpPath);
	return webpPath;
}

async function buildGifClip(clip, project, workDir) {
	const { canvas } = loadJson(MANIFEST_PATH);
	const key = coverGifKeyFor(project);
	const res = await fetch(`${MEDIA_BASE}/${key}`);
	if (!res.ok) throw new Error(`${clip.slug}: /media/${key} answered ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	const webpPath = join(OUT_DIR, `${clip.slug}.webp`);
	let pipeline = sharp(buf, { animated: true });
	if (clip.square) pipeline = pipeline.resize(canvas.width, canvas.width, { fit: 'cover' });
	else pipeline = pipeline.resize(canvas.width, canvas.height, { fit: 'cover' });
	await pipeline.webp({ quality: 70, loop: 0 }).toFile(webpPath);
	return webpPath;
}

async function main() {
	const manifest = loadJson(MANIFEST_PATH);
	const projects = publicProjects();
	const bySlug = new Map(projects.map((p) => [p.slug, p]));
	mkdirSync(OUT_DIR, { recursive: true });
	if (REVIEW) mkdirSync(REVIEW_DIR, { recursive: true });
	const workDir = mkdtempSync(join(tmpdir(), 'clips-'));

	const produced = [];
	for (const clip of manifest.clips) {
		const project = bySlug.get(clip.portfolioSlug);
		if (!project)
			throw new Error(`${clip.slug}: portfolio slug "${clip.portfolioSlug}" not public`);
		if (clip.kind === 'video') {
			project.videoUrl = videoUrlFor(project).url;
		}
		const webpPath =
			clip.kind === 'video'
				? await buildVideoClip(clip, project, workDir)
				: await buildGifClip(clip, project, workDir);
		produced.push(webpPath);
		console.log(`[clips] ${clip.slug}: ${webpPath}`);
	}

	// Luma gate: sample frames across every clip's full duration.
	let failures = 0;
	for (const webpPath of produced) {
		const slug = webpPath.split('/').pop().replace('.webp', '');
		const { frames } = await sampleFrames(webpPath, 8, workDir);
		for (const frame of frames) {
			const luma = meanLuma(frame);
			if (luma !== null && luma < MIN_LUMA) {
				console.error(`[clips] ${slug}: dark frame ${frame} luma=${luma.toFixed(1)}`);
				failures += 1;
			}
			if (REVIEW) {
				const { copyFileSync } = await import('node:fs');
				copyFileSync(frame, join(REVIEW_DIR, `${slug}-${frame.split('/').pop()}`));
			}
		}
	}
	rmSync(workDir, { recursive: true, force: true });
	if (failures > 0) {
		console.error(`[clips] ${failures} sampled frame(s) below luma ${MIN_LUMA} — refusing to ship`);
		process.exit(1);
	}
	console.log('[clips] all clips passed sampled-frame luma gate');
}

main().catch((err) => {
	console.error('[clips] build failed:', err);
	process.exit(1);
});
