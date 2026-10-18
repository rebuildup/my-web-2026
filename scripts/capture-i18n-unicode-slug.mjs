#!/usr/bin/env node

/**
 * capture-i18n-unicode-slug — render the Issue #433 verification screen
 * into `docs/verification/i18n/unicode-slug-validation.webp`.
 *
 * What this captures
 * ------------------
 * The shared decision table (`src/i18n/fixtures.ts`) classified by the
 * shipped policy with the two shipped grammars
 * (`EMOJI_SLUG_GRAMMAR`, `PORTFOLIO_SLUG_GRAMMAR`), plus:
 *
 *   - display-body facts: normalization form, code points, and whether
 *     an NFKC compatibility fold would change the text,
 *   - the URL verdict per grammar space, with the refusal reason,
 *   - a COUNTERFACTUAL column: what a naive "slugify" (NFKD + drop
 *     combining marks) would have produced for the same text. This is
 *     evidence for the refusal, never an implementation — the policy
 *     module ships no lossy derivation, and this script exists to show
 *     the collision the policy prevents,
 *   - the catalog collision audit (duplicate URL / NFC-NFD alias),
 *   - the `check-i18n-policy` gate result over the same tree, so the
 *     image carries the CI evidence and not only a pretty table.
 *
 * Everything is imported from the shipped modules, so the committed
 * image cannot drift from the code the Worker runs.
 *
 * Safety
 * ------
 *   - No deploy, no remote binding, no secret read or print. The page
 *     is fixture data plus the repository's own source files.
 *   - No network: the font stacks are declared but NOT fetched (system
 *     fallback), and the page is rendered with `setContent`, so there
 *     is no origin and no request at all.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG and Issue #433 names a `.png` path, but a
 * verification artefact does not justify a permanently large binary in
 * the tree. The capture is taken into `.tmp/`, encoded with the
 * existing `sharp` devDependency (width <= 1600, quality 75) and the
 * committed file is the `.webp` sibling. The script REFUSES any
 * non-`.webp` output path and deletes the intermediate PNG.
 *
 * Requires Node >= 22.18 (the TypeScript sources are imported
 * directly), matching `package.json#engines` and CI.
 *
 * Usage:
 *   node scripts/capture-i18n-unicode-slug.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/i18n/unicode-slug-validation.webp)
 *   --png=<path>          temporary PNG capture
 *                         (default .tmp/i18n-unicode-slug/capture.png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/i18n-unicode-slug/report.json)
 *   --width=<n>           viewport width (default 1440)
 *   --no-capture          build the evidence and the HTML, write no artefact
 */

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 75;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

export const DEFAULT_SCREENSHOT = 'docs/verification/i18n/unicode-slug-validation.webp';
export const DEFAULT_PNG = '.tmp/i18n-unicode-slug/capture.png';
export const DEFAULT_JSON_OUT = '.tmp/i18n-unicode-slug/report.json';
export const DEFAULT_WIDTH = 1440;

/** The fixture rows the report must contain; an empty page is a failure. */
export const EXPECTED_FIXTURE_COUNT = 17;

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

/** Minimal HTML escaping: the gate text is command output, not source. */
export function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * COUNTERFACTUAL ONLY — the naive slugifier this platform refuses.
 *
 * `NFKD` plus "drop every combining mark" plus strip what is left, which
 * is the last step of almost every off-the-shelf slugify helper. It is
 * here so the report can print the URL a lossy pipeline WOULD have
 * minted next to the verdict the platform actually returns. Nothing in
 * `src/` calls this, and `check-i18n-policy` bans the `slugify(` shape
 * in the shipped surface — which is the point.
 */
export function naiveSlugify(text) {
	return text
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Which distinct display texts would collapse onto the same naive slug. */
export function naiveSlugCollisions(rows) {
	const byNaive = new Map();
	for (const row of rows) {
		const naive = naiveSlugify(row.displayText);
		if (naive === '') continue;
		byNaive.set(naive, [...(byNaive.get(naive) ?? []), row.displayText]);
	}
	return [...byNaive.entries()]
		.filter(([, spellings]) => spellings.length > 1)
		.map(([naive, spellings]) => ({ naive, spellings }));
}

/** `{colors.brand.700}` → `#0369a1`, using the repo's own raw tokens. */
export function resolveTokenReference(reference, rawColors) {
	const match = /^\{colors\.([A-Za-z]+)\.(\d+)\}$/.exec(String(reference));
	if (!match) return String(reference);
	const step = rawColors[match[1]]?.[match[2]];
	return step?.value ?? String(reference);
}

/**
 * Resolve the editorial semantic palette into CSS custom properties, so
 * the artefact uses the shipped visual language instead of a
 * hand-picked one. Appearance is pinned to the light values: a
 * verification artefact has to look the same on every machine.
 */
export function buildPalette(rawTokens, semanticTokens) {
	const declarations = [];
	for (const [role, entries] of Object.entries(semanticTokens.colors)) {
		for (const [name, entry] of Object.entries(entries)) {
			const value = entry?.value?.base ?? entry?.value;
			if (typeof value !== 'string') continue;
			const resolved = resolveTokenReference(value, rawTokens.colors);
			if (resolved.startsWith('#')) declarations.push(`--${role}-${name}: ${resolved};`);
		}
	}
	return declarations.join('\n\t\t');
}

/** The font stacks the product declares. No webfont is fetched. */
export function buildFontStacks(rawTokens) {
	const pick = (name, fallback) => rawTokens.fonts?.[name]?.value ?? fallback;
	return {
		body: pick('sans', 'system-ui, sans-serif'),
		heading: pick('heading', 'system-ui, sans-serif'),
		mono: pick('mono', 'ui-monospace, monospace'),
	};
}

/** Code points of a display string, for the "what the bytes are" column. */
export function codePointList(text) {
	return [...text]
		.map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
		.filter((hex) => hex !== 'U+0020')
		.join(' ');
}

/** Verdict cell: what the shipped policy returns for one grammar space. */
function verdictCell(verdict) {
	if (verdict.ok) return `<span class="ok">受理 /${escapeHtml(verdict.slug)}</span>`;
	return `<span class="no">拒否 (${escapeHtml(verdict.reason)})</span>`;
}

/**
 * Build the report HTML from already-computed evidence.
 *
 * `collectEvidence()` produces `evidence` from the shipped modules;
 * this function is pure, so the layout is unit-testable without a
 * browser.
 */
export function buildReportHtml(evidence) {
	const { palette, fonts, rows, collisions, gate } = evidence;

	const tableRows = rows
		.map((row) => {
			const naive = naiveSlugify(row.displayText);
			const conflicted = evidence.naiveCollisions.some((entry) =>
				entry.spellings.includes(row.displayText),
			);
			const foldNote = row.compatibilityChanges.length
				? `<div class="fold">NFKC: ${row.compatibilityChanges
						.map((change) => escapeHtml(change))
						.join(' / ')}</div>`
				: '';
			return `<tr>
			<td class="id"><code>${escapeHtml(row.id)}</code></td>
			<td class="display">${escapeHtml(row.displayText)}</td>
			<td class="form">${escapeHtml(row.displayForm)}${
				row.compatFoldRisk ? ' <span class="warn">NFKC で変化</span>' : ''
			}</td>
			<td class="cp"><code>${escapeHtml(codePointList(row.displayText))}</code></td>
			<td class="candidate"><code>${escapeHtml(row.candidate)}</code></td>
			<td class="verdict">${row.verdicts.map((verdict) => verdictCell(verdict)).join('<br />')}</td>
			<td class="naive"><code>/${escapeHtml(naive === '' ? '-' : naive)}</code>${
				conflicted ? ' <span class="bad">衝突</span>' : ''
			}${foldNote}</td>
			</tr>`;
		})
		.join('\n\t\t\t');

	const collisionRows = collisions
		.map(
			(collision) =>
				`<tr><td><code>${escapeHtml(collision.kind)}</code></td><td><code>${escapeHtml(
					collision.key,
				)}</code></td><td>${escapeHtml(collision.detail)}</td></tr>`,
		)
		.join('\n\t\t\t');

	const gateLines = gate.lines
		.map(
			(line) =>
				`<div class="gate-line${line.startsWith('  ') ? '' : ' gate-head'}">${escapeHtml(
					line,
				)}</div>`,
		)
		.join('\n\t\t\t');

	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Unicode / URL slug 検証レポート (#433)</title>
<style>
	:root {
		${palette}
	}
	* { box-sizing: border-box; }
	body {
		margin: 0;
		padding: 40px 48px 56px;
		background: var(--bg-canvas);
		color: var(--text-default);
		font-family: ${fonts.body};
		font-size: 15px;
		line-height: 1.7;
	}
	h1 {
		font-family: ${fonts.heading};
		font-size: 30px;
		line-height: 1.3;
		margin: 0 0 10px;
	}
	h2 {
		font-family: ${fonts.heading};
		font-size: 19px;
		margin: 38px 0 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border-subtle);
	}
	p.lede { margin: 0 0 16px; color: var(--text-muted); max-width: 112ch; }
	.meta {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 20px;
		margin: 20px 0 0;
		padding: 16px 20px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		font-size: 13.5px;
	}
	.meta dt { color: var(--text-muted); }
	.meta dd { margin: 0; }
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
		background: var(--bg-surface);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		overflow: hidden;
	}
	th, td {
		text-align: left;
		vertical-align: top;
		padding: 8px 10px;
		border-bottom: 1px solid var(--border-subtle);
	}
	th { background: var(--bg-subtle); font-weight: 600; white-space: nowrap; }
	tr:last-child td { border-bottom: none; }
	code { font-family: ${fonts.mono}; font-size: 12px; }
	td.display { white-space: pre-wrap; max-width: 20ch; }
	td.cp code { color: var(--text-muted); word-break: break-all; }
	td.form, td.verdict { white-space: nowrap; }
	td.naive { white-space: nowrap; }
	.ok { color: var(--accent-positive); font-weight: 600; }
	.no { color: var(--accent-negative); font-weight: 600; }
	.warn { color: var(--accent-warning); }
	.fold { color: var(--text-muted); font-size: 11.5px; white-space: normal; max-width: 24ch; }
	.bad {
		color: var(--accent-negative);
		font-weight: 700;
		border: 1px solid var(--accent-negative);
		border-radius: 4px;
		padding: 0 4px;
	}
	.gate {
		background: var(--bg-inverse);
		color: var(--text-inverse);
		border-radius: 10px;
		padding: 18px 20px;
		font-family: ${fonts.mono};
		font-size: 12px;
		line-height: 1.55;
		white-space: pre;
		overflow-x: auto;
	}
	.gate-line.gate-head { color: var(--accent-interactive); }
	.callout {
		border-left: 3px solid var(--accent-interactive);
		background: var(--bg-surface);
		padding: 14px 18px;
		margin: 14px 0 0;
		border-radius: 0 8px 8px 0;
	}
	.callout ul { margin: 0; padding-left: 20px; }
	footer { margin-top: 40px; color: var(--text-muted); font-size: 12.5px; }
</style>
</head>
<body>
<h1>表示本文の Unicode と URL slug の扱い</h1>
<p class="lede">
	表示本文は記述された byte 列をそのまま保持し、slug は既存 owner の ASCII grammar に
	そのまま従う。<strong>slug を本文から導出しない</strong>ことで、
	「正規化の段階で別の語が同じ URL に潰れる」事故を構造的に起こさない。
	この画面は <code>src/i18n/fixtures.ts</code> の判断表を、出荷済みポリシーと
	出荷済み grammar で分類した結果そのもの。
</p>

<dl class="meta">
	<dt>Issue</dt><dd>#433 feat(i18n): Unicode正規化とURL slugの扱いを分離</dd>
	<dt>生成</dt><dd><code>node scripts/capture-i18n-unicode-slug.mjs</code>（外部通信 0 件 / 秘匿情報 0 件）</dd>
	<dt>入力</dt><dd><code>src/i18n/fixtures.ts</code>（${rows.length} 行）</dd>
	<dt>文法</dt><dd><code>EMOJI_SLUG_GRAMMAR</code>（reactions/ 所有） / <code>PORTFOLIO_SLUG_GRAMMAR</code>（portfolio/ 所有）</dd>
	<dt>条件</dt><dd>fixture ${rows.length} / ${EXPECTED_FIXTURE_COUNT} 行を検出しなければ撮影を失敗とする</dd>
</dl>

<h2>1. 表示本文 — 保持する / 変換しないもの</h2>
<p class="lede">
	<code>describeUnicode()</code> は本文を書き換えず、状態だけを報告する。
	<code>NFC</code> と <code>NFD</code> は同じ単語の 2 表記なので、比較キー（NFC fold）では一致する。
	<code>NFKC</code> で文字が変わる行には「NFKC で変化」を出す。
	互換正規化は<em>タイポグラフィ</em>の変換であり、<em>意味</em>の変換ではない：
	<code>㎡ → m2</code> は前者の例、<code>① → 1</code> や <code>µ → μ</code> は後者の例である。
	両者は同じ手順で処理できないので、どちらも適用しない。
</p>

<h2>2. URL slug — 受理 / 拒否の結果</h2>
<p class="lede">
	各行は「著者が URL に入れようとした文字列」を 2 つの URL 空間で判定した結果。
	最右列は<strong>反実仮想</strong>で、一般的な slugify（NFKD + 結合記号の除去）なら
	どの URL になっていたか、および衝突があれば示す。結合記号の除去は
	<code>≠ → =</code> のように主張そのものを反転させるため、この列は「採用しない」ためにある。
</p>
<table>
	<thead>
		<tr>
			<th>fixture</th><th>表示本文</th><th>form</th><th>code points</th>
			<th>slug 候補</th><th>emoji-slug / portfolio-slug</th><th>naive slugify なら</th>
		</tr>
	</thead>
	<tbody>
		${tableRows}
	</tbody>
</table>

<h2>3. カタログ衝突監査</h2>
<p class="lede">
	同じ URL を 2 件が主張する場合（<code>duplicate-url</code>）と、
	NFC / NFD の表記違いが別 slug として登録されている場合（<code>normalization-alias</code>）。
	どちらも「1 語 1 URL」を壊すので、公開前に検出する。
</p>
<table>
	<thead><tr><th>kind</th><th>key</th><th>detail</th></tr></thead>
	<tbody>
		${collisionRows}
	</tbody>
</table>

<h2>4. CI ゲート結果（<code>pnpm run i18n:policy:check</code>）</h2>
<div class="gate">
	${gateLines}
</div>

<h2>5. この画面で証明していないこと</h2>
<div class="callout">
	<ul>
		<li>文章品質: この PR は本文を<strong>評価も修正もしない</strong>。校正は編集者の作業であり、この画面は自動品質保証の証拠ではない。</li>
		<li>タイポグラフィ: webfont は取得しない（システム fallback で描画）。行間・字間の検証は別の visual 検証の担当。</li>
		<li><code>/portfolio/&lt;非ASCII&gt;</code> が 404 になるか 500 になるかは本 PR の対象外（route の 404 契約は別 ticket）。</li>
		<li>ブラウザ撮影は byte 再現ではない。表のデータは決定的だが、画像の bytes は、環境によって変わる。</li>
	</ul>
</div>

<footer>
	semantic token（light）を CSS custom property に解決して描画している。フォント宣言は製品と同じ stack を並べるだけで、取得はしない。
</footer>
</body>
</html>
`;
}

/**
 * The catalog used for the collision audit. Fixed data, so the report
 * shows the same findings on every run.
 */
export const COLLISION_CATALOG = [
	{ id: 'nfc-cafe', slug: 'cafe-a', displayText: 'Caf\u00e9' },
	{ id: 'nfd-cafe', slug: 'cafe-b', displayText: 'Cafe\u0301' },
	{ id: 'dup-a', slug: 'thumbs_up', displayText: 'Thumbs up' },
	{ id: 'dup-b', slug: 'thumbs_up', displayText: 'Thumbs up (alias)' },
];

/** Load every input from the shipped modules. */
export async function collectEvidence() {
	const [unicode, slugIdentity, fixtures, reactions, portfolio, editorial, semantic, gate] =
		await Promise.all([
			import('../src/i18n/unicode.ts'),
			import('../src/i18n/slug-identity.ts'),
			import('../src/i18n/fixtures.ts'),
			import('../src/reactions/slug-regex.ts'),
			import('../src/portfolio/schema.ts'),
			import('../src/editorial/tokens.ts'),
			import('../src/editorial/semantic-tokens.ts'),
			import('./check-i18n-policy.mjs'),
		]);

	const grammars = {
		'emoji-slug': reactions.EMOJI_SLUG_GRAMMAR,
		'portfolio-slug': portfolio.PORTFOLIO_SLUG_GRAMMAR,
	};

	const rows = fixtures.UNICODE_FIXTURES.map((fixture) => {
		const facts = unicode.describeUnicode(fixture.displayText);
		return {
			id: fixture.id,
			subject: fixture.subject,
			displayText: fixture.displayText,
			displayForm: facts.form,
			compatFoldRisk: facts.changesUnderCompatibilityFold,
			compatibilityChanges: facts.compatibilityFoldChanges.map(
				(change) => `${change.from.hex} → ${change.replacement}`,
			),
			candidate: fixture.slugCandidate,
			verdicts: Object.entries(grammars).map(([, definition]) =>
				slugIdentity.classifySlugCandidate(fixture.slugCandidate, definition),
			),
		};
	});

	return {
		palette: buildPalette(editorial.rawTokens, semantic.semanticTokens),
		fonts: buildFontStacks(editorial.rawTokens),
		rows,
		collisions: slugIdentity.findSlugCollisions(COLLISION_CATALOG),
		naiveCollisions: naiveSlugCollisions(rows),
		gate: { lines: (await gate.renderGateSummary()).lines, violations: gate.scanAllViolations() },
	};
}

/** Fail rather than ship an empty or partial artefact. */
export function assertFixtureCount(rows) {
	if (rows.length !== EXPECTED_FIXTURE_COUNT) {
		throw new Error(
			`expected ${EXPECTED_FIXTURE_COUNT} fixture rows, found ${rows.length} — the artefact must show the whole decision table`,
		);
	}
	return rows.length;
}

export function parseArgs(argv) {
	const options = {
		screenshot: DEFAULT_SCREENSHOT,
		png: DEFAULT_PNG,
		jsonOut: DEFAULT_JSON_OUT,
		width: DEFAULT_WIDTH,
		capture: true,
	};
	for (const arg of argv) {
		if (arg === '--no-capture') {
			options.capture = false;
			continue;
		}
		const [flag, value] = arg.split('=');
		if (flag === '--screenshot') options.screenshot = value;
		else if (flag === '--png') options.png = value;
		else if (flag === '--json-out') options.jsonOut = value;
		else if (flag === '--width') options.width = Number.parseInt(value ?? '', 10);
		else throw new Error(`unknown option: ${arg}`);
	}
	if (!Number.isFinite(options.width) || options.width <= 0) {
		throw new Error(`--width must be a positive integer, saw ${options.width}`);
	}
	return options;
}

async function capture(options, html) {
	const pngPath = resolve(REPO_ROOT, options.png);
	mkdirSync(dirname(pngPath), { recursive: true });

	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: options.width, height: 900 } });
		await page.setContent(html, { waitUntil: 'load' });
		await page.screenshot({ path: pngPath, fullPage: true });
	} finally {
		await browser.close();
	}

	const sharp = (await import('sharp')).default;
	const destination = resolve(REPO_ROOT, assertWebpOutputPath(options.screenshot));
	mkdirSync(dirname(destination), { recursive: true });
	await sharp(pngPath)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(destination);
	rmSync(pngPath, { force: true });

	const verdict = screenshotBudgetVerdict(statSync(destination).size);
	if (!verdict.withinBudget) {
		throw new Error(
			`verification artefact is ${verdict.kb} kB, over the ${Math.round(
				SCREENSHOT_BUDGET_BYTES / 1024,
			)} kB budget: ${destination}`,
		);
	}
	return { path: options.screenshot, ...verdict };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	assertWebpOutputPath(options.screenshot);

	const evidence = await collectEvidence();
	assertFixtureCount(evidence.rows);
	const html = buildReportHtml(evidence);

	const jsonOut = resolve(REPO_ROOT, options.jsonOut);
	mkdirSync(dirname(jsonOut), { recursive: true });
	writeFileSync(
		jsonOut,
		`${JSON.stringify(
			{
				fixtureCount: evidence.rows.length,
				rows: evidence.rows,
				collisions: evidence.collisions,
				naiveCollisions: evidence.naiveCollisions,
				gateViolations: evidence.gate.violations,
				gate: evidence.gate.lines,
			},
			null,
			2,
		)}\n`,
	);

	if (!options.capture) {
		process.stdout.write(
			`[capture-i18n-unicode-slug] --no-capture: ${evidence.rows.length} fixture rows, ${evidence.collisions.length} collision finding(s), ${evidence.gate.violations.length} gate violation(s)\n`,
		);
		return 0;
	}

	if (evidence.gate.violations.length > 0) {
		process.stderr.write(
			`[capture-i18n-unicode-slug] refusing to render evidence while the policy gate fails:\n${evidence.gate.violations
				.map((violation) => `- ${violation}`)
				.join('\n')}\n`,
		);
		return 1;
	}

	const result = await capture(options, html);
	process.stdout.write(
		`[capture-i18n-unicode-slug] wrote ${result.path} (${result.kb} kB, budget ${Math.round(
			SCREENSHOT_BUDGET_BYTES / 1024,
		)} kB)\n`,
	);
	return 0;
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
	try {
		process.exitCode = await main();
	} catch (error) {
		process.stderr.write(`[capture-i18n-unicode-slug] ${error.message}\n`);
		process.exitCode = 1;
	}
}
