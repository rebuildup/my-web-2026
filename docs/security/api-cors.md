# API CORS — 外部 HTTP 境界の origin 契約

Issue #455 で導入。対象は実際に存在する `/api/v1/*` の全ルートと、
`/api/v1/*` 以外の境界プレフィックス（`/webhooks/*`, `/oauth/*`,
`/integrations/*`）の未実装分。

実装は [`src/http/cors/`](../../src/http/cors/README.md)、
仕様判断と運用契約は本ファイル。

## 1. 5つの問い（ADR-0008）

| 問い | 答え |
|------|------|
| Obligation | 外部 HTTP 境界が「どの origin から、どのメソッド・ヘッダで、どの認証形態で到達できるか」を決める。CORS ヘッダの生成と、許可されない cross-origin リクエストの拒否が責務。 |
| Change reason | `Access-Control-Allow-Origin: *` と credentials の組合せ、sandboxed iframe の opaque origin、攻撃者が指定した request header の echo — これらはブラウザの Fetch 仕様と Cloudflare Static Assets のヘッダ適用範囲で決まり、UI 側のフレームワーク都合では変わらない。 |
| Authority | `docs/security/api-cors.md`（本ファイル）＋ `src/http/cors/policy.ts` の `CORS_ROUTES`。allow-list に origin を追加する判断はリポジトリ owner（`BETTER_AUTH_URL` の値）だけが持つ。 |
| Dependency direction | `src/http/**` のみ。後述の「触ってはいけないもの」を参照。 |
| Lifecycle | 境界とともに生え、境界とともに消える。Tool Registry・Cloudflare バインディング・D1 スキーマのいずれにも依存しない。 |

## 2. ルートの分類

| クラス | パス | メソッド | 応答 |
|--------|------|----------|------|
| `credentialed` | `/api/v1/auth/*` | GET, HEAD, POST | 許可 origin を 1 つ echo + `Access-Control-Allow-Credentials: true` |
| `credentialed` | `/api/v1/access/hit` | POST | 同上 |
| `credentialed` | `/api/v1/access/count/:key` | GET | 同上 |
| `credentialed` | `/api/v1/reactions` | GET, PUT, DELETE | 同上 |
| `public-read` | `/api/v1/health` | GET, HEAD | `Access-Control-Allow-Origin: *`（credentials ヘッダは出さない） |
| `public-read` | `/api/v1/reaction-images/:id` | GET, HEAD | 同上 |
| `none` | `/api/v1/db/ping`, `/api/v1/media/ping` | GET | CORS ヘッダなし（body は script から不透明） |
| `none` | `/webhooks/*`, `/oauth/*`, `/integrations/*` | — | ルータ未実装。`OPTIONS` は従来どおり 404 |

`Access-Control-Allow-Methods` / `Access-Control-Max-Age` /
`Access-Control-Allow-Headers` は **preflight の応答にだけ**出す。
実リクエストの応答ではブラウザはこれらを読まない（読むのは
`Access-Control-Allow-Origin` と `-Credentials` だけ）ので、
意味を持たない surface を増やさない。プレフライト以外の行では
スクリーンショット上 `(absent)` になる。

`db/ping` / `media/ping` を `public-read` にしない理由: これは公開
データではなく運用診断だ。ワイルドカードを渡すと、任何のサイトから
本番 binding の生存探査（scriptable liveness probe）ができてしまう。
`test/integration/cors.test.ts#INTENTIONALLY_UNCLASSIFIED` に理由ごと
登録してあり、ルート追加／改名が片方だけで起きるとテストが落ちる。

`none` クラスの `OPTIONS` を 403 に変えない理由: 境界に存在しない
プレフィックスの 404 は「未実装」の観測可能なシグナルであり、policy
がそれを覆うと「まだ無い」のか「拒否された」のかが分からなくなる。
CORS の可否はヘッダの有無で観測できる。

## 3. allow-list の出どころ

origin リテラルはコードに持たない。実行時入力だけを使う。

1. **リクエスト自身の origin**（`new URL(request.url).origin`）。
   同一オリジンなので常に許可。これがあることで、
   `pnpm dev`（`http://localhost:3000`）、preview デプロイ、Worker の
   per-PR URL は設定なしで動く。
2. **`env.BETTER_AUTH_URL`**。Better Auth の `trustedOrigins`
   （`src/cloudflare/auth/better-auth.ts`）に与えられる値と完全に同一で、
   本番では `wrangler.production.jsonc` が
   `https://rebuildup.dev` に固定している。**ノブは 1 つだけ**で、
   2 つの面がずれることはない。

比較は正規化後の完全一致のみ。`startsWith` / suffix / substring 比較
（`https://rebuildup.dev.evil.example`,
`https://evilrebuildup.dev`, ポート違いを許すやつ）はすべて拒否
される。これは `policy.ts#isAllowedOrigin` のテストが
`policy.test.ts` で列挙している。

### 拒否される origin（固定）

- `null` — sandboxed Tool iframe の opaque origin。
- `https://rebuildup.dev.evil.example` などの look-alike。
- 許可 origin と scheme / host / port が 1 つでも違うもの。

## 4. 拒否の仕様（fail closed）

許可されない cross-origin リクエストは **403 + CORS ヘッダなし**で
返す。JSON body は安定した code のみ:

```json
{ "error": "cors_origin_rejected", "class": "credentialed" }
```

code は 3 種:

| code | 条件 |
|------|------|
| `cors_origin_rejected` | Origin が allow-list に無い（`null` 含む） |
| `cors_method_rejected` | プレフライトの `Access-Control-Request-Method` がそのルートがサポートしないメソッド |
| `cors_header_rejected` | プレフライトの `Access-Control-Request-Headers` が固定 allow-list（`authorization`, `content-type`）外 |

許可されたプレフライトは `204` + policy ヘッダで返す。

実リクエスト（preflight 以外）で credentialed に許可された場合は
echo + credentials だけが載る。`Vary: Origin` は CORS 分類された
全応答（`Origin` ヘッダ 無しのもの を含む）に付く。

### ヘッダを「レスポンス確定後」に載せる理由

Hono は `next()` の**前**に呼んだ `c.header()` を内部の
prepared-header バッグに保留し、それは context 自身が
`c.json()` / `c.body()` / `c.newResponse()` で作った応答にしか
載らない。生の `Response` を返す handler
（`src/http/auth/router.ts` の `auth.handler(c.req.raw)` と
`LOCAL_API_MODE=mock` ゲートの `mockApp.fetch(...)`）は
`context.res` を丸ごと差し替えるため、`next()` 前に置いた
ヘッダは黙って消える。**まさに `credentialed` の許可分岐**が
その経路を通るので、middleware は `await next()` の**後**に
確定済み応答へヘッダを載せる。Better Auth の
`Set-Cookie` は保存されることを
`src/http/cors/middleware.test.ts` が固定している。

Origin ヘッダのないリクエスト（SSR の self-call、`curl`、E2E）は
従来どおり handler に届く。変わるのは `Vary: Origin` だけ。これは
shared cache が「Origin 付きのリクエストに concrete な
`Access-Control-Allow-Origin` を持つレスポンス」を別リクエストに
再利用しないための必須条件で、クラス分類が origin で変わらない以上
害がない。

### なぜ preflight だけ拒否しないのか（実リクエストも拒否する）

`Content-Type: text/plain` の POST は CORS-safelisted で、ブラウザは
プレフライトを送らない。preflight だけをゲートにすると、
credentials 無しでも handler（＝D1 まで）は到達できてしまう。
そのため `credentialed` ルートは**実リクエストも**拒否する。同一
オリジンの実リクエストは Origin ヘッダが request origin と一致する
ので、§3-(1) により必ず許可される。

**副作用の正確な範囲（owner 未決の論点。§7 と併せて読むこと）**:
この判定は「このリクエストがブラウザから来たか」ではなく、`Origin`
ヘッダの有無だけで行う。したがって `Origin` を勝手に付ける非ブラウザ
クライアント（一部の SDK は付ける）は、同一オリジンからの呼び出し
でも `403 cors_origin_rejected` を受ける。§3-(1) の根拠は「同一
オリジンの実リクエストは `Origin` が request origin と一致するので
必ず許可される」であり、**同一オリジンの呼び出しにしか当てはま
ない**。CORS はブラウザの仕組みである以上、サーバ側ゲートは
ブラウザの script に対して何も買わない、というのがこの絞り込みの
根拠。したがって:

- **同一オリジンの呼び出し**: 副作用なし（§3-(1) で必ず許可される）。
- **別オリジンからの非ブラウザ呼び出し**: 従来は通っていたものが
  落ちる可能性がある。許可リストに無い origin を拒否する形へ意図的
  に変えた副作用として現れている。
- 拒否を「ヘッダを出さない（ブラウザに読ませない）」だけに留めるか、
  サーバ側 403 を残すかは **owner の判断事項**。本 Issue では
  fail-closed 側（403）を採っている。

## 5. 絶対条件（テストが機械的に検査する）

1. `credentialed` ルートは `Access-Control-Allow-Origin: *` を
   **決して**返さない。preflight でも、エラー応答でも。
   `policy.ts#credentialWildcardViolation()` が規則として実装され、
   `policy.test.ts`（純関数の全マトリクス）と
   `test/integration/cors.test.ts`（実際のレスポンスバイト）の両方で
   検証する。
2. `credentialed` ルートは `Origin: null` を返さない。
3. `public-read` ルートは `Access-Control-Allow-Credentials` を
   出さない（wildcard と credentials の併用は Fetch 仕様で無効）。
4. どのルートも `*` と credentials を同時に持たない。
5. 境界が実際に登録しているルートはすべて分類済み。
   未分類のまま残ったら `INTENTIONALLY_UNCLASSIFIED` に理由付きで
   載せる必要があり、登録漏れ・古い項目は両方向で検出される。
   対象は `externalBoundary.routes` だけでなく、`LOCAL_API_MODE=mock`
   の `createMockApp().routes` も含む（mock も到達可能な面なので）。
6. `credentialed` の許可分岐は**実際の応答バイト**に出る。
   `/api/v1/auth/*`（生の `Response` を返す handler）と
   `LOCAL_API_MODE=mock`（`mockApp.fetch(...)`）は
   `context.res` を差し替える経路なので、`next()` 前に置いた
   `c.header()` が消える。`test/integration/cors.test.ts` に
   `GET|POST /api/v1/auth/get-session` と mock の許可行／拒否行が
   あり、`src/http/cors/middleware.test.ts` が handler の
   `Set-Cookie` を保ったままヘッダが載ることを固定する。
7. preflight の `Access-Control-Request-Method: OPTIONS` は
   `cors_method_rejected`。`OPTIONS` は route 自身が preflight に
   答えるために持つだけで、応答するメソッド一覧には含まれないため、
   受理すると「要求されたメソッドを含まない 204」になる。

## 6. 既存 auth / security 境界への影響（運用契約）

本 Issue は既存 auth 境界を**変更**している。影響範囲:

| 対象 | 変更 | 運用上の意味 |
|------|------|--------------|
| `/api/v1/auth/*`（Better Auth） | 許可 origin 以外の cross-origin リクエストは Better Auth handler に到達せず 403 | Better Auth 自身の `trustedOrigins` チェックより**前**で効く。origin を増やしたいときは `BETTER_AUTH_URL` を 1 つ直すだけで両方に効く（ずれない）。拒否は `Origin` ヘッダの有無だけで判定するため、`Origin` を付ける非ブラウザ client も 403 になる（§4「副作用の正確な範囲」） |
| `/api/v1/access/*`, `/api/v1/reactions` | 同上。API key は header 経由なので、client 側は従来通り | 外部 integration が別 origin から叩く想定なら、それは明示的な owner 決定として別 ticket で扱う（§7） |
| TanStack Start の CSRF middleware | **変更なし**。`src/start.ts` は引き続き不在で、default middleware が有効 | CORS は SSR 面（`/`, `/admin/*`, `/_serverFn/*`）には一切ヘッダを出さない。`test/integration/cors.test.ts` が `/`, `/contact`, `/admin/login` でそのことを検証する |
| `LOCAL_API_MODE=mock` | middleware を境界の先頭に置いたので mock も同じ CORS 面を持つ | デザイナーが mock で別の CORS 面を見て、production と違う挙動を掴むことがない。ただしこの主張は「mount 順が正しい」だけでは成立せず、mock ゲートが生の `Response`（`mockApp.fetch(...)`）を返すため §4 の「確定後に載せる」が必須。`test/integration/cors.test.ts` に mock モードの許可行／拒否行がある |
| Cloudflare バインディング | **変更なし**（D1 / R2 / rate-limit / ASSETS に手を触れていない） | `pnpm run cf-typegen` の再実行は不要 |
| Tool Registry | **変更なし**（`src/tools/manifest.json` に手を触れていない） | §8 参照 |
| `public/_headers` | **変更なし** | §8 参照 |

`env.BETTER_AUTH_URL` の型は default typegen に含まれない（本番専用
text var で、`wrangler.jsonc` に書くと他の binding の型が狭まるため）。
読取りは `src/cloudflare/auth/better-auth.ts` と同じ cast で行う。
型定義は変えない — 既存の auth 境界の型面を動かさないため。

## 7. origin を増やしたい場合（未決の owner 判断）

現状、credentialed API を別オリジンから呼ぶクライアントは存在しない
（Home / Admin / API は同一オリジンで配信される。ADR-0014）。
そのため**許可 origin を拡張する仕組みを用意していない**。
`CORS_ALLOWED_ORIGINS` のような var を今足すのは、観測されていない
 必要性を先に作ることになる（AGENTS.md §3「pre-create しない」）。

必要になったら:

1. `docs/security/api-cors.md` の §3 に origin と理由を追記する。
2. `BETTER_AUTH_URL` だけで足りなければ、`policy.ts` の
   `extraAllowedOrigins` に新しい経路を追加し、Better Auth の
   `trustedOrigins` も同じリストから読む形に統一する。
3. `CORS_ROUTES` ではなく allow-list 側を変える。クラスを
   `public-read` に格上げする案は、公開データが credentialed data に
   変わらない限り却下。

**開いている判断**: 本番相当のプリビュー origin（例:
`https://<preview>.workers.dev`）から credentialed API を叩く必要が
今後生じた場合、どの origin を許可するかは owner の決定事項。現時点では「同一オリジンのみ」を既定として実装している。

## 8. Tool artefact のワイルドカードとの関係（変更なし）

`public/_headers` の

```
/tools/:slug/app/*
  Access-Control-Allow-Origin: *
```

は Static Assets のヘッダであり、Worker のレスポンスには適用されな
い（Cloudflare の仕様は `src/server.ts#applyHtmlCachePolicy` の
コメントが引用しているとおり）。したがって:

- このワイルドカードは `/api/v1/*` に一切影響しない。
- ただし sandboxed iframe（`allow-scripts` のみ）は opaque origin を持つ
  ため、`/api/v1/*` への fetch は `Origin: null` になる。CORS 方針が
  `credentialed` でこれを拒否するので、**ワイルドカードを持つ Tool
  が認証付き API に到達する経路は開かない**（§5-2 / matrix の
  `Origin: null` 行）。
- 逆向きの注意: `allow-same-origin` 付きの Tool iframe は
  同一オリジンになり、CORS は関係しない。同一オリジンの
  XSS は CORS では防げない — Tool 実行の Permissions-Policy /
  sandbox 側の話で、本 Issue の対象外。

`vite.config.ts` の `toolCorsPreviewPlugin`（preview 用の同等ルール）も
`scripts/build-tools.mjs` の namespace 制約も変更していない。
Tool Registry への依存は増やしていない。

## 9. ローカル観測の既知の差異（実測）

`pnpm exec vite dev`（= `@cloudflare/vite-plugin` の dev サーバ）は
**`OPTIONS` を自分で 204 で回答し、Worker に渡さない**。実測:

```
$ curl -i -X OPTIONS http://127.0.0.1:3000/api/v1/reactions \
    -H 'Origin: https://evil.example' \
    -H 'Access-Control-Request-Method: PUT'
HTTP/1.1 204 No Content
Vary: Origin, Access-Control-Request-Headers
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
```

- dev サーバの回答には `Access-Control-Allow-Origin` が無いので、
  ブラウザは最終的にブロックする（読み取りは可能にならない）。
- ただし**プレフライトの判定は dev では観測できない**。開発中に
  403 にならないことを「許可されている」と読んではいけない。
- 本 Issue の測定面接点は (a) `test/integration/cors.test.ts` の
  workerd pool（Worker 全体が実行される）と (b) Chromium が実ヘッダ
  に従うかの 2 段構え。dev サーバの挙動は production の挙動ではない。

## 10. 検証スクリーンショット

`docs/verification/security/cors-preflight-matrix.webp`

生成: `pnpm run security:cors:report`（`node scripts/cors-preflight-report.mjs` と同じ）

- 形式は **WebP**（`sharp` で幅 1600px 以下・quality 80 に再圧縮）。
  Issue 本文のスクリーンショット要件にパス拡張子だけがiaccepted されて
  いないため `.png` ではなく `.webp` を採用している。テキスト表の画像で
  450KB 级的 PNG はリポジトリの重みに対して割に合わない。
- 上段: `test/integration/cors.test.ts` が `SELF.fetch` で実測した
  行（status / allow-origin / allow-credentials / allow-methods）。
  文字起こしではなく測定値。`mock` のラベルがある行だけは
  `externalBoundary` に `LOCAL_API_MODE=mock` を渡して直接呼んだ
  もので、それ以外は `SELF.fetch`（`src/server.ts` 経由）。
- 下段: Chromium が cross-origin `fetch` を実際に試した結果
  （readable / blocked）。ページは `127.0.0.1:4596`、API 側の
  応答は `127.0.0.1:4597` で、ポートが違うので本当に cross-origin。
  応答ヘッダは上段の測定値そのもの。
  `counterfactual` 行だけは `access-control-allow-origin` だけを差し替えた
  もので、「このポリシーが出さない値を出したらブラウザがどう反応するか」を
  示すためのもの（行ごとに個別にラベル済み。production の主張ではない）。
- `readable` 行の body は probe 自身が返す合成 JSON で、API の実データ
  ではない。図は「mechanism」を示すもので、実データが漏れたという意味
  ではない。

スクリーンショットに secret は含まれない（origin とヘッダ値のみ、
プローブは `127.0.0.1`、本番への通信なし）。

## 出典

- OWASP ASVS（Issue 参照のとおり）
- Fetch Standard — CORS protocol の credential / wildcard 規則
- <https://zenn.dev/catnose99/articles/547cbf57e5ad28>（Issue 出典）