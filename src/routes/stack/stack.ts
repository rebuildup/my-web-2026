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
];
