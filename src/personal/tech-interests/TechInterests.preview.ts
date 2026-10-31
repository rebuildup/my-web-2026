/**
 * Tech-interest inventory — the committed preview data (Issue #528).
 *
 * What this module owns
 * ---------------------
 * The **states** a technical interest can be in, and the committed
 * observations that sit in them. It is data, not a surface: the
 * Markdown document `docs/influences/tech-interests.md` and the
 * Storybook preview `TechInterests.stories.tsx` read the same strings
 * from here, and `scripts/check-tech-interests-preview-parity.test.mjs`
 * fails when the two drift apart.
 *
 * Why the state is separate from the recommendation
 * --------------------------------------------------
 * A technology that was the right answer yesterday is not the right
 * answer today. The inventory therefore keeps three things apart:
 *
 *   - `state`        — the state the observation was made in. It is
 *                      the state at the time of the observation, so a
 *                      superseded observation keeps the state it held
 *                      and says so.
 *   - `observedOn`   — the date the observation was made. Names and
 *                      versions decay; the date is what makes an old
 *                      observation readable as old.
 *   - `supersededBy` — the id of the observation that replaced this
 *                      one. An observation with a successor is NEVER
 *                      a current recommendation, no matter how good
 *                      its state is.
 *
 * `CURRENT_RECOMMENDATIONS` is derived from those three fields, never
 * hand-maintained, so "an old recommendation shown as the current one"
 * is a state the data cannot express.
 *
 * The honesty contract
 * --------------------
 * Every entry names an `evidence` path that exists in this repository
 * and an `observedOn` date. The agent that writes this file may
 * OBSERVE and RECORD; it may not ASSERT a subjective state on the
 * owner's behalf — see `docs/personal/knowledge-model.md` ("assert /
 * close subjective state: proposal only"). Where the repository does
 * not settle a question, the entry says so in its note instead of
 * guessing.
 */

/**
 * The four states an entry can be in.
 *
 * They are mutually exclusive by construction: a technology appears in
 * exactly one state section, and the section it appears in IS its
 * state. The state names the owner's RELATION to the technology, not
 * the technology's quality.
 */
export type InterestState = 'currently-using' | 'used-in-production' | 'tried' | 'liked';

/** The label each state is written with, in the document and the preview. */
export const INTEREST_STATE_LABELS: Readonly<Record<InterestState, string>> = {
	'currently-using': '現在使用',
	'used-in-production': '制作で使った',
	tried: '試した',
	liked: '好き / 関心',
};

/**
 * The vocabulary the Miro board uses for the subject of an interest.
 *
 * `ai-provider` is separated from `ai-tool` on purpose: a model
 * provider is a service the owner routes to, a tool is a program the
 * owner runs. The two have different evidence (a pinned configuration
 * versus a subscription) and they decay at different rates.
 */
export type InterestCategory =
	| 'language'
	| 'os'
	| 'framework'
	| 'library'
	| 'platform'
	| 'tool'
	| 'ai-tool'
	| 'ai-provider';

/** The label each category is written with, in the document and the preview. */
export const INTEREST_CATEGORY_LABELS: Readonly<Record<InterestCategory, string>> = {
	language: '言語',
	os: 'OS',
	framework: 'フレームワーク',
	library: 'ライブラリ',
	platform: 'プラットフォーム',
	tool: 'ツール',
	'ai-tool': 'AI ツール',
	'ai-provider': 'AI プロバイダ',
};

export interface TechInterestEntry {
	/** Stable identifier. Also the target of another entry's `supersededBy`. */
	readonly id: string;
	/** The subject's name. Appears verbatim as a `###` heading in the document. */
	readonly name: string;
	readonly category: InterestCategory;
	/** The state this observation was made in. */
	readonly state: InterestState;
	/** The date the observation was made, as `YYYY-MM-DD`. */
	readonly observedOn: string;
	/** The path (or published URL) the observation comes from. */
	readonly evidence: string;
	/**
	 * A second source the observation depends on. Present when the
	 * claim needs both a positive record and a negative one — "it was
	 * used in 2025" and "it is absent from the current configuration"
	 * are two different facts.
	 */
	readonly corroborating?: string;
	/** One line of context. Says what the observation does NOT claim, when relevant. */
	readonly note: string;
	/**
	 * The id of the observation that replaced this one.
	 *
	 * A non-empty value means "this observation is history". The entry
	 * is rendered in the held list only, never in the current
	 * recommendations.
	 */
	readonly supersededBy?: string;
}

export interface TechInterestSection {
	/** Stable identifier. */
	readonly id: string;
	/** The `##` heading. Must equal the document's heading for this section. */
	readonly heading: string;
	/** One sentence describing what the section answers. */
	readonly summary: string;
	/** The prose points of the section. Empty for a section that only lists entries. */
	readonly points: readonly string[];
	/** The observations the section lists. Empty for a prose-only section. */
	readonly entries: readonly TechInterestEntry[];
}

/**
 * The inventory.
 *
 * Reading order follows the states, from the strongest relation to the
 * weakest, and the rule section comes after the data so the reader has
 * already seen what the rule is about.
 */
export const TECH_INTEREST_SECTIONS: readonly TechInterestSection[] = [
	{
		id: 'purpose',
		heading: '1. この文書の目的',
		summary:
			'AI・OS・言語・フレームワーク・ライブラリに対する技術関心を、状態ごとに分けた事実ベースの inventory として管理する。',
		points: [
			'『好き』『試した』『制作で使った』『現在使用』は、それぞれ別の意味を持つ状態として定義する。1 つの平坦なリストに並べ替えると、どの状態なのかが読めなくなる。',
			'根拠は「このリポジトリに実在する記録」に限る。Miro の付箋にはアクセスできないため、Issue 本文が引用した見出し語だけが典拠になる。',
			'観察できないことは「未確認（owner 確認待ち）」として残す。空いた欄を推測で埋めない。',
			'全ツールの宣伝 LP は作らない。記録に残すのは、状態と根拠と観測日だけでよい。',
		],
		entries: [],
	},
	{
		id: 'states',
		heading: '2. 状態の定義',
		summary: 'この inventory が使う 4 状態と、それぞれが何を主張しないかの定義。',
		points: [
			'現在使用: いま手元の開発環境と、このプラットフォームの運用で実際に使っている。',
			'制作で使った: このリポジトリの外にある出荷済み作品（Aulymo / MultiSlicer / Tastile）で実際に使った。',
			'試した: 触れて評価したが、出荷済み作品にも現在のツールチェーンにも使っていない。評価記録だけが残っているものもこの状態に入る。',
			'好き / 関心: 関心はあるが、利用の記録がこのリポジトリ内に存在しない。',
			'4 状態は排他で、同じ対象が 2 つの状態に同時に現れることはない。根拠が複数あるときは、より強い関係（現在使用 > 制作で使った > 試した > 好き / 関心）を採る。',
			'現在使用は「記録が存在する」ことだけでは成立しない。採用記録（adoption）や実 $HOME への配置のような肯定的な記録で支えられるときだけ成立する。存在記録しかない対象は、より弱い状態に置く。',
		],
		entries: [],
	},
	{
		id: 'currently-using',
		heading: '3. 現在使用（currently using）',
		summary: 'いま手元の開発環境と運用で実際に使っているもの。',
		points: [],
		entries: [
			{
				id: 'typescript',
				name: 'TypeScript',
				category: 'language',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: '実装言語。このリポジトリのソースはすべて TypeScript で書かれている。',
			},
			{
				id: 'react',
				name: 'React',
				category: 'library',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: 'UI の実装基盤。Routes と server function の両方が React 19 上にある。',
			},
			{
				id: 'cloudflare-workers',
				name: 'Cloudflare Workers',
				category: 'platform',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'cloudflare.config.ts',
				note: '本番のランタイムでありデプロイ先。単一 Worker で全 surface を配信する。',
			},
			{
				id: 'cloudflare-d1-r2',
				name: 'Cloudflare D1 / R2',
				category: 'platform',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'src/cloudflare/health.ts',
				note: 'SQL は D1、公開画像は R2。health probe が両方の binding を実際に叩いている。',
			},
			{
				id: 'tanstack-start',
				name: 'TanStack Start',
				category: 'framework',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: 'Web フレームワーク。route と server function を提供する層。',
			},
			{
				id: 'hono',
				name: 'Hono',
				category: 'framework',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'src/http/hono.ts',
				note: '外部 HTTP boundary の実装。Worker entry が path prefix で dispatch する。',
			},
			{
				id: 'panda-css',
				name: 'Panda CSS',
				category: 'library',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'src/editorial/tokens.ts',
				note: 'styling 基盤。token 層と primitive を editorial が所有する。',
			},
			{
				id: 'cloudflare-vite-plugin',
				name: '@cloudflare/vite-plugin',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: '2.0.0-beta.sha-c82c3efb3 に固定。1.x 系の記録は §7 の保留側にある。',
			},
			{
				id: 'cf-cli',
				name: 'cf CLI',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: 'build / typegen / deploy を実行する CLI。Wrangler からの移行先はここ。',
			},
			{
				id: 'pnpm',
				name: 'pnpm',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: 'package manager。12.3.4。',
			},
			{
				id: 'biome',
				name: 'Biome',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'quality/profile.yaml',
				note: 'format と lint を 1 つの binary で担う。validate:fast の先頭で毎回走る。',
			},
			{
				id: 'vitest',
				name: 'Vitest',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: 'package.json',
				note: 'unit / integration test の runner。',
			},
			{
				id: 'github-actions',
				name: 'GitHub Actions',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-28',
				evidence: '.github/workflows',
				note: 'CI と release の自動化の実行環境。',
			},
			{
				id: 'macos',
				name: 'macOS',
				category: 'os',
				state: 'currently-using',
				observedOn: '2026-10-20',
				evidence: 'src/keyboard/sources/manifest.json',
				note: 'keyboard manifest の adoption 記録が mac-kanata（role: pc-setup-adopted）を採用 ref として宣言している。構成が存在するのではなく、採用が記録されている。',
			},
			{
				id: 'kanata',
				name: 'Kanata',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-20',
				evidence: 'src/keyboard/sources/manifest.json',
				note: 'macOS の採用 ref は installer が pin する config_ref。repository head は自動追随しない。',
			},
			{
				id: 'hidutil',
				name: 'hidutil',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-20',
				evidence: 'src/keyboard/catalog.ts',
				note: '物理キーボードを大西配列へ変換する macOS 標準の remap 機構。',
			},
			{
				id: 'claude-code',
				name: 'Claude Code',
				category: 'ai-tool',
				state: 'currently-using',
				observedOn: '2026-10-20',
				evidence: 'src/projects/snapshots/dotfiles.json',
				note: 'ネイティブの claude command は公式 login を保持し、wrap も alias もしない。',
			},
			{
				id: 'codex',
				name: 'Codex',
				category: 'ai-tool',
				state: 'currently-using',
				observedOn: '2026-10-20',
				evidence: 'src/projects/snapshots/dotfiles.json',
				note: 'agent 設定が sibling submodule として固定している。',
			},
			{
				id: 'opencode',
				name: 'OpenCode',
				category: 'ai-tool',
				state: 'currently-using',
				observedOn: '2026-10-20',
				evidence: 'src/projects/snapshots/dotfiles.json',
				note: 'agent 設定が sibling submodule として固定している。',
			},
		],
	},
	{
		id: 'used-in-production',
		heading: '4. 制作で使った（used in production）',
		summary: 'このリポジトリの外にある出荷済み作品で実際に使ったもの。',
		points: [],
		entries: [
			{
				id: 'after-effects-sdk',
				name: 'After Effects SDK',
				category: 'platform',
				state: 'used-in-production',
				observedOn: '2026-09-18',
				evidence: 'src/portfolio/seed.ts',
				note: 'MultiSlicer（2023 - present）。C++ の effect plugin として配布した。',
			},
			{
				id: 'premiere-pro-sdk',
				name: 'Premiere Pro SDK',
				category: 'platform',
				state: 'used-in-production',
				observedOn: '2026-09-18',
				evidence: 'src/portfolio/seed.ts',
				note: 'MultiSlicer の technologies として記録されている。',
			},
			{
				id: 'extendscript',
				name: 'ExtendScript',
				category: 'language',
				state: 'used-in-production',
				observedOn: '2026-09-18',
				evidence: 'src/portfolio/seed.ts',
				note: 'Aulymo（2022 - present）。After Effects の lyric motion を作る tool。',
			},
			{
				id: 'kotlin',
				name: 'Kotlin',
				category: 'language',
				state: 'used-in-production',
				observedOn: '2026-09-18',
				evidence: 'src/portfolio/seed.ts',
				note: 'Tastile（2024-06 - present）の multi-client 開発で使った。',
			},
			{
				id: 'rust',
				name: 'Rust',
				category: 'language',
				state: 'used-in-production',
				observedOn: '2026-09-18',
				evidence: 'src/portfolio/seed.ts',
				note: 'Tastile の technologies として記録されている。docs/personal/domain.md §5 は Rust を「展開中の関心」に置くが、確認できる使用の根拠は tastile なので、この状態の方が強い。',
			},
			{
				id: 'tauri',
				name: 'Tauri',
				category: 'framework',
				state: 'used-in-production',
				observedOn: '2026-09-18',
				evidence: 'src/portfolio/seed.ts',
				note: 'Tastile の desktop client。',
			},
		],
	},
	{
		id: 'tried',
		heading: '5. 試した（tried — 採用には至っていない）',
		summary: '触れて評価したが、出荷済み作品にも現在のツールチェーンにも使っていないもの。',
		points: [],
		entries: [
			{
				id: 'yomiyasu',
				name: 'yomiyasu',
				category: 'library',
				state: 'tried',
				observedOn: '2026-10-18',
				evidence: 'docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md',
				note: 'Python の校正ライブラリ。校正と slug 規則は同じ obligation ではないうえ、Python はこのプラットフォームの runtime ではないため採用しなかった。',
			},
			{
				id: 'cf-bot-score',
				name: 'cf.botScore',
				category: 'platform',
				state: 'tried',
				observedOn: '2026-09-19',
				evidence: 'docs/adr/ADR-0010-abuse-protection-rate-limit.md',
				note: 'Cloudflare の bot スコア。server-to-server API が自動的な呼び出しと区別できないため、明示的に採用しないと決めた。',
			},
			{
				id: 'cursor',
				name: 'Cursor',
				category: 'ai-tool',
				state: 'tried',
				observedOn: '2026-10-20',
				evidence: 'src/portfolio/seed.ts',
				corroborating: 'src/projects/snapshots/dotfiles.json',
				note: 'project-init（2025-06 - present）の technologies として記録されているが、2026-10-20 時点の agent 構成記録に名前は出ない。「いま使っていない」ことの証拠ではなく、「現在の使用記録がない」ことまでしか主張しない。',
			},
			{
				id: 'kanata-windows-layout',
				name: 'Kanata（Windows 側の設定）',
				category: 'tool',
				state: 'tried',
				observedOn: '2026-10-20',
				evidence: 'src/keyboard/sources/manifest.json',
				note: '取得・解析して snapshot に取り込んだ Windows 側の設定。採用 ref として選ばれているのは macOS 側だけで、installer が更新されるまで自動追随しない。',
			},
			{
				id: 'windows',
				name: 'Windows',
				category: 'os',
				state: 'tried',
				observedOn: '2026-10-20',
				evidence: 'src/projects/snapshots/dotfiles.json',
				note: 'agent launcher に Windows 用の PowerShell entry script がある。対応のための記録であって、いま Windows を開発環境として使っている記録ではない。keyboard manifest の採用 ref も macOS 側だけ。',
			},
			{
				id: 'opt-in-agent-providers',
				name: 'OpenRouter / DeepSeek / MiniMax / OpenCode Zen',
				category: 'ai-provider',
				state: 'tried',
				observedOn: '2026-10-20',
				evidence: 'src/projects/snapshots/dotfiles.json',
				note: 'unified agent launcher の opt-in 経路として設定されている。既定経路は公式 login 側で、この一覧が現在の推奨になることはない。',
			},
		],
	},
	{
		id: 'liked',
		heading: '6. 好き / 関心（liked — 利用の記録はない）',
		summary: '関心はあるが、このリポジトリ内に利用の記録がないもの。',
		points: [
			'docs/personal/domain.md §5 の「展開中の関心」には Rust / backend / low-level / 機械的検証 / agent evaluation / real-time graphics / cross-platform が挙がるが、そのうち Rust と cross-platform は §4 に出荷物での使用の根拠があるため、より強い状態（制作で使った）を採った。残りは本節の対象ではない。',
		],
		entries: [
			{
				id: 'p5js',
				name: 'p5.js',
				category: 'library',
				state: 'liked',
				observedOn: '2026-09-18',
				evidence: 'docs/personal/domain.md',
				note: 'creative coding への関心として記録されている library。作品としての使用記録は repository 内にない。',
			},
			{
				id: 'webgl',
				name: 'WebGL',
				category: 'platform',
				state: 'liked',
				observedOn: '2026-09-18',
				evidence: 'docs/personal/domain.md',
				note: 'code 自体を表現手段として使うことへの関心として記録されている。',
			},
		],
	},
	{
		id: 'supersede-rule',
		heading: '7. 古い推奨を現在の推奨として表示しない規則',
		summary:
			'観察が置き換わったら、推奨は引き継がれる。引き継がれた側の観測だけが現在の推奨になる。',
		points: [
			'各観察には観測日（observedOn）を必ず付ける。観測日を添えない記述は、いまの推奨として読めない。',
			'ある観察が別の観察に置き換わったら、古い側には supersededBy を付け、古い側は保留の一覧にだけ出す。',
			'現在の推奨一覧は supersededBy を持たない観察から機械的に導く。手書きの「現在の推奨」リストは持たない。',
			'この節の 2 件は実際に引き継がれた例であり、古い側を現在の推奨として表示してはならない。',
		],
		entries: [
			{
				id: 'wrangler',
				name: 'Wrangler',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-04',
				evidence: 'docs/adr/ADR-0016-cf-migration-plan.md',
				supersededBy: 'cf-cli',
				note: '当時の推奨だった Cloudflare CLI。移行が進行中のため依存は tree に残っているが、現在の推奨は cf CLI 側であり、Wrangler 単体を現在の推奨として表示しない。',
			},
			{
				id: 'cloudflare-vite-plugin-1x',
				name: '@cloudflare/vite-plugin 1.x',
				category: 'tool',
				state: 'currently-using',
				observedOn: '2026-10-04',
				evidence: 'docs/adr/ADR-0016-cf-migration-plan.md',
				supersededBy: 'cloudflare-vite-plugin',
				note: '当時の固定は ^1.0.0 だった。現在の固定は 2.0.0-beta 側であり、1.x の記述を現在の推奨として表示しない。',
			},
		],
	},
	{
		id: 'observation-rules',
		heading: '8. 観察日と出典の規則',
		summary: '観察日・出典・誰が何を確定できるかの規則。',
		points: [
			'観察日は ISO の日付（YYYY-MM-DD）で、記録が読まれた日、または snapshot の verifiedAt / fetchedAt / committedAt を使う。',
			'出典は repository 内の実在するパス、または公開済みの URL。存在しないファイルや未公開の URL は書かない。',
			'主観的な状態（好き / 関心 / 意向）の確定は owner の権限。agent は観察と提案までで、owner の発言を勝手に作らない。',
			'同じ対象について相反する記録が両方あるときは、観測日が新しい方を採用し、古い方を保留として残す。',
		],
		entries: [],
	},
	{
		id: 'decisions',
		heading: '9. 採用 / 保留の判断',
		summary: 'この Issue で採用するもの、保留にして別 Issue と owner 判断に回去もの。',
		points: [
			'採用: 4 状態の定義、観測日つき inventory、supersede 規則、単独で描ける Storybook preview、Markdown と preview データの一致検証。',
			'保留: 公開 route への接続。独立 preview の契約は Issue #380 が所有しており、この Issue は接続しない。',
			'保留: Miro の付箋の逐語記録。agent は Miro にアクセスできないため、Issue 本文が引用した見出し語だけを典拠とする。',
			'保留: AI モデルの最新版番号の追跡。外部情報への定期アクセスが必要なため、この Issue の範囲外。',
			'保留: この inventory の公開 surface への表示。公開 copy は owner の承認を要するため、この Issue では公開しない。',
		],
		entries: [],
	},
	{
		id: 'unconfirmed',
		heading: '10. 未確認（owner 確認待ち）',
		summary: 'このリポジトリからは確認できず、owner に確認を要する事項。',
		points: [
			'Miro の付箋にある AI モデルの一覧と、各モデルごとの位置づけ。',
			'my-web-2025 時代に別の styling を使っていた時期があったかどうか。',
			'Cursor の現在の使用状況。記録に名前がないことは「使っていない」ことの証拠ではない。',
			'各 AI モデルの最新版番号。観測日ごとに記録する対象であり、agent は最新と主張しない。',
			'Windows をいま手元の開発環境として使っているか。dotfiles に Windows 用の entry script があることは対応の記録にすぎず、採用の記録ではない。',
		],
		entries: [],
	},
];

/** Every entry of every section, in reading order. */
export const TECH_INTEREST_ENTRIES: readonly TechInterestEntry[] = TECH_INTEREST_SECTIONS.flatMap(
	(section) => section.entries,
);

/** The entries by id, for resolving `supersededBy`. */
export const TECH_INTEREST_ENTRY_BY_ID: ReadonlyMap<string, TechInterestEntry> = new Map(
	TECH_INTEREST_ENTRIES.map((entry) => [entry.id, entry]),
);

/**
 * The observations that were replaced by a later one.
 *
 * They are history. They are rendered in the held list with the
 * observation that replaced them, and they are never a current
 * recommendation.
 */
export const SUPERSEDED_OBSERVATIONS: readonly TechInterestEntry[] = TECH_INTEREST_ENTRIES.filter(
	(entry) => entry.supersededBy !== undefined,
);

/**
 * The current recommendations.
 *
 * Derived, never hand-maintained: an observation is a current
 * recommendation when it is in the `currently-using` state and nothing
 * has replaced it. An observation that was replaced cannot be one, so
 * an old recommendation cannot be shown as the current one.
 */
export const CURRENT_RECOMMENDATIONS: readonly TechInterestEntry[] = TECH_INTEREST_ENTRIES.filter(
	(entry) => entry.state === 'currently-using' && entry.supersededBy === undefined,
);
