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
// they build on, and the infra + dev-tool substrate. Lane membership
// is the reviewed categorisation — the marquee compresses HEIGHT,
// never coverage: dropping an icon to save space is exactly the
// unfounded reduction ADR-0026 forbids.
const ICON_GROUPS = [
	{
		// pure creative tools — styling languages moved to the web
		// lane so this category stays honest at 9 icons (the narrow
		// col-5 viewport is sized so its period still fills the frame)
		label: 'Design & motion',
		ids: [
			'figma',
			'blender',
			'photoshop',
			'illustrator',
			'aftereffects',
			'premiere',
			'xd',
			'p5js',
			'unity',
		],
	},
	{
		label: 'Languages',
		// order mirrors the owner's actual code share (Band 1 stats):
		// TS dominant, then the C-family, then the rest
		ids: [
			'typescript',
			'javascript',
			'python',
			'rust',
			'golang',
			'csharp',
			'cpp',
			'c',
			'swift',
			'bash',
			'powershell',
			'markdown',
		],
	},
	{
		// frameworks + runtimes + the styling layer of the web —
		// vercel/supabase are app platforms, cloudflare is edge infra
		// and lives in the substrate lane
		label: 'Web & app',
		ids: [
			'react',
			'nextjs',
			'vite',
			'nodejs',
			'tailwind',
			'bun',
			'dotnet',
			'vercel',
			'supabase',
			'sass',
			'html',
			'css',
		],
	},
	{
		// substrate lane: hosting, VCS, package managers, IDEs, OS —
		// infra + dev tooling
		label: 'Infra & dev tools',
		ids: [
			'gcp',
			'github',
			'git',
			'cloudflare',
			'pnpm',
			'npm',
			'vscode',
			'androidstudio',
			'visualstudio',
			'gradle',
			'sqlite',
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
