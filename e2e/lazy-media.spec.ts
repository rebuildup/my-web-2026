import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	type Browser,
	type BrowserContext,
	type Page,
	type TestInfo,
	expect,
	test,
} from '@playwright/test';

/**
 * Lazy media / iframe — browser waterfall measurement (Issue #487).
 *
 * The deterministic half of this ticket is
 * `test/integration/lazy-media-contract.test.ts`, which runs in
 * `validate:fast` on every PR. This spec is the half that can only
 * come from a real browser: what the first paint of `/` actually
 * pulls over the wire under a declared CPU / network profile, before
 * and after the digit strip declares its loading mode.
 *
 * Why both, and why this one is not a gate
 * ---------------------------------------
 * The contract suite reads SSR markup. It cannot see a request that
 * markup does not describe (a CSS `url()`, a font file, an analytics
 * beacon), and it cannot observe a browser honouring — or ignoring —
 * `loading="lazy"`. This spec closes both gaps from
 * `context.on('response')`.
 *
 * What it deliberately does NOT do is assert a byte budget or a
 * timing threshold. A throttled measurement is a number with a
 * variance; putting one in `validate:*` would make the gate flaky and
 * would overlap Issues #384 (reproducible Lighthouse command), #385
 * (Lighthouse release gate) and #386 (Core Web Vitals budget). Those
 * tickets own the gate; this one owns the evidence plus the
 * per-request rules that carry no variance.
 *
 * The before/after A/B
 * --------------------
 * The "before" leg is the SAME document with the media-mode attributes
 * this ticket added (`loading` AND `decoding`) stripped from its
 * `<img>` tags, served through a Playwright route that rewrites the
 * HTML. That is exactly the markup that shipped before Issue #487 (the
 * strip was the only `<img>` on `/`), so the two legs differ by those
 * attributes only, on the same build, in the same browser, under the
 * same throttle — no rebuild, no second commit, no guesswork. A
 * `__vite__` dev-server document is never measured here: `pnpm run
 * build` output is what ships.
 *
 * Embedded media
 * --------------
 * The contract is stated over `<iframe>` AND `<video>` AND `<audio>`
 * (none of them on the home surface), so this spec collects all three
 * from the live DOM after `load`. The SSR contract test
 * (`test/integration/lazy-media-contract.test.ts`) reads server
 * markup and therefore cannot see an element that hydration inserts
 * afterwards; a browser leg that only counted iframes would report a
 * green `0` for a page that had just started downloading a video.
 *
 * Two document shapes, reported separately
 * ----------------------------------------
 * The digit WebPs are 0.2–0.9 KB each, so Vite's production build
 * INLINES them into the home document as `data:image/webp;base64`
 * URIs. On that document there is no digit request to defer, and the
 * A/B wire numbers are identical by construction — the attribute
 * governs decode scheduling instead. The dev SSR document keeps them
 * as real asset requests, and there the same A/B is 7 requests before
 * `load` → 0. Every measurement records which shape it saw
 * (`digitImagesInlined`), and the control leg asserts the shape it is
 * in rather than pretending the two are comparable.
 *
 * To measure the dev-server shape, run the same spec against
 * `pnpm dev`:
 *
 *   pnpm dev &
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 \
 *   LAZY_MEDIA_REPORT_DIR=.tmp/lazy-media-dev \
 *   LAZY_MEDIA_ENV='dev server (vite dev)' \
 *     pnpm exec playwright test e2e/lazy-media.spec.ts
 *
 * The local E2E surface needs `MY_WEB_2026_CONSUMER_API_KEY` present
 * (any dummy string) or the counter renders its disabled `—` state and
 * the digit strip does not exist to measure.
 *
 * Declared measurement conditions (recorded into the report)
 * ---------------------------------------------------------
 *   browser    : the pinned Playwright Chromium for this project
 *   network    : CDP `Network.emulateNetworkConditions`, "Fast 4G"
 *                (9 Mbit/s down / 1.5 Mbit/s up / 150 ms RTT);
 *                `LAZY_MEDIA_PROFILE=off` disables throttling.
 *   CPU        : CDP `Emulation.setCPUThrottlingRate` ×4 (same env
 *                switch disables it)
 *   origin     : third-party origins are aborted, so the run is
 *                hermetic and repeatable. This ticket measures
 *                first-party media / iframe cost; GA4 and Google
 *                Fonts have their own surfaces.
 *   surface    : a fresh context per navigation (empty cache), so
 *                "first paint" means first paint.
 *   source     : `git rev-parse HEAD` plus the dirty flag, recorded
 *                into the JSON so a screenshot can never claim a
 *                number for a commit that did not produce it.
 *
 * Reproduction
 * ------------
 *   pnpm run build                            # vite build + build-tools.mjs
 *   pnpm run e2e -- e2e/lazy-media.spec.ts    # writes .tmp/lazy-media/*.json
 *   pnpm run lazy-media:report                # renders the committed WebP
 * CI runs this spec on pushes to `main` / `release-*` and on any PR
 * labelled `ui-change`; the JSON lands in the uploaded Playwright
 * report as a test attachment.
 */

/** `/tools/<slug>/app/**` — the Tool artifact namespace (ADR-0006 §1). */
const TOOL_ARTIFACT = /\/tools\/[^/]+\/app\//;

/** The home counter section — the below-the-fold media this ticket is about. */
const COUNTER_TILE = '[data-testid="home-access-counter-tile"]';

/**
 * The pre-#487 markup, as a rewrite rule.
 *
 * Issue #487 added BOTH `loading` and `decoding` to the digit strip, so
 * the control leg has to remove both to be byte for byte the markup
 * that shipped before the ticket. Stripping only `loading` would leave
 * ` decoding="async"` in the "before" document and report only part of
 * the markup cost as "the attributes' cost".
 */
const MEDIA_MODE_ATTRS = /\s(?:loading|decoding)="[^"]*"/g;

/**
 * The base URL Playwright resolved for this run.
 *
 * `playwright.config.ts` owns it (`PLAYWRIGHT_BASE_URL ?? PLAYWRIGHT_PORT`);
 * re-deriving `http://127.0.0.1:3000` here would make the origin filter —
 * and with it every leg of this measurement — quietly wrong on a
 * non-default port, where every first-party response would be filtered
 * out and the third-party abort route would kill the document itself.
 * The resolved value is read back from the project instead of guessed a
 * second time.
 */
function resolvedBaseURL(testInfo: TestInfo): string {
	const base = testInfo.project.use.baseURL;
	const first = Array.isArray(base) ? base[0] : base;
	if (typeof first !== 'string' || first.length === 0) {
		throw new Error(
			'e2e/lazy-media.spec.ts needs playwright.config.ts#use.baseURL to resolve relative paths',
		);
	}
	return first;
}

const REPORT_DIR = process.env.LAZY_MEDIA_REPORT_DIR ?? '.tmp/lazy-media';
const PROFILE = process.env.LAZY_MEDIA_PROFILE ?? 'fast-4g';
const THROTTLED = PROFILE !== 'off';

interface RecordedResponse {
	url: string;
	path: string;
	resourceType: string;
	bytes: number;
}

interface PageMeasurement {
	label: string;
	path: string;
	generatedAt: string;
	environment: string;
	profile: string;
	cpuThrottlingRate: number;
	browser: string;
	sourceSha: string;
	/** Tracked tree clean? Untracked files are excluded on purpose: the
	 *  verification image this run produces is itself untracked at the
	 *  moment the report is written, and a permanently-dirty report is
	 *  a report nobody reads. */
	trackedTreeDirty: boolean;
	viewport: { width: number; height: number };
	/** Responses observed up to the document's `load` event. */
	responsesBeforeLoad: number;
	/** Image responses for the digit strip, split by when they arrived. */
	digitImagesBeforeLoad: number;
	digitImagesAfterScroll: number;
	/** True when the build inlined the digit strip's WebPs as `data:` URIs. */
	digitImagesInlined: boolean;
	/** `<img>` elements in the digit strip, and how many decoded. */
	digitImageCount: number;
	/** `<img>` markup inside the counter tile — what the inline flag is read from. */
	digitImgTags: string[];
	loadedImageCount: number | null;
	responseCount: number;
	/** Uncompressed document size, measured with an explicit API request. */
	documentBytes: number;
	/**
	 * The same document with every `loading` / `decoding` attribute
	 * removed — i.e. the pre-#487 markup, byte for byte. Derived from
	 * THIS leg's own body rather than from a second request, because
	 * two SSR documents are never byte-identical (timestamps,
	 * counters) and a delta across two requests would be
	 * unattributable.
	 */
	documentBytesPreTicket: number;
	/** Largest first-party responses, for the DevTools-style waterfall. */
	topResponses: RecordedResponse[];
	/** Response count per Playwright resource type. */
	resourceTypeCounts: Record<string, number>;
	toolArtifactResponses: RecordedResponse[];
	mediaResponses: RecordedResponse[];
	mediaBytes: number;
	totalBytes: number;
	imgTags: string[];
	iframeSrcs: (string | null)[];
	/**
	 * `<iframe>` count before an explicit activation click (Issue
	 * #498). `null` on a leg with no consent gate.
	 */
	preActivationIframeCount: number | null;
	/** `<video>` / `<audio>` sources in the live DOM, post-hydration. */
	videoSrcs: (string | null)[];
	audioSrcs: (string | null)[];
	/** iframe + video + audio. The number the contract is stated over. */
	embeddedMediaCount: number;
}

function git(args: string[]): string {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return 'unknown';
	}
}

function isToolArtifact(pathname: string): boolean {
	return TOOL_ARTIFACT.test(pathname);
}

function isMedia(response: RecordedResponse): boolean {
	return (
		response.resourceType === 'image' ||
		response.resourceType === 'media' ||
		/\.(webp|png|jpe?g|avif|gif|svg|mp4|webm)$/i.test(response.path)
	);
}

/** Digit-strip assets: the ten pre-rasterised WebPs of `src/home/digits/`. */
function isDigitImage(response: RecordedResponse): boolean {
	return /\/\d\.webp$/.test(response.path);
}

async function openContext(
	browser: Browser,
	baseURL: string,
	options: { stripMediaMode?: boolean },
) {
	const origin = new URL(baseURL).origin;
	const context: BrowserContext = await browser.newContext({
		baseURL,
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 1,
	});

	// Third-party subresources (GA4, Google Fonts) are out of scope for
	// this ticket, and leaving them in would make the numbers depend on
	// someone else's uptime.
	await context.route('**/*', (route) => {
		if (route.request().url().startsWith(origin)) return route.continue();
		return route.abort();
	});

	if (options.stripMediaMode) {
		await context.route(`${origin}/`, async (route) => {
			const response = await route.fetch();
			const body = (await response.text()).replace(MEDIA_MODE_ATTRS, '');
			await route.fulfill({ response, body });
		});
	}

	const page: Page = await context.newPage();
	const cdp = THROTTLED ? await context.newCDPSession(page) : null;
	if (cdp) {
		await cdp.send('Network.enable');
		await cdp.send('Network.emulateNetworkConditions', {
			offline: false,
			downloadThroughput: (9 * 1024 * 1024) / 8,
			uploadThroughput: (1.5 * 1024 * 1024) / 8,
			latency: 150,
		});
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	}
	return { context, page };
}

/**
 * `src` descriptors for every `<iframe>` / `<video>` / `<audio>` in
 * the live DOM, `<source>` children included.
 *
 * The SSR contract in `test/integration/lazy-media-contract.test.ts`
 * can only see what the server rendered, so anything that hydration
 * or client-side code inserts afterwards is invisible to it. This leg
 * reads the DOM after `load` (and after the scroll on the digit
 * leg), which is the only place a post-hydration `<video>` can be
 * caught — hence all three element types, not just `<iframe>`: the
 * rule is stated over the three of them, so the measurement that
 * backs the rule has to cover the three of them.
 */
async function embeddedMediaSrcs(
	page: Page,
	selector: 'iframe' | 'video' | 'audio',
): Promise<(string | null)[]> {
	return page.locator(selector).evaluateAll((nodes) =>
		nodes.map((node) => {
			const element = node as HTMLMediaElement;
			const nested = [...element.querySelectorAll('source')]
				.map((source) => source.getAttribute('src'))
				.find((value): value is string => Boolean(value));
			return element.getAttribute('src') ?? element.currentSrc ?? nested ?? null;
		}),
	);
}

async function measure(
	browser: Browser,
	label: string,
	path: string,
	options: {
		baseURL: string;
		stripMediaMode?: boolean;
		scrollToSelector?: string;
		/**
		 * Selector for an explicit activation control (Issue #498). When
		 * present the document is measured BEFORE the click as well, so
		 * the "what did the visitor cost before acting" leg stays a
		 * measurement instead of an assumption.
		 */
		activateSelector?: string;
		reportKey: string;
	},
): Promise<PageMeasurement> {
	const { baseURL } = options;
	const origin = new URL(baseURL).origin;
	const { context, page } = await openContext(browser, baseURL, {
		stripMediaMode: options.stripMediaMode,
	});

	const responses: RecordedResponse[] = [];
	context.on('response', (res) => {
		if (!res.url().startsWith(origin)) return;
		// `request.sizes()` needs the response body and throws for most
		// of these, so the wire size comes from `content-length`. The
		// preview server does not compress, so these are uncompressed
		// sizes — comparable between legs, not a bandwidth estimate.
		const declared = res.headers()['content-length'];
		const bytes = declared ? Number(declared) : 0;
		const parsed = new URL(res.url());
		responses.push({
			url: res.url(),
			path: parsed.pathname,
			resourceType: res.request().resourceType(),
			bytes,
		});
	});

	// The SSR document is streamed without `content-length`, so its size
	// is measured separately through the API request context (which does
	// not appear in `responses`). Doing it once, identically for every
	// leg, is what makes the before/after document bytes comparable.
	const documentProbe = await context.request.get(path);
	const probeBody = await documentProbe.body();
	const documentBytes = probeBody.byteLength;
	const documentBytesPreTicket = Buffer.from(
		probeBody.toString('utf8').replace(MEDIA_MODE_ATTRS, ''),
		'utf8',
	).byteLength;

	await page.goto(path, { waitUntil: 'load' });
	const responsesBeforeLoad = responses.length;
	const digitImagesBeforeLoad = responses.filter(isDigitImage).length;

	// Issue #498: a Tool whose declared third-party contacts require
	// consent renders no frame until the visitor starts the load. The
	// counts below that describe the live DOM are taken AFTER that
	// activation, so the Tool leg measures the surface the visitor
	// actually asked for; `preActivationIframeCount` records what the
	// document contained before the click.
	let preActivationIframeCount: number | null = null;
	if (options.activateSelector) {
		preActivationIframeCount = await page.locator('iframe').count();
		await page.locator(options.activateSelector).click();
		await page.waitForFunction(() => document.querySelector('iframe') !== null, undefined, {
			timeout: 10_000,
		});
		await page.waitForLoadState('networkidle');
	}

	let loadedImageCount: number | null = null;
	if (options.scrollToSelector) {
		await page.locator(options.scrollToSelector).scrollIntoViewIfNeeded();
		// A native-lazy image starts fetching when it approaches the
		// viewport; `networkidle` is the bounded window for it to
		// finish. A digit that never loads would leave the section
		// permanently blank — the failure mode a wrong `loading` value
		// looks like from the outside.
		await page.waitForLoadState('networkidle');
		loadedImageCount = await page
			.locator(`${options.scrollToSelector} img`)
			.evaluateAll(
				(nodes) => nodes.filter((node) => (node as HTMLImageElement).naturalWidth > 0).length,
			);
	}

	const imgTags = await page.locator('img').evaluateAll((nodes) => nodes.map((n) => n.outerHTML));
	const iframeSrcs = await embeddedMediaSrcs(page, 'iframe');
	const videoSrcs = await embeddedMediaSrcs(page, 'video');
	const audioSrcs = await embeddedMediaSrcs(page, 'audio');
	const embeddedMediaCount = iframeSrcs.length + videoSrcs.length + audioSrcs.length;
	const digitImageCount = await page
		.locator(`${COUNTER_TILE} img`)
		.count()
		.catch(() => 0);
	// The production build inlines the digit WebPs as `data:` URIs (they
	// are 0.2–0.9 KB each, well under Vite's `assetsInlineLimit`), so
	// on a production document there is no digit *request* to defer.
	// The `loading` mode then governs decode scheduling instead of the
	// wire, and the A/B numbers below mean different things per
	// environment. Recording which shape was measured is what keeps the
	// report honest instead of quietly comparing two different things.
	//
	// Scoped to the counter tile on purpose: the question is whether
	// *the digits* are inlined, and a page-wide `every()` would answer
	// it wrongly the day home carries a normal-URL image (one such
	// image would flip the flag to `false`, and the control leg would
	// then demand seven digit requests that were never going to be
	// made).
	const digitImgTags = await page
		.locator(`${COUNTER_TILE} img`)
		.evaluateAll((nodes) => nodes.map((node) => node.outerHTML))
		.catch(() => [] as string[]);
	const digitImagesInlined =
		digitImgTags.length > 0 && digitImgTags.every((tag) => /src="data:/i.test(tag));

	const measurement: PageMeasurement = {
		label,
		path,
		generatedAt: new Date().toISOString(),
		environment: process.env.LAZY_MEDIA_ENV ?? 'preview (pnpm run build)',
		profile: THROTTLED ? 'Fast 4G (9 Mbit/s down, 150 ms RTT) + CPU x4' : 'off (no throttle)',
		cpuThrottlingRate: THROTTLED ? 4 : 1,
		browser: `chromium ${browser.version()}`,
		sourceSha: git(['rev-parse', 'HEAD']),
		trackedTreeDirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0,
		viewport: page.viewportSize() ?? { width: 0, height: 0 },
		responsesBeforeLoad,
		documentBytes,
		documentBytesPreTicket,
		digitImagesBeforeLoad,
		digitImagesAfterScroll: responses.filter(isDigitImage).length,
		digitImagesInlined,
		digitImageCount,
		digitImgTags,
		loadedImageCount,
		responseCount: responses.length,
		topResponses: [...responses].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
		resourceTypeCounts: responses.reduce<Record<string, number>>((counts, response) => {
			counts[response.resourceType] = (counts[response.resourceType] ?? 0) + 1;
			return counts;
		}, {}),
		toolArtifactResponses: responses.filter((response) => isToolArtifact(response.path)),
		mediaResponses: responses.filter(isMedia),
		mediaBytes: responses.filter(isMedia).reduce((sum, response) => sum + response.bytes, 0),
		totalBytes: responses.reduce((sum, response) => sum + response.bytes, 0),
		imgTags,
		iframeSrcs,
		preActivationIframeCount,
		videoSrcs,
		audioSrcs,
		embeddedMediaCount,
	};

	await context.close();
	await writeMeasurement(options.reportKey, measurement);
	return measurement;
}

/** One file per leg — parallel Playwright workers must not share a file. */
async function writeMeasurement(key: string, measurement: PageMeasurement): Promise<void> {
	await mkdir(REPORT_DIR, { recursive: true });
	await writeFile(
		join(REPORT_DIR, `${key}.json`),
		`${JSON.stringify(measurement, null, 2)}\n`,
		'utf8',
	);
}

test.describe('lazy media / iframe waterfall (Issue #487)', () => {
	test('first paint of / pulls no Tool bundle and defers the below-the-fold digit strip', async ({
		browser,
	}, testInfo) => {
		const baseURL = resolvedBaseURL(testInfo);
		const home = await measure(browser, 'home first paint (loading="lazy")', '/', {
			baseURL,
			scrollToSelector: COUNTER_TILE,
			reportKey: 'home-after',
		});

		// 1. No Tool artifact request — before or after the scroll.
		expect(home.toolArtifactResponses.map((response) => response.url)).toEqual([]);

		// 2. No embedded document on the home surface, in ANY of the
		//    three element types, read from the live DOM after
		//    hydration. An `<iframe>`-only check would let a
		//    client-side `<video>` pass as a green measurement while
		//    the reported number said "iframe / video / audio".
		expect(home.embeddedMediaCount).toBe(0);
		expect(home.iframeSrcs).toEqual([]);
		expect(home.videoSrcs).toEqual([]);
		expect(home.audioSrcs).toEqual([]);

		// 3. Every image states its loading mode.
		for (const tag of home.imgTags) {
			expect(tag).toMatch(/loading="(lazy|eager)"/);
		}

		// 4. Digit-strip behaviour. The strip only exists when the
		//    counter is enabled, which needs
		//    `MY_WEB_2026_CONSUMER_API_KEY`; without it the tile renders
		//    its disabled `—` state and there is nothing to defer. The
		//    measurement is still recorded either way — the markup rule
		//    for the enabled case is pinned by
		//    `test/integration/lazy-media-contract.test.ts`, which binds a
		//    dummy key in the workerd pool.
		if (home.digitImageCount === 0) {
			test.info().annotations.push({
				type: 'note',
				description:
					'counter disabled in this environment: the digit strip is not rendered, so the lazy-digit rules have nothing to measure',
			});
		} else {
			expect(home.digitImageCount).toBe(7);
			// No digit WebP is requested before the strip can be seen —
			// trivially true on a production document (the digits are
			// inlined), load-bearing wherever they are real requests.
			expect(home.digitImagesBeforeLoad).toBe(0);
			// … and the lazy path still ends in decoded pixels, not a
			// permanently blank section.
			expect(home.loadedImageCount).toBe(7);
			if (!home.digitImagesInlined) expect(home.digitImagesAfterScroll).toBe(7);
		}

		await testInfo.attach('lazy-media-home-after', {
			body: JSON.stringify(home, null, 2),
			contentType: 'application/json',
		});
	});

	test('the pre-#487 markup control leg (A/B on the same document)', async ({
		browser,
	}, testInfo) => {
		// The control leg exists so the "after" number above is a
		// measurement, not a claim. Same document, same build, same
		// throttle — only the `loading` attribute differs.
		const baseURL = resolvedBaseURL(testInfo);
		const before = await measure(browser, 'home first paint (pre-#487 markup)', '/', {
			baseURL,
			stripMediaMode: true,
			reportKey: 'home-before',
		});

		if (before.digitImageCount === 0) {
			test.info().annotations.push({
				type: 'note',
				description: 'counter disabled in this environment: no A/B leg to compare',
			});
			await testInfo.attach('lazy-media-home-before', {
				body: JSON.stringify(before, null, 2),
				contentType: 'application/json',
			});
			return;
		}

		// The control markup really did lose both attributes #487
		// added (`loading` AND `decoding`) — otherwise the "before"
		// leg would still be partly the post-#487 document and the
		// byte delta would understate the markup cost.
		expect(
			before.imgTags.every((tag) => !tag.includes('loading=') && !tag.includes('decoding=')),
		).toBe(true);

		if (before.digitImagesInlined) {
			// Production build: the digits are `data:` URIs inside the
			// document, so there is no request to defer and the wire is
			// identical in both legs. The attribute governs decode
			// scheduling here, not bytes on the network.
			expect(before.digitImagesBeforeLoad).toBe(0);
		} else {
			// Dev SSR document: the digits are separate asset requests,
			// and without the attribute the browser pulls all seven
			// during first paint.
			expect(before.digitImagesBeforeLoad).toBe(7);
		}

		await testInfo.attach('lazy-media-home-before', {
			body: JSON.stringify(before, null, 2),
			contentType: 'application/json',
		});
	});

	test('the Tool bundle is fetched only after an explicit navigation', async ({
		browser,
	}, testInfo) => {
		const baseURL = resolvedBaseURL(testInfo);
		const tool = await measure(browser, 'tool route', '/tools/prototype', {
			baseURL,
			activateSelector: '[data-testid="tool-embed-consent-activate"]',
			reportKey: 'tool-route',
		});

		// Issue #498: before the visitor starts the load there is no
		// frame at all — the Tool's declared third-party contacts
		// (Google Fonts / Typekit / Apps Script) must not be paid for by
		// someone who only looked at the page.
		expect(tool.preActivationIframeCount).toBe(0);
		// The shell must still mount its sandboxed iframe …
		expect(tool.iframeSrcs).toEqual(['/tools/prototype/app/index.html']);
		// … and the Tool surface must not gain media elements the
		// home-side rule was measured against.
		expect(tool.videoSrcs).toEqual([]);
		expect(tool.audioSrcs).toEqual([]);
		expect(tool.embeddedMediaCount).toBe(1);
		// … and once the visitor asked for that Tool, the artifact and
		// its bundle MUST be requested. "Nothing loads at all" would
		// satisfy every home-side rule while breaking the Tool.
		expect(tool.toolArtifactResponses.length).toBeGreaterThan(0);

		await testInfo.attach('lazy-media-tool-route', {
			body: JSON.stringify(tool, null, 2),
			contentType: 'application/json',
		});
	});
});
