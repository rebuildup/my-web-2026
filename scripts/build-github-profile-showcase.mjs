#!/usr/bin/env node
/**
 * GitHub profile work showcase build — main/sub/decor relay
 * (rebuildup/rebuildup#8 review round 3, Issue #1214, ADR-0026).
 *
 * The README's Selected Work section shows ONE animated WebP:
 * a horizontal, height-constrained relay where the protagonist
 * role passes between works. Collage/scroll/wipe are means, not
 * goals — what matters is that every moment has a clear
 * main / sub / decor relationship:
 *
 *   - acts[] in showcase.json define who is MAIN (centre stage),
 *     PREVIEW (next protagonist, top sub slot), PREV (just-shown
 *     protagonist, middle sub slot) and CONTEXT (supporting work,
 *     bottom sub slot) for each act;
 *   - at each act boundary every changing role glides between
 *     slots on a smoothstep over `transition` seconds — the next
 *     work grows out of its preview slot while the outgoing main
 *     shrinks into the prev slot, so the hand-off reads as one
 *     causal motion instead of a cut;
 *   - act durations differ on purpose (protagonist time varies);
 *   - a slow whole-loop "breathing" scale (per-element phase) and
 *     a role-proportional drift (subs move, main stays planted)
 *     keep the frame alive without competing with the roles;
 *   - the last act hands off to the first act's arrangement
 *     inside the final `transition` seconds, and bookend fades to
 *     the canvas background make the wrap seamless by
 *     construction — no content-phase matching required.
 *
 * Sources are fail-closed from the public portfolio snapshot:
 * YouTube sections for `kind: "video"`, the public `/media/<key>`
 * cover GIF for `kind: "gif"`. Nothing here runs in the Worker.
 *
 * Scene quality gate: sampled frames across the WHOLE output are
 * probed for mean luma — a dark or loading segment anywhere fails
 * the build.
 *
 * Pipeline (build-time only):
 *   yt-dlp --download-sections / /media fetch -> ffmpeg normalize ->
 *   per-frame deterministic composite (JS motion math + constant-size
 *   overlays; avoids ffmpeg 9 framesync mis-pairing on varying-size
 *   secondary streams) -> img2webp animated WebP.
 *
 * Usage:
 *   node scripts/build-github-profile-showcase.mjs                    # regenerate
 *   node scripts/build-github-profile-showcase.mjs --review           # dump frames
 *   node scripts/build-github-profile-showcase.mjs --config <path>    # variant config
 *
 * Theme variants (Issue #1242): the decorative colors live in the
 * config's optional `theme` block — `vignette`, `panelFill`, `rim`,
 * `frameUnderlay`, `frameAccent`, `dockFill`, `dockStroke`. Absent
 * keys fall back to the dark-theme values, so `showcase.json` is
 * unchanged; `showcase.light.json` carries the light set and its own
 * `output` path.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const configArg = process.argv.indexOf('--config');
const SHOWCASE_PATH =
	configArg > -1 && process.argv[configArg + 1]
		? join(REPO_ROOT, process.argv[configArg + 1])
		: join(REPO_ROOT, 'src/http/github-profile/showcase.json');
const SOURCES_PATH = join(REPO_ROOT, 'src/http/github-profile/clips.json');
const SNAPSHOT_PATH = join(REPO_ROOT, 'src/portfolio/notion/generated/snapshot.json');
const MEDIA_BASE = 'https://rebuildup.dev/media';
const WORK_DIR = join(REPO_ROOT, '.tmp/showcase-build');
const SRC_CACHE = join(REPO_ROOT, '.tmp/showcase-src');
const REVIEW_DIR = join(REPO_ROOT, '.tmp/showcase-review');
const REVIEW = process.argv.includes('--review');
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

// ---- schedule engine -------------------------------------------------
//
// Slots are expressed as scale factor s (element is element.w x
// element.h), plus centre coordinates. "off" parks the element far
// outside the canvas at near-zero scale.

function slotParams(showcase, name) {
	const { element, slots } = showcase;
	if (name === 'off') return { s: 0.02, cx: -400, cy: -400 };
	const park = name.match(/^park(\d+)$/);
	if (park) {
		const rect = slots.parks[Number(park[1])];
		return { s: rect.w / element.w, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
	}
	const rect = name === 'main' ? slots.main : slots.subs[Number(name.slice(3))];
	return {
		s: rect.w / element.w,
		cx: rect.x + rect.w / 2,
		cy: rect.y + rect.h / 2,
	};
}

// Per work: collect (start, dur, delta) changes for each param.
// value(t) = v0 + sum(delta_j * smoothstep(clamp((t-a_j)/d_j)))
function buildMotion(showcase) {
	const { acts, duration: D, transition: T } = showcase;
	const TRANS = T;
	// act boundaries (end of each act); last boundary is the wrap
	// point at D, where act5 hands off to act1's arrangement.
	const bounds = [];
	let acc = 0;
	for (const act of acts) {
		acc += act.duration;
		bounds.push(acc);
	}
	const works = [...new Set(acts.flatMap((a) => [a.main, a.preview, a.prev, a.context]))];
	// Works without a role in an act park in the dock slots (bottom-
	// right dead zone) instead of leaving the canvas — keeps every
	// transition on-stage and fills the empty quadrant.
	const parkCount = showcase.slots.parks?.length ?? 0;
	// Each work prefers a stable dock slot (global order) so the dock
	// does not reshuffle every act; collisions within one act scan
	// forward for the next free slot.
	const parkPref = new Map(works.map((w, i) => [w, i % Math.max(1, parkCount)]));
	const SUB_SLOTS = ['sub0', 'sub1', 'sub2', 'sub3'];
	// Vacancy sequence: BL stays filled every act (bottom row never
	// reads top-heavy), and Act 4's empty corner moves off BR where
	// it paired with a near-black TR sub (v23 imbalance note).
	const VACANT_ORDER = [0, 1, 3, 0, 1];
	const slotOf = acts.map((act, actIdx) => {
		// The vacant corner rotates across the loop instead of leaving
		// one quadrant permanently dead.
		const vacant = SUB_SLOTS[VACANT_ORDER[actIdx % VACANT_ORDER.length]];
		const filled = SUB_SLOTS.filter((s) => s !== vacant);
		const roles = [...new Set([act.preview, act.prev, act.context])];
		const map = { [act.main]: 'main' };
		roles.forEach((w, i) => {
			map[w] = filled[i] ?? 'off';
		});
		const used = new Set(Object.values(map));
		const unassigned = works.filter((w) => !(w in map)).sort();
		for (const w of unassigned) {
			if (parkCount === 0) {
				map[w] = 'off';
				continue;
			}
			for (let k = 0; k < parkCount; k += 1) {
				const cand = `park${(parkPref.get(w) + k) % parkCount}`;
				if (!used.has(cand)) {
					map[w] = cand;
					used.add(cand);
					break;
				}
			}
			if (!(w in map)) map[w] = 'off';
		}
		return map;
	});
	const motions = {};
	for (const w of works) {
		const changes = { s: [], cx: [], cy: [], alpha: [] };
		const v0 = {};
		for (const p of ['s', 'cx', 'cy']) {
			v0[p] = slotParams(showcase, slotOf[0][w] ?? 'off')[p];
		}
		v0.alpha = slotOf[0][w] === 'off' ? 0 : 1;
		// internal boundaries 1..n-1: the glide ENDS on the boundary so
		// each act starts from a settled arrangement instead of spending
		// its opening seconds still in flight. A small deterministic
		// per-work stagger keeps hand-offs from colliding head-on.
		for (let k = 1; k < bounds.length; k += 1) {
			const b = bounds[k - 1];
			const from = slotOf[k - 1][w] ?? 'off';
			const to = slotOf[k][w] ?? 'off';
			if (from === to) continue;
			// Per-work lead time staggers departure so several cards
			// don't pile onto the dock plate in the same second; every
			// glide still lands exactly on the act boundary.
			const lead = (((works.indexOf(w) * 7 + k * 3) % 9) / 9) * 0.8;
			const a = b - TRANS - lead;
			const pa = slotParams(showcase, from);
			const pb = slotParams(showcase, to);
			const win = TRANS + lead;
			// Off-stage works NEVER travel: entering works snap to
			// their destination while invisible and materialize there;
			// leaving works dissolve at their slot, then snap away.
			// No card is ever sliced by the canvas edge mid-flight.
			if ((from === 'off') !== (to === 'off')) {
				if (from === 'off') {
					for (const p of ['s', 'cx', 'cy']) changes[p].push({ a, d: 0.05, delta: pb[p] - pa[p] });
					changes.alpha.push({ a: a + win * 0.6, d: win * 0.4, delta: 1 });
				} else {
					changes.alpha.push({ a, d: win * 0.4, delta: -1 });
					for (const p of ['s', 'cx', 'cy'])
						changes[p].push({ a: a + win * 0.4 + 0.05, d: 0.05, delta: pb[p] - pa[p] });
				}
				continue;
			}
			// Causal anticipation on the SCALE channel only: receding
			// cards start shrinking earlier (clear the stage first),
			// arriving cards grow late (pop into place at the
			// boundary). Position glides keep the shared window so
			// paths stay smooth; every channel still lands on b.
			const grow = pb.s > pa.s;
			// Park-bound cards must be thumbnail-sized BEFORE they reach
			// the dock plate: shrink almost a full second early so they
			// never slice across the plate's edge while still large.
			const parkBound = /^(park\d+|off)$/.test(to);
			for (const p of ['s', 'cx', 'cy']) {
				let aa = a;
				let dd = TRANS + lead;
				if (p === 's') {
					if (grow) {
						aa += 0.15;
						dd -= 0.15;
					} else {
						const early = parkBound ? 0.8 : 0.45;
						aa -= early;
						dd += early;
					}
				}
				changes[p].push({ a: aa, d: dd, delta: pb[p] - pa[p] });
			}
		}
		// wrap boundary at D: last act -> first act arrangement must
		// SETTLE before the bookend fade starts, otherwise the final
		// visible frames are mid-flight cards over dead space.
		const last = acts.length - 1;
		const from = slotOf[last][w] ?? 'off';
		const to = slotOf[0][w] ?? 'off';
		if (from !== to) {
			const a = D - (showcase.fade ?? 0) - TRANS;
			const pa = slotParams(showcase, from);
			const pb = slotParams(showcase, to);
			if ((from === 'off') !== (to === 'off')) {
				if (from === 'off') {
					for (const p of ['s', 'cx', 'cy']) changes[p].push({ a, d: 0.05, delta: pb[p] - pa[p] });
					changes.alpha.push({ a: a + TRANS * 0.6, d: TRANS * 0.4, delta: 1 });
				} else {
					changes.alpha.push({ a, d: TRANS * 0.4, delta: -1 });
					for (const p of ['s', 'cx', 'cy'])
						changes[p].push({ a: a + TRANS * 0.4 + 0.05, d: 0.05, delta: pb[p] - pa[p] });
				}
			} else {
				for (const p of ['s', 'cx', 'cy']) {
					changes[p].push({ a, d: TRANS, delta: pb[p] - pa[p] });
				}
			}
		}
		motions[w] = { v0, changes };
	}
	return { motions, works, bounds, slotOf, acts };
}

// Numeric evaluation of the same motion model the ffmpeg exprs
// used to encode. value(t) = v0 + sum(delta_j * smoothstep(clamp((t-a_j)/d_j)))
const smoothstep = (x) => {
	const c = Math.min(1, Math.max(0, x));
	return c * c * (3 - 2 * c);
};

function paramValue(v0, changes, t) {
	let v = v0;
	for (const c of changes) v += c.delta * smoothstep((t - c.a) / c.d);
	return v;
}

// Per-element display state at time t: top-left x/y and pixel size.
// Mirrors the old sTotal/cxTotal/cyTotal exprs exactly (breathing +
// role-proportional drift included).
function elementState(showcase, motions, works, idx, t) {
	const { element, breathing, drift, duration: D } = showcase;
	const m = motions[works[idx]];
	const sRole = paramValue(m.v0.s, m.changes.s, t);
	const cxRole = paramValue(m.v0.cx, m.changes.cx, t);
	const cyRole = paramValue(m.v0.cy, m.changes.cy, t);
	const phase = idx * 0.9;
	const s = sRole * (1 + breathing.amp * Math.sin((2 * Math.PI * t) / D + phase));
	const amp = Math.max(0, 1 - sRole / 0.8125);
	const cx = cxRole + drift.amp * amp * Math.sin((2 * Math.PI * t) / drift.period + phase);
	const cy =
		cyRole + drift.amp * 0.7 * amp * Math.cos((2 * Math.PI * t) / drift.period + phase + 1.3);
	const w = element.w * s;
	const h = element.h * s;
	const alpha = Math.min(1, Math.max(0, paramValue(m.v0.alpha, m.changes.alpha, t)));
	return { x: cx - w / 2, y: cy - h / 2, w, h, sRole, alpha };
}

// rounded-rect SVG -> PNG via sharp (sub slot panels + main frame)
async function decorPng(path, svg) {
	await sharp(Buffer.from(svg)).png().toFile(path);
}

async function main() {
	const showcase = loadJson(SHOWCASE_PATH);
	const sources = loadJson(SOURCES_PATH);
	// Decorative colors: config `theme` overrides the dark defaults
	// (Issue #1242). `showcase.json` declares none → identical output.
	const theme = {
		panelFill: 'rgba(9,13,19,0.72)',
		vignette: '#0B0F14',
		rim: 'rgba(255,255,255,0.26)',
		frameUnderlay: 'rgba(5,10,18,0.6)',
		frameAccent: 'rgba(140,188,246,0.78)',
		dockFill: 'rgba(22,30,42,0.9)',
		dockStroke: 'rgba(255,255,255,0.10)',
		...(showcase.theme ?? {}),
	};
	const outPath = join(REPO_ROOT, showcase.output ?? 'public/github-profile/showcase.webp');
	const canvas = showcase.canvas;
	const { width: W, height: H, fps, quality } = canvas;
	const bgRgb = {
		r: Number.parseInt(canvas.background.slice(1, 3), 16),
		g: Number.parseInt(canvas.background.slice(3, 5), 16),
		b: Number.parseInt(canvas.background.slice(5, 7), 16),
	};
	const D = showcase.duration;
	const { element } = showcase;
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

	// One normalized element per work at element.w x element.h —
	// elementSeconds == duration so each plays exactly once (no
	// internal loop cut); bookend fades cover the wrap.
	async function elementFile(slug) {
		const clip = clipBySlug.get(slug);
		// Element cache key covers every geometry-affecting clip field so
		// a clips.json edit can never silently reuse a stale normalize.
		const geom = JSON.stringify({
			t: clip?.trim ?? null,
			o: clip?.offset ?? null,
			c: clip?.crop ?? null,
			s: clip?.segments ?? null,
		});
		const geomKey = Buffer.from(geom).toString('base64url').slice(0, 10);
		const out = join(WORK_DIR, `elem-${slug}-${geomKey}.mp4`);
		if (existsSync(out)) return out;
		let src = await sourceFor(slug);
		// Optional per-clip window: `segments` concatenates [start,end]
		// ranges (drops interior flashes/frozen cards); otherwise
		// `offset` seeks into the source and `trim` keeps the first N
		// seconds — used to drop dark end-cards, white flash frames and
		// frozen tails (positions verified with freezedetect / stats).
		if (clip?.segments?.length) {
			const trimmed = join(WORK_DIR, `seg-${slug}-${geomKey}.mp4`);
			if (!existsSync(trimmed)) {
				const fc = clip.segments
					.map(([a, b], i) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[s${i}]`)
					.concat(
						`[${clip.segments.map((_, i) => `s${i}`).join('][')}]concat=n=${clip.segments.length}:v=1:a=0[v]`,
					)
					.join(';');
				run('ffmpeg', [
					'-y',
					'-v',
					'error',
					'-i',
					src,
					'-filter_complex',
					fc,
					'-map',
					'[v]',
					'-c:v',
					'libx264',
					'-preset',
					'fast',
					'-pix_fmt',
					'yuv420p',
					'-an',
					trimmed,
				]);
			}
			src = trimmed;
		} else if (clip?.trim || clip?.offset) {
			const trimmed = join(
				WORK_DIR,
				`trim-${slug}-${clip?.offset ?? 0}-${clip?.trim ?? 'end'}.mp4`,
			);
			if (!existsSync(trimmed)) {
				const args = ['-y', '-v', 'error'];
				if (clip.offset) args.push('-ss', String(clip.offset));
				args.push('-i', src);
				if (clip.trim) args.push('-t', String(clip.trim));
				args.push('-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-an', trimmed);
				run('ffmpeg', args);
			}
			src = trimmed;
		}
		// Optional per-clip crop box (element pixel space) trims baked
		// letterbox/pillarbox bars before restoring element dims.
		const crop = clip?.crop;
		const vf = `scale=${element.w}:${element.h}:force_original_aspect_ratio=increase,crop=${element.w}:${element.h}${
			crop ? `,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${element.w}:${element.h}` : ''
		},fps=${fps},format=yuv420p`;
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
		return out;
	}

	const { motions, works, bounds, slotOf, acts } = buildMotion(showcase);

	// ---- decor layers (panels behind subs, frame around main) ----
	const decorDir = join(workDir, 'decor');
	mkdirSync(decorDir, { recursive: true });
	const PAD = 3;
	const R = 10;
	const panelSvgs = showcase.slots.subs.map((slot, i) => {
		const w = slot.w + PAD * 2;
		const h = slot.h + PAD * 2;
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${R}" fill="${theme.panelFill}"/></svg>`;
	});
	const panelFiles = [];
	for (const [i, svg] of panelSvgs.entries()) {
		const p = join(decorDir, `panel-${i}.png`);
		await decorPng(p, svg);
		panelFiles.push({ path: p, slot: showcase.slots.subs[i] });
	}
	// The protagonist accent frame is NOT baked into the base plate:
	// the main card breathes and travels between slots, so a static
	// wireframe would detach from it. renderFrame draws the frame
	// around whichever element is currently largest instead.
	const FRAME_STROKE = theme.frameAccent;
	const FRAME_WIDTH = 3;

	// ---- decor: bake background + sub panels + main frame into one
	// static base plate. Elements are composited per frame on top. ----
	const basePath = join(WORK_DIR, 'base.png');
	{
		const composites = [];
		for (const p of panelFiles) {
			composites.push({
				input: await sharp(p.path).png().toBuffer(),
				left: p.slot.x - PAD,
				top: p.slot.y - PAD,
			});
		}
		await sharp({ create: { width: W, height: H, channels: 4, background: canvas.background } })
			.composite(composites)
			.png()
			.toFile(basePath);
	}

	// The dock plate is a SEPARATE layer, not baked into base: cards
	// travelling to/from park slots pass behind it, so the plate
	// occludes mid-flight thumbnails instead of letting them pile
	// up on its face. Parked thumbs (scale ~sPark) composite after
	// the plate so the dock reads as a real container.
	let dockLayer = null;
	let dockBounds = null;
	{
		const parks = showcase.slots.parks ?? [];
		if (parks.length > 0) {
			const x0 = Math.min(...parks.map((r) => r.x)) - 14;
			const y0 = Math.min(...parks.map((r) => r.y)) - 14;
			const x1 = Math.max(...parks.map((r) => r.x + r.w)) + 14;
			const y1 = Math.max(...parks.map((r) => r.y + r.h)) + 14;
			const dockW = x1 - x0;
			const dockH = y1 - y0;
			const dockSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dockW}" height="${dockH}"><rect x="0.5" y="0.5" width="${dockW - 1}" height="${dockH - 1}" rx="14" fill="${theme.dockFill}" stroke="${theme.dockStroke}"/></svg>`;
			const dockPath = join(decorDir, 'dock.png');
			await decorPng(dockPath, dockSvg);
			dockLayer = await sharp(dockPath).png().toBuffer();
			dockBounds = { left: x0, top: y0, width: dockW, height: dockH };
		}
	}

	// ---- per-frame deterministic composite ----
	//
	// ffmpeg 9's overlay framesync mis-pairs secondary frames whose
	// dimensions vary per frame (scale eval=frame), silently reusing
	// early tiny frames. Each output frame is therefore assembled in
	// JS: one ffmpeg call extracts the needed element stills, then
	// sharp composites them back-to-front with rounded corners,
	// role-proportional dimming and area-sorted z-order.
	const elemFiles = new Map();
	for (const w of works) elemFiles.set(w, await elementFile(w));

	const N = Math.round(D * fps);
	const FRAMES_DIR = join(WORK_DIR, 'frames');
	mkdirSync(FRAMES_DIR, { recursive: true });

	// Role recession: parked thumbs dim hardest, subs recess, main is
	// full strength. Driven by role scale so it tracks transitions.
	const sPark = (showcase.slots.parks?.[0]?.w ?? 56) / element.w;
	const sMain = showcase.slots.main.w / element.w;
	// Recessive curve: parked thumbs sink lowest, subs sit clearly
	// below main so bright footage can't out-shout a dark protagonist.
	const dimAt = (sRole) => {
		const v = Math.min(1, Math.max(0, (sRole - sPark) / (sMain - sPark)));
		return 0.38 + 0.62 * v ** 1.4;
	};

	// Which act's arrangement is being approached at time t: inside a
	// transition window the DESTINATION act wins, so the incoming
	// protagonist gets z-top + the accent border early — a causal
	// hand-off instead of two overlapping heroes.
	// Protagonist hand-off is deferred to the LAST ~62% of the glide:
	// any earlier and the still-parked next hero pops to z-top/full
	// brightness/accent border before it has visibly started moving.
	const TRANS_W = showcase.transition * 0.62;
	function destActIndex(t) {
		for (let k = 1; k < bounds.length; k += 1) {
			const b = bounds[k - 1];
			if (t >= b - TRANS_W && t < b) return k;
		}
		if (t >= D - (showcase.fade ?? 0) - TRANS_W) return 0;
		let acc = 0;
		for (let i = 0; i < acts.length; i += 1) {
			acc += acts[i].duration;
			if (t < acc) return i;
		}
		return acts.length - 1;
	}
	// Protagonist hand-off leads the slot/dim flip: the incoming hero
	// takes z-top + the accent border ~0.8s before the boundary —
	// before the two heroes' paths cross mid-glide — so the outgoing
	// card never reads as "still on top" while the newcomer expands
	// beneath it. The frame alpha-fades with the card, so an early
	// flip on a still-dim incoming hero stays invisible.
	const PROG_W = 0.8;
	function progActIndex(t) {
		for (let k = 1; k < bounds.length; k += 1) {
			const b = bounds[k - 1];
			if (t >= b - PROG_W && t < b) return k;
		}
		if (t >= D - (showcase.fade ?? 0) - PROG_W) return 0;
		let acc = 0;
		for (let i = 0; i < acts.length; i += 1) {
			acc += acts[i].duration;
			if (t < acc) return i;
		}
		return acts.length - 1;
	}

	// Which card edges face the canvas centre per sub slot — drives
	// the inner-edge vignette that keeps hero overlap reading as
	// depth rather than a sliced headline.
	// Seams where the protagonist's edge crosses each sub: top-row
	// subs are cut by the hero's TOP edge (seam near their top),
	// bottom-row subs by its BOTTOM edge — plus the side facing
	// canvas centre. Vignetting the wrong edge leaves clipped text
	// bright at the seam (v21/v22 review).
	const SUB_SIDES = {
		sub0: ['right', 'top'],
		sub1: ['left', 'top'],
		sub2: ['right', 'bottom'],
		sub3: ['left', 'bottom'],
	};

	const maskCache = new Map();
	function roundedMask(w, h) {
		const key = `${w}x${h}`;
		if (!maskCache.has(key)) {
			const r = Math.min(10, Math.round(h * 0.09));
			maskCache.set(
				key,
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`,
				),
			);
		}
		return maskCache.get(key);
	}

	const alphaMaskCache = new Map();
	function alphaMask(w, h, a) {
		const q = Math.round(a * 100) / 100;
		const key = `${w}x${h}x${q}`;
		if (!alphaMaskCache.has(key)) {
			alphaMaskCache.set(
				key,
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff" fill-opacity="${q}"/></svg>`,
				),
			);
		}
		return alphaMaskCache.get(key);
	}

	const rimCache = new Map();
	function rimStroke(w, h) {
		const key = `${w}x${h}`;
		if (!rimCache.has(key)) {
			const r = Math.max(1, Math.min(10, Math.round(h * 0.09)) - 1);
			rimCache.set(
				key,
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" fill="none" stroke="${theme.rim}" stroke-width="1"/></svg>`,
				),
			);
		}
		return rimCache.get(key);
	}

	const frameCache = new Map();
	function accentFrame(w, h) {
		const key = `${w}x${h}`;
		if (!frameCache.has(key)) {
			const r = Math.min(12, Math.round(h * 0.08));
			// Dark keyline under the accent stroke: the light-blue
			// border alone washes out against bright protagonists
			// (e.g. Act 5's off-white grid) at README scale.
			frameCache.set(
				key,
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${FRAME_WIDTH / 2}" y="${FRAME_WIDTH / 2}" width="${w - FRAME_WIDTH}" height="${h - FRAME_WIDTH}" rx="${r}" fill="none" stroke="${theme.frameUnderlay}" stroke-width="${FRAME_WIDTH + 5}"/><rect x="${FRAME_WIDTH / 2}" y="${FRAME_WIDTH / 2}" width="${w - FRAME_WIDTH}" height="${h - FRAME_WIDTH}" rx="${r}" fill="none" stroke="${FRAME_STROKE}" stroke-width="${FRAME_WIDTH}"/></svg>`,
				),
			);
		}
		return frameCache.get(key);
	}

	// Sub cards sit partially behind the protagonist, so their inner
	// edges are hard-clipped mid-content (reviewer: "sliced
	// headlines"). A dark gradient on the canvas-facing edges makes
	// the overlap read as depth instead of a cut. `sideH`/`sideV`
	// name which edges face the canvas centre.
	const vignetteCache = new Map();
	function subVignette(w, h, sideH, sideV) {
		const key = `${w}x${h}:${sideH}${sideV}`;
		if (!vignetteCache.has(key)) {
			// Band sized from the card's own width/height, NOT min():
			// the hero seam sits ~35-40% in from the inner edge, so a
			// min()-based band stopped just short of it (v23 miss).
			const bandX = Math.round(w * 0.55);
			const bandY = Math.round(h * 0.5);
			const rects = [];
			// Plateau profile: transparent at the band's outer limit,
			// then ~full strength well before the card edge so the
			// hero-overlap seam sits inside the dark zone rather than
			// on its decay tail (the v21 failure mode).
			const grad = (id, x1, y1, x2, y2) =>
				`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${theme.vignette}" stop-opacity="0"/><stop offset="0.45" stop-color="${theme.vignette}" stop-opacity="0.88"/><stop offset="1" stop-color="${theme.vignette}" stop-opacity="0.88"/></linearGradient>`;
			const defs = [];
			if (sideH === 'right') {
				defs.push(grad('gh', w - bandX, 0, w, 0));
				rects.push(`<rect x="${w - bandX}" y="0" width="${bandX}" height="${h}" fill="url(#gh)"/>`);
			} else {
				defs.push(grad('gh', bandX, 0, 0, 0));
				rects.push(`<rect x="0" y="0" width="${bandX}" height="${h}" fill="url(#gh)"/>`);
			}
			if (sideV === 'bottom') {
				defs.push(grad('gv', 0, h - bandY, 0, h));
				rects.push(`<rect x="0" y="${h - bandY}" width="${w}" height="${bandY}" fill="url(#gv)"/>`);
			} else {
				defs.push(grad('gv', 0, bandY, 0, 0));
				rects.push(`<rect x="0" y="0" width="${w}" height="${bandY}" fill="url(#gv)"/>`);
			}
			vignetteCache.set(
				key,
				Buffer.from(
					`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${defs.join('')}</defs>${rects.join('')}</svg>`,
				),
			);
		}
		return vignetteCache.get(key);
	}

	function runAsync(cmd, args) {
		return new Promise((resolve, reject) => {
			const p = spawn(cmd, args);
			let err = '';
			p.stderr.on('data', (d) => {
				err += d;
			});
			p.on('close', (code) =>
				code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`)),
			);
		});
	}

	async function renderFrame(n) {
		const t = n / fps;
		const items = [];
		const destIdx = destActIndex(t);
		const progIdx = progActIndex(t);
		const protagonistSlug = acts[progIdx].main;
		works.forEach((w, i) => {
			const st = elementState(showcase, motions, works, i, t);
			const wpx = Math.max(2, Math.round(st.w) - (Math.round(st.w) % 2));
			const hpx = Math.max(2, Math.round(st.h) - (Math.round(st.h) % 2));
			const x = Math.round(st.x);
			const y = Math.round(st.y);
			if (wpx >= 4 && st.alpha > 0.08 && x + wpx > 0 && y + hpx > 0 && x < W && y < H) {
				items.push({
					file: elemFiles.get(w),
					slug: w,
					x,
					y,
					w: wpx,
					h: hpx,
					dim: slotOf[destIdx]?.[w] === 'main' ? 1 : dimAt(st.sRole),
					alpha: st.alpha,
					mainBound: false,
					area: wpx * hpx,
				});
			}
		});
		for (const p of items) p.mainBound = p.slug === protagonistSlug;
		// The protagonist composites last (z-top) even mid-growth, so
		// the incoming hero rises over the outgoing one through the
		// hand-off window.
		items.sort((a, b) => Number(a.mainBound) - Number(b.mainBound) || a.area - b.area);

		const out = join(FRAMES_DIR, `f${String(n).padStart(4, '0')}.png`);
		if (items.length === 0) {
			await sharp(basePath).png().toFile(out);
			return;
		}

		const srcDir = join(workDir, `src-${n}`);
		mkdirSync(srcDir, { recursive: true });
		const args = ['-y', '-v', 'error'];
		for (const p of items) args.push('-ss', t.toFixed(3), '-i', p.file);
		items.forEach((p, i) => {
			args.push('-map', `${i}:v`, '-frames:v', '1', '-update', '1', join(srcDir, `${i}.png`));
		});
		await runAsync('ffmpeg', args);

		const layers = [];
		for (const [i, p] of items.entries()) {
			let img = sharp(join(srcDir, `${i}.png`))
				.resize(p.w, p.h, { fit: 'fill' })
				.ensureAlpha();
			// Subs also desaturate slightly so bright footage can't
			// out-shout a dark protagonist at README scale. The
			// per-clip grade is a luminance equaliser: it lifts
			// dark UIs and reins in blown-out footage BOTH as main
			// and as sub, so dark dock thumbs stop vanishing.
			const grade = clipBySlug.get(p.slug)?.grade ?? 1;
			if (p.dim < 0.999)
				img = img.modulate({
					brightness: p.dim * grade,
					saturation: 0.75,
				});
			else if (grade !== 1) img = img.modulate({ brightness: grade });
			// sharp's composite() REPLACES earlier composites — the mask,
			// rim, vignette and accent layers must ride in ONE call or
			// earlier layers silently drop (the v21-v24 vignette was
			// being wiped by exactly this).
			const ops = [];
			// Edge vignette on subs facing the protagonist: first op so
			// the rounded/alpha masks below cut it along with the card —
			// a dissolving sub never leaves a dark gradient behind.
			const subSlot = slotOf[destIdx]?.[p.slug];
			const subSides = SUB_SIDES[subSlot];
			// Never vignette the protagonist: during a hand-off the
			// incoming hero is still slot-mapped as a sub until the
			// boundary, and the dark gradient would black out half of
			// the card that already wears the accent border (v25).
			if (p.dim < 0.999 && subSides && p.slug !== protagonistSlug) {
				ops.push({
					input: subVignette(p.w, p.h, subSides[0], subSides[1]),
					blend: 'over',
				});
			}
			ops.push({ input: roundedMask(p.w, p.h), blend: 'dest-in' });
			// modulate() has no alpha channel — dissolve/materialize is
			// applied as a second dest-in pass with a uniform-alpha mask.
			if (p.alpha < 0.999) ops.push({ input: alphaMask(p.w, p.h, p.alpha), blend: 'dest-in' });
			// Faint rim keeps dark-UI subs/dock thumbs readable against
			// the near-black canvas at README scale.
			if (p.dim < 0.999) ops.push({ input: rimStroke(p.w, p.h) });
			img = img.composite(ops);
			layers.push({ input: await img.png().toBuffer(), left: p.x, top: p.y, _item: p });
		}
		// Protagonist accent frame tracks progActIndex's hero (see
		// protagonistSlug above), PAD outside its rect — never a
		// detached static wireframe.
		const lead = items.find((p) => p.slug === protagonistSlug) ?? items[items.length - 1];
		let frameLayer = null;
		if (lead) {
			const fw = lead.w + PAD * 2;
			const fh = lead.h + PAD * 2;
			let frameImg = sharp(accentFrame(fw, fh));
			if (lead.alpha < 0.999)
				frameImg = frameImg.composite([{ input: alphaMask(fw, fh, lead.alpha), blend: 'dest-in' }]);
			frameLayer = {
				input: await frameImg.png().toBuffer(),
				left: lead.x - PAD,
				top: lead.y - PAD,
			};
		}
		// Bookend fades baked per frame (linear, to canvas bg) so the
		// PNG sequence can go straight to img2webp without a lossy
		// intermediate video encode.
		const FADE = showcase.fade;
		const p = Math.min(Math.min(1, t / FADE), Math.min(1, (D - t) / FADE));
		// Paint order: dock plate first (strictly under every card),
		// then elements small→large, accent frame, bookend fade.
		// v10: every occlusion variant tried (size gates, slot
		// proximity, dock-bound routing, overlap demotion) produced
		// disappearing/clipping artifacts in review; the 1.0s
		// transitions + early park shrink keep the plate face clear
		// enough that plain z-order reads cleanest.
		const strip = ({ input, left, top }) => ({ input, left, top });
		const topLayers = [];
		if (dockLayer) topLayers.push({ input: dockLayer, ...dockBounds });
		topLayers.push(...layers.map(strip));
		if (frameLayer) topLayers.push(frameLayer);
		if (p < 1) {
			const fadeLayer = await sharp({
				create: {
					width: W,
					height: H,
					channels: 4,
					background: { ...bgRgb, alpha: 1 - p },
				},
			})
				.png()
				.toBuffer();
			topLayers.push({ input: fadeLayer });
		}
		await sharp(basePath).composite(topLayers).png().toFile(out);
	}

	{
		const CONCURRENCY = 6;
		let next = 0;
		let done = 0;
		await Promise.all(
			Array.from({ length: CONCURRENCY }, async () => {
				while (next < N) {
					const n = next;
					next += 1;
					await renderFrame(n);
					done += 1;
					if (done % 40 === 0) console.log(`[showcase] frames ${done}/${N}`);
				}
			}),
		);
	}

	// Encode PNG sequence -> animated WebP via img2webp (libwebp tools).
	// This keeps full-color frames — the previous ffmpeg->GIF pipe
	// posterized every frame to a 256-colour palette (visible dithering).
	mkdirSync(dirname(outPath), { recursive: true });
	const framePaths = [];
	for (let n = 0; n < N; n += 1) {
		framePaths.push(join(FRAMES_DIR, `f${String(n).padStart(4, '0')}.png`));
	}
	// img2webp treats -d/-lossy/-q/-m as PER-FRAME options: they must
	// precede every frame file or later frames fall back to lossless.
	const frameArgs = framePaths.flatMap((p) => [
		'-d',
		String(Math.round(1000 / fps)),
		'-lossy',
		'-q',
		String(quality),
		'-m',
		'6',
		// Cap the inter-frame delta chain: without a periodic
		// keyframe, lossy deltas accumulate into the blocky ghost
		// trails reviewers kept flagging in dark dissolve regions.
		// kmax 12 (~1.5s) lands a keyframe inside every 1s act
		// transition so dissolve residuals flush quickly.
		'-kmin',
		'8',
		'-kmax',
		'12',
		p,
	]);
	run('img2webp', ['-loop', '0', '-sharp_yuv', ...frameArgs, '-o', outPath]);
	console.log(`[showcase] wrote ${outPath}`);

	// Sampled-frame luma gate across the whole loop.
	const meta = await sharp(readFileSync(outPath), { animated: true }).metadata();
	const pages = meta.pages ?? 1;
	let failures = 0;
	const samples = 12;
	for (let i = 0; i < samples; i += 1) {
		// Sample the middle 80% — the bookend fades legitimately sit
		// near the luma floor by design.
		const idx = Math.min(pages - 1, Math.floor(pages * (0.1 + (0.8 * i) / samples)));
		const png = join(WORK_DIR, `sample-${i}.png`);
		writeFileSync(png, await sharp(readFileSync(outPath), { page: idx }).png().toBuffer());
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
