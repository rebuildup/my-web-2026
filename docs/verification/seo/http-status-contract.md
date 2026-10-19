# 404 / 500 / noindex と公開可否の HTTP 契約（Issue #419）

> Issue #419 の検証成果物。対象は「この URL に対して Worker は
> どの status を返し、どの `robots` meta とどの document を返すか」という
> HTTP 契約と、その契約が route 全体を網羅していることを証明する仕組み。

## 1. 何を宣言したか

宣言は `scripts/_seo-status-contract.mjs`（純粋ロジック、26 case / 15 route）。
1 case = 1 request class で、以下を固定する。

| 列 | 意味 |
| --- | --- |
| `route` | `src/routeTree.gen.ts` のどの route に対する case か |
| `request` | 実際に投げる request（fixture の条件も含む） |
| `expect.status` | 返すべき HTTP status（redirect は 3xx のいずれでも可） |
| `expect.robots` | 配信 document が持つ `<meta name="robots">` の状態（`absent` / `noindex`） |
| `expect.surface` | 訪問者が着く surface（`page` / `not_found` / `service_unavailable` / `tools_not_found` / `redirect`） |
| `sitemap` | `sitemap.xml` への掲載可否 |
| `proves` | この case を実行しているファイル（gate が参照文字列として検査する） |
| `openDecision` | 既知の不備。`docs/verification/ops/error-state-gallery.md` §7 を参照 |

### 既存契約との役割分担

| 契約 | 答える問い | request を投げるか |
| --- | --- | --- |
| `scripts/_index-boundary.mjs`（#423） | どの URL を crawl / index してよいか（方針） | いいえ（source と robots.txt を読む） |
| `src/editorial/error-states/contract.ts`（#501） | failure surface が何を公開するか | いいえ |
| `scripts/_seo-status-contract.mjs`（本 Issue） | response **status** は何か | 宣言側はいえ（実測は別ファイル） |

## 2. 誤 200 を落とした仕組み

受け入れ条件「誤200や未公開コンテンツのindexable応答をfail」に対して、
`portfolio_project` に 4 状態（`public+published` / `draft` / `unlisted` /
`archived`）+ 未登録 slug を seed し、それぞれに case を置いた。

| 条件 | 期待 | どこで実測 |
| --- | --- | --- |
| `public + published` | 200 / robots なし / 通常の page | workerd + ブラウザ |
| `draft` | 404 / `not_found` | workerd + ブラウザ |
| `unlisted` | 404 / `not_found` | workerd + ブラウザ |
| `archived` | 404 / `not_found` | workerd |
| 未登録 slug | 404 / `not_found` | workerd |
| `/portfolio` 一覧 | 未公開 slug への link を出さない | workerd |
| `/sitemap.xml` | `public+published` の行だけを `<loc>` に載せる | workerd |

判定は `evaluateObservation()` に observation を食わせて行うため、
suite 側で期待値を書き直す余地がない（`status-mismatch` /
`robots-mismatch` / `surface-mismatch` の違反コードで必ず落ちる）。

## 3. 無言の合格を許さない仕組み

`pnpm run seo:status:check`（`validate:fast` のコンポーネント）が検査する。

| 違反コード | 意味 |
| --- | --- |
| `unclassified-route` | route tree にある route に対応する case がない |
| `stale-case` | case が指す route がもう存在しない |
| `unproven-case` | case が名指す proof ファイルが無い、または case id を引用していない |

つまり **「書かれたが誰も実行していない行」** と
**「レビューされていない新しい route」** はどちらも build failure になる。

## 4. 実測（2 層）

| 層 | ファイル | 何が証明されるか |
| --- | --- | --- |
| workerd | `test/integration/seo-status-contract.test.ts` | `SELF.fetch` → `src/server.ts` を通した実 SSR 応答の status / robots / surface |
| ブラウザ | `e2e/seo-status.spec.ts` | 実ブラウザが受け取った document の描画、DOM 上の `meta[name=robots]`、admin の redirect |

2 層は**同じ契約・同じ evaluator** を読む。ブラウザ側の assertion が
HTTP 側の assertion より弱くなることはない。

loader 失敗 case は実際に `DROP TABLE portfolio_project` を実行して本物の
失敗を作る（pool の isolated storage がテスト後に戻す）。schema が無い
ときの 500 は fixture の偶然であって契約ではないため、evidence にならない。

## 5. 既知の不備（隠していない 4 行）

`service_unavailable` のラベルは `503` だが、TanStack Router は loader 失敗を
`500` で返す。以下 4 行は**現状値をそのまま固定**し、`openDecision` で
§7 を参照させている。丸めて「503 になるべき」とは書いていない。

| case | 実測 status | 不備 |
| --- | --- | --- |
| `portfolio-loader-failure` | 500 | §7 #2（外部契約の変更。monitoring / cache / retry に影響） |
| `portfolio-invalid-slug-loader-failure` | 500 | §7 #8 (b)（slug 検証を `validateParams` へ移す判断） |
| `portfolio-invalid-query-input-failure` | 500 | §7 #8 (a)（恒久入力失敗を 400/404 にするか） |
| `admin-invitations-accept-invalid-token` | 500 | §7 #8 (a)（同上） |

なお **failure document には `robots` meta を載せない**。de-index は status
（404 / 5xx）が担う。`noindex` を載せるのは「200 で crawler に応答するが
index には入れない」2 箇所（`/tools/$slug` と admin subtree）だけである。
これは Issue #423 の robots.txt 設計（`Disallow` しない）と表裏一体で、
どちらか一方と食い違うと gate が落ちる。

## 6. 再現手順

前提: Node 22.18 以上、pnpm 12.3.x、Chromium（`pnpm run e2e:install`）。

```bash
# 1. 宣言の網羅性（validate:fast に組み込み済み・CI でも毎回走る）
pnpm run seo:status:check
pnpm run seo:status:check -- --report        # 全 case の表 + open decision

# 2. HTTP 層の実測（workerd）
pnpm exec vitest run test/integration/seo-status-contract.test.ts

# 3. ブラウザ層の実測（local origin のみ）
pnpm run build
pnpm exec playwright test e2e/seo-status.spec.ts

# 4. スクリーンショットの再生成
pnpm run capture:seo-status
```

### 期待結果

| 手順 | 期待 |
| --- | --- |
| `seo:status:check` | `seo status contract OK: 26 cases (200×10, 401×1, 404×6, 500×4, redirect×5) over 15 routes, 4 row(s) with a recorded open decision` / exit 0 |
| `vitest run seo-status-contract` | 28 tests green |
| `playwright test e2e/seo-status.spec.ts` | 14 tests green |
| `capture:seo-status` | `docs/verification/seo/404-and-500-state.webp` 写出。2 枚とも `contract=MATCH` |

撮影対象 URL（local origin のみ。production へはアクセスしない）:

| URL | 期待する応答 |
| --- | --- |
| `http://127.0.0.1:<port>/this-route-does-not-exist-419` | 404 / `not_found` surface |
| `http://127.0.0.1:<port>/portfolio?facets=a&facets=b` | 500 / `not_found` surface（§7 #8 (a) の gap） |

## 7. 画像

- `404-and-500-state.webp` — Issue が要求する
  `docs/verification/seo/404-and-500-state.png` の `.webp` 版。
  中間 PNG はディスクに書かず、メモリ上の Buffer を `sharp` で
  WebP に再エンコードしている（`scripts/capture-seo-status-report.mjs`）。
- 画像には 2 枚の**実応答のスクリーンショット**（404 / 500）と、
  宣言された 26 case の表、suite の実行結果が表示される。
  status / `robots` / surface の表示値はすべて実応答から読み取って
  おり、`evaluateObservation` の判定（MATCH / MISMATCH）と一致する。
  スクリーンショットだけで合格を主張しないため、再現コマンド・URL・
  期待結果は上表に記載する。
- 画像のレイアウトは `scripts/_seo-status-report.mjs`（純粋関数）にある。
  `scripts/capture-seo-status-report.test.mjs` が escape・件数・ verdict
  表示を固定しており、report が「期待値を表示するだけ」になる退行を落とす。