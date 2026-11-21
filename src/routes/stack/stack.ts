/**
 * `/stack` — repo-controlled article data for the public stack page
 * (Issue #381).
 *
 * This module owns the CONTENT contract: which sections exist, which
 * items each section lists, and what every item claims (responsibility,
 * adoption reason, evidence). It deliberately owns NO version literals
 * that can drift — each item's `version` is a REFERENCE that
 * `src/routes/stack/load.ts` resolves against the live sources at
 * request time:
 *
 *   - `profile:<key>`  → the `stack.<key>` entry of
 *                        `quality/profile.yaml` (the declared stack
 *                        contract the quality gates are built on);
 *   - `npm:<name>`     → the declared spec in `package.json`
 *                        (`dependencies` first, then
 *                        `devDependencies`);
 *   - `packageManager` → `package.json#packageManager`;
 *   - `none`           → the item has no meaningful version (a
 *                        platform service or a committed artefact);
 *   - `undetermined`   → the repository does not record the value.
 *                        The page renders 「未確定」 — it never guesses.
 *
 * Evidence links point at `main`, the repository's default branch:
 * they name the file a claim was read from, and the rendered version
 * label is derived from that same file's current contents, so the
 * link and the claim cannot silently disagree after a merge.
 *
 * Sections are an ORDERED ARRAY on purpose: Issues #382 / #383 / #510
 * add their own sections (Biome detail, Quality/Delivery, the
 * component-integration example) by appending entries or extending an
 * item — the page component maps over the array and needs no
 * restructuring for a new section.
 */

/** Base for evidence links into this repository's default branch. */
const STACK_REPO_BLOB_BASE = 'https://github.com/rebuildup/my-web-2026/blob/main/' as const;

/** One piece of evidence: a label plus the URL it opens. */
export interface StackEvidence {
	readonly label: string;
	readonly href: string;
}

/**
 * How an item's version label is obtained. Never a literal — see the
 * file header for the resolution contract.
 */
export type StackVersionRef =
	| { readonly kind: 'profile'; readonly key: string }
	| { readonly kind: 'npm'; readonly name: string }
	| { readonly kind: 'packageManager' }
	| { readonly kind: 'none' }
	| { readonly kind: 'undetermined' };

/**
 * A labelled code block rendered inside an item — the before/after
 * pairs and the proposal comparison the Biome section (Issue #382)
 * shows. The `code` text is committed copy: when it claims to be a
 * formatter output it must be the real bytes the formatter produced
 * (the reproduction command is named in `note` and in
 * `docs/verification/stack/biome-formatting.md`).
 */
export interface StackCodeSample {
	/** Visible label, e.g. 「変換前」 / 「Biome 適用後」. */
	readonly label: string;
	/** Fence language hint (`ts`, `json`, `text`); metadata only. */
	readonly language?: string;
	readonly code: string;
	/** Optional muted note under the block. */
	readonly note?: string;
}

/**
 * A runtime-resolved fact table. `version` resolves to ONE label;
 * `facts` resolves to a list of labelled rows read from a repository
 * file at request time — currently only `biome.json` (Issue #382).
 * Same fail-closed contract as `version`: a reference that resolves
 * to nothing renders no table, never a guessed value.
 */
export type StackFactRef = { readonly kind: 'biomeJson' };

/** One row of a resolved fact table (`settings` on the view). */
export interface StackFactRow {
	/** Dotted key path, e.g. `formatter.lineWidth`. */
	readonly label: string;
	readonly value: string;
	readonly note?: string;
}

/** One technology / configuration entry on the page. */
export interface StackItem {
	readonly id: string;
	/** Display name (proper noun or tool name). */
	readonly name: string;
	/** What this entry is responsible for on the platform. */
	readonly responsibility: string;
	/** Why it was adopted / the design intent behind the choice. */
	readonly reason: string;
	readonly version: StackVersionRef;
	/** Optional runtime-resolved settings table (see {@link StackFactRef}). */
	readonly facts?: StackFactRef;
	/** Optional committed code samples (before/after, proposals). */
	readonly samples?: readonly StackCodeSample[];
	readonly evidence: readonly StackEvidence[];
	/**
	 * Optional verification verdicts (Issue #510). Only the
	 * component-integration example carries them today; the resolver
	 * and the page pass them through untouched.
	 */
	readonly checks?: readonly StackCheck[];
}

/** A titled group of stack items. */
export interface StackSection {
	readonly id: string;
	/** Japanese section title. */
	readonly title: string;
	/** English half of the bilingual title. */
	readonly titleEn: string;
	/** Optional muted description under the heading. */
	readonly description?: string;
	readonly items: readonly StackItem[];
}

/**
 * Verification verdict for one claim an item makes (Issue #510).
 *
 * The vocabulary is deliberately the same four-state one the
 * editorial-approval and publication gates use, so a reader who knows
 * those reports reads this page the same way:
 *
 *   - `pass`            — the claim was verified against the cited
 *                         source;
 *   - `fail`            — a verification ran and contradicted the
 *                         claim;
 *   - `not-run`         — no verification exists yet;
 *   - `not-applicable`  — the claim does not apply to this example
 *                         (for example a guarantee the example
 *                         deliberately does not make).
 *
 * A `not-applicable` verdict is NOT a failure and is never rendered
 * as one: it records the boundary of what the example claims.
 */
export type StackCheckStatus = 'pass' | 'fail' | 'not-run' | 'not-applicable';

/** One verification verdict attached to a stack item. */
export interface StackCheck {
	readonly id: string;
	/** What was checked, in Japanese. */
	readonly label: string;
	readonly status: StackCheckStatus;
	/** Optional muted note qualifying the verdict (the honest gap). */
	readonly note?: string;
}

const blob = (...segments: readonly string[]): string =>
	`${STACK_REPO_BLOB_BASE}${segments.join('/')}`;

/** Directory evidence: GitHub's tree view, not a blob. */
const tree = (...segments: readonly string[]): string =>
	`https://github.com/rebuildup/my-web-2026/tree/main/${segments.join('/')}`;

const evidence = (label: string, ...segments: readonly string[]): StackEvidence => ({
	label,
	href: blob(...segments),
});

const evidenceDir = (label: string, ...segments: readonly string[]): StackEvidence => ({
	label,
	href: tree(...segments),
});

/**
 * The Biome before/after sample (Issue #382).
 *
 * `BIOME_SAMPLE_BEFORE` is the deliberately unformatted input;
 * `BIOME_SAMPLE_AFTER` is the byte-exact stdout of
 *
 *   pnpm exec biome format --stdin-file-path=sample.ts < before.ts
 *
 * run with the repository's own `biome.json` (Biome 1.9.4,
 * `lineWidth: 100`, tab indent, single quotes, `trailingCommas: "all"`).
 * The reproduction command and the compressed-proposal comparison are
 * recorded in `docs/verification/stack/biome-formatting.md`; if
 * `biome.json`'s formatter settings change, this pair must be
 * regenerated, not hand-edited.
 */
const BIOME_SAMPLE_BEFORE = [
	'export function describeStackItem(item:{name:string;responsibility:string;reason:string;version:string|null}):string{',
	'return `${item.name} — ${item.responsibility} (${item.version??"未確定"})`',
	'}',
	'export const SAMPLE=describeStackItem({name:"Biome",responsibility:"format と lint を 1 つの binary で担う toolchain。",reason:"Prettier と ESLint の 2 系統を 1 つの設定・1 回の実行に統合するため。",version:"1.9.x"})',
].join('\n');

const BIOME_SAMPLE_AFTER = [
	'export function describeStackItem(item: {',
	'\tname: string;',
	'\tresponsibility: string;',
	'\treason: string;',
	'\tversion: string | null;',
	'}): string {',
	"\treturn `${item.name} — ${item.responsibility} (${item.version ?? '未確定'})`;",
	'}',
	'export const SAMPLE = describeStackItem({',
	"\tname: 'Biome',",
	"\tresponsibility: 'format と lint を 1 つの binary で担う toolchain。',",
	"\treason: 'Prettier と ESLint の 2 系統を 1 つの設定・1 回の実行に統合するため。',",
	"\tversion: '1.9.x',",
	'});',
].join('\n');

/**
 * The compressed one-line proposal (Issue #382): the same function
 * with the signature minified and the object literal kept on one
 * line. Under `lineWidth: 100` Biome cannot keep this shape — the
 * call alone exceeds the width, so `biome format --write` re-expands
 * it to {@link BIOME_SAMPLE_AFTER}. That is the mechanical reason the
 * proposal is deferred rather than adopted.
 */
const BIOME_SAMPLE_COMPRESSED = [
	'export function describeStackItem(i:{name:string;responsibility:string;reason:string;version:string|null}):string{return`${i.name} — ${i.responsibility} (${i.version??"未確定"})`}',
	'export const SAMPLE=describeStackItem({name:"Biome",responsibility:"format と lint を 1 つの binary で担う toolchain。",reason:"Prettier と ESLint の 2 系統を 1 つの設定・1 回の実行に統合するため。",version:"1.9.x"})',
].join('\n');

/**
 * The committed stack inventory.
 *
 * Ordering inside a section is editorial (runtime first, then the
 * layers built on it). Every `reason` states the OBSERVED design
 * intent — the source that records it is named in `evidence`, so a
 * reader can check the claim instead of trusting the prose.
 */
export const STACK_SECTIONS: readonly StackSection[] = [
	{
		id: 'runtime',
		title: '実行基盤とフレームワーク',
		titleEn: 'Runtime & framework',
		description: 'サイト全体を配信する Worker と、その上に載るフレームワーク・言語の構成です。',
		items: [
			{
				id: 'cloudflare-workers',
				name: 'Cloudflare Workers',
				responsibility:
					'公開ページ・API・Webhook・メディア配信をすべて担う単一 Worker のランタイム。エッジで実行され、D1 / R2 / Static Assets と同じ基盤の上で動きます。',
				reason:
					'個人プラットフォームを 1 つの deployment 単位で運用するため。サーバー管理を持たず、バインディング宣言だけでデータ層を構成できる点が採用理由です。',
				version: { kind: 'profile', key: 'runtime' },
				evidence: [
					evidence('wrangler.jsonc', 'wrangler.jsonc'),
					evidence('cloudflare.config.ts', 'cloudflare.config.ts'),
					evidence('architecture.md', 'docs', 'architecture.md'),
				],
			},
			{
				id: 'tanstack-start',
				name: 'TanStack Start',
				responsibility:
					'file-based routing・SSR・server function を提供する Web フレームワーク。`routes/**` が公開 surface の契約です。',
				reason:
					'React 上で routing と server function を型付きに扱うため。外部 HTTP boundary との分担は `server.ts` の path dispatch が所有します。',
				version: { kind: 'profile', key: 'framework' },
				evidence: [
					evidence('package.json', 'package.json'),
					evidence('architecture.md', 'docs', 'architecture.md'),
					evidence('AGENTS.md', 'AGENTS.md'),
				],
			},
			{
				id: 'react',
				name: 'React',
				responsibility:
					'UI の実装基盤。route component と server function の両方が React 上にあります。',
				reason:
					'TanStack Start の前提となる UI ランタイムであり、editorial primitive も React component として構成されています。',
				version: { kind: 'npm', name: 'react' },
				evidence: [evidence('package.json', 'package.json')],
			},
			{
				id: 'typescript',
				name: 'TypeScript',
				responsibility: '実装言語。`src/**` と `scripts/**` の source はすべて TypeScript です。',
				reason:
					'Worker・route・script の境界を型で固定するため。`tsc --noEmit` が validate:fast の必須工程です。',
				version: { kind: 'npm', name: 'typescript' },
				evidence: [
					evidence('package.json', 'package.json'),
					evidence('tsconfig.json', 'tsconfig.json'),
				],
			},
			{
				id: 'hono',
				name: 'Hono',
				responsibility:
					'`/api/v1/*`・`/webhooks/*`・`/oauth/*`・`/integrations/*`・`/media/*`・sitemap / robots / security.txt を担う外部 HTTP boundary。',
				reason:
					'TanStack Start の document pipeline と機械向け endpoint を分けるため。`server.ts` が path prefix で dispatch し、境界ポリシーは ADR-0002 が所有します。',
				version: { kind: 'profile', key: 'external_boundary' },
				evidence: [
					evidence('hono.ts', 'src', 'http', 'hono.ts'),
					evidence('server.ts', 'src', 'server.ts'),
					evidence('architecture.md', 'docs', 'architecture.md'),
				],
			},
			{
				id: 'vite',
				name: 'Vite',
				responsibility: 'build tool。client / SSR / Worker bundle の生成を担います。',
				reason:
					'`@cloudflare/vite-plugin` と TanStack Start plugin が同一の Vite pipeline に乗る構成のため。',
				version: { kind: 'npm', name: 'vite' },
				evidence: [
					evidence('package.json', 'package.json'),
					evidence('vite.config.ts', 'vite.config.ts'),
				],
			},
		],
	},
	{
		id: 'data',
		title: 'データとストレージ',
		titleEn: 'Data & storage',
		description:
			'構造化データ・メディア・静的 asset の置き場。すべて Worker の binding 宣言で構成されます。',
		items: [
			{
				id: 'cloudflare-d1',
				name: 'Cloudflare D1',
				responsibility:
					'portfolio・reactions などの構造化データを保持する SQLite 系データベース。schema は `migrations/` の逐次履歴が所有します。',
				reason:
					'Workers と同一基盤で動く管理対象の SQL ストアが必要なため。外部 DB の運用を持ち込まない判断です。',
				version: { kind: 'none' },
				evidence: [
					evidence('wrangler.jsonc', 'wrangler.jsonc'),
					evidenceDir('migrations/', 'migrations'),
					evidence('architecture.md', 'docs', 'architecture.md'),
				],
			},
			{
				id: 'cloudflare-r2',
				name: 'Cloudflare R2',
				responsibility:
					'公開画像・メディア blob を保持する object storage。`/media/<key>` が公開判定を経て配信します。',
				reason:
					'画像バイナリを Worker の応答や git に載せないため。公開可否の判定は portfolio obligation が所有します。',
				version: { kind: 'none' },
				evidence: [
					evidence('wrangler.jsonc', 'wrangler.jsonc'),
					evidence('architecture.md', 'docs', 'architecture.md'),
				],
			},
			{
				id: 'static-assets',
				name: 'Cloudflare Static Assets',
				responsibility:
					'Vite が出力する client asset と `public/**` の静的文書を Worker の前段で配信します。',
				reason:
					'静的ファイルを Worker 実行なしで配れるため。HTML 文書は TanStack Start が担い、assets binding がその手前を受けます。',
				version: { kind: 'none' },
				evidence: [
					evidence('wrangler.jsonc', 'wrangler.jsonc'),
					evidence('vite.config.ts', 'vite.config.ts'),
				],
			},
		],
	},
	{
		id: 'styling',
		title: 'スタイリングと視覚言語',
		titleEn: 'Styling & visual language',
		description:
			'公開 surface の見た目を決める styling 基盤と、そこに載る editorial token / primitive です。',
		items: [
			{
				id: 'panda-css',
				name: 'Panda CSS',
				responsibility:
					'styling 基盤。zero-runtime の CSS-in-TS で、token と style を型付きに扱います。',
				reason:
					'build 時に CSS を生成するため runtime cost を持たず、design token を型で参照できる点が採用理由です。',
				version: { kind: 'profile', key: 'styling' },
				evidence: [
					evidence('package.json', 'package.json'),
					evidence('panda.config.ts', 'panda.config.ts'),
					evidence('tokens.ts', 'src', 'editorial', 'tokens.ts'),
				],
			},
			{
				id: 'editorial',
				name: 'editorial（独自 visual language）',
				responsibility:
					'`editorial/**` が所有する shipped visual language。semantic token・`Container`・`SectionHeading`・`Badge` などの display primitive を提供します。',
				reason:
					'公開 surface の見た目を 1 つの obligation に集約するため。Tailwind CSS は採用していません（AGENTS.md §2）。',
				version: { kind: 'none' },
				evidence: [
					evidenceDir('editorial/', 'src', 'editorial'),
					evidence('architecture.md', 'docs', 'architecture.md'),
					evidence('AGENTS.md', 'AGENTS.md'),
				],
			},
		],
	},
	{
		id: 'quality',
		title: '品質と開発ツール',
		titleEn: 'Quality & tooling',
		description: 'format・lint・型検査・test・package 管理を担う開発時の toolchain です。',
		items: [
			{
				id: 'biome',
				name: 'Biome',
				responsibility: 'format と lint を 1 つの binary で担う toolchain。',
				reason:
					'Prettier と ESLint の 2 系統を 1 つの設定・1 回の実行に統合するため。`validate:fast` の先頭工程です。',
				version: { kind: 'profile', key: 'format_lint' },
				evidence: [
					evidence('biome.json', 'biome.json'),
					evidence('profile.yaml', 'quality', 'profile.yaml'),
				],
			},
			{
				id: 'vitest',
				name: 'Vitest',
				responsibility:
					'unit / integration test の runner。Worker 側は `@cloudflare/vitest-plugin` の workerd pool で実行します。',
				reason:
					'Vite と同じ transform pipeline に乗せて test を書けるため。workerd pool で binding を含む挙動まで検証できます。',
				version: { kind: 'profile', key: 'test_runner' },
				evidence: [
					evidence('vitest.config.ts', 'vitest.config.ts'),
					evidence('profile.yaml', 'quality', 'profile.yaml'),
				],
			},
			{
				id: 'cloudflare-vitest-plugin',
				name: '@cloudflare/vitest-plugin',
				responsibility:
					'test を workerd 内で実行する pool を提供し、D1 / R2 binding を含む contract を検証します。',
				reason:
					'本番と同じ Workers runtime で test するため。Node 上の mock では binding の挙動差を検出できません。',
				version: { kind: 'profile', key: 'worker_test' },
				evidence: [
					evidence('vitest.config.ts', 'vitest.config.ts'),
					evidence('package.json', 'package.json'),
				],
			},
			{
				id: 'playwright',
				name: 'Playwright',
				responsibility:
					'公開 route の browser-level 検証（e2e spec・axe-core scan・screenshot capture）を担います。',
				reason:
					'実際に配信される document を browser で測るため。route 品質の e2e / seo / a11y coverage はこの runner の spec が根拠です。',
				version: { kind: 'npm', name: '@playwright/test' },
				evidence: [evidenceDir('e2e/', 'e2e'), evidence('package.json', 'package.json')],
			},
			{
				id: 'pnpm',
				name: 'pnpm',
				responsibility: 'package manager。依存の解決と script 実行を担います。',
				reason:
					'`packageManager` field で version を固定し、全 contributor / CI が同一の解決結果を使うため。',
				version: { kind: 'packageManager' },
				evidence: [evidence('package.json', 'package.json')],
			},
			{
				id: 'knip',
				name: 'knip',
				responsibility: 'unused code / 依存の検出を担う静的解析 tool です。',
				reason: 'obligation 境界を跨いだ dead export を機械的に見つけるため。',
				version: { kind: 'profile', key: 'unused_code' },
				evidence: [
					evidence('package.json', 'package.json'),
					evidence('profile.yaml', 'quality', 'profile.yaml'),
				],
			},
			{
				id: 'github-actions',
				name: 'GitHub Actions',
				responsibility:
					'CI の実行環境。ticket PR の `validate:fast`、release candidate の `validate:integration`、production smoke を workflow が駆動します。',
				reason:
					'gate の構成は `profile.yaml` が単一の宣言元で、workflow YAML に hidden step を置かない方針のため。',
				version: { kind: 'undetermined' },
				evidence: [
					evidence('ci.yml', '.github', 'workflows', 'ci.yml'),
					evidence('profile.yaml', 'quality', 'profile.yaml'),
				],
			},
		],
	},
	{
		id: 'biome',
		title: 'コード品質・Biome',
		titleEn: 'Code quality · Biome',
		description:
			'format と lint を担う Biome の実設定と、formatter の実出力による before / after、そして 1 行圧縮案との比較記録です。設定値はリクエスト時に `biome.json` から読み取ります。',
		items: [
			{
				id: 'biome-config',
				name: 'biome.json の設定値',
				responsibility:
					'formatter（indent・lineWidth・lineEnding）・JavaScript formatter（quote・semicolon・trailing comma）・linter rules・organizeImports の設定値を表で示します。',
				reason:
					'「コードをどう整形するか」の契約は `biome.json` 1 ファイルが所有し、`format:check` / `lint:check` がそれを機械的に強制するためです。表の値はページ表示時にファイルから読み取るので、記載が実設定からずれることはありません。',
				version: { kind: 'profile', key: 'format_lint' },
				facts: { kind: 'biomeJson' },
				evidence: [evidence('biome.json', 'biome.json'), evidence('package.json', 'package.json')],
			},
			{
				id: 'biome-format-sample',
				name: '整形の before / after',
				responsibility:
					'「変換前」は整形していない TypeScript の入力、「Biome 適用後」は同じ入力を `biome format --stdin-file-path` に通した実際の出力です。',
				reason:
					'設定値の列挙だけでは 100 桁での折り返し方が伝わらないため、実バイナリの出力をそのまま掲載しています。再現手順と採否の記録は根拠リンク先の検証記録にあります。',
				version: { kind: 'none' },
				samples: [
					{
						label: '変換前（整形前の入力）',
						language: 'ts',
						code: BIOME_SAMPLE_BEFORE,
					},
					{
						label: 'Biome 適用後（biome format の実出力）',
						language: 'ts',
						code: BIOME_SAMPLE_AFTER,
						note: 'pnpm exec biome format --stdin-file-path=sample.ts < 入力.ts の stdout。末尾の改行を除き byte 一致。',
					},
				],
				evidence: [
					evidence('biome.json', 'biome.json'),
					evidence('biome-formatting.md', 'docs', 'verification', 'stack', 'biome-formatting.md'),
				],
			},
			{
				id: 'biome-compression-decision',
				name: '1行圧縮案との比較（保留）',
				responsibility:
					'「改行とインデントを潰して 1 行に圧縮する」案と、現行の `lineWidth: 100` による整形を、同じコードで比較します。',
				reason:
					'圧縮は formatter が維持する可読性 — 折り返し位置・trailing comma・字下げの一貫性 — と競合し、`lineWidth: 100` では Biome 自体がその形を再展開します。本番の format policy は変更せず、採否は保留として記録します。採用する場合は別 Issue で扱います。',
				version: { kind: 'none' },
				samples: [
					{
						label: '1行圧縮案（未採用）',
						language: 'ts',
						code: BIOME_SAMPLE_COMPRESSED,
						note: 'この入力を `biome format --write` に掛けると、幅超過のため下の「現行の整形結果」と同じ整形に再展開されます（引数名の差のみ）。',
					},
					{
						label: '現行の整形結果（lineWidth: 100）',
						language: 'ts',
						code: BIOME_SAMPLE_AFTER,
					},
				],
				evidence: [
					evidence('biome.json', 'biome.json'),
					evidence('biome-formatting.md', 'docs', 'verification', 'stack', 'biome-formatting.md'),
				],
			},
		],
	},
	{
		id: 'delivery',
		title: '品質ゲートとデリバリー',
		titleEn: 'Quality gates & delivery',
		description:
			'変更が本番に届くまでの経路です。ticket PR では `pnpm run validate:fast`、release PR と `main` への push では `pnpm run validate:integration` / `pnpm run validate:release` が走ります。release PR の merge・tag・Release 公開は owner の明示的な承認を経て、`main` への push を起点に Cloudflare Workers Builds が唯一の本番デプロイ主体として deploy します。',
		items: [
			{
				id: 'gate-fast',
				name: 'validate:fast',
				responsibility:
					'ローカルとすべての CI run で実行される高速 gate。`pnpm run validate:fast` が `run-quality-gates.mjs` 経由で `profile.yaml` の `gates.fast.components` を宣言された順に 1 コマンドずつ実行し、最初の失敗でその exit code のまま停止します。offline・read-only が契約です。',
				reason:
					'gate の構成は `profile.yaml` が唯一の宣言元で、workflow YAML に hidden step を置かない方針のため。安い検証をすべての変更で先に済ませます。',
				version: { kind: 'none' },
				evidence: [
					evidence('profile.yaml', 'quality', 'profile.yaml'),
					evidence('package.json', 'package.json'),
					evidence('run-quality-gates.mjs', 'scripts', 'run-quality-gates.mjs'),
				],
			},
			{
				id: 'gate-integration',
				name: 'validate:integration',
				responsibility:
					'release candidate の検証。`fast` の全成分を展開した上で `pnpm run build:production`、bundle budget と server-only module の gate、build 済み artifact の secret scan、Build Output contract、Storybook build、artifact attestation までを実行します。trigger は release PR・frozen SHA への `workflow_dispatch`・`main` への push です。',
				reason:
					'重い検証を ticket ごとではなく release candidate ごとに 1 回だけ走らせるため。ticket PR は `validate:fast` で merge します。',
				version: { kind: 'none' },
				evidence: [
					evidence('profile.yaml', 'quality', 'profile.yaml'),
					evidence('package.json', 'package.json'),
				],
			},
			{
				id: 'gate-release',
				name: 'validate:release',
				responsibility:
					'`main` へ merge する前の最終検証。`validate:integration` の全成分に加えて `pnpm run cf-typegen:check` を実行し、再生成される Worker 型が commit 済みのものと byte 一致しなければ失敗します。',
				reason: '型の乖離を release 前に検出するため。',
				version: { kind: 'none' },
				evidence: [
					evidence('profile.yaml', 'quality', 'profile.yaml'),
					evidence('package.json', 'package.json'),
				],
			},
			{
				id: 'workers-builds',
				name: 'Cloudflare Workers Builds',
				responsibility:
					'唯一の本番デプロイ主体。`main` への push で Cloudflare 側の build 環境が `pnpm run build` → `pnpm run deploy:production:prepared` を実行します。build phase が `.cloudflare/output` の Build Output を作り、deploy phase は rebuild せずその artifact を検証して ship します。',
				reason:
					'deploy に使う 2 つの command は runbook に記録され、`cf:config:drift:check` が package.json の script 名と記録の一致を fast gate で検査します。非 production branch の build は無効化されており、release PR の merge・tag push・GitHub Release 公開は owner の明示承認を要します。',
				version: { kind: 'none' },
				evidence: [
					evidence(
						'cloudflare-workers-builds.md',
						'docs',
						'runbook',
						'cloudflare-workers-builds.md',
					),
					evidence('release.md', 'docs', 'release.md'),
					evidence('cloudflare-config-drift.json', 'quality', 'cloudflare-config-drift.json'),
				],
			},
			{
				id: 'github-actions-delivery',
				name: 'GitHub Actions',
				responsibility:
					'本番デリバリーにおける検証専用の実行環境。`ci.yml` の validate job が format・lint・architecture・version・typecheck・test・build・wrangler dry-run を実行し、release PR と `ui-change` label の PR、`main` / release branch への push で Playwright E2E が走ります。`prod-smoke.yml` は operator が手動で起動する diagnostic で、push event には繋がっていません。',
				reason:
					'本番デプロイ権限は Cloudflare Workers Builds に限定するため、deploy 用の workflow は意図的に存在しません。',
				version: { kind: 'undetermined' },
				evidence: [
					evidence('ci.yml', '.github', 'workflows', 'ci.yml'),
					evidence('prod-smoke.yml', '.github', 'workflows', 'prod-smoke.yml'),
					evidence(
						'cloudflare-workers-builds.md',
						'docs',
						'runbook',
						'cloudflare-workers-builds.md',
					),
				],
			},
			{
				id: 'infisical',
				name: 'Infisical',
				responsibility:
					'runtime secret value の source of truth（`prod` / `dev` environment）。Universal Auth の Machine Identity で deploy 経路が secret を取得し、operator 向けの照合は status-only 出力（`MATCH` / `DIFFER` / `MISSING` / `PRESENT`）に限定されます。secret 値は stdout・log・argv・commit のいずれにも出ません。',
				reason:
					'runtime secret は Cloudflare から再読できないため別 store が必要です。static な非 secret 変数と identifier は Wrangler config、Workers Builds の API token は Cloudflare UI に残す境界です。',
				version: { kind: 'none' },
				evidence: [
					evidence('infisical-secrets.md', 'docs', 'runbook', 'infisical-secrets.md'),
					evidence(
						'ADR-0015-infisical-env-management.md',
						'docs',
						'adr',
						'ADR-0015-infisical-env-management.md',
					),
					evidence('deploy-with-secrets.mjs', 'scripts', 'deploy-with-secrets.mjs'),
				],
			},
		],
	},
	{
		id: 'component-integration',
		title: 'コンポーネント統合の実例',
		titleEn: 'Component integration example',
		description:
			'独立した feature が「データ契約 → 表示 component → Storybook preview → 薄い route adapter」の順にどう接続されるかを、実在する 1 つの component で示します。対象は `/` トップの「現在地」セクション（CurrentProjects）です。各項目の検証状況は pass / fail / not run / not applicable で区別しています。',
		items: [
			{
				id: 'current-projects-contract',
				name: 'CurrentProjects — データ契約',
				responsibility:
					'`home/current/types.ts` が所有する `CurrentProjectRecord` / `ProjectFact`。継続・稼働・注力の 3 軸を「値 + 出典（handwritten / git / github）+ 観測日」の fact として保持し、出典の違う値を区別します。',
				reason:
					'出典の異なる値を 1 つの列に混ぜると、手書きの記憶が commit と同じ確かさに見えてしまうため。preview と route が同じ型を読むことで、表示側は出典を偽れません。',
				version: { kind: 'none' },
				evidence: [
					evidence('types.ts', 'src', 'home', 'current', 'types.ts'),
					evidence('source.ts', 'src', 'home', 'current', 'source.ts'),
				],
				checks: [
					{
						id: 'contract-single-vocabulary',
						label: 'preview と route が同一のデータ契約を共有する',
						status: 'pass',
						note: '`CurrentProjects.stories.tsx` の Shipped story と `/` route の loader が、どちらも `CurrentProjectRecord[]` を同じ `CurrentProjects` component に渡します。',
					},
				],
			},
			{
				id: 'current-projects-component',
				name: 'CurrentProjects — 表示 component',
				responsibility:
					'`home/current/CurrentProjects.tsx`。record を継続・稼働・注力の軸で描画し、無い fact は省略して placeholder を置きません。描画判断はこの component に閉じています。',
				reason:
					'Storybook と route の両方がこの 1 つの component を mount するため、preview で見える組版は route が出す組版と同じ実装です。',
				version: { kind: 'none' },
				evidence: [
					evidence('CurrentProjects.tsx', 'src', 'home', 'current', 'CurrentProjects.tsx'),
					evidenceDir('current/', 'src', 'home', 'current'),
				],
				checks: [
					{
						id: 'component-single-implementation',
						label: 'preview 用と route 用で実装を複製していない',
						status: 'pass',
						note: 'story も route も `CurrentProjects.tsx` を直接 import します。preview 専用の写しは存在しません。',
					},
				],
			},
			{
				id: 'current-projects-preview',
				name: 'CurrentProjects.stories — Storybook preview',
				responsibility:
					'`Shipped` story は `currentProjectsFor(TODAY)` を呼び、route と同じ committed source（`roster.ts` の手書き値と `git-facts.json` の git snapshot）を合成して描画します。独立 preview はこの story です。',
				reason:
					'preview が独自 fixture を持たないため、Storybook で見えるものは route が読むのと同じ合成経路の結果です。検証画像は `capture-home-current-projects.mjs` が story の `render()` 出力から生成します。',
				version: { kind: 'none' },
				evidence: [
					evidence(
						'CurrentProjects.stories.tsx',
						'src',
						'home',
						'current',
						'CurrentProjects.stories.tsx',
					),
					evidence('loader.ts', 'src', 'home', 'current', 'loader.ts'),
					evidence('git-facts.test.ts', 'src', 'home', 'current', 'git-facts.test.ts'),
					evidence('parity.test.ts', 'src', 'home', 'current', 'parity.test.ts'),
				],
				checks: [
					{
						id: 'preview-same-sources',
						label: 'preview が route と同じ committed source を合成する',
						status: 'pass',
						note: '`currentProjectsFor` は `currentProjectsLoader` と同じ `PROJECT_ROSTER` と `FACT_SOURCES`（手書き + git snapshot）を使います。`git-facts.test.ts` が合成結果を pin しています。',
					},
					{
						id: 'preview-route-identical-output',
						label: 'preview と route の表示 record 集合が完全一致する',
						status: 'not-applicable',
						note: 'route はさらに GitHub activity snapshot 由来の `gh-*` record を merge するため、record 集合全体は一致しません。実測では preview が roster 由来 4 件、route が 16 件（同一の 4 件 + `gh-*` 12 件）で、home/current の parity テストが roster 由来 record の同一性（順序・公開 field を含む）を pin しています。集合全体の完全一致は意図的に保証範囲外です。',
					},
					{
						id: 'github-merge-parity',
						label: 'GitHub merge 後の record 集合を preview と突合する',
						status: 'pass',
						note: 'home/current の parity テストが commit 済み activity snapshot を入力に route の merge 経路を実行し、preview の全 roster record が同じ順序・同じ公開 field で残り、追加分が `github` source の `gh-*` record のみであることを確認しています（roster 4 件 + `gh-*` 12 件 = 16 件）。live D1 snapshot の選択規則は home/activity の live テストが担保します。',
					},
				],
			},
			{
				id: 'current-projects-route',
				name: 'routes/index.tsx — thin route adapter',
				responsibility:
					'`/` route は `getCurrentProjects` server function を呼ぶだけで、合成は server 側の `currentProjectsLoader` が行います。route が持つのは chrome と loader 呼び出しだけです。',
				reason:
					'合成に必要な committed artefact（roster・git snapshot）を client bundle に載せないため、server function の境界の内側で解決します。',
				version: { kind: 'none' },
				evidence: [
					evidence('index.tsx', 'src', 'routes', 'index.tsx'),
					evidence('load.ts', 'src', 'home', 'current', 'load.ts'),
					evidence('composer.tsx', 'src', 'home', 'composer.tsx'),
				],
				checks: [
					{
						id: 'route-no-composition',
						label: 'route がデータ合成を所有しない',
						status: 'pass',
						note: '`routes/index.tsx` は `getCurrentProjects({ data: { today } })` を呼び、結果を `HomePage` に渡すだけです。',
					},
					{
						id: 'other-locale-render',
						label: 'fr / de / pt / ru locale での描画を確認する',
						status: 'not-applicable',
						note: 'サイトに locale 別 route は存在せず（route tree は flat で `/fr` 等を持たない）、`statusJa` は契約上の日本語の文です。i18n の fr / de / pt / ru は見出し glyph の fixture で locale routing ではなく、Home の locale 集合（en / ja / ko）は Intl 整形専用で CurrentProjects はこれを使いません（derive の整形は locale 非依存）。他言語 locale での描画という検査対象が存在しません。',
					},
				],
			},
		],
	},
];
