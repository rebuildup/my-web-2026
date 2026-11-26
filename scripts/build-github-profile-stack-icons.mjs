#!/usr/bin/env node
/**
 * Generates `src/http/github-profile/stack-icons.ts` — the inline glyph
 * data for the `/api/v1/github-profile/stack` marquee band.
 *
 * Source assets: `public/github-profile/skills/*.svg` (tandpfun/
 * skill-icons, MIT — same set the README Stack section embeds).
 * Each source is a 256×256 rounded chip; we keep the FULL inner
 * markup (chip + glyph + defs) so the band renders the icons exactly
 * as the standalone files do. `-dark` / `-light` file pairs map to
 * the band's `?theme=` variants; single files serve both themes.
 *
 * SVG `id`/`url(#…)`/`href="#…"` references are prefixed per icon so
 * gradient defs can never collide inside the composed document.
 *
 * Run: `node scripts/build-github-profile-stack-icons.mjs`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKILLS = join(ROOT, 'public/github-profile/skills');
const OUT = join(ROOT, 'src/http/github-profile/stack-icons.ts');

// All 48 committed skill icons (ADR-0026 §2.4 baseline — the old
// my-web-2025 48-tech tree) grouped by activity area, ordered by
// what defines the owner: Design & motion leads (the distinctive
// craft), then the languages they write, the web/app frameworks
// they build on, and the infra + dev-tool substrate.
// Two lanes, not four (Issue #1235 round 2): the README constraint is
// HEIGHT — 48 legible icons cannot sit still in one row, and four
// lanes spent ~284px desktop / ~368px mobile re-stating what two
// honest categories already say. The merge keeps every icon and
// every group's integrity: lane A is what appears on screen (design
// tools + web/app frameworks), lane B is what it runs on (languages
// + infra/dev tools). Order inside each lane mirrors the original
// group order.
const ICON_GROUPS = [
	{
		label: 'Design & web',
		// design tools and web frameworks INTERLEAVED — a marquee
		// window only ever shows ~9 icons, so a blocked order would
		// hide half the lane's stated domain at any moment
		ids: [
			'figma',
			'react',
			'blender',
			'nextjs',
			'photoshop',
			'vite',
			'illustrator',
			'nodejs',
			'aftereffects',
			'tailwind',
			'premiere',
			'bun',
			'xd',
			'dotnet',
			'p5js',
			'vercel',
			'unity',
			'supabase',
			'sass',
			'html',
			'css',
		],
	},
	{
		label: 'Languages & infra',
		// languages and infra/dev tools interleaved for the same
		// reason; within each half the order still mirrors the
		// owner's actual code share (TS dominant, then the C-family)
		ids: [
			'typescript',
			'gcp',
			'javascript',
			'github',
			'python',
			'git',
			'rust',
			'cloudflare',
			'golang',
			'pnpm',
			'csharp',
			'npm',
			'cpp',
			'vscode',
			'c',
			'androidstudio',
			'swift',
			'visualstudio',
			'bash',
			'gradle',
			'powershell',
			'sqlite',
			'markdown',
			'notion',
			'linux',
			'ubuntu',
			'debian',
		],
	},
];
const ICON_IDS = ICON_GROUPS.flatMap((g) => g.ids);

function pick(id, suffix) {
	for (const name of [`${id}-${suffix}.svg`, `${id}.svg`]) {
		try {
			return readFileSync(join(SKILLS, name), 'utf8');
		} catch {
			/* try next candidate */
		}
	}
	return null;
}

function innerOf(svg, iconIndex) {
	const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
	if (!m) throw new Error('no inner svg');
	let inner = m[1];
	const prefix = `i${iconIndex}_`;
	inner = inner.replace(/\sid="([^"]+)"/g, (_all, id) => ` id="${prefix}${id}"`);
	inner = inner.replace(/url\(#([^)]+)\)/g, (_all, id) => `url(#${prefix}${id})`);
	inner = inner.replace(
		/(xlink:href|href)="#([^"]+)"/g,
		(_all, attr, id) => `${attr}="#${prefix}${id}"`,
	);
	return inner.trim();
}

const entries = [];
for (const [index, id] of ICON_IDS.entries()) {
	const darkSvg = pick(id, 'dark');
	const lightSvg = pick(id, 'light');
	if (!darkSvg || !lightSvg) throw new Error(`missing icon asset: ${id}`);
	entries.push({
		id,
		dark: innerOf(darkSvg, index),
		light: innerOf(lightSvg, index),
	});
}

const body = entries
	.map((e) => `\t{ id: '${e.id}', dark: \`${e.dark}\`, light: \`${e.light}\` },`)
	.join('\n');

writeFileSync(
	OUT,
	`/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate: \`node scripts/build-github-profile-stack-icons.mjs\`
 *
 * Inline inner markup of \`public/github-profile/skills/*.svg\`
 * (tandpfun/skill-icons, MIT), one entry per technology in README
 * Stack order. \`dark\`/\`light\` carry the chip+glyph for each band
 * theme; ids are prefixed per icon to keep gradient defs unique.
 */
export interface StackIcon {
	readonly id: string;
	readonly dark: string;
	readonly light: string;
}

export const STACK_ICONS: readonly StackIcon[] = [
${body}
];

export interface StackIconGroup {
	readonly label: string;
	readonly iconIds: readonly string[];
}

export const STACK_GROUPS: readonly StackIconGroup[] = [
${ICON_GROUPS.map((g) => `	{ label: '${g.label}', iconIds: [${g.ids.map((i) => `'${i}'`).join(', ')}] },`).join('\n')}
];
`,
);
console.log(`wrote ${OUT} (${entries.length} icons)`);

// Keep the generated file biome-clean so `format:check` stays green
// after a regeneration without a manual format pass.
const { execFileSync } = await import('node:child_process');
try {
	execFileSync('pnpm', ['exec', 'biome', 'format', '--write', OUT], {
		cwd: ROOT,
		stdio: 'inherit',
	});
} catch {
	console.warn(
		'biome format skipped — run `pnpm exec biome format --write src/http/github-profile/stack-icons.ts`',
	);
}
