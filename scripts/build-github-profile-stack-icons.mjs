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

// Curated core set grouped by activity area, ordered by what defines
// the owner: Design & motion leads (the distinctive craft), then the
// languages they write, the frameworks/runtimes they build on, infra,
// and dev tools. Filler icons (markdown, html, css, OS tiles,
// duplicate package managers, sunset Adobe Xd) are deliberately
// excluded — the lane answers "what do you actually work with", not
// "every tool you have ever opened".
const ICON_GROUPS = [
	{
		label: 'Design & motion',
		ids: ['figma', 'blender', 'photoshop', 'illustrator', 'aftereffects', 'premiere', 'unity'],
	},
	{
		label: 'Languages',
		// order mirrors the owner's actual code share (Band 1 stats):
		// TS dominant, then the C-family, then the rest
		ids: ['typescript', 'csharp', 'cpp', 'javascript', 'python', 'rust', 'golang'],
	},
	{
		label: 'Frameworks & runtimes',
		ids: ['react', 'nextjs', 'vite', 'nodejs', 'tailwind', 'bun', 'dotnet'],
	},
	{
		// substrate lane: infra + dev tooling share one quieter tier —
		// four lanes total so the desktop grid is a balanced 2×2
		label: 'Infra & dev tools',
		ids: [
			'cloudflare',
			'gcp',
			'vercel',
			'supabase',
			'github',
			'git',
			'pnpm',
			'vscode',
			'androidstudio',
			'powershell',
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
