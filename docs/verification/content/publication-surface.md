# 公開面（publication surface）の監査範囲

> Issue #505 の companion 文書。`docs/verification/content/publication-diff-report.md`
> は機械生成の記録で、このファイルは「何を監査しているか」「何を公開しているか」
> 「何が外部と通信するか」「何が対象外か」を読む人が確認できる形に固定する。
>
> 出典（Issue 内の指定）: `docs/personal/knowledge-model.md`（visibility の意味論）、
> `docs/release.md`（sprint cycle）、ADR-0014（canonical production domain）、
> AGENTS.md §1 / §3 / §4。

## 1. この文書が固定するもの

`my-web-2026` は公開リポジトリかつ公開原点のプラットフォームです。したがって
*何が公開されているか* はコードの流派ではなく **契約** であり、放置すると次の
2 種類の事故が静かに起きます。

1. **意図しない公開面の縮小** — route / portfolio seed / tool manifest の変更で、
   訪問者が辿れなくなった URL がレビューで気付けられない。
2. **非公開データの混入** — 今まで公開していなかった surface が public に上げる、
   あるいは credential 入り URL や loopback URL が shipped source に混ざる。

そこで `scripts/publication-surface.mjs` が「公開面」を宣言的なデータとして持ち、
`scripts/check-publication-diff.mjs` が commit 済み snapshot と比較します。
判定は `pnpm run validate:fast` の一部として CI の `validate` ジョブで毎回走ります。

## 2. 監査対象（in scope）

| 対象 | 取得元 | 扱い |
| --- | --- | --- |
| route surface の分類（public / internal） | `scripts/publication-surface.mjs` の `SURFACE_DECLARATIONS` | route file との網羅性を検査し、漏れた route file は `E005` |
| sitemap 対象 URL | 同宣言の `sitemap: true` | 宣言表の出力であり、sitemap.xml の実体ではない |
| **公開到達可能 URL 全体**（sitemap 対象 + sitemap 外の public surface + 静的ページ） | 宣言の `classification: 'public'` の URL 展開 + `public/**` の HTML | **これが比較対象**。減ると `E001`（Issue の「review 必要」状態） |
| portfolio の公開 URL | `src/portfolio/seed.ts` の slug | seed は `visibility: 'public'` / `status: 'published'` で投入される契約（`migrations/0007_portfolio.sql` の DEFAULT と `scripts/seed-portfolio.mjs`） |
| tools の公開 URL | `src/tools/manifest.json` の `delivery.kind ∈ {same_origin_static, external_exception}` | `host_disabled` / `not_integrable_yet` は `/tools` 上で "Coming soon" になるだけで、リンク先 URL を持たない |
| Static Assets が直接配信する公開ページ | `public/**` の `.html` | `public/index.html` は `/`、`public/<dir>/index.html` は `/<dir>/`、その他はそのままの path。削除は `E001` |
| 外部 HTTP boundary | `src/server.ts` の `EXTERNAL_BOUNDARY_PREFIXES` | sitemap 対象外だが機械的な公開面。**prefix の増減も差分**（減ると `E012`、増えると `W005`） |
| 絶対 URL | `src/**` と `public/**` の shipped source（`*.test.*` は除外、`js` / `mjs` / `cjs` を含む） | first-party / external / identifier namespace に分類して差分を取る。`*.stories.tsx` も `src/**` にあるため監査対象に含める（Storybook は配信されないが、sample に外部 URL を置くと `E004` として記録される） |
| Tool iframe が実際に持ち込む外部 URL | 各 `same_origin_static` Tool の checkout の `index.html` と `public/**` | `/tools/<slug>/app/` として配信される document の由来。checkout が無い場合は `E013` で fail-closed |

## 3. 公開している情報（現在の記録）

`docs/verification/content/publication-surface.snapshot.json` が機械可読な正であり、
この節はその要約です。**数値は snapshot を正としてください**（手で書き換えない）。

### 3.1 sitemap 対象（13 URL）

- `/`, `/about`, `/contact`
- `/portfolio` と、portfolio seed 由来の `/portfolio/<slug>`
- `/tools` と、統合済み tool 由来の `/tools/<slug>`

### 3.2 公開到達可能だが sitemap に入れない surface

- `/design-system` — 公開到達可能。`SUPPRESS_BREADCRUMB_LEAF_IDS` と同じく
  editorial IA の外側に置く意図的な showcase なので sitemap 対象外。
- `/admin/login` — **公開が前提**。session が存在しない状態で到達できなければ
  ログインできません。loader は「サイン済みなら `/admin` へ redirect」だけを行います。
- `/admin/invitations/accept` — **公開が前提**。メールで届いた token を
  server-side で probe する landing page。project データも描画せず sitemap にもしません。
- `/share/procon2026/` — `public/share/procon2026/index.html` が Static Assets
  で直接配信する静的ページ。route ではないので宣言表には現れず、sitemap にもしません。

**公開到達可能 URL は合計 17 件**（sitemap 13 + sitemap 外の public surface 3 +
静的ページ 1）。`E001 removed-public-url` が比較するのはこの 17 件です。

### 3.3 非公開 surface

`/__root__`, `/admin`, `/admin/`, `/admin/invitations`, `/admin/keys`,
`/admin/images`, `/admin/emoji-catalog`。いずれも admin role の loader で
gate され、sitemap にも外部 host 集合にも現れません。

## 4. 外部通信と依存

### 4.1 訪問者がたどれる / ブラウザが取得する外部 host

`src/**` と `public/**`、および統合済み Tool が持ち込む document から観測された host を、
用途ごとに分けたものです。**新しい host の追加は `E004`（error）になります。**

- **フォント**: `fonts.googleapis.com`（stylesheet）、`fonts.gstatic.com`（font files）
- **計測**: `www.googletagmanager.com`（GA4 loader, `src/editorial/analytics/GoogleAnalytics.tsx`）
- **作者プロフィールと配布先**: `github.com`, `x.com`, `samuido.booth.pm`,
  `361do.booth.pm`, `yusuke-kim.com`（`src/contact/channels.json` は 30 日の
  freshness gate を通った channel だけを描画します）
- **`public/share/procon2026/` の静的ページが参照する第三者の資料**:
  `www.procon.gr.jp`, `www.naprock.jp`, `www.facebook.com`, `www.stat.go.jp`,
  `www.mlit.go.jp`, `www.mhlw.go.jp`, `www.maff.go.jp`, `design.google`,
  `developers.google.com`
- **Tool iframe（`/tools/prototype`）がフォント取得に使う host**: `use.typekit.net`
  （`external/prototype/index.html`）。この document の build 成果物がそのまま
  `/tools/prototype/app/index.html` として配信されるため、Tool 側が持ち込む host も
  監査対象に含めます。
- **到達できないリゾルバ用センチネル**: `redirect-guard.invalid`
  （`src/http/security/redirect.ts` の `PARSER_BASE`）。RFC 2606 の予約 TLD なので
  public DNS からは到達できず、URL parser の比較基準としてのみ使われます。

### 4.2 取得されない identifier namespace（`http://` を宣言的に許容）

XML namespace URI、sitemap schema の namespace IRI、JSON-LD context IRI、JSON Schema
dialect IRI、SPDX license identifier です。参照されるだけで browser / runtime が取得する
ことはないので `http://` を insecure 扱いしません。宣言は
`IDENTIFIER_NAMESPACE_HOSTS` に集約してあり、ここに無い host の `http://` は
`E007`（error）になります。

- `www.w3.org`（SVG namespace、`xhtml` namespace）
- `www.sitemaps.org`（sitemap schema namespace。`src/http/seo/sitemap.ts` が生成する
  XML document の `xmlns`。取得される対象ではない）
- `schema.org`（JSON-LD `@context`）
- `json-schema.org`（`src/tools/manifest.schema.json` の `$schema`）
- `www.apache.org`, `scripts.sil.org`（license identifier）

### 4.3 同一オリジンの機械的 boundary（sitemap 対象外）

`/api/v1`, `/webhooks`, `/oauth`, `/integrations`, `/sitemap.xml`, `/robots.txt`。canonical
origin (`https://rebuildup.dev`, ADR-0014) の下で配信され、`src/server.ts` が
prefix 一致で Hono と TanStack Start を振り分けます。URL 集合としては記録しますが、
sitemap target にはしません。**prefix の増減も差分対象**で、減ると `E012`（error）、
増えると `W005`（warn）になります。

## 5. 監査対象外（out of scope）とその理由

- **`docs/`, `e2e/`, `migrations/`, `scripts/`, `test/`** — 訪問者に配信されません。
- **`release-assets/`** — publication pipeline の入力であって shipped surface ではありません。
  既に `scripts/check-release-assets.mjs` が manifest 整合を gate しています。
- **Tool の build 成果物そのもの（`dist/client/tools/**`）** — `publication:check` は
  build より前に走るため成果物が存在しません。代わりに build の入力のうち訪問者に
  そのまま届く deterministic な部分、つまり各 `same_origin_static` Tool の
  `index.html`（build 後に iframe document になるファイル）と `public/**`
  （verbatim で複製される静的ファイル）を監査対象にしています。checkout が 1 つでも
  無ければ「監査できていない」ので、無かったことにせず `E013 tool-source-missing`
  で fail-closed にします（CI は submodule を checkout します。ローカルでは
  `git submodule update --init --recursive` が必要）。
  **残る gap**: bundler が JS chunk に注入する URL（lazy import 先の chunk、
  実行時に評価される文字列など）は build 後にはじめて現れるため、この gate では
  検出できません。
- **`external/` の Tool ソースのその他（lockfile / docs / アプリ本体）** — 上記の
  shipped ファイルは build 入力ではあるものの、訪問者のブラウザが取得する document に
  そのままなるのは `index.html` だけです。ただし bundler がアプリ本体から生成する
  JS chunk は build 後にしか存在せず、その中の URL は監査できません（上の gap と同じ）。
- **R2 media host `media.rebuildup.dev`** — `wrangler.production.jsonc` の
  `MEDIA_PUBLIC_BASE_URL` で宣言されますが、shipped source に URL literal が
  ありません（`MEDIA_PUBLIC_BASE_URL` を実行時に読むため）。したがって host 集合には
  現れません。**first-party host が 0 件なのはこの理由**であり、回帰ではありません。
- **sitemap.xml / robots.txt の実体** — この Issue は「sitemap 対象の比較」を
  作ることが目的で、sitemap 自体の配信は別 ticket の領域です。宣言表が唯一の正なので、
  sitemap を配信する段階ではこの表を使うことになります。
- **visual / layout** — 別 gate（`scripts/layout-audit-check.mjs`）の領域です。

## 6. 運用

```bash
pnpm run publication:check   # CI が走る判定。差分・網羅性・invariant を fail-closed で検査
pnpm run publication:write   # 公開面の変更を「承認」する。snapshot + report を再生成
```

公開面を変えた PR では `publication:write` を実行して
`docs/verification/content/publication-surface.snapshot.json` と
`publication-diff-report.md` を commit します。surface が変わっているのに記録が
更新されていない場合は `E011 stale-report` で red になります。

`--write` は snapshot を「現在の surface」に更新すると同時に、**承認した差分**を
snapshot 内の `approvedTransition` と report に保存します。次に surface が変わると
その差分が新しい `approvedTransition` になります。git history と合わせて
「いつ何が公開面へ入ったか・出たか」が追えます。

### 判定コード

| Code | severity | 意味 |
| --- | --- | --- |
| `E001 removed-public-url` | error | 公開到達可能 URL（sitemap 対象 / sitemap 外の public route / 静的ページ）が減った（Issue の「review 必要」状態） |
| `E002 public-surface-withdrawn` | error | public → internal への変更 |
| `E003 internal-surface-published` | error | internal → public への変更 |
| `E004 external-host-added` | error | 新しい外部 host（新しい外部依存） |
| `E005 undeclared-route-file` | error | 宣言されていない route file が `src/routes/` に存在 |
| `E006 orphan-surface-declaration` | error | 宣言が実在しない file を指す、または 2 重的 |
| `E007 insecure-external-url` | error | 取得される外部 URL が `http://` |
| `E008 external-url-with-userinfo` | error | URL に credential が埋め込まれている |
| `E009 loopback-or-private-host-url` | error | loopback / RFC 1918 / CGNAT / link-local / ULA / `.local` / `.internal` などの private host が shipped source にある |
| `E010 snapshot-missing` | error | snapshot が未記録（この schema で読めない snapshot もここに帰着する） |
| `E011 stale-report` | error | surface が変わったが記録が更新されていない |
| `E012 external-boundary-prefix-removed` | error | 外部 HTTP boundary の prefix が消えた |
| `E013 tool-source-missing` | error | 統合済み Tool の checkout が無く、iframe が持ち込む URL を監査できていない |
| `W001`–`W005` | warn | host / URL の増減、public URL の追加、boundary prefix の追加（レビュー対象、fail しない） |

`W004`（public URL の追加）と `W005`（boundary prefix の追加）が fail しないのは、
公開面が**減ること**が事故であると Issue が判断しているためです。追加はレビュー情報として
report と PR body に必ず残ります。