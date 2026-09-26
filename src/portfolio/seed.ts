import type { PortfolioFacet } from './schema';

/**
 * Skeleton seed for the portfolio foundation (Issue #76).
 *
 * Every entry here is grounded in `docs/personal/domain.md`
 * §8 (Experience) or §9 (What I am doing now). No speculative
 * narrative is added — the loader and the UI surface the rows
 * as published, but the Markdown bodies are intentionally
 * short so the operator (or Issue #78 migration) can flesh
 * them out before they are shown to a third party.
 *
 * Source → entry mapping:
 *
 *   my-web-2026                  → my-web-2026
 *     `domain.md` §9 (representative current work)
 *
 *   Tastile                      → tastile
 *     `domain.md` §9 ("Tastile — scheduling を扱う product")
 *
 *   project-init / design-skills → project-init
 *     `domain.md` §9 ("project-init / design-skills — agent
 *     が実際の project で使える engineering / design
 *     workflow の形式知化")
 *
 *   Aulymo                       → aulymo
 *     `domain.md` §8 ("Aulymo — After Effects で lyric motion
 *     を作るための tool"). 500+ sales cumulative evidence is
 *     date-stamped (`as_of: 2026-01`).
 *
 *   MultiSlicer                  → multi-slicer
 *     `domain.md` §8 ("MultiSlicer — C++ / After Effects SDK
 *     を使った effect plugin"). Thousands of downloads scale
 *     is `as_of: 2026-01`.
 *
 *   ScienceArts internship       → sciencearts-internship-2026
 *     `domain.md` §8 ("2026 年夏には ScienceArts と OPTiM で
 *     software / product development に関する internship を
 *     経験した"). Single combined entry covers both
 *     internships because `domain.md` describes them
 *     together; splitting is a #78 / #79 follow-up.
 */

export interface PortfolioSeedEntry {
	slug: string;
	title: string;
	summary: string;
	role: string;
	periodStart: number;
	periodEnd: number | null;
	periodLabel: string;
	facets: readonly PortfolioFacet[];
	technologies: readonly string[];
	links: ReadonlyArray<{
		kind: 'repo' | 'demo' | 'release' | 'article' | 'shop' | 'video' | 'other';
		url: string;
		label?: string;
	}>;
	media: ReadonlyArray<{ r2Key: string; contentType: string; alt: string; isCover: boolean }>;
	motivationMd: string;
	architectureMd?: string;
	constraintsMd?: string;
	implementationMd?: string;
	evidenceMd?: string;
	retrospectiveMd?: string;
	pinned: boolean;
	displayOrder: number;
}

/** `2026-01-01T00:00:00.000Z` — used as `as_of` for historical metrics. */
const EVIDENCE_AS_OF_2026_01 = Date.UTC(2026, 0, 1);
/** `2026-08-01T00:00:00.000Z` — start of the 2026 summer internship window. */
const INTERN_START_2026_08 = Date.UTC(2026, 7, 1);
/** `2026-09-30T00:00:00.000Z` — end of the 2026 summer internship window (≈ end of August). */
const INTERN_END_2026_09 = Date.UTC(2026, 8, 30);

export const PORTFOLIO_SEED: readonly PortfolioSeedEntry[] = [
	{
		slug: 'my-web-2026',
		title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers',
		summary:
			'Personal Web Platform の再構築。TanStack Start / Hono / Panda CSS / Cloudflare D1+R2 を obligation-oriented architecture で束ねる。',
		role: 'Solo architect / developer',
		periodStart: Date.UTC(2025, 8, 1), // 2025-09
		periodEnd: null,
		periodLabel: '2025-09 - present',
		facets: ['develop'],
		technologies: [
			'TypeScript',
			'Cloudflare Workers',
			'TanStack Start',
			'Hono',
			'Panda CSS',
			'D1',
			'R2',
			'Biome',
		],
		links: [
			{
				kind: 'repo',
				url: 'https://github.com/rebuildup/my-web-2026',
				label: 'Source',
			},
		],
		media: [],
		motivationMd:
			'旧 my-web-2025 が「何でも 1 site に乗せる実験」になっていたため、obligation ごとに境界を引き直し、就活用 Portfolio surface まで含めて 1 Worker / 1 repo で運用できる基盤を再構築する。',
		architectureMd:
			'obligation-oriented (ADR-0008)。`src/home/`, `src/editorial/`, `src/cloudflare/`, `src/http/`, `src/portfolio/` 等の obligation を path として projection。type-only edge (`home → http`) を architecture check で機械検証。',
		constraintsMd:
			'Cloudflare Workers の runtime 制約 (V8 isolate / Workers RPC) と、solo maintainer の運用容量内で release gate を成立させる必要。',
		implementationMd:
			'Vite + TanStack Start 1.168 + Hono 4.13 + Panda CSS 1.12。CI は GitHub Actions の `validate:integration` で format/lint/typecheck/test/build/wrangler dry-run/build-storybook/lint:ci を一括実行。',
		evidenceMd:
			'Foundation release を 2026-09-11 に shipped。続く release で marketing layout / editorial spread / reactions を段階的に追加。',
		pinned: true,
		displayOrder: 0,
	},
	{
		slug: 'aulymo',
		title: 'Aulymo — After Effects lyric motion tool',
		summary:
			'After Effects で lyric motion を作るための tool。実装だけでなく productization / support / update まで経験。',
		role: 'Solo developer / distributor',
		periodStart: Date.UTC(2022, 0, 1),
		periodEnd: null,
		periodLabel: '2022 - present',
		facets: ['develop', 'design'],
		technologies: ['After Effects', 'ExtendScript', 'TypeScript', 'BOOTH'],
		links: [
			{
				kind: 'shop',
				url: 'https://361do.booth.pm',
				label: 'BOOTH',
			},
		],
		media: [],
		motivationMd:
			'映像制作の中で lyric motion の組み立てを手作業で繰り返すのがもったいなかったため、テンプレート生成 + 一括適用 + 微調整 UI を持つ tool として設計。',
		evidenceMd: `累計販売 500 本以上 (as_of: ${new Date(EVIDENCE_AS_OF_2026_01).toISOString().slice(0, 7)})。download 数や現在販売状況は時間で変わるため、site 上で live に出す場合は別途 source を確認する必要がある。`,
		pinned: false,
		displayOrder: 10,
	},
	{
		slug: 'multi-slicer',
		title: 'MultiSlicer — After Effects effect plugin (C++)',
		summary: 'C++ / After Effects SDK で書いた effect plugin。native plugin development を実践。',
		role: 'Solo developer',
		periodStart: Date.UTC(2023, 0, 1),
		periodEnd: null,
		periodLabel: '2023 - present',
		facets: ['develop'],
		technologies: ['C++', 'After Effects SDK', 'Premiere Pro SDK'],
		links: [],
		media: [],
		motivationMd:
			'After Effects の標準 effect では対応できない multi-band スライス処理を、GPU 寄りの C++ plugin として実装。',
		evidenceMd: `数千 download 規模まで利用された (as_of: ${new Date(EVIDENCE_AS_OF_2026_01).toISOString().slice(0, 7)})。`,
		pinned: false,
		displayOrder: 20,
	},
	{
		slug: 'tastile',
		title: 'Tastile — scheduling product (multi-client)',
		summary:
			'scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
		role: 'Solo developer',
		periodStart: Date.UTC(2024, 5, 1), // 2024-06
		periodEnd: null,
		periodLabel: '2024-06 - present',
		facets: ['develop'],
		technologies: ['TypeScript', 'React', 'Kotlin', 'Rust', 'Tauri'],
		links: [],
		media: [],
		motivationMd:
			'個人 / 少人数チーム向けの scheduling 課題に対し、client の形が違う複数ユーザーを同一 backend で扱える product として設計。',
		constraintsMd:
			'multi-client 開発では API contract と sync 戦略を client ごとに決める必要があり、solo 開発で運用可能な範囲に収めるのが難しい。',
		pinned: false,
		displayOrder: 30,
	},
	{
		slug: 'project-init',
		title: 'project-init / design-skills — agent engineering / design workflow knowledge',
		summary:
			'agent が実際の project で使える engineering / design workflow を形式知化した Skills 集。',
		role: 'Author / maintainer',
		periodStart: Date.UTC(2025, 5, 1), // 2025-06
		periodEnd: null,
		periodLabel: '2025-06 - present',
		facets: ['develop'],
		technologies: ['Markdown', 'Claude Code', 'Cursor', 'Codex'],
		links: [
			{
				kind: 'repo',
				url: 'https://github.com/rebuildup/project-init',
				label: 'project-init',
			},
			{
				kind: 'repo',
				url: 'https://github.com/rebuildup/design-skills',
				label: 'design-skills',
			},
		],
		media: [],
		motivationMd:
			'agent に workflow を渡すたびに同じ説明を繰り返す状況を減らすため、engineering / design の意思決定と ADR を Skill 形式で公開。',
		retrospectiveMd:
			'my-web-2026 側にも design / engineering / release / recovery / policy / quality / runtime の各 Skills を import 済み (`skills/<skill>/SKILL.md`)。',
		pinned: false,
		displayOrder: 40,
	},
	{
		slug: 'sciencearts-optim-internship-2026',
		title: '2026 Summer internship — ScienceArts / OPTiM',
		summary:
			'2026 年夏に ScienceArts と OPTiM で software / product development に関する internship を経験。',
		role: 'Intern',
		periodStart: INTERN_START_2026_08,
		periodEnd: INTERN_END_2026_09,
		periodLabel: '2026 夏 (Summer 2026)',
		facets: ['develop'],
		technologies: ['Team development', 'Code review', 'Spec-driven development'],
		links: [],
		media: [],
		motivationMd: '学校外の開発環境で、team で読める code / 仕様 / review / 運用 を経験する。',
		retrospectiveMd:
			'個人開発で得た速度や幅だけでなく、team で成立させることへの関心が強くなった。`domain.md` §10 Future direction への反映を予定。',
		pinned: false,
		displayOrder: 50,
	},
];
