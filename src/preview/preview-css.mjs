/**
 * Issue #764 — comparison-preview CSS (WORKTREE ONLY, never committed).
 *
 * The owner asked to choose a direction by LOOKING at it, so this module
 * re-skins the real routes instead of drawing mocks. It writes one `<style>`
 * element (rendered last inside `<head>`, so it wins over Panda's `:root`
 * and its `@media (prefers-color-scheme: dark)` block on source order) and
 * declares every colour as a CSS custom property, which is the same seam the
 * real token layer would move.
 *
 * What it does NOT do: it does not touch `src/editorial/**`, it does not
 * change copy, and it is never imported outside the preview.
 */
import { PALETTES } from './preview-palettes.mjs';

const VAR_MAP = [
	['canvas', '--colors-bg-canvas'],
	['surface', '--colors-bg-surface'],
	['subtle', '--colors-bg-subtle'],
	['inverse', '--colors-bg-inverse'],
	['accentFill', '--colors-bg-accent'],
	['accentInteractive', '--colors-accent-interactive'],
	['accentSurface', '--colors-accent-surface'],
	['control', '--colors-bg-control'],
	['controlHover', '--colors-bg-control-hover'],
	['text', '--colors-text-default'],
	['muted', '--colors-text-muted'],
	['textInverse', '--colors-text-inverse'],
	['link', '--colors-text-accent'],
	['ok', '--colors-accent-positive'],
	['danger', '--colors-accent-negative'],
	['warn', '--colors-accent-warning'],
	['catDesign', '--colors-accent-category-design'],
	['catCode', '--colors-accent-category-code'],
	['catWriting', '--colors-accent-category-writing'],
	['catTool', '--colors-accent-category-tool'],
	['borderFocus', '--colors-border-focus'],
	['borderRule', '--colors-border-strong'],
	['borderSubtle', '--colors-border-subtle'],
	['onAccent', '--colors-on-accent'],
	['planeMuted', '--colors-text-on-inverse-muted'],
	['planeOk', '--colors-accent-positive-on-inverse'],
	['planeWarn', '--colors-accent-warning-on-inverse'],
	['planeDanger', '--colors-accent-negative-on-inverse'],
];

function vars(p) {
	return VAR_MAP.map(([k, name]) => `${name}: ${p[k]};`).join('\n\t');
}

/**
 * Shared by all three directions: the owner's confirmed decisions
 * (2026-11-01) — full-width consent band, no decorative border, no left
 * colour bar, one 12-column grid. Only the palette and the structural
 * temper (below) differ between A / B / C.
 */
const SHARED = `
	/* ── icons: self-hosted, no third-party request (delivery decision) ──
	   Ligature font: the markup carries the word (arrow_forward), the font
	   draws the glyph. \`font-display: block\` hides the word during load
	   instead of flashing it; the box is a fixed 1em so nothing shifts. */
	@font-face {
		font-family: 'Material Symbols Rounded';
		font-style: normal;
		font-weight: 400;
		font-display: block;
		src: url('/preview-assets/material-symbols-rounded.woff2') format('woff2');
	}
	.msr {
		font-family: 'Material Symbols Rounded' !important;
		font-weight: normal;
		font-style: normal;
		font-size: 1em;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1em;
		height: 1em;
		overflow: hidden;
		vertical-align: -0.14em;
		letter-spacing: normal;
		text-transform: none;
		font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
	}

	/* ── surfaces are separated by FILL, never by a 1px border ────────── */
	*[class*="bd-w_1px"] { border-width: 0 !important; }
	*[class*="bd_1px_solid"] { border-width: 0 !important; }
	/* a control that sat on the page colour now sits one step above it */
	button[class*="bg-c_bg.canvas"],
	a[class*="bg-c_bg.canvas"],
	button[class*="bg-c_bg.surface"],
	a[class*="bg-c_bg.surface"] {
		background: var(--colors-bg-control) !important;
	}
	button[class*="bg-c_bg.canvas"]:hover,
	a[class*="bg-c_bg.canvas"]:hover,
	button[class*="bg-c_bg.surface"]:hover,
	a[class*="bg-c_bg.surface"]:hover {
		background: var(--colors-bg-control-hover) !important;
	}
	/* a card that was closed by a border is now closed by its own plane */
	article[class*="bd-w_1px"],
	li[class*="bd-w_1px_solid"],
	figure[class*="bd_1px_solid"] {
		background: var(--colors-bg-surface) !important;
	}
	/* the CTA label is its own role: \`text.inverse\` was doing both jobs */
	[class*="bg-c_bg.accent"],
	[class*="bg-c_accent.interactive"],
	[class*="hover\\:bg-c_accent.interactive"]:hover,
	[class*="active\\:bg-c_accent.interactive"]:active {
		color: var(--colors-on-accent) !important;
	}
	/* ── no left colour bar (owner: confirmed, all directions) ────────── */
	*[class*="bd-s-w_4px"] { border-inline-start-width: 0 !important; }

	/* ── one grid: 12 x 58 + 24 gutter, content 960 ───────────────────── */
	@media (min-width: 1024px) {
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_8fr)"]:has(> :last-child:nth-child(2)),
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_4fr)_minmax(0,_4fr)"]:has(> :last-child:nth-child(3)) {
			grid-template-columns: repeat(12, minmax(0, 1fr)) !important;
			column-gap: 24px !important;
		}
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_8fr)"]:has(> :last-child:nth-child(2)) > :nth-child(1) { grid-column: 1 / span 4; }
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_8fr)"]:has(> :last-child:nth-child(2)) > :nth-child(2) { grid-column: 5 / span 8; }
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_4fr)_minmax(0,_4fr)"]:has(> :last-child:nth-child(3)) > :nth-child(1) { grid-column: 1 / span 4; }
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_4fr)_minmax(0,_4fr)"]:has(> :last-child:nth-child(3)) > :nth-child(2) { grid-column: 5 / span 4; }
		[class*="grid-tc_minmax(0,_4fr)_minmax(0,_4fr)_minmax(0,_4fr)"]:has(> :last-child:nth-child(3)) > :nth-child(3) { grid-column: 9 / span 4; }
		article[class*="grid-tc_minmax(0,_4fr)_minmax(0,_8fr)"] {
			grid-template-columns: repeat(12, minmax(0, 1fr)) !important;
			column-gap: 24px !important;
		}
		article[class*="grid-tc_minmax(0,_4fr)_minmax(0,_8fr)"] > :nth-child(2) { grid-column: 1 / span 4; }
		article[class*="grid-tc_minmax(0,_4fr)_minmax(0,_8fr)"] > :nth-child(3) { grid-column: 5 / span 8; }
	}

	/* ── consent band: full width, on the same grid ────────────────────
	   Behaviour (persistent / sticky / collapsible) is NOT decided here;
	   the comparison shows the persistent band. Look spec:
	   fill = bg.subtle, no border, no radius, no shadow, one top rule. */
	section[class*="pos_fixed"] {
		position: static !important;
		inset: auto !important;
		z-index: auto !important;
		width: 100% !important;
		max-width: none !important;
		margin: 0 !important;
		padding: 20px max(32px, calc((100vw - 960px) / 2)) !important;
		border: 0 !important;
		border-radius: 0 !important;
		box-shadow: none !important;
		background: var(--colors-bg-subtle) !important;
		color: var(--colors-text-default) !important;
		display: grid !important;
		grid-template-columns: repeat(12, minmax(0, 1fr)) !important;
		column-gap: 24px !important;
		row-gap: 4px !important;
		align-items: start !important;
	}
	section[class*="pos_fixed"] > p:nth-of-type(1) { grid-column: 1 / span 3; grid-row: 1; margin: 0; }
	section[class*="pos_fixed"] > h2 { grid-column: 1 / span 3; grid-row: 2; margin: 0; }
	section[class*="pos_fixed"] > p:nth-of-type(2) { grid-column: 4 / span 6; grid-row: 1 / span 3; margin: 0; }
	section[class*="pos_fixed"] > p:nth-of-type(3) { display: none; }
	section[class*="pos_fixed"] > div { grid-column: 10 / span 3; grid-row: 1 / span 3; margin: 0; }
	@media (max-width: 1023px) {
		section[class*="pos_fixed"] { grid-template-columns: 1fr !important; padding: 16px !important; }
		section[class*="pos_fixed"] > * { grid-column: 1 !important; grid-row: auto !important; }
	}
`;

const STRUCTURE = {
	A: `
		/* A — display-led: big label, hard rule under the kicker */
		:root { --font-sizes-lg: 1.5rem; --font-sizes-xl: 1.625rem; --font-sizes-2xl: 2.5rem; }
		h1, h2, h3 { line-height: 1.12; letter-spacing: 0.005em; }
		h1[class*="fs_3xl"] { letter-spacing: -0.02em; }
		section [class*="ff_sans"][class*="fs_sm"][class*="fw_600"],
		section [class*="ff_mono"][class*="fs_sm"][class*="c_text.muted"] {
			font-size: 11px !important; letter-spacing: 0.2em !important;
			text-transform: uppercase; color: var(--colors-text-accent) !important;
		}
		header > h2::before {
			content: ''; display: block; width: 56px; height: 4px;
			margin-bottom: 18px; background: var(--colors-bg-accent);
		}
		header > h2[class*="fs_2xl"] { font-size: 2.5rem !important; }
		#app-root > section:first-of-type {
			background: var(--colors-bg-surface);
		}
		nav[class*="bd-be-w_1px"] {
			background: var(--colors-bg-canvas);
			border-bottom: 1px solid var(--colors-border-strong) !important;
			position: sticky; top: 0; z-index: 30;
		}
		section[class*="pos_fixed"] { border-top: 4px solid var(--colors-bg-accent) !important; }
	`,
	B: `
		/* B — mono + signal: squared off, one signal colour, hard rules */
		:root { --font-sizes-lg: 1.375rem; --font-sizes-xl: 1.625rem; --font-sizes-2xl: 2.25rem; }
		*[class*="bdr"] { border-radius: 0 !important; }
		h1, h2, h3 { line-height: 1.1; letter-spacing: 0.008em; }
		section [class*="ff_sans"][class*="fs_sm"][class*="fw_600"],
		section [class*="ff_mono"][class*="fs_sm"][class*="c_text.muted"] {
			font-family: var(--fonts-mono), ui-monospace, monospace !important;
			font-size: 11px !important; letter-spacing: 0.24em !important;
			text-transform: uppercase; color: var(--colors-text-accent) !important;
		}
		header > h2[class*="fs_2xl"], header > h1 {
			padding-bottom: 14px; border-bottom: 2px solid var(--colors-border-strong);
		}
		nav[class*="bd-be-w_1px"] {
			background: var(--colors-bg-canvas);
			border-bottom: 2px solid var(--colors-bg-accent) !important;
			position: sticky; top: 0; z-index: 30;
		}
		section[class*="pos_fixed"] { border-bottom: 2px solid var(--colors-bg-accent) !important; }
	`,
	C: `
		/* C — the current language, sharpened: same skeleton, stronger scale */
		:root { --font-sizes-lg: 1.25rem; --font-sizes-xl: 1.5rem; --font-sizes-2xl: 2.5rem; }
		h1, h2, h3 { line-height: 1.14; letter-spacing: -0.01em; }
		header > h2[class*="fs_2xl"] { font-size: 2.5rem !important; font-weight: 700 !important; }
		section [class*="ff_sans"][class*="fs_sm"][class*="fw_600"] {
			letter-spacing: 0.12em !important; font-weight: 700 !important;
			color: var(--colors-text-accent) !important;
		}
		nav[class*="bd-be-w_1px"] {
			background: var(--colors-bg-canvas);
			border-bottom: 1px solid var(--colors-border-strong) !important;
			position: sticky; top: 0; z-index: 30;
		}
	`,
};

export function parsePreview(search) {
	const params = new URLSearchParams(search ?? '');
	const rawDir = (params.get('direction') ?? '').toLowerCase();
	const direction =
		rawDir === 'b' ? 'b' : rawDir === 'c' ? 'c' : rawDir === 'a' ? 'a' : 'a';
	const theme = (params.get('theme') ?? '').toLowerCase() === 'light' ? 'light' : 'dark';
	// `?direction=` present at all turns the preview on; without it the page
	// renders exactly as released, so the owner can compare against reality.
	return { direction, theme, on: params.has('direction') || params.has('theme') };
}

export function buildPreviewCss(direction, theme) {
	const palette = PALETTES[direction][theme];
	return `
:root {
	color-scheme: ${theme};
	${vars(palette)}
}
${SHARED}
${STRUCTURE[direction]}
`;
}
