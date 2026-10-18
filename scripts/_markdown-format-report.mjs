/**
 * Pure builder for the Markdown format regression report (Issue #435).
 *
 * Split from `markdown-format-report.mjs` so the string-building half can
 * be tested with `node --test` — no Vite, no Worker, no filesystem — while
 * the CLI half only has to render fixtures and write the file.
 *
 * The report is a verification artefact, not a product surface, but it is
 * generated from UNTRUSTED fixture text (the hostile fixture is an XSS
 * payload corpus by design). Every fragment of fixture or rendered markup
 * therefore goes through `escapeHtml` on the way into the page: the report
 * must never be the thing that executes a payload.
 */

/** Escape the five characters that can start markup in HTML text and attributes. */
export function escapeHtml(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

/** Reverse the entity escaping React applies to text nodes and attributes. */
export function decodeEntities(value) {
	return String(value ?? '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}

/**
 * The text one reader line must still produce once its Markdown markers
 * are gone. Used by the `no-dropped-line` check; it never "corrects" the
 * source, because a correction here would be a place the renderer is
 * allowed to change meaning.
 */
export function stripMarkdownMarkers(line) {
	return String(line ?? '')
		.trim()
		.replace(/^`{3,}[^`]*$/, '')
		.replace(/^#{1,6}\s+/, '')
		.replace(/^[-*]\s+/, '')
		.replace(/^\d+\.\s+/, '')
		.replace(/^>\s?/, '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/^(-{3,}|\*{3,}|_{3,})$/, '')
		.trim();
}

/**
 * Text a reader sees. Block-level tags contribute a line break the way a
 * browser gives them; inline tags contribute nothing.
 */
export function visibleTextOf(html) {
	const withBlockBreaks = String(html ?? '').replace(
		/<\/?(?:p|h[1-6]|li|ul|ol|pre|blockquote|div|br|hr|table|tr|td|th|section|article)\b[^>]*>/g,
		'\n',
	);
	return decodeEntities(withBlockBreaks.replace(/<[^>]*>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();
}

function tagsOf(html) {
	return String(html ?? '').match(/<[^>]*>/g) ?? [];
}

/**
 * True when a markup string carries nothing a browser would execute.
 *
 * The report injects the rendered fixture verbatim — that is the whole
 * point of the artefact — so it re-checks its own input first. If a future
 * renderer change made the markup executable, the report shows the markup
 * escaped inside a `<pre>` instead of running it. The regression becomes
 * visible in the artefact rather than in the browser viewing it.
 */
export function markupIsInert(html) {
	return !tagsOf(html).some(
		(tag) =>
			/^<\/?(?:script|iframe|object|embed|style|link|meta|form)\b/i.test(tag) ||
			/\son[a-z]+\s*=/i.test(tag),
	);
}

function hrefsOf(html) {
	return [...String(html ?? '').matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

/**
 * Evaluate the safety / fidelity contract for one rendered fixture.
 *
 * Same claims the Vitest suite asserts, in report form. Returns one entry
 * per check so the artefact shows WHICH claim was measured rather than a
 * single opaque pass/fail.
 */
export function evaluateContract({ source, html }) {
	const rendered = String(html ?? '');
	const text = visibleTextOf(rendered);
	const tags = tagsOf(rendered);
	const hrefs = hrefsOf(rendered);
	const sourceLines = String(source ?? '')
		.split('\n')
		.map(stripMarkdownMarkers)
		.filter(Boolean);

	const injectedTags = tags.filter((tag) =>
		/^<\/?(?:script|iframe|img|svg|object|embed|form|style|link|meta)\b/i.test(tag),
	);
	const handlerTags = tags.filter((tag) => /\son[a-z]+\s*=/i.test(tag));
	const badHrefs = hrefs.filter(
		(href) => href !== '#' && !href.startsWith('/') && !/^https?:\/\//i.test(href),
	);
	const missingLines = sourceLines.filter((line) => !text.includes(line));
	const forbiddenAttributes = [/\slang=/i, /\sdir=/i, /data-locale/].filter((pattern) =>
		pattern.test(rendered),
	);
	// Whitespace is normalised on both sides: `visibleTextOf` folds a
	// source newline into a space, and that fold is not an invented
	// character.
	const sourceCharacters = new Set(`${String(source ?? '').replace(/\s+/g, ' ')}"'\`*-_#>[]()`);
	const introducedCharacters = [...new Set(text)].filter((ch) => !sourceCharacters.has(ch));

	return [
		{
			id: 'inert-markup',
			label: '危険な HTML が実行可能な要素にならない',
			detail:
				injectedTags.length === 0
					? `注入試行 ${injectedTags.length} 件 / event handler ${handlerTags.length} 件`
					: `要素: ${injectedTags.slice(0, 3).join(' ')}`,
			status: injectedTags.length === 0 && handlerTags.length === 0 ? 'pass' : 'fail',
		},
		{
			id: 'href-scheme',
			label: 'href が http(s) / 相対 / inert fallback に閉じている',
			detail:
				badHrefs.length === 0
					? `href ${hrefs.length} 件 / 非許可 ${badHrefs.length} 件`
					: `非許可: ${badHrefs.slice(0, 3).join(' ')}`,
			status: badHrefs.length === 0 ? 'pass' : 'fail',
		},
		{
			id: 'no-dropped-line',
			label: '入力の各行が marker を外した形で可視テキストに残る',
			detail:
				missingLines.length === 0
					? `${sourceLines.length} 行すべて保持`
					: `${missingLines.length} 行が欠落: ${missingLines[0].slice(0, 24)}`,
			status: missingLines.length === 0 ? 'pass' : 'fail',
		},
		{
			id: 'locale-free',
			label: 'locale を推論せず、lang / dir を出力しない',
			detail:
				forbiddenAttributes.length === 0
					? 'lang / dir / data-locale なし'
					: forbiddenAttributes.map(String).join(' '),
			status: forbiddenAttributes.length === 0 ? 'pass' : 'fail',
		},
		{
			id: 'no-typography-substitution',
			label: 'source に無い文字（smart quote 等）を導入しない',
			detail:
				introducedCharacters.length === 0
					? '導入文字なし'
					: `導入: ${introducedCharacters.join(' ')}`,
			status: introducedCharacters.length === 0 ? 'pass' : 'fail',
		},
	];
}

/** Report chrome. Colours come from the Panda token variables the inlined
 * stylesheet defines, so the artefact matches the shipped palette instead
 * of hard-coding hex values that would drift. */
const CHROME_CSS = `
	:root { color-scheme: light dark; }
	body {
		margin: 0;
		padding: 2.5rem 2rem 4rem;
		background: var(--colors-bg-canvas);
		color: var(--colors-text-default);
		font-family: var(--font-fallback);
		line-height: 1.6;
	}
	.report { max-width: 76rem; margin: 0 auto; }
	.report > h1 { font-size: 1.5rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
	.report > p.lede { margin: 0 0 1.75rem; color: var(--colors-text-muted); font-size: 0.875rem; }
	.report > p.lede code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	h2.fixture { font-size: 1.05rem; margin: 2.25rem 0 0.5rem; }
	p.fixture-note { margin: 0 0 0.9rem; color: var(--colors-text-muted); font-size: 0.8125rem; }
	table.checks { width: 100%; border-collapse: collapse; margin: 0 0 1.25rem; font-size: 0.8125rem; }
	table.checks th, table.checks td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--colors-border-subtle); vertical-align: top; }
	table.checks th { color: var(--colors-text-muted); font-weight: 600; }
	table.checks td.detail { color: var(--colors-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	td.verdict { white-space: nowrap; font-weight: 600; }
	td.verdict.pass { color: var(--colors-accent-positive); }
	td.verdict.fail { color: var(--colors-accent-negative); }
	div.columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
	div.pane { border: 1px solid var(--colors-border-subtle); border-radius: 0.5rem; padding: 0.85rem 1rem; overflow: hidden; }
	div.pane > h3 { margin: 0 0 0.5rem; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--colors-text-muted); }
	pre.source { margin: 0; max-height: 34rem; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
	p.summary { margin: 0 0 0.25rem; font-size: 0.875rem; }
	p.summary strong { font-weight: 600; }
`;

/** Build the standalone report page. Fixture text is escaped by contract. */
export function buildReportHtml({ heading, lede, css, fixtures }) {
	const sections = fixtures
		.map((fixture) => {
			const rows = fixture.checks
				.map(
					(check) => `		<tr>
			<td class="verdict ${check.status === 'pass' ? 'pass' : 'fail'}">${check.status === 'pass' ? 'PASS' : 'FAIL'}</td>
			<td>${escapeHtml(check.label)}</td>
			<td class="detail">${escapeHtml(check.detail)}</td>
		</tr>`,
				)
				.join('\n');
			const renderedPane = markupIsInert(fixture.html)
				? `<div class="rendered">${fixture.html}</div>`
				: `<p class="fixture-note">Rendered markup was NOT inert, so it is shown escaped.</p>
				<pre class="source">${escapeHtml(fixture.html)}</pre>`;
			return `	<section>
		<h2 class="fixture">${escapeHtml(fixture.title)}</h2>
		<p class="fixture-note">${escapeHtml(fixture.note)}</p>
		<table class="checks">
			<thead>
				<tr><th>判定</th><th>検査</th><th>計測</th></tr>
			</thead>
			<tbody>
${rows}
			</tbody>
		</table>
		<div class="columns">
			<div class="pane">
				<h3>Markdown source</h3>
				<pre class="source">${escapeHtml(fixture.source)}</pre>
			</div>
			<div class="pane">
				<h3>Rendered (PortfolioMarkdown, real component)</h3>
${renderedPane}
			</div>
		</div>
	</section>`;
		})
		.join('\n');

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(heading)}</title>
		<style>${css ?? ''}</style>
		<style>${CHROME_CSS}</style>
	</head>
	<body>
		<div class="report">
			<h1>${escapeHtml(heading)}</h1>
			<p class="lede">${escapeHtml(lede)}</p>
${sections}
		</div>
	</body>
</html>
`;
}
