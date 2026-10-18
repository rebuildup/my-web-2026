# Architecture

> 現在の source ownership を 1 ページで示す。判断理由は
> `docs/adr/`、実装詳細は source を参照する。

## Source ownership

my-web-2026 は 1 Worker / 1 repository の deployment monolith だが、
source は固定 layer や file type ではなく **obligation** で境界を作る。

obligation は、同じ規則・判断権限・ライフサイクルに支配される仕事の集合である。
path はその境界を見える形にした結果であり、path 自体を先に設計しない。

```text
src/
├─ home/
│  ├─ composer.tsx
│  ├─ hero.tsx
│  ├─ footer.tsx
│  ├─ capabilities/
│  │  ├─ capability.ts
│  │  ├─ registry.ts
│  │  └─ grid.tsx
│  └─ status/
│     ├─ health.ts
│     ├─ services.ts
│     ├─ load.ts
│     └─ tiles.tsx
├─ portfolio/
│  ├─ schema.ts
│  ├─ contract.ts
│  ├─ load.ts
│  ├─ media.ts
│  ├─ seed.ts
│  ├─ public.ts
│  └─ index.ts
├─ editorial/
│  ├─ tokens.ts
│  ├─ semantic-tokens.ts
│  └─ primitives/
├─ cloudflare/
│  └─ health.ts
├─ http/
│  ├─ hono.ts
│  └─ health.ts
├─ routes/
├─ server.ts
├─ client.tsx
└─ router.tsx
```

この tree は template ではない。新しい feature を追加するときに
`home/` と同じ形を複製しない。新しい仕事について owner / change reason /
dependency / lifecycle を確認し、その結果として必要な境界だけを作る。

## Current obligations

### `home/`

canonical home surface の composition と Home 固有の表示判断を所有する。

- `composer.tsx` — Home の reading order と page composition
- `capabilities/` — Home が公開する capability inventory とその表示
- `status/` — platform health を Home 上でどう説明するか
- `hero.tsx` / `footer.tsx` — Home 固有の public communication

Home は Cloudflare binding の probe 方法を所有しない。

### `portfolio/` (Issue #76, target 0.5.0)

employment-facing Portfolio surface の data model と publication contract を所有する。

- `schema.ts` — Project / Link / Media の TS 型 + Zod schema + 行 → 公開型 変換
- `contract.ts` — `PortfolioLoader` interface + DI seam 用 `PortfolioEnv`
- `load.ts` — D1 実装 + facet/visibility/limit filter。TanStack Start server-fn (`public.ts`) はここを呼ぶ
- `media.ts` — R2 media URL 合成 (foundation は `null` 返却、UI で placeholder 表示)
- `seed.ts` — `docs/personal/domain.md` で grounded されている project のみを seed
- `public.ts` — `createServerFn` ラッパー (handler 内で env 解決)

`portfolio/` は `home/` の peer obligation で、どちらもお互いを import しない。Cloudflare runtime とは DI seam (`createD1PortfolioLoader(env)`) 経由で結合し、テストでは偽 env を渡して workerd 依存を排除する。

### `editorial/`

現在の public surface が話す editorial visual language を所有する。

raw / semantic tokens と、その visual language の primitive をまとめる。
これは「全 UI component の共有置き場」ではない。別の visual language が必要に
なった場合、観測された同一 obligation がない限り自動的には統合しない。

### `cloudflare/`

Cloudflare runtime によって変更理由が決まる仕事を所有する。

現在は D1 / R2 health probe がここにある。Home は public-safe な health contract
だけを消費し、binding API や probe implementation を知らない。

### `http/`

外部 HTTP contract を所有する。

- `hono.ts` — external REST / webhook / OAuth / integration boundary
- `health.ts` — この boundary の stable health description

### `routes/` and runtime entries

`routes/` は TanStack Start の file-based routing contract によって場所が決まる。
`server.ts`, `client.tsx`, `router.tsx` も runtime/framework contract の
entrypoint である。

これらは technical name だが、単なる分類ではなく独立した外部契約を所有するため
有効な obligation boundary である。

## Dependency direction

```text
routes ───────────────▶ home
routes ───────────────▶ portfolio
home/status ─────────▶ cloudflare
home/status ─────────▶ http
portfolio ───────────▶ cloudflare (DI seam)
portfolio ───────────▶ editorial
home ────────────────▶ editorial
server ──────────────▶ http
```

逆向きは禁止する。

- `cloudflare/` は `home/` も `portfolio/` も知らない。
- `http/` は `home/` も `portfolio/` を知らない。
- `editorial/` は特定 surface を知らない。
- `portfolio/` は `home/` / `routes/` / `http/` を import しない (peer obligation)。
- framework route は Home / Portfolio を bind するが、Home / Portfolio は route file を知らない。

## TanStack Start / Hono boundary

```text
Cloudflare Worker
        │
        ▼
src/server.ts
        │
        ├─ /api/v1/* /webhooks/* /oauth/* /integrations/*
        │       ▼
        │   src/http/hono.ts
        │
        └─ everything else
                ▼
       @tanstack/react-start/server-entry
```

TanStack Start の default CSRF middleware を維持するため、custom
`src/start.ts` / `startInstance` は ADR なしで追加しない。

`/api/v1/*` は dispatch により TanStack Start に到達しないため、
外部境界は独自の Origin チェックを持つ: `csrfGuard`
(`src/http/middleware/csrf.ts`, `src/http/hono.ts` で `/api/v1/*` に
mount)。書込メソッドだけを検査し、fail-closed。契約・拒否コード・
運用上の影響は [`docs/security.md`](security.md#csrf) を参照。

UI から使う internal operation は TanStack Start server function とする。
第三者向け stable HTTP contract は Hono が所有する。

## How boundaries are evaluated

新しい boundary を作る前に最低限次を確認する。

1. **Obligation** — 何を守る仕事か。
2. **Change reason** — どの判断・契約が変わると変更されるか。
3. **Authority** — その判断を最終的に決める権限は何か。
4. **Dependency direction** — どこまでがこの仕事を知ってよいか。
5. **Lifecycle** — 何と一緒に生まれ、何と一緒に消えるか。

「同時に変更された」は boundary 仮説を検証する evidence であり、同一 obligation
であることの定義ではない。

物理的な directory 分離にもコストがある。独立した概念を見つけても、分離によって
blast radius / ownership / navigation が改善しないなら無理に directory を増やさない。

## Promotion and demotion

共有化は一方向ではない。

- local な実装が独立した contract / authority / lifecycle を持つようになれば昇格する。
- shared/cross-surface な boundary が 1 owner だけの仕事に戻れば、その owner の下へ降格できる。
- duplication は shared obligation の候補を示す evidence であって、統合の証明ではない。

将来利用されるかもしれない、という理由だけで shared layer や adapter を先に作らない。

## Persistence and deployment

Bindings は `wrangler.jsonc` が canonical source である。binding を変更したら
`pnpm run cf-typegen` を実行し、`worker-configuration.d.ts` を同じ PR に含める。

| Binding | Name | Purpose |
| --- | --- | --- |
| D1 | `DB` | Structured content |
| R2 | `MEDIA` | Blobs / media |
| Assets | `ASSETS` | Vite static assets |

SELF integration tests は local workerd / Miniflare 上の contract を確認する。
real Cloudflare resource smoke は release cut で確認する。

## Static assets

`public/` は `ASSETS` binding の on-disk projection である。Vite は `public/` を
`dist/client/` へ verbatim copy し、Cloudflare Workers Static Assets が配信する。

`run_worker_first` は未設定なので、asset server が先に path を照合し、一致すれば
**Worker コードを実行せずに** 応答する。`not_found_handling` も未設定なので、
一致しない path だけが Worker（`src/server.ts`）へ落ちる。

したがって静的資産を配信する legislation は route を書かずに済む:

- `src/routes/` に route 定義を追加しない
- `env.ASSETS` を触るコードを追加しない
- binding 変更・ADR・`pnpm run cf-typegen` は不要

現行の資産は `share/` namespace のみ:

| Path | URL |
| --- | --- |
| `public/share/procon2026/index.html` | `https://rebuildup.dev/share/procon2026/` |
| `public/share/procon2026/assets/**` | `https://rebuildup.dev/share/procon2026/assets/*`（HTML からの相対参照） |

### 規約: `public/share/<slug>/index.html`

共有したい静的 HTML 文書の置き場所は **directory + `index.html`** とする。
`html_handling` は未設定 = Cloudflare default の `auto-trailing-slash` で、
実仕様は次の通り:

| Request | 結果 |
| --- | --- |
| `/share/<slug>/` | 200 — `share/<slug>/index.html` を配信 |
| `/share/<slug>` | 307 → `/share/<slug>/` |
| `/foo.html`（単体 file） | 307 → `/foo`（拡張子が strip される） |

`.html` で終わる名前でも、拡張子なしの URL（`/share/<slug>/hexaudon`）には到達
できる。ただしその場合 canonical URL は「末尾スラッシュなし・拡張子なし」の単数形に
固定され、**directory 形の URL**（`/share/<slug>/`）は作れない。`auto-trailing-slash`
が trailing-slash を付けるのは index 解決だけ（`/foo` → `/foo/`）であり、単体
`.html` file に対しては逆に拡張子を落とす（`/foo.html` → `/foo`）。

共有物を directory 形の URL で公開したい場合は directory + `index.html` が必要。
本規約は後者を採用している。

- `<slug>` = 共有対象の識別子。小文字・ハイフン区切り。
- 1 共有 = 1 directory。`index.html` がその文書そのもの（別 layer の
  landing page は作らない）。
- 同一 directory に付随ファイルを置いてもよい（同一 origin なので相対 path は
  動く）。ただし root 絶対 path `/foo` は壊れる — Static Assets は path を
  rewrite しない。

### 制約

- **per-file 上限 25 MiB。** 超過すると deploy が hard fail する。資産を
  差し替える前に size を確認する。
- 1  版ごとに git blob が同 size 増える。共有物が 3 件（約 47 MiB）に達したら
  git-lfs または R2（`MEDIA`）への移管を再評価する。
- `vite build` と `wrangler deploy` のたびに同 size が再 upload される。

### 意図的に作らないもの

`/tools/` には `scripts/build-tools.mjs` + `check-tools-manifest.mjs` という
manifest 駆動の生成 precedent がある。ただし shared namespace については
**それらを導入しない**。共有物が 2 件目になった時点で contract が観測され、
その時点で実 instance 2 つに対して設計して昇格する。現時点の実装は 1 件であり、
将来利用されるかもしれないという理由だけで abstraction を先に作らない
（AGENTS.md §3 / ADR-0008）。

## Verification

Architecture boundary の変更は path の見た目だけで承認しない。
代表的な change scenario を当て、変更が想定 owner に局所化されるか確認する。

- Home に section を追加する → `home/` と route binding 以外へ不要な変更を漏らさない。
- D1 / R2 probe を変更する → `cloudflare/` が変更を所有し、Home composition は維持する。
- editorial spacing を変更する → `editorial/` が変更を所有し、platform code は触らない。
- routing convention を変更する → `routes/` / runtime entry が変更を所有し、Home の意味を変えない。

詳細は ADR-0008 を参照する。

### Storybook story の ownership（Issue #509）

Storybook story は feature-local UI の preview 対象である。preview は browser で
走るため、binding も Worker runtime も存在しない。よって story の **実行時
import closure** は、その obligation の中に収まっていなければならない。

`scripts/check-storybook-ownership.mjs`（`pnpm run storybook:ownership:check`、
`validate:fast` に配線済み）がこれを機械的に検証する。主語（subject）は
`.storybook/main.ts` の `stories` glob が実際に宣言した story だけであり、glob の
非 glob 部分を walk の起点にするため `src/` 外に宣言された story も対象になる。
`stories` 配列に文字列リテラル以外（spread、テンプレートリテラル等）がある、
glob が repository 外を解決する場合は「主語集合が読めない」ものとして exit 2 に
する（黙って狭い集合を pass にしない）。foreign boundary は次の
5 種で、いずれも browser preview では解決・実行できない。

- `src/routes/**` — file-route contract。import すると route tree 一式が入る。
- `src/server.ts` — Worker runtime entrypoint。
- `src/http/**` — 外部 HTTP boundary (Hono)。
- `src/cloudflare/**` — binding を所有する obligation。
- `cloudflare:workers` — Workers virtual module。

**除外（理由つき）**

- 上記のうち **path の 4 種**（`src/routes/**` / `src/server.ts` / `src/http/**` /
  `src/cloudflare/**`）は本規則の *対象* であり *主語* ではない。owner 間の依存
  方向は `scripts/check-architecture.mjs` が所有しており、本 checker は preview が
  何をロードできるかだけを判定する（出力の `not applicable` 欄）。boundary 配下に
  置かれた story も主語にせず、`not applicable` として列挙する。
  `cloudflare:workers` は path ではないため、この欄には現れず、違反と
  known limitations（出力の最終段）に現れる。
- `import type` は `verbatimModuleSyntax: true` で build 時に消えるため到達と
  みなさない（AGENTS.md §3 の type-only edge、`home → http` が登録済み）。
- npm package / 生成物 `styled-system/` / 静的 asset は終端 leaf。`src/` 外の
  specifier が解決できない場合は `external` として表示する（生成物の codegen 未実行
  を CI の失敗にしないため）。
- **server-function seam**: `createServerFn` を value import する module は、
  preview が実際に import した export だけが client に到達する、という前提で
  扱う。クライアント側から見える export（と、それを参照する同ファイル内の宣言）
  だけを walk し、`.handler(…)` body 内の import は Worker 側でしか実行されない
  ので walk しない。named import は alias ではなく **import 元の export 名**で
  要求を解決し、default / namespace import は任意の export に触れ得るため
  handler 外の edge を保守的に walk する。edge 自体は隠さず `seam` として報告する。
  `src/home/reactions/widget.stories.tsx` のコメントと `.storybook/main.ts` の
  `external: ['cloudflare:workers']` が既に宣言している前提を refinements している。

**ソースの読み方** — import の照合は、コメント・文字列リテラル・テンプレート
リテラルを伏せた”上に対して行う。ドキュメントとして import 例を表示する story
が誤って違反になり、逆に import 形のコメントが server-function seam と読まれて
本物の違反が隠れることを防ぐ。

**判定の4状態** — `pass` / `fail` / `not run` / `not applicable`。`not run`
（`src/` 内で解決できない specifier がある、主語集合が読めない）は「green ではない」
として exit 2 にする。walk が不完全なまま pass を主張しないため。
fixture による検証は `scripts/check-storybook-ownership.test.mjs`。

**この checker が所有しないもの** — 「shared UI layer」の新設。違反を直す正しい
方法は、render できる部分を owner obligation へ移し loader の結果を prop として
渡すこと（`src/home/status/tiles.stories.tsx` がその形の参照実装）。route 層や
共通 UI を新設して境界を薄めることは本 checker の目的ではない。
