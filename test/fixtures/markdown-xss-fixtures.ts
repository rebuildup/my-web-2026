/**
 * Accepted / rejected Markdown corpus for the XSS boundary
 * (Issue #451).
 *
 * Why the corpus lives in `test/fixtures/`
 * ----------------------------------------
 * The Issue asks for ONE reproduction that both test layers and the
 * verification artefact can share:
 *
 *   1. `src/portfolio/markdown.security.test.tsx` — renderer level
 *      (`renderToStaticMarkup` over the real `PortfolioMarkdown`).
 *   2. `test/integration/markdown-xss-ssr.test.ts` — Worker level
 *      (`SELF.fetch('/portfolio/markdown-xss-fixture')` against a
 *      seeded D1 row).
 *   3. `.tmp/capture-markdown-xss-fixture.mjs` — the browser
 *      screenshot that lands in
 *      `docs/verification/security/markdown-xss-fixture.webp`.
 *
 * A corpus that lives in a `.test.` file can only ever serve layer 1,
 * and the page that gets screenshotted would drift from what CI
 * asserts. This module is pure data plus one pure predicate, so all
 * three consume the same bytes.
 *
 * The file is not itself a test, so any layer can import it, but it
 * stays outside `SCAN_ROOTS` (`src/`, `public/`). The publication
 * gate scans shipped source for external hosts and deliberately
 * skips test files because "a fixture URL is not a published URL"
 * (`scripts/check-publication-diff.mjs`). Living under `src/` made
 * these reserved documentation hosts look like outbound dependencies
 * and turned release CI red (Issue #599).
 *
 * Payload policy
 * --------------
 * These strings are ATTACK SIMULATIONS rendered inert by the
 * renderer. They are committed on purpose: a security fixture that
 * cannot be read cannot be reviewed. They contain no credentials, no
 * internal hostnames, and no live third-party origin — every
 * "destination" is `example.com` / `example.invalid`, reserved for
 * documentation by RFC 2606 / RFC 6761, and the payloads only ever
 * assign to `window.__xssFired`, a marker a test asserts is absent.
 *
 * Cross-references:
 *   - `src/portfolio/markdown.lexer.ts` — `classifyHref` oracle.
 *   - `src/portfolio/markdown.notion.ts` — Notion-derived HTML adapter
 *     (its own corpus lives beside its test).
 *   - `docs/security.md` §"Markdown / Notion-derived HTML input boundary".
 */

export interface MarkdownFixture {
	/** Stable id used as the D1 section anchor / test name. */
	readonly id: string;
	/** Short human label (English; rendered as-is on the fixture page). */
	readonly label: string;
	/** The Markdown source fed to the renderer. */
	readonly input: string;
	/**
	 * `accepted` — the renderer keeps a usable, navigable result.
	 * `blocked`   — the input is refused (escaped, or replaced by the
	 *              visible blocked-link marker).
	 */
	readonly expectation: 'accepted' | 'blocked';
	/**
	 * Which input shape the fixture exercises. `markdown-link` fixtures
	 * must produce the visible blocked-link marker; `raw-html` fixtures
	 * must degrade to escaped text (there is no link to refuse). The
	 * distinction is asserted, not assumed — a link fixture that stops
	 * rendering a marker would otherwise pass as "escaped text".
	 */
	readonly vector: 'text' | 'markdown-link' | 'raw-html';
	/** Why this case exists, and what "success" looks like for it. */
	readonly note: string;
}

/**
 * Accepted input — normal article copy. These must keep rendering as
 * real markup; a sanitizer that eats everything would pass the
 * "nothing executes" assertion while destroying the page.
 */
const ACCEPTED_FIXTURES: readonly MarkdownFixture[] = [
	{
		id: 'plain-prose',
		label: 'Plain prose + emphasis',
		input: 'Normal **bold** and *italic* copy stays intact.',
		expectation: 'accepted',
		vector: 'text',
		note: 'Baseline. Strong / em still render as real elements.',
	},
	{
		id: 'internal-link',
		label: 'Internal link',
		input: 'Back to the [index](/portfolio).',
		expectation: 'accepted',
		vector: 'markdown-link',
		note: 'Same-origin href stays relative, target=_self, no rel.',
	},
	{
		id: 'external-link',
		label: 'External link',
		input: 'Read the [reference](https://example.com/docs).',
		expectation: 'accepted',
		vector: 'markdown-link',
		note: 'Off-origin href keeps target=_blank rel="noopener noreferrer".',
	},
];

/**
 * Rejected input — the dangerous shapes. Every one of these must end
 * up either as escaped text or as the visible blocked-link marker,
 * and none may contribute a live attribute to the DOM.
 */
const BLOCKED_FIXTURES: readonly MarkdownFixture[] = [
	{
		id: 'script-tag',
		label: 'Raw <script> tag',
		input: '<script>window.__xssFired=1</script>',
		expectation: 'blocked',
		vector: 'raw-html',
		note: 'Raw HTML is not parsed; the text is escaped to `&lt;script&gt;`.',
	},
	{
		id: 'img-onerror',
		label: 'img/onerror handler',
		input: '<img src=x onerror="window.__xssFired=1">',
		expectation: 'blocked',
		vector: 'raw-html',
		note: 'Event-handler attributes need no tag to be dangerous; escaped text only.',
	},
	{
		id: 'svg-onload',
		label: 'svg/onload handler',
		input: '<svg onload="window.__xssFired=1"></svg>',
		expectation: 'blocked',
		vector: 'raw-html',
		note: 'SVG payloads are the classic inline-HTML vector; escaped text only.',
	},
	{
		id: 'iframe',
		label: 'iframe injection',
		input: '<iframe src="https://example.invalid/frame"></iframe>',
		expectation: 'blocked',
		vector: 'raw-html',
		note: 'Framing a third-party document is refused outright by the lexer.',
	},
	{
		id: 'javascript-url',
		label: 'javascript: URL',
		input: '[click me](javascript:window.__xssFired=1)',
		expectation: 'blocked',
		vector: 'markdown-link',
		note: 'Blocked with reason `scheme-not-allowed` and shown as a visible marker.',
	},
	{
		id: 'javascript-url-control-char',
		label: 'javascript: URL with a TAB',
		input: '[click me](java\tscript:window.__xssFired=1)',
		expectation: 'blocked',
		vector: 'markdown-link',
		note: 'Browsers strip TAB/LF/CR before parsing the scheme; refused up front.',
	},
	{
		id: 'javascript-url-entity',
		label: 'javascript: URL with entity-encoded colon',
		input: '[click me](javascript&#58;window.__xssFired=1)',
		expectation: 'blocked',
		vector: 'markdown-link',
		note: 'Entity decoding exposes the scheme; blocked with reason `encoded-scheme`.',
	},
	{
		id: 'data-url',
		label: 'data: URL document',
		input: '[open](data:text/html,<script>window.__xssFired=1</script>)',
		expectation: 'blocked',
		vector: 'markdown-link',
		note: '`data:` can carry a whole HTML document; never a link target.',
	},
	{
		id: 'vbscript-url',
		label: 'vbscript: URL',
		input: '[legacy](vbscript:msgbox(1))',
		expectation: 'blocked',
		vector: 'markdown-link',
		note: 'Legacy-engine scheme; refused with the same visible marker.',
	},
];

/** The full corpus: accepted first, then blocked. */
export const MARKDOWN_XSS_FIXTURES: readonly MarkdownFixture[] = [
	...ACCEPTED_FIXTURES,
	...BLOCKED_FIXTURES,
];

/**
 * Ids the blocked corpus MUST keep covering.
 *
 * The corpus is data, so it can quietly lose a whole payload family
 * in a refactor. The test asserts this list is still present, which
 * turns "we still test script tags / svg handlers / obfuscated
 * schemes" into a checkable statement instead of a memory.
 */
export const BLOCKED_FIXTURE_IDS = [
	/** Raw HTML script element. */
	'script-tag',
	/** Inline event handler on a void element. */
	'img-onerror',
	/** SVG payload (the classic inline-HTML vector). */
	'svg-onload',
	/** Framed third-party document. */
	'iframe',
	/** `javascript:` scheme. */
	'javascript-url',
	/** `javascript:` hidden behind a TAB. */
	'javascript-url-control-char',
	/** `javascript:` hidden behind a character reference. */
	'javascript-url-entity',
	/** `data:` document URL. */
	'data-url',
	/** `vbscript:` legacy scheme. */
	'vbscript-url',
] as const;

export function acceptedMarkdownFixtures(): readonly MarkdownFixture[] {
	return MARKDOWN_XSS_FIXTURES.filter((fixture) => fixture.expectation === 'accepted');
}

export function blockedMarkdownFixtures(): readonly MarkdownFixture[] {
	return MARKDOWN_XSS_FIXTURES.filter((fixture) => fixture.expectation === 'blocked');
}

/** Blocked fixtures that go through the LINK path (must show the marker). */
export function blockedLinkFixtures(): readonly MarkdownFixture[] {
	return blockedMarkdownFixtures().filter((fixture) => fixture.vector === 'markdown-link');
}

/** Blocked fixtures that are raw HTML (must degrade to escaped text only). */
export function blockedRawHtmlFixtures(): readonly MarkdownFixture[] {
	return blockedMarkdownFixtures().filter((fixture) => fixture.vector === 'raw-html');
}

/**
 * Compose the corpus into one Markdown body.
 *
 * Each fixture becomes its own paragraph so the rendered page shows
 * the label next to the payload — that is what makes the screenshot
 * readable as evidence rather than as a wall of escaped angle
 * brackets.
 */
export function composeMarkdownFixtureBody(): string {
	return MARKDOWN_XSS_FIXTURES.map((fixture) =>
		[
			`### ${fixture.label} _(${fixture.expectation} / ${fixture.vector})_`,
			'',
			fixture.input,
			'',
			fixture.note,
		].join('\n'),
	).join('\n\n');
}

/** Slug of the row that carries the corpus to the renderer. */
export const MARKDOWN_XSS_FIXTURE_SLUG = 'markdown-xss-fixture';

/**
 * The fixture row, as DATA — deliberately not as SQL.
 *
 * The write path belongs to each caller: a bound `?n` statement in the
 * workerd integration test, a `--batch` JSON file in the Playwright
 * layer, a batch file in the screenshot generator. Sharing the row
 * values (not a statement string) is what keeps those three layers
 * from drifting into seeding *different* content behind the same slug.
 */
export const MARKDOWN_XSS_FIXTURE_PROJECT = {
	id: 'xss_fixture',
	slug: MARKDOWN_XSS_FIXTURE_SLUG,
	title: 'Markdown XSS fixture',
	summary: 'Local reproduction of the Issue #451 corpus. Not published content.',
	role: 'Fixture',
	periodStart: Date.UTC(2026, 0, 1),
	periodLabel: 'fixture',
	periodEnd: null,
	facets: '["develop"]',
	technologies: '["TypeScript"]',
	visibility: 'public',
	status: 'published',
	pinned: 0,
	displayOrder: 900,
	createdAt: Date.UTC(2026, 0, 1),
	updatedAt: Date.UTC(2026, 0, 1),
	motivationMd: composeMarkdownFixtureBody(),
} as const;

/** Column order for {@link MARKDOWN_XSS_FIXTURE_PROJECT}. */
export const MARKDOWN_XSS_FIXTURE_COLUMNS: readonly string[] = [
	'id',
	'slug',
	'title',
	'summary',
	'role',
	'period_start',
	'period_end',
	'period_label',
	'motivation_md',
	'facets',
	'technologies',
	'visibility',
	'status',
	'pinned',
	'display_order',
	'created_at',
	'updated_at',
];

/** Values in {@link MARKDOWN_XSS_FIXTURE_COLUMNS} order. */
export function markdownXssFixtureRowValues(): readonly (string | number | null)[] {
	const p = MARKDOWN_XSS_FIXTURE_PROJECT;
	return [
		p.id,
		p.slug,
		p.title,
		p.summary,
		p.role,
		p.periodStart,
		p.periodEnd,
		p.periodLabel,
		p.motivationMd,
		p.facets,
		p.technologies,
		p.visibility,
		p.status,
		p.pinned,
		p.displayOrder,
		p.createdAt,
		p.updatedAt,
	];
}

/**
 * Markup that would let a payload run if it ever reached the DOM.
 *
 * This is the shared oracle both test layers assert against. It runs
 * on RENDERED HTML, so it must be able to tell escaped text
 * (`&lt;img src=x onerror=…&gt;`) from live markup (`<img onerror>`).
 * Hence the patterns are anchored on the opening angle bracket and on
 * an attribute boundary *inside* a tag, never on the bare payload
 * substring.
 */
const EXECUTABLE_MARKUP_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
	{ name: 'script element', pattern: /<script\b/i },
	{ name: 'iframe element', pattern: /<iframe\b/i },
	{ name: 'object element', pattern: /<object\b/i },
	{ name: 'embed element', pattern: /<embed\b/i },
	{ name: 'svg element', pattern: /<svg\b/i },
	{ name: 'img element', pattern: /<img\b/i },
	{ name: 'form element', pattern: /<form\b/i },
	{ name: 'style element', pattern: /<style\b/i },
	{
		name: 'inline event-handler attribute',
		pattern: /<[a-z][^>]*\son[a-z]+\s*=/i,
	},
];

/** Schemes that must never reach an `href` / `src` attribute value. */
const ACTIVE_URL_IN_ATTRIBUTE =
	/(?:^|[\s<])(?:href|src|action|formaction)\s*=\s*["']?\s*(?:javascript|data|vbscript|file|blob):/i;

/**
 * Report every executable-markup finding in `html`.
 *
 * Returns `[]` when the output is inert. Callers assert on emptiness
 * so a failure names the finding instead of just "expected false".
 */
export function executableMarkupFindings(html: string): readonly string[] {
	const findings: string[] = [];
	for (const { name, pattern } of EXECUTABLE_MARKUP_PATTERNS) {
		if (pattern.test(html)) findings.push(name);
	}
	if (ACTIVE_URL_IN_ATTRIBUTE.test(html)) findings.push('active URL in attribute');
	return findings;
}

/**
 * Narrow `html` to one region so a whole-page assertion is not
 * confused by the framework's own hydration `<script>` tags.
 *
 * The portfolio detail page wraps the rendered Markdown in
 * `<article id="portfolio-detail">`; the SSR shell outside it is
 * trusted application code, and asserting over it would prove
 * nothing about the input boundary.
 */
export function articleRegion(html: string): string {
	const start = html.indexOf('<article');
	if (start === -1) return '';
	const end = html.indexOf('</article>', start);
	return end === -1 ? html.slice(start) : html.slice(start, end);
}
