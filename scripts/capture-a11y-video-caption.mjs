#!/usr/bin/env node

/**
 * capture-a11y-video-caption — capture the Issue #408 verification screen
 * into `docs/verification/a11y/video-caption-track.webp`.
 *
 * What this captures
 * ------------------
 * One screen that renders the four states a `<video>` contract has to
 * survive — captioned, no caption track, a caption track whose resource
 * fails to load, and a playable video with no controls — plus the same
 * captioned video at 320 px. The verdict of each static case is computed
 * by the GATE's own `evaluateVideo`, so the browser half and the source
 * half cannot disagree about the contract.
 *
 * It is an ASSERTION, not only a screenshot. The caption track of one card
 * points at a resource that 404s; the capture reads the browser-reported
 * `readyState`, and fails (exit 1, no artefact) when:
 *
 *   - a case resolves to a rule different from the one it claims,
 *   - the working caption track does not reach LOADED,
 *   - the failing caption track is NOT reported as an error, or
 *   - the video whose caption source failed still claims
 *     `data-caption-status="verified"` (the fail-closed core of the Issue),
 *   - the 320 px layout changes the video facts.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is read
 *     or printed. The harness and its caption file are generated inline.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port. The "missing" caption request is answered 404 by that
 *     server, so the failure is real, not simulated.
 *   - Chromium screenshots are not byte-reproducible across processes, so
 *     the report records conditions instead of claiming a deterministic
 *     artefact.
 *
 * WebP, not PNG
 * -------------
 * Issue #408 names a `.png` path, but Chromium only writes PNG and a
 * verification artefact does not justify a permanently large binary in the
 * tree. The capture goes to `.tmp/`, is re-encoded with the existing
 * `sharp` devDependency at width <= 1600 / quality 80, and the committed
 * file is the `.webp` sibling. The script REFUSES any non-`.webp` output
 * path and deletes the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-video-caption.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/video-caption-track.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-video-caption)
 *   --json-out=<path>    report destination (default .tmp/a11y-video-caption/report.json)
 *   --width=<n>          page viewport width (default 1600)
 *   --no-capture         write no artefact
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateVideo, WCAG, WCAG_REFERENCE } from './check-a11y-video-caption.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The static states the screen compares, with the rule each must resolve to. */
export const CASES = [
	{ id: 'captioned', label: 'captioned and verified', expectRules: [] },
	{ id: 'no-caption', label: 'no caption track', expectRules: ['video-without-caption-track'] },
	{ id: 'no-controls', label: 'no playback controls', expectRules: ['video-without-controls'] },
	{
		id: 'caption-load-fails',
		label: 'the caption resource fails to load',
		expectRules: ['video-playable-without-verified-caption'],
	},
	{
		id: 'no-audio-description',
		label: 'no audio-description disposition',
		expectRules: ['video-without-audio-description'],
	},
];

/** The caption track the harness serves (a real, valid WebVTT). */
export const CAPTION_FILE = 'captions.vtt';
export const CAPTION_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA recorded caption cue.\n';
/** The caption resource that does not exist (the server answers 404). */
export const MISSING_CAPTION = 'missing-captions.vtt';
/** The audio-description track the harness serves. */
export const DESCRIPTION_FILE = 'descriptions.vtt';
export const DESCRIPTION_VTT =
	'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nA recorded audio-description cue.\n';

/**
 * The WCAG 2.2 criteria this artefact speaks to.
 *
 * Read from the gate, so the screen and the gate cannot disagree about
 * which criteria are requirements.
 */
export const WCAG_MAPPING = WCAG;

export const HARNESS_DIR = '.tmp/a11y-video-caption/harness';

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** An inline SVG poster, so the capture issues no network request for it. */
const POSTER = `data:image/svg+xml;utf8,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" fill="#101828"/><rect x="24" y="30" width="200" height="18" rx="4" fill="#7dd3fc"/><rect x="24" y="70" width="330" height="10" rx="4" fill="#475467"/><rect x="24" y="94" width="300" height="10" rx="4" fill="#475467"/><rect x="24" y="200" width="140" height="30" rx="6" fill="#2e90fa"/></svg>',
)}`;

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return { bytes, kb: Math.round(bytes / 1024), withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES };
}

/** Reject an output path that is not WebP, or that leaves the repository. */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return rel;
}

/** Minimal XML escaping: the panel text is computed, not source. */
export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The harness page.
 *
 * Each card is a `<video data-case="…">`. The `caption-load-fails` card
 * declares `data-caption-status="verified"` and points its caption track at
 * a resource the server answers 404; the page's own handler demotes the
 * status to `unavailable` and shows a notice when the track errors, which
 * is the fail-closed behaviour the capture asserts.
 */
export function harnessIndexHtml() {
	const poster = POSTER;
	const captionedSources = `
			<source src="/missing-video.mp4" type="video/mp4" />
			<track kind="captions" src="/${CAPTION_FILE}" srcLang="en" label="English" default />
			<track kind="descriptions" src="/${DESCRIPTION_FILE}" srcLang="en" label="Audio description" />`;
	// The audio-description track is orthogonal to the caption track: a
	// work may describe its audio and still ship no captions, which is
	// exactly the state the `no-caption` card stands for. The card
	// therefore claims `provided` AND ships the descriptions track, so
	// the only rule it resolves is the caption one.
	const noCaptionSources = `
			<source src="/missing-video.mp4" type="video/mp4" />
			<track kind="descriptions" src="/${DESCRIPTION_FILE}" srcLang="en" label="Audio description" />`;
	const failingSources = `
			<source src="/missing-video.mp4" type="video/mp4" />
			<track kind="captions" src="/${MISSING_CAPTION}" srcLang="en" label="English" default />
			<track kind="descriptions" src="/${DESCRIPTION_FILE}" srcLang="en" label="Audio description" />`;
	const card = (id, body, notice = '') => `<figure class="card" data-card="${id}">
		${body}
		<figcaption><code>${escapeHtml(id)}</code></figcaption>
		${notice}
	</figure>`;
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>video captions / text alternative — Issue #408</title>
		<style>
			* { box-sizing: border-box; }
			body { margin: 0; padding: 24px 28px 36px; background: #ffffff; color: #101828;
				font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
			h1 { font-size: 20px; margin: 0 0 6px; }
			p.lede { margin: 0 0 20px; color: #475467; }
			.grid { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
			.card { margin: 0; width: 480px; }
			.card video { display: block; width: 100%; border: 1px solid #d0d5dd; border-radius: 8px; background: #101828; }
			.card figcaption { margin-top: 8px; color: #475467; }
			.card code { color: #101828; }
			.notice { margin: 8px 0 0; color: #b42318; }
			[data-narrow="true"] .card { width: 320px; }
		</style>
	</head>
	<body>
		<h1>video captions / text alternative — Issue #408 (WCAG 2.2 SC 1.2.2 / 1.1.1 / 2.1.1, level A)</h1>
		<p class="lede">Each card is one state. The <code>caption-load-fails</code> card points its track at a 404; the page demotes <code>data-caption-status</code> to <code>unavailable</code> and shows a notice. The <code>no-audio-description</code> card declares no audio-description disposition, which is a decision the gate refuses to guess.</p>
		<div class="grid" id="grid">
			${card(
				'captioned',
				`<video data-case="captioned" controls poster="${poster}" aria-label="A captioned work" data-caption-status="verified" data-audio-description-status="provided">${captionedSources}
			</video>`,
			)}
			${card(
				'no-caption',
				`<video data-case="no-caption" controls poster="${poster}" aria-label="A work with no caption track" data-audio-description-status="provided">${noCaptionSources}
			</video>`,
			)}
			${card(
				'no-controls',
				`<video data-case="no-controls" poster="${poster}" aria-label="A work with no controls" data-caption-status="verified" data-audio-description-status="provided">${captionedSources}
			</video>`,
			)}
			${card(
				'caption-load-fails',
				`<video data-case="caption-load-fails" controls poster="${poster}" aria-label="A work whose captions failed to load" data-caption-status="verified" data-audio-description-status="provided">${failingSources}
			</video>`,
				'<p class="notice" id="caption-notice" hidden>Captions unavailable — this work is not presented as playable with verified captions.</p>',
			)}
			${card(
				'no-audio-description',
				`<video data-case="no-audio-description" controls poster="${poster}" aria-label="A work with no audio-description disposition" data-caption-status="verified">
				<source src="/missing-video.mp4" type="video/mp4" />
				<track kind="captions" src="/${CAPTION_FILE}" srcLang="en" label="English" default />
			</video>`,
			)}
		</div>
		<script>
			const failing = document.querySelector('video[data-case="caption-load-fails"]');
			failing.querySelector('track[kind="captions"]').addEventListener('error', () => {
				failing.setAttribute('data-caption-status', 'unavailable');
				document.getElementById('caption-notice').hidden = false;
			});
		</script>
	</body>
</html>
`;
}

const CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.vtt': 'text/vtt; charset=utf-8',
};

/** Resolve one request path inside the served root (pure). */
export function resolveStaticTarget(root, requestPath) {
	const base = resolve(root);
	const candidate = resolve(base, `.${decodeURIComponent(requestPath)}`);
	if (candidate !== base && !candidate.startsWith(`${base}/`)) return { status: 403, file: null };
	const isDirectory = existsSync(candidate) && statSync(candidate).isDirectory();
	const target = existsSync(candidate) && !isDirectory ? candidate : join(candidate, 'index.html');
	if (!existsSync(target)) return { status: 404, file: null };
	return {
		status: 200,
		file: target,
		contentType: CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
	};
}

/** Serve `root` over loopback on an ephemeral port, for the capture only. */
export function serveDirectory(root) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const resolved = resolveStaticTarget(root, url.pathname);
		if (resolved.status !== 200) {
			res.writeHead(resolved.status).end(resolved.status === 403 ? 'forbidden' : 'not found');
			return;
		}
		res.writeHead(200, { 'content-type': resolved.contentType });
		createReadStream(resolved.file).pipe(res);
	});
	return new Promise((resolveServer) => {
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			resolveServer({
				baseUrl: `http://127.0.0.1:${port}`,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}

/** Write the generated harness (idempotent, so a re-run reuses it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, CAPTION_FILE), CAPTION_VTT);
	writeFileSync(join(dir, DESCRIPTION_FILE), DESCRIPTION_VTT);
	return dir;
}

/**
 * Read the video facts out of the rendered page.
 *
 * Runs in the browser, so it is written as a function body Chromium
 * serialises — no imports, no closure variables. Each `<video>` is reduced
 * to the shape `evaluateVideo` reads, so the gate's rule functions decide
 * the verdict in the browser too.
 */
export const READ_STATE = () => {
	const attributeList = (element) =>
		[...element.attributes].map((attribute) => ({
			name: attribute.name,
			kind: 'string',
			value: attribute.value,
		}));
	return {
		viewportWidth: document.documentElement.clientWidth,
		cases: [...document.querySelectorAll('video[data-case]')].map((video) => {
			const caption = video.querySelector('track[kind="captions"]');
			return {
				id: video.getAttribute('data-case'),
				videoWidth: video.clientWidth,
				attributes: attributeList(video),
				tracks: [...video.querySelectorAll('track')].map(attributeList),
				hasSource: video.querySelector('source') !== null,
				captionStatus: video.getAttribute('data-caption-status'),
				captionReadyState: caption ? caption.readyState : null,
				captionError: caption ? caption.readyState === 3 : false,
				noticeVisible: (() => {
					const notice = video.parentElement?.querySelector('.notice');
					return notice ? !notice.hasAttribute('hidden') : false;
				})(),
			};
		}),
	};
};

/**
 * Decide whether the browser observations prove the video contract (pure).
 *
 * `wide` and `narrow` are each a `READ_STATE` result.
 */
export function evaluateObservation({ wide, narrow }) {
	const failures = [];
	const rows = [];
	const byId = (state) => new Map((state?.cases ?? []).map((entry) => [entry.id, entry]));

	for (const expected of CASES) {
		const entry = byId(wide).get(expected.id);
		if (!entry) {
			failures.push(`the case ${expected.id} was not rendered`);
			continue;
		}
		const { violations } = evaluateVideo({
			attributes: entry.attributes,
			tracks: entry.tracks,
			hasSource: entry.hasSource,
		});
		const found = violations.map((violation) => violation.rule);
		if (JSON.stringify(found) !== JSON.stringify(expected.expectRules)) {
			failures.push(
				`${expected.id}: the gate resolves [${found.join(', ')}], the screen claims [${expected.expectRules.join(', ')}]`,
			);
		}
		rows.push(
			`${expected.id.padEnd(18)} caption-status=${String(entry.captionStatus).padEnd(11)} caption-readyState=${entry.captionReadyState} rules=[${found.join(', ')}]`,
		);
	}

	const captioned = byId(wide).get('captioned');
	if (captioned) {
		if (captioned.captionReadyState !== 2) {
			failures.push(
				`captioned: the working caption track is not LOADED (readyState ${captioned.captionReadyState})`,
			);
		}
		if (captioned.captionError) {
			failures.push('captioned: the working caption track reported an error');
		}
	}

	const failing = byId(wide).get('caption-load-fails');
	if (failing) {
		if (!failing.captionError) {
			failures.push(
				'caption-load-fails: the missing caption resource was not reported as an error',
			);
		}
		if (failing.captionStatus === 'verified') {
			failures.push(
				'caption-load-fails: the video still claims data-caption-status="verified" after the caption source failed — a work whose captions are unavailable must not be presented as playable with verified captions',
			);
		}
		if (!failing.noticeVisible) {
			failures.push(
				'caption-load-fails: no visible notice explains that the captions are unavailable',
			);
		}
	}

	const wideCaptioned = byId(wide).get('captioned');
	const narrowCaptioned = byId(narrow).get('captioned');
	if (wideCaptioned && narrowCaptioned) {
		if (wideCaptioned.videoWidth < 400) {
			failures.push(`captioned: the wide layout is only ${wideCaptioned.videoWidth} px wide`);
		}
		if (narrowCaptioned.videoWidth > 320) {
			failures.push(`narrow: the 320 px layout kept the video at ${narrowCaptioned.videoWidth} px`);
		}
		if (
			JSON.stringify(wideCaptioned.attributes) !== JSON.stringify(narrowCaptioned.attributes) ||
			wideCaptioned.captionStatus !== narrowCaptioned.captionStatus
		) {
			failures.push('narrow: the 320 px layout changed the captioned video facts');
		}
		rows.push(
			`${'narrow-captioned'.padEnd(18)} caption-status=${narrowCaptioned.captionStatus} video-width=${narrowCaptioned.videoWidth}`,
		);
	}

	return { ok: failures.length === 0, failures, rows };
}

/** The header band: what was measured, what was not. */
export function headerSvg({ gate, verdict, width = SCREENSHOT_MAX_WIDTH }) {
	const title =
		'video captions / text alternative — Issue #408 (WCAG 2.2 SC 1.2.2 / 1.2.3 / 1.2.5 / 1.1.1 / 2.1.1)';
	const rows = [
		`${CASES.length} card(s) + a 320 px layout: each card's verdict is computed by the gate's own evaluateVideo`,
		'machine-checked: caption track presence and kind, poster, accessible name and controls read from the rendered DOM',
		'machine-checked: the audio-description disposition (data-audio-description-status) and the descriptions track, fail-closed',
		'machine-checked: the working caption track reaches LOADED and the missing one reaches ERROR',
		'machine-checked: the video whose caption source failed declines to claim data-caption-status="verified"',
		`machine-checked: gate ${gate.violations.length} violation(s) over ${gate.shipped.filesScanned} shipped .tsx file(s), ${gate.shipped.videosScanned} <video> element(s)`,
		'not machine-checked: caption accuracy, whether a particular work needs an audio description (the human decision behind the disposition), the poster image, a screen-reader pass',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}; SC ${WCAG_REFERENCE.sc} (${WCAG_REFERENCE.level}) is reference only`,
		'',
		...verdict.rows,
	];
	const rowTop = 34 + 30;
	const height = rowTop + rows.length * 19 + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 19}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeHtml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="28" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="19" font-weight="700" fill="#0b1020">${escapeHtml(title)}</text>
	${lines}
</svg>
`,
	};
}

/** Compose the artefact: the header band above the rendered screen. */
export async function composeArtefact({ sharp, pagePng, header, outPath }) {
	const page = await sharp(pagePng)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.png()
		.toBuffer();
	const meta = await sharp(page).metadata();
	const body = await sharp(page)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.png()
		.toBuffer();
	await sharp(body)
		.composite([{ input: Buffer.from(header.svg), left: 0, top: 0 }])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return {
		pageWidth: meta.width ?? null,
		pageHeight: meta.height ?? null,
		headerHeight: header.height,
	};
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/video-caption-track.webp',
		pngDir: '.tmp/a11y-video-caption',
		jsonOut: '.tmp/a11y-video-caption/report.json',
		width: SCREENSHOT_MAX_WIDTH,
		capture: true,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'png-dir':
				options.pngDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'width':
				options.width = Number(value);
				break;
			case 'no-capture':
				options.capture = false;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	return options;
}

function ensureDir(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/** Wait until every caption track has settled (LOADED or ERROR). */
async function waitForTracks(page) {
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('video[data-case] track[kind="captions"]')].every(
				(track) => track.readyState >= 2,
			),
		undefined,
		{ timeout: 10_000 },
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	const { collectEvidence, renderGateSummary } = await import('./check-a11y-video-caption.mjs');
	const gate = collectEvidence();
	if (gate.violations.length > 0) {
		process.stderr.write(`${renderGateSummary(gate)}\n`);
		throw new Error(
			`the video-caption gate reports ${gate.violations.length} violation(s); the artefact would photograph a broken contract`,
		);
	}

	writeHarness();
	const server = await serveDirectory(resolve(REPO_ROOT, HARNESS_DIR));
	let capture = null;
	let verdict = null;
	let wide = null;
	let narrow = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness written, nothing captured\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'screen.png');
			ensureDir(join(options.pngDir, 'x.png'));
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: 900 },
					deviceScaleFactor: 1,
					isMobile: false,
				});
				const page = await context.newPage();
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				await waitForTracks(page);
				wide = await page.evaluate(READ_STATE);
				await page.evaluate(() => {
					document.getElementById('grid').setAttribute('data-narrow', 'true');
				});
				await page.waitForTimeout(80);
				narrow = await page.evaluate(READ_STATE);
				writeFileSync(pagePng, await page.screenshot({ fullPage: true, type: 'png' }));
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation({ wide, narrow });
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the video-caption contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ gate, verdict });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({ sharp, pagePng, header, outPath });
			const meta = await sharp(outPath).metadata();
			const budget = screenshotBudgetVerdict(statSync(outPath).size);
			rmSync(pagePng, { force: true });
			if (!budget.withinBudget) {
				throw new Error(
					`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				viewport: { width: options.width, height: 900 },
				quality: SCREENSHOT_QUALITY,
				width: meta.width ?? null,
				height: meta.height ?? null,
				...geometry,
				...budget,
			};
			process.stdout.write(
				`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${budget.kb} kB)\n`,
			);
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#408',
		generatedBy: 'scripts/capture-a11y-video-caption.mjs',
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, html: harnessIndexHtml(), captionFile: CAPTION_FILE },
		cases: CASES,
		wide,
		narrow,
		verdict,
		gate: {
			violations: gate.violations,
			filesScanned: gate.shipped.filesScanned,
			videosScanned: gate.shipped.videosScanned,
		},
		wcag: WCAG_MAPPING,
		humanEvaluation: gate.humanEvaluation,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/video-caption-track.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-video-caption.mjs')) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		},
	);
}
