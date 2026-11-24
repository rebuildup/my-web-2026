#!/usr/bin/env node
/**
 * GitHub profile showcase PROTOTYPE — motion-collage candidates
 * (rebuildup/rebuildup#8 review round 2, Issue #1214).
 *
 * Two candidate directions built from REAL work footage so they can be
 * compared as actual animations, not descriptions:
 *
 *   proto-a "parallax collage" (horizontal-dominant):
 *     800x360 canvas. A fullscreen background work slowly zooms/pans
 *     (Ken Burns). Three bordered tiles drift on independent sinusoidal
 *     periods/phases at different depths, and two smaller works
 *     traverse the frame on linear pass-throughs at different speeds
 *     and directions. No hard cuts; every motion period divides the
 *     18 s loop so the wrap is seamless.
 *
 *   proto-b "diagonal-mask scenes" (mask-transition-dominant):
 *     800x360 canvas. Four scenes with deliberately different layouts
 *     (hero+support / asymmetric split / trio / duo) joined by
 *     alternating diagonal xfade wipes (diagtl/diagbr/diagtr/diagbl).
 *     Scene durations vary (8/4/8/4 s) so screen time per work differs;
 *     a 4 s repeat of scene 1 closes the loop — its content phase at
 *     the wrap equals the first frame, making the loop seamless.
 *
 * Sources are fail-closed from the public portfolio snapshot exactly
 * like the production builders: YouTube sections for `kind: "video"`,
 * the public `/media/<key>` cover GIF for `kind: "gif"`. Nothing here
 * ships — output goes to .tmp/collage-proto/ for review.
 *
 * Usage:
 *   node scripts/build-github-profile-collage-proto.mjs [a|b|all]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const CLIPS_PATH = join(REPO_ROOT, 'src/http/github-profile/clips.json');
const MEDIA_BASE = 'https://rebuildup.dev/media';
const WORK_DIR = join(REPO_ROOT, '.tmp/collage-proto');
const SRC_CACHE = join(REPO_ROOT, '.tmp/collage-src');
const OUT_DIR = join(WORK_DIR, 'out');
const YT_ID = /(?:youtube\.com\/(?:watch\?[^ ]*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

const CANVAS_W = 800;
const CANVAS_H = 360;
const FPS = 8;
const BG = '0x0B0F14';
const BORDER = '0x334155';
const BORDER_PX = 4;
const SECTION_SECONDS = 12;

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

async function ensureVideoSource(clip, project) {
	const cache = join(SRC_CACHE, `${clip.slug}.mp4`);
	if (existsSync(cache)) return cache;
	const url = videoUrlFor(project);
	const metaCache = join(SRC_CACHE, `${clip.slug}.info.json`);
	let total;
	if (existsSync(metaCache)) {
		total = loadJson(metaCache).duration ?? SECTION_SECONDS;
	} else {
		const info = JSON.parse(run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url]));
		mkdirSync(SRC_CACHE, { recursive: true });
		writeFileSync(metaCache, JSON.stringify(info));
		total = info.duration ?? SECTION_SECONDS;
	}
	const start = Math.max(0, Math.floor(total * (clip.at ?? 0.35)) - 1);
	const workDir = mkdtempSync(join(tmpdir(), 'collage-src-'));
	const srcDir = join(workDir, clip.slug);
	mkdirSync(srcDir, { recursive: true });
	try {
		run('yt-dlp', [
			'-f',
			'bv*[height<=720]+ba/b[height<=720]/best',
			'--merge-output-format',
			'mp4',
			'--download-sections',
			`*${start}-${start + SECTION_SECONDS}`,
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

const projects = publicProjects();
const bySlug = new Map(projects.map((p) => [p.slug, p]));
const clipBySlug = new Map(loadJson(CLIPS_PATH).clips.map((c) => [c.slug, c]));

async function sourceFor(slug) {
	const clip = clipBySlug.get(slug);
	if (!clip) throw new Error(`unknown clip "${slug}"`);
	const project = bySlug.get(clip.portfolioSlug);
	if (!project) throw new Error(`${slug}: portfolio slug "${clip.portfolioSlug}" not public`);
	return clip.kind === 'video' ? ensureVideoSource(clip, project) : ensureGifSource(clip, project);
}

/** Normalize a work into a looping element of exactly w x h (+ optional border). */
async function element(slug, w, h, { border = false, seconds = 12 } = {}) {
	const out = join(WORK_DIR, `elem-${slug}-${w}x${h}${border ? '-b' : ''}.mp4`);
	if (existsSync(out)) return out;
	const src = await sourceFor(slug);
	const inner = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},format=yuv420p`;
	const vf = border
		? `${inner},pad=${w + BORDER_PX * 2}:${h + BORDER_PX * 2}:${BORDER_PX}:${BORDER_PX}:color=${BORDER}`
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
		String(seconds),
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		out,
	]);
	return out;
}

/** Full-bleed background element, oversized for Ken Burns headroom. */
async function bgElement(slug, seconds) {
	const w = 880;
	const h = Math.round((w * CANVAS_H) / CANVAS_W); // 396
	return element(slug, w, h, { seconds });
}

function overlayInput(args, file, inputIndex) {
	args.push('-stream_loop', '-1', '-fflags', '+genpts', '-i', file);
	return inputIndex;
}

async function protoA() {
	const LOOP = 18;
	// bg zoom period must equal its own segment duration for a clean wrap;
	// bg element is 18 s of source loops — its own hard cuts are inside
	// the footage, same class as every other element.
	const bg = await bgElement('prototype', LOOP);
	const t1 = await element('flashbeat', 300, 169, { border: true });
	const t2 = await element('multislicer', 300, 169, { border: true });
	const t3 = await element('aulymo-v02', 190, 107, { border: true });
	const p1 = await element('foldlayers', 200, 112, { border: true });
	const p2 = await element('ugoita', 200, 112, { border: true });

	const args = ['-y', '-v', 'error'];
	overlayInput(args, bg, 0); // 0
	overlayInput(args, t1, 1); // 1
	overlayInput(args, t2, 2); // 2
	overlayInput(args, t3, 3); // 3
	overlayInput(args, p1, 4); // 4
	overlayInput(args, p2, 5); // 5

	// bg: slow zoom-in-out once per loop, always covering the canvas.
	const z = `(1-cos(2*PI*t/${LOOP}))/2`;
	let fc = `color=c=${BG}:s=${CANVAS_W}x${CANVAS_H}:d=${LOOP}:r=${FPS}[bg0]`;
	fc += `;[0:v]scale=w='880*(1+0.07*${z})':h='396*(1+0.07*${z})':eval=frame[bgs]`;
	fc += ';[bg0][bgs]overlay=x=(W-w)/2:y=(H-h)/2[bg]';

	// drifting tiles — each on its own period/phase/amplitude.
	const T1 = 9;
	const T2 = 6;
	const drift = [
		[1, `x='40+25*sin(2*PI*t/${T1})'`, `y='176+8*sin(2*PI*t/${T1}+1.3)'`],
		[2, `x='470-30*sin(2*PI*t/${T1}+0.7)'`, `y='24+10*sin(2*PI*t/${T2})'`],
		[3, `x='620+20*sin(2*PI*t/${T2}+2)'`, `y='210-12*sin(2*PI*t/${T1})'`],
	];
	let prev = 'bg';
	drift.forEach(([idx, x, y], i) => {
		const out = i === drift.length - 1 ? 'stage' : `d${i}`;
		fc += `;[${prev}][${idx}:v]overlay=${x}:${y}[${out}]`;
		prev = out;
	});

	// pass-throughs: linear traverse, wrap offscreen; spans divide 18*speed.
	const pass = [
		[4, 'x=-200+mod(t*160\\,1440)', 'y=250'], // 160px/s, two crossings? span1440 -> wraps at 9s & 18s
		[5, 'x=950-mod(t*110\\,1980)', 'y=60'], // 110px/s right-to-left, one crossing
	];
	pass.forEach(([idx, x, y], i) => {
		const out = i === pass.length - 1 ? 'vout' : `p${i}`;
		fc += `;[${prev}][${idx}:v]overlay=${x}:${y}[${out}]`;
		prev = out;
	});

	args.push(
		'-filter_complex',
		fc,
		'-map',
		'[vout]',
		'-t',
		String(LOOP),
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		join(WORK_DIR, 'proto-a.mp4'),
	);
	run('ffmpeg', args);
	await toWebp('proto-a');
}

async function sceneInputs(spec) {
	// spec: { duration, items: [{slug,w,h,x,y,border?}] }
	const args = ['-y', '-v', 'error'];
	const items = [];
	let inputIndex = 0;
	for (const it of spec.items) {
		const file = await element(it.slug, it.w, it.h, { border: it.border ?? false, seconds: 4 });
		const idx = overlayInput(args, file, inputIndex);
		inputIndex += 1;
		items.push({ idx, ...it });
	}
	let fc = `color=c=${BG}:s=${CANVAS_W}x${CANVAS_H}:d=${spec.duration}:r=${FPS}[bg]`;
	let prev = 'bg';
	items.forEach((it, i) => {
		const out = i === items.length - 1 ? 'vout' : `s${i}`;
		fc += `;[${prev}][${it.idx}:v]overlay=${it.x}:${it.y}[${out}]`;
		prev = out;
	});
	args.push(
		'-filter_complex',
		fc,
		'-map',
		'[vout]',
		'-t',
		String(spec.duration),
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		join(WORK_DIR, spec.name),
	);
	run('ffmpeg', args);
	return join(WORK_DIR, spec.name);
}

async function protoB() {
	// Scene layouts deliberately differ: hero+support, asymmetric split,
	// trio, duo. Underlying element loops are 4 s; scene durations are
	// multiples of 4 s so each work's content phase realigns at cuts
	// (which the wipes mask anyway).
	const s1 = await sceneInputs({
		name: 'scene-s1.mp4',
		duration: 8,
		items: [
			{ slug: 'prototype', w: 620, h: 349, x: 160, y: 6 },
			{ slug: 'flashbeat', w: 170, h: 96, x: 8, y: 16, border: true },
		],
	});
	const s2 = await sceneInputs({
		name: 'scene-s2.mp4',
		duration: 4,
		items: [
			{ slug: 'multislicer', w: 400, h: 360, x: 0, y: 0 },
			{ slug: 'aulymo-v02', w: 400, h: 225, x: 400, y: 67, border: true },
		],
	});
	const s3 = await sceneInputs({
		name: 'scene-s3.mp4',
		duration: 8,
		items: [
			{ slug: 'foldlayers', w: 460, h: 259, x: 170, y: 50, border: true },
			{ slug: 'ugoita', w: 240, h: 135, x: 30, y: 205, border: true },
			{ slug: 'homura', w: 160, h: 90, x: 610, y: 30, border: true },
		],
	});
	const s4 = await sceneInputs({
		name: 'scene-s4.mp4',
		duration: 4,
		items: [
			{ slug: 'kosen', w: 400, h: 360, x: 0, y: 0 },
			{ slug: 'tegaki', w: 380, h: 214, x: 410, y: 20, border: true },
		],
	});
	// Loop-back: first 4 s of scene 1 — same content phase as frame 0.
	const s1c = join(WORK_DIR, 'scene-s1c.mp4');
	run('ffmpeg', [
		'-y',
		'-v',
		'error',
		'-i',
		s1,
		'-t',
		'4',
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		s1c,
	]);

	const TRANS = 0.8;
	const scenes = [s1, s2, s3, s4, s1c];
	const wipes = ['diagtl', 'diagbr', 'diagtr', 'diagbl'];
	const args = ['-y', '-v', 'error'];
	for (const f of scenes) args.push('-i', f);
	// xfade chain: transition occupies the last TRANS seconds of the
	// accumulated stream; offset = accumulated duration - TRANS.
	const durs = [8, 4, 8, 4, 4];
	const filters = [];
	let prev = '0:v';
	let acc = durs[0];
	for (let i = 1; i < scenes.length; i += 1) {
		const out = i === scenes.length - 1 ? 'vout' : `x${i}`;
		const offset = acc - TRANS;
		filters.push(
			`[${prev}][${i}:v]xfade=transition=${wipes[i - 1]}:duration=${TRANS}:offset=${offset}[${out}]`,
		);
		prev = out;
		acc += durs[i] - TRANS;
	}
	const fc = filters.join(';');
	args.push(
		'-filter_complex',
		fc,
		'-map',
		'[vout]',
		'-c:v',
		'libx264',
		'-preset',
		'fast',
		'-pix_fmt',
		'yuv420p',
		'-an',
		join(WORK_DIR, 'proto-b.mp4'),
	);
	run('ffmpeg', args);
	await toWebp('proto-b');
}

async function toWebp(name) {
	const mp4 = join(WORK_DIR, `${name}.mp4`);
	const gif = join(WORK_DIR, `${name}.gif`);
	run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-f', 'gif', gif]);
	mkdirSync(OUT_DIR, { recursive: true });
	await sharp(gif, { animated: true })
		.webp({ quality: 40, loop: 0 })
		.toFile(join(OUT_DIR, `${name}.webp`));
	console.log(`[collage] ${name}.webp written`);
}

const which = process.argv[2] ?? 'all';
mkdirSync(WORK_DIR, { recursive: true });
if (which === 'a' || which === 'all') await protoA();
if (which === 'b' || which === 'all') await protoB();
