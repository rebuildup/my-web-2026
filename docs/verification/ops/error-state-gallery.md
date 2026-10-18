# エラー状態のギャラリー — 404 / 503 / 依存取得失敗の復帰導線 (#501)

- 対象: `src/editorial/error-states/**`（failure surface の contract + 3 component）と、その router への結線 `src/router.tsx`
- Issue: #501（`ops(reliability): エラーページの復帰・再試行の導線を整備`）
- 成果物: `docs/verification/ops/error-state-gallery.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/editorial/error-states/error-states.stories.tsx` の `Editorial/ErrorStates` → `Gallery`（shipped story を harness が直接 import して描画） |
| capture 手段 | `pnpm run capture:error-states`（`node scripts/capture-error-state-gallery.mjs`。`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 2768 px、**114 kB** WebP（quality 80、budget 300 kB） |
| Node / OS | v26.x / darwin arm64 |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

Issue は `.png` 経路を指定しているが、本リポジトリで **初めて commit する画像 artefact** であり、PNG のままでは 1440x2768 の本文稠密画面に対して検証 artefact として大きすぎる（117,188 bytes → WebP 114 kB、quality 80、budget 300 kB）ため **`.webp`** を commit した。`scripts/capture-error-state-gallery.mjs` は `.webp` 以外の出力先を拒否し、中間 PNG は削除する。

## 2. 画面が示している条件

画像の 3 段が、そのまま 3 つの failure surface に対応する。

1. `not_found` — route が一致しない、または loader が `notFound()` を投げたとき。**加えて、URL がその route 自身の入力検証（`validateSearch` / `validateParams` / `loaderDeps`）に落ちたときも同じ kind で返す**（§5 / §6）。HTTP 404。
   - 提示: 「戻る」+ **代替面 5 つすべて**（`/` `/portfolio` `/about` `/tools` `/contact`）。
   - **retry は無い**。存在が確定していない URL を再要求しても成功しないため。押しても効かない操作は訪問者に「ボタンは無視される」という習慣を养成するだけ、という判断。
2. `service_unavailable` — loader か SSR render が throw したとき（プラットフォーム側が応答できない）。
   - loader 失敗は router の `defaultErrorComponent` が返す。route component 自体が SSR 中に throw する場合は React の Error Boundary では捕まらないため、`src/server.ts` が document 全体を standalone の fallback document に差し替える（§5.1）。fallback も同じ `contract.ts` の文言・代替面を使う。
   - 提示: **再試行**（第一導線）+「戻る」+ **binding を読まない面のみ**（`/tools` `/contact`）。
   - 再試行は click handler を持たない anchor で、失敗 URL（pathname + query）への document 遷移。hydration 前後で挙動は同じ（理由は §6）。
   - 公開文言は binding 名を**名指ししない**。公開面はどちらの binding が壊れたか知らないので、断定すれば推測になるため。
3. `dependency_failure` — ページ自体は描画できたが、前提データの取得が失敗したとき。
   - 提示: 再試行（第一導線）+「戻る」+ binding を読まない面のみ。
   - 外部サービスの identity / payload / SLA は公開しない。

## 3. 公開情報 / 非公開情報の監査表

宣言は `src/editorial/error-states/contract.ts` にあり、テストで固定している。

### 公開する情報

| 項目 | 値 |
| --- | --- |
| failure kind と status label | `404` / `503` / `Dependency` |
| 説明文言 | 日本語 + 英語（日 → 英、` / ` 区切り。repo 内固定定数、リクエストごとの生成なし） |
| 復旧導線 | back / retry / alternative（kind ごとに宣言。宣言していない操作は描かない） |
| 代替面 | href + label（`PUBLIC_NAV_ITEMS` の 6 面のうち `/design-system` を除いた 5 面の部分集合。絶対 URL は出さない） |
| 訪問者個人情報 | **なし**（session / account / IP / UA / referrer を一切出さない） |

### 公開しない情報

| クラス | 備考 |
| --- | --- |
| throwable（message / stack / `cause`） | component に `error` prop が存在しない。描画経路が構造的に無い |
| binding 詳細（SQL / row count / D1 database id / R2 key） | 公開文言は binding 名すら出さない |
| runtime 識別子（request id / colo / Worker version / env 名） | 出さない |
| 第三者サービスの identity / SLA | promoted な外部 integration が存在しない（`docs/domain/integrations.md`） |

### 既知の例外（測定済み・隠していない）

**SSR ハイドレーション payload `$_TSR` には、失敗した match の `error.message` が乗る。**

- 経路: TanStack Router の `Match.tsx` が match state を payload に載せる際、フレームワーク同梱の `ShallowErrorPlugin` が `Error` を `{ message }` のみに直列化する（`NODE_ENV` による分岐は無い）。
- つまり **stack と `cause` は出ないが、message は page source に出る**。どの message が乗るかは loader の throw 契約に依存する。`release-0-6-3` で merge した Issue #457 以降、`/portfolio/**` と `/about` は `src/portfolio/public-errors.ts` で `portfolio_unavailable (ref=…)` に正規化されるため、この経路では binding 詳細は乗らない。正規化していない loader は依然として `D1_ERROR: no such table: …` のような runtime message を載せうる。
- component 側から除去する手段は無い。唯一の手段は custom `startInstance` だが、AGENTS.md §2 により ADR 無しでは導入不可。
- `test/integration/error-states.test.ts` が両方を固定している。(a) 訪問者が読む document には一切含まれない / (b) payload は `new Error("<message>")` 1 個のみで stack を含まず、`/portfolio/<unknown>` では #457 の redaction 契約どおり `portfolio_unavailable (ref=<16 hex>)` になる。将来フレームワークが payload に情報を増やしたら、または redaction 境界が失われたら、このテストが落ちる。
- SSR render 失敗ではこの例外すら残らない。React が出す `data-msg` / `data-stck` 付き error template を含む document 全体を `src/server.ts` が fallback に置き換えるため、message も stack も served HTML に入らない（§5.1 で実測）。

## 4. 外部通信と依存の監査

### 失敗 document が出しうる外部通信

| 相手 | 通信 | 起動側 | 可読性に必要か | 根拠 |
| --- | --- | --- | --- | --- |
| Google Fonts | stylesheet + font file | browser | **不要** | `src/routes/__root.tsx`（`media="print"` の非同期 CSS + inline flip） |
| Google Analytics 4 | measurement script + page_view | browser | **不要** | `src/editorial/analytics/GoogleAnalytics.tsx`（ID は任意） |
| 第三者 API | **無し** | — | — | `docs/domain/integrations.md`（Current state: promoted なし） |

SSR render 失敗時の standalone fallback document（§5.1）は、外部 stylesheet も analytics script も読み込まない（inline CSS と素の anchor のみ）。したがって第三者をすべて block した環境でも同じ内容が読める。

第三者をすべて block しても、failure メッセージはプラットフォームのフォントで読める。上表 3 行は `contract.ts#ERROR_STATE_EXTERNAL_COMMUNICATIONS` で宣言し、テストが「すべて `requiredForMessage: false`」「server 起点の行は 0 件」を固定する。

### 公開面と platform binding の依存表

| 面 | render 時の binding 依存 | 根拠 |
| --- | --- | --- |
| `/` | D1（access counter / reactions）、R2（media） | `src/routes/index.tsx` |
| `/portfolio` | D1 | `src/portfolio/public.ts` |
| `/about` | D1（experience subset） | `src/about/public.ts` → `src/portfolio/load.ts` |
| `/tools` | **無し**（build 時に `manifest.json` を import） | `src/tools/registry.ts` |
| `/contact` | **無し**（build 時に `channels.json` を import） | `src/contact/public.ts` |

503 / dependency_failure が代替面として提示するのは「依存が 0」の面だけ。これは推測ではなく上記 loader の実装から導出した表であり、loader を変更する PR は同じ commit でこの表を更新する義務がある（`contract.ts#PUBLIC_SURFACE_DEPENDENCIES` のコメントに明記）。`/design-system` は nav には載っているが loader が無く binding も読まないため、この表では**意図的に外して**いる。failure surface がデザインシステムを案内してよいかは公開ナビゲーションの判断なので §7 #6 に送る。

## 5. SSR での実測（CI が常時回す）

`test/integration/error-states.test.ts`（`SELF.fetch` → `src/server.ts` → TanStack Start → `getRouter()`）。スクリーンショットだけでは証明にならないので、実パイプライン側の観測を別途固定する。

| 観測 | 実測 |
| --- | --- |
| 未一致 URL の status | **404** |
| 未一致 URL の body | `<!DOCTYPE html>` + `<h1>` + `data-error-state="not_found"` + back link + 代替 5 link |
| framework 既定 `<p>Not Found</p>` | **無い**（旧既定の消滅） |
| loader 実失敗（`/portfolio/<unknown>`、local D1 に `portfolio_project` が無い） | status 500、body は **503 surface**（`<h1>` + 再試行 anchor）。`servedState` は `service_unavailable` に固定して検証（404 に緩지면落下を検知できない） |
| 再試行 anchor の href | 失敗 URL の pathname + router が正規化した search string（`?ref=newsletter` はそのまま往復。繰り返し指定された param はフレームワークが再直列化する） |
| framework 既定 "Something went wrong!" と `<pre>` 内の例外 | **無い** |
| 訪問者が読む document に throwable | **無い** |
| route 固有 404 の優先 | `/tools/<unknown>` は `data-testid="tools-not-found"`（router 既定の 404 state ではない） |
| **search 検証失敗**（`/portfolio?facets=a&facets=b`、`/admin/invitations/accept?token=<20 文字未満>` / token 無し） | status 500 / **404 surface**（`data-error-state="not_found"`）。**503 surface は出ない**。再試行 anchor も出ない（同じ不正 URL の再要求は成功し得ないため）。throwable も訪問者の document には出ていない。判定は `src/router.tsx#isPermanentInputFailure` が URL から行うので hydration 前後で同じ |
| search 検証は通り loader が失敗する URL（`/portfolio?facets=develop`、local D1 に `portfolio_project` が無い） | status 500 / **503 surface**（再試行 anchor あり）。同じ route でも「検証を通ったか」で kind が変わる |
| token 検証を通る `/admin/invitations/accept?token=<24 文字>` | 200、`data-error-state` なし（route 自身の view が描画される） |
| 正常 route の非回帰 | `/tools` は 200、`data-error-state` なし |
| cache | 失敗 document も `cache-control: no-cache`（`src/server.ts#applyHtmlCachePolicy` の HTML 分岐を継承） |

loader 失敗が 500 で返るのは TanStack Router の仕様であり、本 Issue のスコープ外。`service_unavailable` の `503` は「条件」のラベルであり、response status の対応は router レベルの設計判断が要るため §7 に送る。

### 5.1 SSR render 失敗（route component の throw）

React の Error Boundary は **server-side rendering 中の例外を捕捉しない**。route component が初回 SSR で throw すると、React は client-rendered boundary の marker (`<!--$!--><template …></template>`) を出し、TanStack Start の streaming handler は **200 のまま**部分的な document を返す。この場合 router の `defaultErrorComponent` は一度も描画されず、dev では例外 message と stack が served HTML に入る。

`src/server.ts` は SSR handler の HTML response を読み、marker を検出したら `src/editorial/error-states/ssr-fallback.ts#renderSsrFailureDocument` の standalone document に差し替える（`settleSsrDocumentResponse`）。文言・代替面・`data-error-*` 属性は hydrated surface と同じ `contract.ts` から導出する。

| 観測 | 実測 |
| --- | --- |
| throw する route component（実装中に一時 route を追加して測定。commit していない） | status **500**（元は 200）/ `data-error-state="service_unavailable"` / `data-error-fallback="ssr-render"` |
| 元の 200 document に含まれていた例外 message / stack | **served document から消える**（fallback に置換されるため） |
| retry anchor | 失敗 URL の pathname + query string（`?ref=newsletter` を保持） |
| 外部通信 | 無し（inline CSS、`<script>` 無し） |
| 非 HTML response / 正常 document | 変更しない（`settleSsrDocumentResponse` は `content-type` が `text/html` のときだけ読む。正常 document は同じ status / headers で再構築） |
| 回帰テスト（CI） | `src/editorial/error-states/ssr-fallback.test.ts` が dev / production 両方の React marker、query 保持、全 href の escape、throwable 非公開、stream reject、非 HTML の pass-through を固定 |

live の throw を commit した route で常時再現することはしない（壊れた route を出荷しないため）。代わりに response 層の変換を、React が実際に出す marker の形で固定している。

## 6. 残存リスク

- 失敗 surface は root layout の中に載るだけで、画面全体を覆う UI は無い。`role="alert"` を付けていないため、route error としてスクリーンリーダーへ announce されることは無い（回復導線は視覚・キーボード操作の双方から到達できる）。
- 代替面の表（§4）は手動維持であり、loader を変更した PR が更新し忘れると「開ける」と宣言した面が失敗する（契約違反であって security 違反ではないが、見落としやすい）。
- **復旧導線は全部、click handler を持たない素の document 遷移**（hydration 前 / 後 / JS 無効で同じ）。これは検討の結果であって単なる簡略化ではない。TanStack の `CatchBoundary#reset` は local state を clear するだけで loader を再実行せず、`MatchInner` は同じ `status: 'error'` match を再 throw するため、handler を繋いだ retry は「何も起きない + 本来有効だった遷移を `preventDefault()` で潰す」だけになっていた。`router.invalidate()` は実際に loader を再実行するが、**active な loader を全部**再実行し、対象 match が pending になって surface が一瞬 blank になる。「ここから出られるか」に答える手段としては、SSR 全体をやり直す document 遷移の方が単純で確実。
- **`validateSearch` / `validateParams` / `loaderDeps` の失敗は 404 surface に落ちる（今回対応）**。`/portfolio?facets=a&facets=b` や `/admin/invitations/accept?token=`（短い / 無し）は恒久的なクライアント入力エラーで、以前は `defaultErrorComponent` に着地して「システムの一部が応答していません」と表示され、再試行は**同じ不正 URL** を再要求していた（＝成功し得ない操作。404 で retry を置かない判断と同一の原則に反する）。`src/router.tsx#isPermanentInputFailure` が URL から route 自身の検証結果を引き直し、**既存の 404 surface** で返す。throwable は泄漏していない（実測済み）。判定は `props.error` ではなく URL から行う: hydration payload は framework の `SearchParamError` を素の `Error` として復元するため、`instanceof` だと hydration 前後で答えが変わる。
- **loader 内で入力を検証する route は、まだ 503 surface に落ちる**。`/portfolio/$slug` は slug を loader の中で `SlugSchema.parse` しているため、入力の検証が loader 失敗に吸収される。route が自分の入力を `validateParams` / `validateSearch` に移せば同じ判定経路に乗るが、route 側の契約変更なので本 Issue の外（§7 #8）。
- root loader（現状は `env.GOOGLE_ANALYTICS_MEASUREMENT_ID` を読むだけ）が失敗した場合、`@tanstack/react-router` は root route も `CatchBoundary` で包むため、`<html>` / `<head>` / `<body>` の shell を **`RootComponent` の代わりに 503 surface が描画**する（読めはするが document shell は無い）。現状この loader は失敗しないので到達しないが、root に binding 依存が増えた場合は fossilize させるべき挙動。
- **SSR render fallback の検出は React の marker (`<!--$!--><template`) に依存する**。framework が marker を変えた場合、fallback は発動せず元の 200 + error template に戻る。`ssr-fallback.test.ts` は現在の dev / production の形を固定しているので、React 更新で marker が変われば test が落ちる（silent には壊れない）。ただし live の throw を常時再現する route は無いため、「実際に throw したときに必ず置換される」ことの CI 証明は response 層の変換に限られる。
- **SSR render fallback は app shell / Panda CSS を使わない**。document を組み立てている React 自体が失敗しているため、router の CSS link や hydration script は取得できない。fallback は inline CSS の standalone document で、retry / back / alternatives は素の anchor。見た目は gallery の 503 surface と同一ではない（同じ公開契約・同じ copy）。また JS が無いため、fallback からの復帰は document 遷移だけになる（これは他の failure surface と同じ方針）。
- **SSR render 失敗はすべて fallback に置き換わる（保守的）**。React が部分的に client-render で復帰できるケースでも、部分的な document を返さず 500 + 完全な fallback にする。hydrated な client が後から復帰できる可能性より、「読める完全な document を返す」ことを優先した判断。
- **SSR document は entrypoint で一度 buffer する**。marker の有無は document 全体を見ないと判定できないため。TanStack Start は `progressiveChunkSize: Number.POSITIVE_INFINITY` で document を組み立ててから flush するので通常ページの TTFB への影響は小さいが、SSR 中に解決しない Suspense boundary を持つ route を将来追加した場合、その完了まで response が返らなくなる。現状 `/` の lazy picker は client 側の境界で、integration test の `/` 取得は完了している（`html-cache-policy.test.ts`）。streaming を維持したまま同じ保証をするには framework 側の error hook が必要で、本 Issue の範囲外。
- 検証画像は Storybook ではなく生成 harness で撮っている（理由は §7 #5）。harness は `.tmp/` に生成されるため、repo には残らない。

## 7. 未決事項（owner 決定が要るもの / follow-up）

| # | 内容 | なぜこの Issue で閉じないか |
| --- | --- | --- |
| 1 | `$_TSR` payload に `error.message` が乗る（§3） | component からは除去不能。`/portfolio/**` と `/about` は #457 で正規化済みだが、残る loader は個別に throwable を正規化するか、ADR を伴う framework レベルの変更が必要 |
| 2 | loader 失敗の response status を 503 にしたい | 外部契約の変更（monitoring / cache / retry 挙動に影響）。router レベルの設計判断が要る |
| 3 | `DependencyFailureState` の呼び出し元が無い | promoted な外部 integration が存在しないため、page レベルで upstream 失敗を報告する route が無い。contract / story / test として出荷し、捏造した失敗経路には繋いでいない |
| 4 | 依存表（§4）の手動同期 | loader 変更と同一 commit での更新が運用ルール。自動生成は現 roadmap 外 |
| 5 | Storybook の静的 build が manager-only | `@storybook/react-vite` がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack plugin が出力を奪う。本 Issue の capture は生成 harness で回避した。build 修正は別 ticket |
| 6 | `/design-system` を failure surface の代替面に含めるか | nav には載っているが loader / binding 依存が無いので「開ける面」には技術的に該当する。failure surface からデザインシステムを案内してよいかは公開ナビゲーションの判断であり、本 Issue が単独で決める話ではない（今は意図的に roster から外し、`/tools` `/contact` のみ提示している） |
| 7 | DOM レベルのテスト（`*.client.test.tsx`）が gate に載っていない | `pnpm run test:client` は happy-dom 用で、`validate:fast` にも CI にも入っていない。そのため「hydration 後の click が document 遷移のままである」ことは **element tree を walk する test**（`error-states.test.tsx`、CI で回る）で担保している。gate に DOM test を足すのは quality profile の変更なので別 decision |
| 8 | 恒久的な入力エラーの回答方法を 404 surface から専用 surface に上げるか | 今回の review fix で、`validateSearch` / `validateParams` / `loaderDeps` の失敗は**既存の 404 surface** で返すようにした（新しい copy / 4 番目の kind / route 固有 component は不要。404 の copy は原因に「入力の誤り」を既に挙げている）。残るのは 2 つの判断: (a) 400 / invalid request 専用の failure surface を公開契約として追加すべきか（現状は HTTP 的に厳密ではない 404 で応答し、response status も 500 のまま = §7 #2 と同じギャップ）、(b) loader 内で入力を検証している route（`/portfolio/$slug` など）を `validateParams` へ移すか |