# 境界入力検証の運用契約 (Issue #450)

`/api/v1/*` は公開境界であり、**UI の client-side validation はセキュリティ制御ではない**。
利用者はいつでも Worker に直接リクエストを送れるため、外部入力は
`src/http/validation.ts` がハンドラに届く前に検証され、不正入力は定義済みレスポンス
（`400` / `405` / `413` / `415`）へ落ちる。

 companion: [`docs/security.md`](security.md)（security policy 全体） /
 [`docs/architecture.md`](../architecture.md)（境界の義務配置）

## 1. 検証の4軸と定義済みレスポンス

| 軸          | ガード                        | 定義済みレスポンス                                    |
|-------------|-------------------------------|-------------------------------------------------------|
| size        | `MAX_JSON_BODY_BYTES` (16 KiB) | `413 payload_too_large`                              |
| format      | endpoint schema module の `validate*` | `400` + endpoint 固有コード（`invalid_body` / `invalid_key` / …） |
| protocol    | `Content-Type` / HTTP verb    | `415 unsupported_media_type` / `405 method_not_allowed` |
| type        | Zod schema                    | `400 invalid_body`                                   |

境界検証由来の拒否は常に次の envelope を返す:

```json
{ "error": "<stable code>", "reason": "<human readable string>" }
```

- `error` … consumer が分岐するための安定コード。endpoint ごとに互換性が維持される。
- `reason` … 人間向けの1行。credential・request body 全体・内部パスは含めない。
  Zod failure は **最初の issue だけ**を `path: message` 形式で返す（旧実装は
  `error.message` まるごとを載せていた）。

size ガードは **request の契約上の境界**であって memory の上限ではない。
body は `c.req.text()` で一度読み切った後に実測バイト数を比較するため、
`Content-Length` を持たない chunked request でも `413` になるが、その前に
body は Worker memory に載る（上限は Cloudflare 側の request size / memory 制限が
規律する）。`413` を「メモリを守る defense」と読まないこと。このルートは
`requireApiKey` の後ろにあるので、到達するのは認証済み caller のみ。

## 2. 認証より**後**に検証する理由

route の middleware 順は `requireApiKey` → `rateLimit*` → `jsonBody(...)` → handler で固定する。

`requireApiKey` は Better Auth api-key plugin の rate limit 対象なので、
**認証前の匿名トラフィックは body を1バイトも読まれずに 401 で弾かれる**。
検証を先にすると、匿名 caller に body read を強制できてしまう。
413/415/400 は「そのリクエスト自身の問題」であり認証情報について何も漏らさないが、
順序は abuse control を先に置く。

## 3. 適用エンドポイントと応答

実際に存在する API のみを対象にする（未実装 API の adapter は本 Issue の範囲外）。

| Method + Path                     | 検証軸           | 不正入力時の応答                                              |
|-----------------------------------|------------------|--------------------------------------------------------------|
| `POST /api/v1/access/hit`         | body             | `415` / `413` / `400 invalid_body`                          |
| `PUT /api/v1/reactions`           | body             | `415` / `413` / `400 invalid_body`                          |
| `DELETE /api/v1/reactions`        | body             | `415` / `413` / `400 invalid_body`                          |
| `GET /api/v1/reactions`           | query            | `400 missing_target` / `invalid_target` / `invalid_actor_id` / `invalid_query` |
| `GET /api/v1/access/count/:key`   | path             | `400 invalid_key`                                            |
| `GET /api/v1/reaction-images/:id` | path             | `400 invalid_id`                                             |
| 上記 path の非対応 verb           | protocol         | `405 method_not_allowed` + `Allow` header                   |

- `invalid_query` … 同一名が複数回指定された HTTP parameter pollution
  （`?target=a&target=b`）。どちらの値を正とするか実装層で割れる前に 400 にする。
- 認証・rate limit の応答（`401 missing_authorization` / `401 invalid_api_key` /
  `403 missing_scope` / `429 rate_limited`）は本 Issue の変更対象外。
- `GET /api/v1/auth/*` は Better Auth の handler が own するため対象外。

## 4. 互換性メモ（=#450 で変わった observable な応答）

**accepted → 定義済み拒否**（従来は handler に到達していたリクエスト）:

| 変更前                                                              | 変更後                          |
|---------------------------------------------------------------------|---------------------------------|
| `Content-Type: text/plain` の JSON body → `c.req.json()` が parse して handler に到達 | `415 unsupported_media_type`   |
| `Content-Type: application/x-www-form-urlencoded`（`curl --data` / `--data-binary` の既定値）→ 同上 | `415 unsupported_media_type`（scripted caller は `-H 'content-type: application/json'` が必須） |
| 16 KiB 超の JSON body → D1 まで到達                                  | `413 payload_too_large`         |
| 同一クエリ名の重複（`?target=a&target=b`）→ 最初の値が採用され handler に到達 | `400 invalid_query`        |
| 上記 path の非対応 verb → `404 not_found`（リソースが無いという誤解を招く） | `405` + `Allow`            |

**500 → 定義済み 400**（本 Issue で解消した実欠陥）:

| 変更前                                                              | 変更後                          |
|---------------------------------------------------------------------|---------------------------------|
| `key` に空白を含む `POST /access/hit` → **500 internal_error**         | `400 invalid_body`              |
| `:key` に空白を含む `GET /access/count/:key` → **500 internal_error** | `400 invalid_key`               |

**同じステータス / コードのまま意味が変わったもの**:

| 変更前                                                              | 変更後                          |
|---------------------------------------------------------------------|---------------------------------|
| `?target=`（空文字）→ `400 missing_target`                            | `400 invalid_target`            |
| `reason` に Zod の全 issue（JSON 文字列）が入っていた                | `reason` は1行の `path: message` |
| scope を持たない key + 不正 body の `POST /access/hit` / `PUT`・`DELETE /reactions` → `403 missing_scope` | `400 invalid_body`（body 検証が `requireResourceAction` より先に走るため。どちらも定義済み 4xx） |

脈絡として、在庫の consumer（`src/home/access/load.ts` / `src/home/reactions/load.ts`）
は既に `content-type: application/json` を付け、`response.ok` と `429` しか見ないので
どれにも影響を受けない。影響を受けるのは **スクリプトから直接叩く外部 caller**
だけである。

**未決事項（owner 判断）**: `application/x-www-form-urlencoded` を `415` で拒否する
方針自体は確定した契約ではない。代替として「`Content-Type` を無視して `JSON.parse`
に委ねる」方針もあり得る。本 PR はコードと unit test が固定している現行の挙動
（`415`）を維持し、決定は owner に委ねている。方針を変える場合は §1 の protocol 軸と
§3 のテーブルも追随する。

## 5. 変更していない境界

- `requireApiKey` / `verifyApiKey`（auth）と rate limit binding は変更なし。
- Cloudflare binding（D1 / R2 / ASSETS / rate limit）と `wrangler*.jsonc` は変更なし。
- Tool Registry（`src/tools/**`、`external/<slug>/**`）との依存は増やさない。
- migration は追加していない（DDL は変化していない）。

したがって本 Issue に新しい運用契約（runbook / rotation / deploy）は生じない。
境界の責務そのものが `src/http/**` の中に閉じており、ADR の更新も不要。

## 6. 検証手順

```bash
# 1. 境界検証の unit テスト + local worker (workerd) での HTTP matrix
pnpm exec vitest run src/http/validation.test.ts
pnpm exec vitest run --reporter=verbose test/integration/input-validation.test.ts

# 2. 検証アーティファクト（PNG）の再生成
pnpm run verification:input-matrix
```

`test/integration/input-validation.test.ts` は 33 ケースを実際の HTTP リクエストとして
local workerd pool（D1 / R2 binding 実物、API key は `withVerifyApiKey` seam の fixture）で
実行し、観測した status / `error` code から matrix を出力する。PNG はその実測値の
レンダリングであり、secret は含まれない（capture script が credential らしき行を検出したら
出力しない）。

生成先: `docs/verification/security/input-validation-matrix.png`
(one Issue = 1 PR のため、差分が増えるごとに同じコマンドで再生成する)