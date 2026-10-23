# 公開 API の責務と契約（Issue #530）

> Status: **Observed inventory** — `docs/domain/capabilities.md` の vocabulary に従い、`live` のみを記載（`planned` / `uncommitted` は含めない）。
> Visibility: public (MIT)
> Grounded: 2026-10-22（`release-0-7-0` に基づく観測）
> 正本: `src/http/hono.ts` の `externalBoundary`（`routes` 配列から読み取れる登録ルート）
> カタログ: `src/http/api-directory/catalog.ts`
> 検証テスト: `src/http/api-directory/catalog.test.ts`
> 表示面: `src/http/api-directory/catalog.stories.tsx`
> 内部ドキュメント（日本語）: 本ファイル

この文書は「将来ありそうな API リスト」ではなく、`externalBoundary` に現在登録されているルートから導出した公開契約の記録である。存在しないもの（明文化された廃止方針、公開スキーマ定義、バージョン管理ポリシー）は「存在しない」と明記する。

---

## 1. 責務と公開契約

### 1.1 責務（何を所有するか）

`src/http/hono.ts` の `externalBoundary` は、`/api/v1/*`、`/media/*`、`/sitemap.xml`、`/robots.txt`、`/.well-known/security.txt` を含む外部 HTTP 境界を所有する（`docs/security/api-cors.md` §1 の 5 つの問いによる定義）。

この境界の責務は:

- **認証形態**（匿名 / API Key / Better Auth セッション / CORS origin）をルートごとに定める（`docs/security/api-cors.md` §2 のクラス分け: `credentialed` / `public-read` / `none`）。
- **rate limit** のバケット（`RATE_LIMIT_WRITE` / `RATE_LIMIT_READ`）をルートごとに割り当てる（`docs/security/write-rate-limit.md` の表と `src/http/middleware/rate-limit.ts` の定数）。
- **エラー形式**（安定した JSON `error` コード + status）を境界全体で統一する（`docs/security/api-key-scope.md` §3 の拒否表、`docs/security/write-rate-limit.md` の `Retry-After` 契約）。

### 1.2 公開契約（ルートごと）

以下は `publicApiCatalog`（`src/http/api-directory/catalog.ts`）から導出。各行の出典は `src/http/hono.ts` の登録コードと関連ルータの `router.ts` にある。

| Path / Method | 認証種別 | Rate limit | エラー形式（安定 code） | 出典（file:line 相当） |
|---|---|---|---|---|
| `GET /api/v1/health` | 匿名 | なし | `{ error: "not_found" }`（404 のみ、CORS ヘッダなし） | `hono.ts:133` |
| `GET /api/v1/auth/*`、`POST /api/v1/auth/*` | 認証（Better Auth セッション、`credentialed` CORS echo） | なし | `403 cors_origin_rejected`（preflight）、`403 INVALID_ORIGIN`（Better Auth 側） | `hono.ts:82-88`、`auth/router.ts`、`docs/security/api-cors.md` §4 |
| `GET /api/v1/reaction-images/:id` | 匿名（`public-read`、`Access-Control-Allow-Origin: *`、credentials なし） | `RATE_LIMIT_READ`（IP ベース、`docs/security/write-rate-limit.md` §2） | `404`（body なし、`no-store`） | `reactions/router.ts`（image router）、`media/router.ts`、`docs/security/api-cors.md` §2 |
| `GET /api/v1/reactions`（`?target=...`） | 認証（API Key `reactions:read`、`credentialed` CORS echo） | `RATE_LIMIT_READ` | `401 missing_authorization` / `invalid_api_key`、`403 missing_scope`、`400 invalid_target` / `invalid_actor_id` | `reactions/router.ts`、`docs/security/api-key-scope.md` §3 |
| `PUT /api/v1/reactions` | 認証（API Key `reactions:write`、`credentialed`） | `RATE_LIMIT_WRITE` | 同上 + `422 image reference rejected`（`ReactionReferenceError` の `err.code`） | `reactions/router.ts`、`docs/security/write-rate-limit.md` §3 |
| `DELETE /api/v1/reactions` | 認証（`reactions:write`） | `RATE_LIMIT_WRITE` | 同 `PUT` の拒否契約 | `reactions/router.ts` |
| `POST /api/v1/access/hit` | 認証（API Key `access_counter:write`） | `RATE_LIMIT_WRITE` | 同認証契約 + `400 invalid_body`（`jsonBody` 層）+ `429 rate_limited`（`Retry-After: 60`） | `access-counter/router.ts`、`docs/security/write-rate-limit.md` §3 |
| `GET /api/v1/access/count/:key` | 認証（API Key `access_counter:read`） | `RATE_LIMIT_READ` | 同認証契約 + `400 invalid_key` | `access-counter/router.ts` |

### 1.3 存在しないもの（明記する）

- **廃止方針（deprecation policy）の明文化は存在しない。** `docs/security/api-cors.md` は CORS 契約を記載するが、API 版数の廃止スケジュールや `version` ヘッダの変更ルールは定義されていない。`package.json#version` はリリースバージョンの唯一の SoT（`AGENTS.md` §2）であり、API ルートに `version` パラメータを組み込む設計は現在存在しない。
- **公開スキーマ定義（OpenAPI / JSON Schema）** はリポジトリに存在しない。各 router の入力検証（`parseReactionInput`、`parseHitBody` など）は内部の型 (`ReactionInputValue`、`HitInputValue`）として所有されているが、公開契約として独立したファイルに出力されていない。
- **バージョン管理ポリシー（semantic versioning の API 適用ルール）** は ADR に存在しない。`0.1.0` の release は foundation であり（`AGENTS.md` §11）、API の公開契約のバージョン管理は未着手である。

---

## 2. 匿名 API と認証 API の違い

`docs/security/api-cors.md` §2 のクラス分けと `docs/security/api-key-scope.md` §1 の resource/action 2 段スコープによって区別される:

| 側面 | 匿名 API（`public-read` / `anonymous`） | 認証 API（`credentialed` / `api-key` / `better-auth-session`） |
|---|---|---|
| 認証形態 | なし（`none`） | API Key（`Authorization: Bearer ...`）または Better Auth セッション（cookie） |
| CORS | `Access-Control-Allow-Origin: *`（credentials なし） | 許可された 1 つの origin を echo + `Access-Control-Allow-Credentials: true` |
| Rate limit principal | リクエスト IP（`docs/security/write-rate-limit.md` §2 の「IP を principal として使う」経路） | API Key id（`requireApiKey` が `c.var.apiKey.id` に設定） |
| 拒否時の情報 | 404（body なし、理由を公開しない — `media/router.ts` の `notFound()` と `docs/security/r2-media-visibility.md` の「理由を公開しない」契約） | 401（`invalid_api_key` — 4 理由を 1 つに畳む、`docs/security/api-key-scope.md` §3）、403（`missing_scope` — resource 名を含まない） |
| 例 | `GET /api/v1/health`、`GET /api/v1/reaction-images/:id` | `GET /api/v1/reactions`、`POST /api/v1/access/hit` |

**重要**: 匿名読み取り（`GET` / `HEAD`）は CORS ヘッダを出さないことでブラウザの script が読めないようにする（`docs/security/api-cors.md` §3 の「読み取りだけはヘッダを出さない」契約）。認証付き書き込み（`PUT` / `DELETE` / `POST`）は `credentialed` ルートで `403` を返す（`docs/security/api-cors.md` §4 の「state-changing な実リクエストも拒否する」契約）。

---

## 3. Rate limit（`docs/security/write-rate-limit.md` の要約）

- `RATE_LIMIT_WRITE`: `PUT` / `DELETE /api/v1/reactions`、`POST /api/v1/access/hit` — 60 回 / 60 秒（principal = API Key id）。
- `RATE_LIMIT_READ`: `GET /api/v1/reactions?target=`、`GET /api/v1/access/count/:key`、`GET /api/v1/reaction-images/:id` — 600 回 / 60 秒（principal = API Key id または IP）。
- 抑制された応答の契約: `429 Too Many Requests` + `Retry-After: 60`（`docs/security/write-rate-limit.md` の表と `src/http/middleware/rate-limit.ts` の `RATE_LIMITS` 定数）。

---

## 4. エラー形式とバージョン

- エラー形式は安定した `error` 文字列（`docs/security/api-key-scope.md` §3 の表: `missing_authorization` / `invalid_api_key` / `missing_scope`、`docs/security/write-rate-limit.md` の `rate_limited`）。
- `version` は `package.json#version` から `hono.ts` の `GET /api/v1/health` で返される（`hono.ts:133-140` の `packageJson` import）。API ルートに `version` パスパラメータを組み込む設計は存在しない。

---

## 5. 利用例

`publicApiCatalog` の各エンドポイントは `purpose` と `responseExample` に利用例を持つ。例（`reactions` の `GET`）:

- リクエスト: `GET /api/v1/reactions?target=example`（`Authorization: Bearer <api-key>` ヘッダ必須）。
- 応答: `{ target_key: "example", aggregates: { count: 3 } }`（`reactions/router.ts` の `aggregateByTarget` から導出）。

`access` の `POST /hit` は `key` と `session_id` を body に持つ（`access-counter/router.ts` の `parseHitBody`）。

---

## 6. 廃止方針

**存在しない。** `docs/security/api-cors.md` は CORS 契約の変更理由を記録するが、API ルートの廃止スケジュール・バージョン移行ルール・後方互換保証期間は明文化されていない。将来の公開契約変更（新リソースの追加、既存ルートの削除、認証形態の変更）は別の ADR / Issue で扱う必要がある（`docs/domain/capabilities.md` の `planned` / `uncommitted` vocabulary に従う）。

---

## 7. 検証と再現

- カタログと境界の一致: `pnpm run architecture:check`（`scripts/check-architecture.mjs` の依存方向ゲート）+ `src/http/api-directory/catalog.test.ts`（route 一覧と catalog の構造的一致）。
- 表示面: `pnpm run build-storybook`（`catalog.stories.tsx` が Panda CSS の `editorial/primitives/` と `css` / `cx` を使用するため、Tailwind は一切使わない）。
- 空状態: `EmptyState` story（`catalog.stories.tsx` の 2 つ目の story）。
- 内部ドキュメント（本ファイル）と Storybook プレビュー（`catalog.stories.tsx`）は `copy:approval:check` の対象外である。`quality/copy-editorial-surfaces.json` の `publicCopyGlobs` に `src/http/**` はなく、`**/*.md` と `**/*.stories.tsx` は `excludeGlobs` に含まれるため、本ファイルの日本語文言に owner 承認は要らない。

---

## 8. 秘密値と管理用エンドポイントの非公開（確認）

以下は `publicApiCatalog` に含めない（`catalog.ts` の除外コメントに明記）:

- `/api/v1/db/ping`（D1 binding の生存探査、`docs/security/api-cors.md` §2 の `none` クラス — `public` にすると `Access-Control-Allow-Origin: *` が付くため、未認証の生存探査が可能になる）。
- `/api/v1/media/ping`（R2 binding の生存探査、同上の理由）。
- `/media/*`（バイナリ配信ゲート — 公開データではあるが REST API 契約ではない、`media/router.ts` の `notFound()` は理由を公開しない）。
- `/admin/*`、内部サーバ関数（`/_serverFn/*`）、管理画面（存在しない）。
- `LOCAL_API_MODE=mock` の mock ルート（`src/http/mock/index.ts` — production では到達しない）。
- 実際の `API Key` 値、`BETTER_AUTH_URL` の値、D1 / R2 の内部情報（`docs/security/api-key-scope.md` §5 の秘密値取り扱い不変条件に従う）。

---

## 9. 依存方向の確認

`src/http/api-directory/catalog.ts` は `src/http/` の obligation 内にあり、`editorial` の primitive は `catalog.stories.tsx` で使用する（`editorial` への import は許可される方向で、`AGENTS.md` §3 の dependency direction 表に `http -> editorial (Issue #530 …)` として登録されている）。`catalog.fixture.ts` の `TableColumn` 参照は `import type` のみである。他の obligation（`home`、`portfolio`、`reactions` など）への value import は存在しない（`catalog.test.ts` は `externalBoundary.routes` だけを参照する）。
