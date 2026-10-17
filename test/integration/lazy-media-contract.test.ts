/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { listAllTools } from '../../src/tools/registry';
import { REACTIONS_MIGRATIONS } from '../helpers/reactions-schema';

/**
 * Lazy media / iframe contract (Issue #487).
 *
 * What this proves
 * ----------------
 * The first paint of `/` must not pull in anything the visitor has not
 * asked for yet:
 *
 *   - no Tool artifact (`/tools/<slug>/app/**`) in any *element*;
 *     ProtoType alone is a ~1.5 MB Vite bundle (gsap + three.js +
 *     pixi.js + recharts), so one accidental reference on the home
 *     surface is the most expensive regression this repository could
 *     ship;
 *   - no `<iframe>` / `<video>` / `<audio>` element, i.e. no embedded
 *     document that starts its own subresource fetch on load;
 *   - no `<link rel="preload|prefetch">` hint pointing at a Tool
 *     artifact — a page that "lazily" preloads it is not lazy;
 *   - every `<img>` declares its own `loading` mode, so no image is
 *     left on the implicit `eager` default. The home counter's digit
 *     strip is the case this catches: seven small WebPs rendered in
 *     the fifth section, far below the fold.
 *
 * The positive control matters as much as the negative assertions:
 * `/tools/<slug>` MUST still mount its iframe immediately. A "lazy"
 * contract that also removed the Tool shell would satisfy every
 * assertion above while breaking the product.
 *
 * Element scope, not document scope
 * ---------------------------------
 * TanStack Start serialises every loader payload into the
 * `<script class="$tsr">` hydration stream, so `/tools` HTML *does*
 * contain the string `/tools/prototype/app/index.html` — as inert
 * route data the browser never fetches. Assertions therefore run over
 * markup with `<script>` bodies removed. What the browser actually
 * pulls over the wire is measured separately, from a real browser, in
 * `e2e/lazy-media.spec.ts`.
 *
 * Why a workerd SELF test and not Playwright
 * ------------------------------------------
 * This suite is a *contract*, not a benchmark, so it has to run in
 * `validate:fast` (`quality/profile.yaml#gates.fast`) — the gate every
 * PR and every release-branch push gets. Playwright E2E runs only on
 * pushes to `main` / `release-*` and on `ui-change` PRs, and
 * `e2e/lazy-media.spec.ts` builds the throttled browser waterfall on
 * top of the same rules. The two are deliberately not merged: a
 * throttled measurement is a number with a variance, and a number with
 * a variance does not belong in a gate that has to stay deterministic.
 *
 * Fixture notes
 * -------------
 * Schema bootstrap: the home route reads `reactions` and
 * `reaction_emoji_catalog`, so the tables are applied here from the
 * shared `test/helpers/reactions-schema.ts` fixture. Access-counter
 * tables are not needed: a failed upstream read degrades to
 * `enabled: true, count: 0`, which still renders the digit strip this
 * suite asserts on.
 *
 * Every document is fetched once, in `beforeAll`. workerd pays a
 * one-off ~5 s initialisation on the first `SELF.fetch` of a suite,
 * which is uncomfortably close to the 5 s per-test timeout; a hook has
 * more headroom, and one fetch per path is also the honest shape for
 * a document-level contract.
 */

/** `<iframe …>`, `<video …>`, `<audio …>` in any casing. */
const EMBEDDED_MEDIA = /<(iframe|video|audio)\b/i;

const D1 = () => env.DB;

/**
 * Tool artifact namespaces (`/tools/<slug>/app`) from the manifest.
 *
 * `flatMap` rather than `filter().map()`: the predicate tests
 * `tool.delivery.kind`, and TypeScript only narrows `tool.delivery`
 * inside the branch body — a `.filter()` callback returning a boolean
 * is not a type predicate, so `artifact_path` would not exist on the
 * surviving `ManifestTool` values.
 */
const TOOL_ARTIFACT_PATHS = listAllTools().flatMap((tool) =>
	tool.delivery.kind === 'same_origin_static' ? [tool.delivery.artifact_path] : [],
);

const DISABLED_TOOL = listAllTools().find((tool) => tool.delivery.kind === 'host_disabled');

/** Markup with hydration `<script>` bodies removed. */
function markup(html: string): string {
	return html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/** `<img …>` opening tags, in document order. */
function imgTags(html: string): string[] {
	return [...markup(html).matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
}

async function fetchDocument(path: string): Promise<string> {
	const res = await SELF.fetch(`https://example.com${path}`);
	expect(res.status, `GET ${path} must render 200 to assert on its markup`).toBe(200);
	return (await res.text()).replaceAll('<!-- -->', '');
}

let home: string;
let toolsIndex: string;
let toolRoute: string;
let disabledRoute: string;

beforeAll(async () => {
	await applyD1Migrations(D1(), REACTIONS_MIGRATIONS);
	expect(DISABLED_TOOL, 'manifest must keep at least one host_disabled Tool').toBeDefined();
	[home, toolsIndex, toolRoute, disabledRoute] = await Promise.all([
		fetchDocument('/'),
		fetchDocument('/tools'),
		fetchDocument('/tools/prototype'),
		fetchDocument(`/tools/${DISABLED_TOOL?.slug}`),
	]);
});

describe('lazy media / iframe contract (Issue #487)', () => {
	it('the manifest still declares a same-origin Tool artifact to guard', () => {
		// Guards the assertions below from degrading into vacuous
		// truth: if every Tool were `host_disabled`, "no artifact
		// reference on home" would prove nothing.
		expect(TOOL_ARTIFACT_PATHS.length).toBeGreaterThan(0);
	});

	it('home mounts no iframe / video / audio element', () => {
		expect(home).not.toMatch(EMBEDDED_MEDIA);
	});

	it('home markup references no Tool artifact path', () => {
		const html = markup(home);
		for (const artifactPath of TOOL_ARTIFACT_PATHS) {
			expect(html).not.toContain(artifactPath);
		}
	});

	it('home emits no preload / prefetch hint for a Tool artifact', () => {
		// Scoped to Tool artifacts on purpose. Vite's dev-mode SSR
		// import analysis injects `<link rel="preload" as="image">`
		// for every `?url` asset a page imports, so the home document
		// carries a hint for the counter digits here that the
		// production build does not emit. That dev/production
		// difference is measured against the real production bundle in
		// `e2e/lazy-media.spec.ts`; this suite stays a contract.
		const html = markup(home);
		const hints = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
		for (const hint of hints) {
			for (const artifactPath of TOOL_ARTIFACT_PATHS) {
				expect(hint).not.toContain(artifactPath);
			}
		}
	});

	it('every <img> on home declares an explicit loading mode', () => {
		const tags = imgTags(home);
		// The counter digit strip is 7 slots wide (DIGIT_SLOTS in
		// src/home/access/tiles.tsx). Assert the count so a future
		// component cannot satisfy the rule below by adding no
		// images at all.
		expect(tags).toHaveLength(7);
		for (const tag of tags) {
			expect(tag).toMatch(/\sloading="(lazy|eager)"/);
		}
	});

	it('the Tool iframe still mounts eagerly on /tools/<slug> (positive control)', () => {
		const html = markup(toolRoute);
		const iframes = [...html.matchAll(/<iframe\b[^>]*>/gi)].map((match) => match[0]);
		expect(iframes).toHaveLength(1);
		expect(iframes[0]).toContain('src="/tools/prototype/app/index.html"');
		// The shell keeps its sandbox; making the shell lazy is not a
		// licence to relax the Tool isolation contract.
		expect(iframes[0]).toContain('sandbox="allow-scripts"');
	});

	it('a host_disabled Tool mounts no iframe and no artifact', () => {
		const html = markup(disabledRoute);
		expect(html).not.toMatch(EMBEDDED_MEDIA);
		expect(html).not.toContain('/app/index.html');
	});

	it('the Tool index names Tools but never points at a Tool bundle', () => {
		// `/tools` is one click from home, so it is the only Tool
		// surface a visitor reaches without asking for a Tool.
		expect(toolsIndex).not.toMatch(EMBEDDED_MEDIA);
		for (const artifactPath of TOOL_ARTIFACT_PATHS) {
			expect(markup(toolsIndex)).not.toContain(artifactPath);
		}
	});
});
