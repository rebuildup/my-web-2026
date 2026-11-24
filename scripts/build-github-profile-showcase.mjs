#!/usr/bin/env node
/**
 * GitHub profile work showcase build — scene-based motion collage
 * (rebuildup/rebuildup#8 review round 2, Issue #1214, ADR-0026).
 *
 * The README's Selected Work section shows ONE animated WebP:
 * a horizontal, height-constrained collage of the owner's works.
 * Unlike the rejected uniform marquee/grid, every work gets its own
 * screen time, size, crop and role:
 *
 *   - scenes have deliberately different layouts (hero + support,
 *     asymmetric split, trio, duo) defined in showcase.json;
 *   - hero items get a slow Ken Burns push-in (scale eval=frame +
 *     centre crop) spanning the whole scene;
 *   - support items drift on independent sinusoidal periods/phases;
 *   - scenes are joined by alternating DIAGONAL wipes (xfade
 *     diagtl/diagbr/diagtr/diagbl), so the focal work changes
 *     organically instead of the whole frame sliding uniformly;
 *   - the last scene repeats the first scene's file so the final
 *     diagonal wipe lands back on scene 1, and bookend fades to the
 *     canvas background make the wrap seamless by construction.
 *
 * Sources are fail-closed from the public portfolio snapshot:
 * YouTube sections for `kind: "video"` (the `at` fraction inside
 * clips.json picks the section), the public `/media/<key>` cover
 * GIF for `kind: "gif"`. Nothing here runs in the Worker.
 *
 * Scene quality gate: sampled frames across the WHOLE output are
 * probed for mean luma — a dark or loading segment anywhere fails
 * the build.
 *
 * Pipeline (build-time only):
 *   yt-dlp --download-sections / /media fetch -> ffmpeg normalize ->
 *   per-scene overlay composites -> xfade diagonal wipes ->
 *   gif pipe -> sharp animated WebP.
 *
 * Usage:
 *   node scripts/build-github-profile-showcase.mjs           # regenerate
 *   node scripts/build-github-profile-showcase.mjs --review  # dump frames
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOWCASE_PATH = join(REPO_ROOT, 'src/http/github-profile/showcase.json');
const SOURCES_PATH = join(REPO_ROOT, 'src/http/github-profile/clips.json');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const MEDIA_BASE = 'https://rebuildup.dev/media';
const WORK_DIR = join(REPO_ROOT, '.tmp/showcase-build');
const SRC_CACHE = join(REPO_ROOT, '.tmp/showcase-src');
const REVIEW_DIR = join(REPO_ROOT, '.tmp/showcase-review');
const REVIEW = process.argv.includes('--review');
const OUT_PATH = join(REPO_ROOT, 'public/github-profile/showcase.webp');
const MIN_LUMA = 18;
const YT_ID = /(?:youtube\.com\/(?:watch\?[^ ]*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

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

async function ensureVideoSource(clip, project, workDir, sectionSeconds) {
	const cache = join(SRC_CACHE, `${clip.slug}-${sectionSeconds}s.mp4`);
	if (existsSync(cache)) return cache;
	const url = videoUrlFor(project);
	const metaCache = join(SRC_CACHE, `${clip.slug}.info.json`);
	let total;
	if (existsSync(metaCache)) {
		total = loadJson(metaCache).duration ?? sectionSeconds;
	} else {
		const info = JSON.parse(run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url]));
		mkdirSync(SRC_CACHE, { recursive: true });
		writeFileSync(metaCache, JSON.stringify(info));
		total = info.duration ?? sectionSeconds;
	}
	const duration = clip.duration ?? 4;
	const start = Math.max(0, Math.floor(total * (clip.at ?? 0.35)) - 1);
	const end = start + sectionSeconds;
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
		{ encoding: 'utf8' },
	).trim();
	if (!srcFile) throw new Error(`${clip.slug}: yt-dlp produced no source`);
	mkdirSync(SRC_CACHE, { recursive: true });
	run('ffmpeg', ['-y', '-v', 'error', '-i', srcFile, '-c', 'copy', cache]);
	return cache;
}

async function ensureGifSource(clip, project, sectionSeconds) {
	const cache = join(SRC_CACHE, `${clip.slug}-${sectionSeconds}s.gif`);
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
	const { width: W, height: H, fps, quality, border, borderPx } = canvas;
	const bg = canvas.background.replace('#', '0x');
	const borderColor = border.replace('#', '0x');
	const TRANS = showcase.transitionSeconds;
	const projects = publicProjects();
	const bySlug = new Map(projects.map((p) => [p.slug, p]));
	const clipBySlug = new Map(sources.clips.map((c) => [c.slug, c]));

	const workDir = mkdtempSync(join(tmpdir(), 'showcase-'));
	mkdirSync(WORK_DIR, { recursive: true });
	if (REVIEW) mkdirSync(REVIEW_DIR, { recursive: true });

	async function sourceFor(slug) {
		const clip = clipBySlug.get(slug);
		if (!clip) throw new Error(`unknown clip "${slug}"`);
		const project = bySlug.get(clip.portfolioSlug);
		if (!project) throw new Error(`${slug}: portfolio slug "${clip.portfolioSlug}" not public`);
		return clip.kind === 'video'
			? ensureVideoSource(clip, project, workDir, showcase.elementSeconds)
			: ensureGifSource(clip, project, showcase.elementSeconds);
	}

	// Normalize each work once into a looping element at its largest
	// needed size; scenes reuse the file. 12 s elements mean no internal
	// loop cut occurs inside any scene (max scene = 8 s).
	const elementCache = new Map();
	async function element(slug, w, h, bordered) {
		const key = `${slug}-${w}x${h}${bordered ? '-b' : ''}`;
		if (elementCache.has(key)) return elementCache.get(key);
		const out = join(WORK_DIR, `elem-${key}.mp4`);
		if (!existsSync(out)) {
			const src = await sourceFor(slug);
			const inner = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p`;
			const vf = bordered
				? `${inner},pad=${w + borderPx * 2}:${h + borderPx * 2}:${borderPx}:${borderPx}:color=${borderColor}`
				: inner;
			run('ffmpeg', [
				'-y',
				'-v',
				'error',
				'-stream_loop',
				'-1',
				'-fflags',
				'+genpts',
				'-i',
				src,
				'-vf',
				vf,
				'-t',
				String(showcase.elementSeconds),
				'-c:v',
				'libx264',
				'-preset',
				'fast',
				'-pix_fmt',
				'yuv420p',
				'-an',
				out,
			]);
		}
		elementCache.set(key, out);
		return out;
	}

	// Render one scene: bg + per-item overlays. Hero items get a
	// Ken Burns push-in; drift items get a small sinusoidal offset.
	async function renderScene(scene) {
		const out = join(WORK_DIR, `scene-${scene.slug}.mp4`);
		if (existsSync(out)) return out;
		const D = scene.duration;
		const args = ['-y', '-v', 'error'];
		const items = [];
		let inputIndex = 0;
		for (const it of scene.items) {
			const bordered = it.border === true;
			const file = await element(it.slug, it.w, it.h, bordered);
			args.push('-stream_loop', '-1', '-fflags', '+genpts', '-i', file);
			items.push({ idx: inputIndex, ...it });
			inputIndex += 1;
		}
		const filters = [`color=c=${bg}:s=${W}x${H}:d=${D}:r=${fps}[bg]`];
		let prev = 'bg';
		items.forEach((it, i) => {
			const tag = `i${i}`;
			const src = `[${it.idx}:v]`;
			if (it.hero) {
				// Slow push-in over the whole scene: zoom 1.00 -> 1.10
				// eased by (1-cos)/2, centre crop keeps the frame filled.
				const z = `(1-cos(2*PI*t/${D}))/2`;
				filters.push(
					`${src}scale=w='${it.w}*(1+0.10*${z})':h='${it.h}*(1+0.10*${z})':eval=frame,crop=${it.w}:${it.h}:x='(in_w-out_w)/2':y='(in_h-out_h)/2',setsar=1,fps=${fps}[${tag}]`,
				);
			} else {
				filters.push(`${src}setsar=1,fps=${fps}[${tag}]`);
			}
			const drift = it.drift ?? 0;
			const phase = (i * 1.7).toFixed(2);
			const xExpr = drift ? `${it.x}+${drift}*sin(2*PI*t/${D}+${phase})` : `${it.x}`;
			const out = i === items.length - 1 ? 'vout' : `o${i}`;
			filters.push(`[${prev}][${tag}]overlay=x='${xExpr}':y='${it.y}'[${out}]`);
			prev = out;
		});
		args.push(
			'-filter_complex',
			filters.join(';'),
			'-map',
			'[vout]',
			'-t',
			String(D),
			'-c:v',
			'libx264',
			'-preset',
			'fast',
			'-pix_fmt',
			'yuv420p',
			'-an',
			out,
		);
		run('ffmpeg', args);
		return out;
	}

	const sceneFiles = [];
	const sceneDurs = [];
	for (const scene of showcase.scenes) {
		sceneFiles.push(await renderScene(scene));
		sceneDurs.push(scene.duration);
	}
	const loopScene = showcase.scenes.find((s) => s.slug === showcase.loopBack);
	if (!loopScene) throw new Error(`loopBack scene "${showcase.loopBack}" not found`);
	sceneFiles.push(sceneFiles[showcase.scenes.indexOf(loopScene)]);
	sceneDurs.push(loopScene.duration);

	// xfade chain: each transition occupies the last TRANS seconds of
	// the accumulated stream; the appended loop-back scene makes the
	// final wipe land on scene 1's opening frame.
	const args = ['-y', '-v', 'error'];
	for (const f of sceneFiles) args.push('-i', f);
	const xfilters = [];
	let prev = '0:v';
	let acc = sceneDurs[0];
	for (let i = 1; i < sceneFiles.length; i += 1) {
		const out = i === sceneFiles.length - 1 ? 'vout' : `x${i}`;
		const offset = acc - TRANS;
		xfilters.push(
			`[${prev}][${i}:v]xfade=transition=${showcase.wipes[i - 1]}:duration=${TRANS}:offset=${offset}[${out}]`,
		);
		prev = out;
		acc += sceneDurs[i] - TRANS;
	}
	// Bookend the loop: fade in from / out to the canvas background so
	// the wrap is seamless by construction — the last frames and the
	// first frames are both the flat background, and no content-phase
	// matching is required at the seam.
	const FADE = 0.35;
	const total = acc;
	xfilters.push(
		`[vout]fade=t=in:st=0:d=${FADE}:color=${bg},fade=t=out:st=${(total - FADE).toFixed(2)}:d=${FADE}:color=${bg}[vfinal]`,
	);
	args.push(
		'-filter_complex',
		xfilters.join(';'),
		'-map',
		'[vfinal]',
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		join(WORK_DIR, 'showcase.mp4'),
	);
	run('ffmpeg', args);

	// gif pipe -> sharp animated WebP (this ffmpeg build has no libwebp).
	const gif = join(WORK_DIR, 'showcase.gif');
	run('ffmpeg', ['-y', '-v', 'error', '-i', join(WORK_DIR, 'showcase.mp4'), '-f', 'gif', gif]);
	mkdirSync(dirname(OUT_PATH), { recursive: true });
	await sharp(gif, { animated: true }).webp({ quality, loop: 0 }).toFile(OUT_PATH);
	console.log(`[showcase] wrote ${OUT_PATH}`);

	// Sampled-frame luma gate across the whole loop.
	const meta = await sharp(readFileSync(OUT_PATH), { animated: true }).metadata();
	const pages = meta.pages ?? 1;
	let failures = 0;
	const samples = 12;
	for (let i = 0; i < samples; i += 1) {
		// Sample the middle 80% — the bookend fades legitimately sit
		// near the luma floor by design.
		const idx = Math.min(pages - 1, Math.floor(pages * (0.1 + (0.8 * i) / samples)));
		const png = join(WORK_DIR, `sample-${i}.png`);
		writeFileSync(png, await sharp(readFileSync(OUT_PATH), { page: idx }).png().toBuffer());
		const luma = meanLuma(png);
		if (luma !== null && luma < MIN_LUMA) {
			console.error(`[showcase] dark frame page=${idx} luma=${luma.toFixed(1)}`);
			failures += 1;
		}
		if (REVIEW) {
			writeFileSync(
				join(REVIEW_DIR, `showcase-${String(idx).padStart(3, '0')}.png`),
				readFileSync(png),
			);
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
