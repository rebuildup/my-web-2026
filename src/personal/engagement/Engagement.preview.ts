/**
 * Engagement — the data behind the Issue #517 experience experiment.
 *
 * What this module is
 * -------------------
 * The CONTENT of the "見てて楽しい" (fun to look at / fun to make)
 * spike: ONE real information set — the public portfolio works —
 * presented TWO ways so the two meanings of the Miro phrase can be
 * compared on the same facts:
 *
 *   - `static`     — a readable document: every work's facts are on
 *                    the page at once, in reading order, with no
 *                    JavaScript state.
 *   - `interactive`— an operable deck: one work at a time behind
 *                    prev/next controls and arrow keys, with a
 *                    progress indicator and a step transition.
 *
 * It is a plain data module — no React, no CSS, no imports — for the
 * same reasons `Manifesto.preview.ts`, `FlatVsDepth.preview.ts` and
 * `HandleMap.preview.ts` are:
 *
 *   1. `scripts/check-engagement-preview-parity.test.mjs` imports it
 *      directly and asserts the verification document carries the
 *      same works, sources, links and notes. One source, two surfaces.
 *   2. The Storybook stories render exactly what the document argues,
 *      so a reviewer reads the experiment without leaving the preview.
 *   3. A data module has no rendering opinion, so it cannot drift
 *      into "the preview shows something the document does not say".
 *
 * What counts as a source
 * -----------------------
 * Every `title`, `periodLabel`, `role`, `technologies` entry and
 * `fact` below was read from a committed record in THIS repository:
 * `src/portfolio/seed.ts` (the published portfolio seed, itself
 * grounded in `docs/personal/domain.md` §8/§9). Nothing here is a
 * memory, an estimate, or an unreleased claim. The Miro board itself
 * is NOT reachable: only the heading words the Issue quotes are cited
 * (`miroAxis`), and everything the owner alone can decide is marked
 * 未確認 rather than asserted.
 *
 * Scope
 * -----
 * This is a PREVIEW experiment. It does not decide adoption, it is
 * not wired to any route, and it does not apply either presentation
 * to any page — Issue #517's own boundary. The screen exists so the
 * owner can compare "readable at a glance" against "operable and
 * moving" BEFORE choosing where either belongs.
 */

/** One committed record the preview's claims were read from. */
export interface EngagementSource {
	/** Stable id, referenced by work entries. */
	id: string;
	/** Short label for the record. */
	label: string;
	/** Repo-relative path of the committed record. */
	path: string;
	/** What the record is the authority for, in one line. */
	note: string;
}

/** One published URL the variants may link to — nothing else. */
export interface EngagementLink {
	label: string;
	url: string;
}

/**
 * One portfolio work, restated as the SAME fact set both variants
 * render. Field-for-field this is the subset of `PortfolioSeedEntry`
 * a reader can check against `src/portfolio/seed.ts`; the seed stays
 * the authority and this module only re-presents it.
 */
export interface EngagementWork {
	/** The portfolio slug — stable id. */
	id: string;
	/** The work's published title. */
	title: string;
	/** The published period label, verbatim. */
	periodLabel: string;
	/** The published role, verbatim. */
	role: string;
	/** The published technology list, verbatim and in order. */
	technologies: readonly string[];
	/** One line: what the work is (the seed's summary, restated). */
	fact: string;
	/** The published links this work carries in the seed. */
	links: readonly EngagementLink[];
	/** The source records the fact set was read from. */
	sourceIds: readonly string[];
}

/** One of the two presentations the Issue asks to compare. */
export interface EngagementVariant {
	/** Stable id — also the `data-engagement-variant` marker value. */
	id: 'static' | 'interactive';
	/** Display name. */
	label: string;
	/** What this presentation IS, in one line. */
	description: string;
	/** The structural facts the comparison can check on the DOM. */
	facts: readonly string[];
}

/** One axis of the Issue's required comparison. */
export interface EngagementCriterion {
	/** Stable id. */
	id: string;
	/** The comparison axis, in Japanese (the Issue's own words). */
	label: string;
	/** What the axis asks, in one line. */
	question: string;
}

/** The document-level facts both variants print. */
export interface EngagementDocument {
	/** The h1 of both variants. */
	title: string;
	/** The kicker / eyebrow line. */
	kicker: string;
	/** Publication state — this is a preview, not a published page. */
	status: string;
	/** Where the material was read from (Issue + Miro citation). */
	source: string;
	/** How the preview is machine-checked. */
	verification: string;
	/** The preview's own location. */
	preview: string;
	/** The verification document path. */
	document: string;
}

export const ENGAGEMENT_DOCUMENT: EngagementDocument = {
	title: '見てて楽しい — 静的と操作の 2 つの体験',
	kicker: 'engagement preview — Issue #517',
	status: 'preview / 未公開 — route 未接続の単独検証',
	source: 'Issue #517 が引用する Miro 見出し語 + 本リポジトリの確定記録',
	verification: 'scripts/check-engagement-preview-parity.test.mjs + scripts/capture-engagement.mjs',
	preview: 'src/personal/engagement/Engagement.stories.tsx',
	document: 'docs/verification/experience/engagement.md',
};

/**
 * The committed records every claim was read from.
 *
 * The parity test re-reads each `path` and fails when a cited record
 * does not exist — the same mechanism
 * `check-manifesto-preview-parity.test.mjs` uses.
 */
export const ENGAGEMENT_SOURCES: readonly EngagementSource[] = [
	{
		id: 'portfolio-seed',
		label: 'src/portfolio/seed.ts',
		path: 'src/portfolio/seed.ts',
		note: '公開 portfolio の seed。6 作品の title / periodLabel / role / technologies / links / summary の権威。',
	},
	{
		id: 'personal-domain',
		label: 'docs/personal/domain.md §8–§9',
		path: 'docs/personal/domain.md',
		note: 'seed の根拠となる canonical な個人ドメイン記録（Experience / What I am doing now）。',
	},
];

/**
 * The ONE information set both variants present: the six published
 * portfolio works, restated field-for-field from the seed.
 *
 * Order follows the seed's `displayOrder` — the same order the
 * public portfolio index publishes — so "the same information" is
 * also "the same order". No work is added, dropped or embellished:
 * a fact that is not in the seed is not on this screen.
 */
export const ENGAGEMENT_WORKS: readonly EngagementWork[] = [
	{
		id: 'my-web-2026',
		title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers',
		periodLabel: '2025-09 - present',
		role: 'Solo architect / developer',
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
		fact: 'Personal Web Platform の再構築。TanStack Start / Hono / Panda CSS / Cloudflare D1+R2 を obligation-oriented architecture で束ねる。',
		links: [
			{
				label: 'Source',
				url: 'https://github.com/rebuildup/my-web-2026',
			},
		],
		sourceIds: ['portfolio-seed', 'personal-domain'],
	},
	{
		id: 'aulymo',
		title: 'Aulymo — After Effects lyric motion tool',
		periodLabel: '2022 - present',
		role: 'Solo developer / distributor',
		technologies: ['After Effects', 'ExtendScript', 'TypeScript', 'BOOTH'],
		fact: 'After Effects で lyric motion を作るための tool。実装だけでなく productization / support / update まで経験。',
		links: [
			{
				label: 'BOOTH',
				url: 'https://361do.booth.pm',
			},
		],
		sourceIds: ['portfolio-seed', 'personal-domain'],
	},
	{
		id: 'multi-slicer',
		title: 'MultiSlicer — After Effects effect plugin (C++)',
		periodLabel: '2023 - present',
		role: 'Solo developer',
		technologies: ['C++', 'After Effects SDK', 'Premiere Pro SDK'],
		fact: 'C++ / After Effects SDK で書いた effect plugin。native plugin development を実践。',
		links: [],
		sourceIds: ['portfolio-seed', 'personal-domain'],
	},
	{
		id: 'tastile',
		title: 'Tastile — scheduling product (multi-client)',
		periodLabel: '2024-06 - present',
		role: 'Solo developer',
		technologies: ['TypeScript', 'React', 'Kotlin', 'Rust', 'Tauri'],
		fact: 'scheduling を扱う product。Web / Android / desktop / backend を含む multi-client development。',
		links: [],
		sourceIds: ['portfolio-seed', 'personal-domain'],
	},
	{
		id: 'project-init',
		title: 'project-init / design-skills — agent engineering / design workflow knowledge',
		periodLabel: '2025-06 - present',
		role: 'Author / maintainer',
		technologies: ['Markdown', 'Claude Code', 'Cursor', 'Codex'],
		fact: 'agent が実際の project で使える engineering / design workflow を形式知化した Skills 集。',
		links: [
			{
				label: 'project-init',
				url: 'https://github.com/rebuildup/project-init',
			},
			{
				label: 'design-skills',
				url: 'https://github.com/rebuildup/design-skills',
			},
		],
		sourceIds: ['portfolio-seed', 'personal-domain'],
	},
	{
		id: 'sciencearts-optim-internship-2026',
		title: '2026 Summer internship — ScienceArts / OPTiM',
		periodLabel: '2026 夏 (Summer 2026)',
		role: 'Intern',
		technologies: ['Team development', 'Code review', 'Spec-driven development'],
		fact: '2026 年夏に ScienceArts と OPTiM で software / product development に関する internship を経験。',
		links: [],
		sourceIds: ['portfolio-seed', 'personal-domain'],
	},
];

/**
 * The two presentations, declared as data so the comparison the doc
 * argues is also checkable on the DOM: `facts` are the structural
 * properties a reviewer can verify without trusting prose.
 */
export const ENGAGEMENT_VARIANTS: readonly EngagementVariant[] = [
	{
		id: 'static',
		label: '静的 — 読む体験',
		description: '6 作品の全事実を 1 枚の文書として並べる。状態を持たず、操作も動きも無い。',
		facts: [
			'全 6 作品の事実が初期表示に全て存在する',
			'JavaScript の状態・イベントハンドラを持たない',
			'アニメーションを 1 つも emit しない',
		],
	},
	{
		id: 'interactive',
		label: '操作 — 遊ぶ体験',
		description: '1 作品ずつめくる deck。前後ボタンと矢印キーで操作し、位置表示と進行バーを持つ。',
		facts: [
			'同時に 1 作品だけを表示し、残りは操作で辿る',
			'前後ボタン 2 本と ArrowLeft / ArrowRight キーで操作できる',
			'作品の切り替えに 1 種類の step transition を持つ',
			'reduced motion では transition を emit せず即時に切り替わる',
		],
	},
];

/**
 * The four axes Issue #517 requires the comparison to cover —
 * kept as data so the document and the screen name the same axes.
 */
export const ENGAGEMENT_CRITERIA: readonly EngagementCriterion[] = [
	{
		id: 'legibility',
		label: '視認性',
		question: '情報が一目で読めるか。スクロールなしで掴める量はどれだけか。',
	},
	{
		id: 'operability',
		label: '操作可能性',
		question: 'キーボードだけで全情報に辿り着けるか。状態が分かるか。',
	},
	{
		id: 'loading-cost',
		label: '読み込み負荷',
		question: '初期表示に必要な JS / 描画コストはどれだけか。',
	},
	{
		id: 'reduced-motion',
		label: 'reduced motion',
		question: '動きを減らす設定で、情報が欠けずに表示されるか。',
	},
];

/**
 * Every published URL either variant may link to — the union of the
 * works' own seed links. Nothing else: an invented link is exactly
 * what the parity gate and the capture verifier exist to refuse.
 */
export const ENGAGEMENT_LINKS: readonly EngagementLink[] = [
	{
		label: 'my-web-2026 repository',
		url: 'https://github.com/rebuildup/my-web-2026',
	},
	{
		label: 'Aulymo on BOOTH',
		url: 'https://361do.booth.pm',
	},
	{
		label: 'project-init repository',
		url: 'https://github.com/rebuildup/project-init',
	},
	{
		label: 'design-skills repository',
		url: 'https://github.com/rebuildup/design-skills',
	},
	{
		label: '公開作品の一覧（portfolio）',
		url: 'https://rebuildup.dev/portfolio',
	},
];

/** Colophon facts printed at the foot of both variants. */
export const ENGAGEMENT_NOTES: readonly string[] = [
	'2 つの表示は同一データ（ENGAGEMENT_WORKS）を描く。見える差はすべて容れ物の差であり、内容の差ではない。',
	'材料は公開済みの記録（src/portfolio/seed.ts / docs/personal/domain.md）に限定し、未公開の作品・実績・個人情報は含めない。',
	'本 preview は採用を決めない。どちらの体験をどこに使うかは owner 決定であり、ページへの適用も本 Issue の範囲外。',
	'公開 route への接続・サイト上の位置・正式公開は owner 決定であり、本 preview の範囲外。',
];
