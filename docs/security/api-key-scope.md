# API Key の権限スコープと失効の運用契約 (Issue #442)

`/api/v1/access/*` と `/api/v1/reactions/*` は API Key で保護される。
「その Key にその操作が許されるか」と「その Key が今も有効か」は
**2つの異なる層**が別々に判定しており、返り値も層ごとに異なる。この
ドキュメントはその境界と、拒否応答が秘密鍵や内部情報を漏らさないことを固定する。

 companion: [`docs/security.md`](security.md)（security policy 全体） /
 [`docs/adr/ADR-0009-better-auth-foundation.md`](../adr/ADR-0009-better-auth-foundation.md)§5・§6 /
 [`docs/adr/ADR-0010-abuse-protection-rate-limit.md`](../adr/ADR-0010-abuse-protection-rate-limit.md) /
 [`docs/runbook/consumer-api-key-rotation.md`](../runbook/consumer-api-key-rotation.md)

## 1. 権限スコープは resource / action の2段

権限は Key ごとに 1 つの object として `apikey.permissions`（JSON 文字列）に
保存される。定義済み resource は **この2つだけ**（ADR-0009 §5）。

| resource          | read               | write                | 保護する endpoint                                   |
| ----------------- | ------------------ | -------------------- | -------------------------------------------------- |
| `access_counter`  | `GET  /count/:key` | `POST /hit`          | `/api/v1/access/*`                                  |
| `reactions`       | `GET  /?target=`   | `PUT` / `DELETE`     | `/api/v1/reactions`（`/reaction-images/:id` は public） |

- 判定は `requireResourceAction(c, resource, action)` の**引き当て**であり
  wildcard ではない。`reactions` だけを持つ Key は `access_counter` に到達できない。
- 権限 block 自体が無い Key（`permissions` が NULL）は「全 scope 無し」であり
  500 ではなく 403 になる。
- resource を増やす判断は ADR-0009 §5 に従い単独 ticket で行う。
  `src/admin/keys/load.ts` の `RESOURCES` と、境界側の
  `requireResourceAction` 呼び出しを同時に更新する。

## 2. 判定の2層と、それぞれの責務

| 層 | 実装 | 判定するもの | 失敗時の応答 |
| --- | --- | --- | --- |
| 境界 middleware | `src/http/api-keys/middleware.ts` | `Authorization` header の形、Key の scope 引き当て | `401 missing_authorization` / `403 missing_scope` |
| 認証基盤 | `@better-auth/api-key@1.7.5` `validateApiKey` | Key の hash 一致、有効化、期限、保有数 | `401 invalid_api_key` |

middleware は verifier の失敗理由を**外部へ出さない**。Better Auth は
`KEY_DISABLED` / `KEY_EXPIRED` / `KEY_NOT_FOUND` / `INVALID_API_KEY` を
区別して内部で扱うが、境界の応答は常に 1 つに畳まれる。

**失効（revoke）は「行を消した」状態だけを指す。** `enabled = 0` は
「保持はするが検証で通らない」状態で、ミグレーション
`0006_apikey_key_unique.sql` が重複 hash を無効化する際にに使う。
この2つは運用上別物なので、runbook では分けて扱う。

期限切れ Key は**初回検証で row が削除される**（Better Auth の
self-reaping 動作）。2 回目以降は「未知の Key」と区別がつかなくなる。
つまり「消えた Key」を調査する場面では、期限切れと手動 revoke を
応答の見た目から区別できない。

## 3. 拒否と許可の応答契約

| 状況 | status | body |
| --- | --- | --- |
| scope 不足 | 403 | `{"error":"missing_scope","status":403}` |
| Key が無効（revoke / disabled / expired / 誤 hash / 未知） | 401 | `{"error":"invalid_api_key"}` |
| `Authorization` が無い / Bearer でない / 値が空 | 401 | `{"error":"missing_authorization"}` |

- scope 不足の body は resource 名・action 名・`apikey.id` を含まない
  （拒否した理由を caller に返さない）。
- 401 の4理由（unknown / 誤 hash / revoked / disabled）は **body が
  byte 同一**。応答を Key の有無を調べる oracle に使わない。
- 許可された場合は status だけで意味が完結する。Key の権限は応答に
  含まれない（`GET /count/:key` は自分の principal の行だけを返す）。

## 4. 検証 fixture（契約と実測）

fixture は local workerd の Miniflare D1 に作られる。**本番には一切
触れない。** 使うアカウントは suite 内で `role=admin` として生成する
合成ユーザー（`api-key-matrix@test.local`）で、operator の実アカウントや
実際の scope は観測していない。

| fixture | 作り方 | 期待 | 判定する層 |
| --- | --- | --- | --- |
| `access_counter:read+write` | `auth.api.createApiKey` に両 action | 200（write→read で count が上がる） | 許可 |
| `reactions:read` | `reactions: ['read']` | 200 | 許可 |
| `access_counter:read` | `access_counter: ['read']` | read 200 / write 403 | 拒否（scope） |
| `access_counter:write` | `access_counter: ['write']` | write 200 / read 403 | 拒否（scope） |
| `reactions:read+write` | `reactions` のみ | access_counter 403 | 拒否（wildcard しない） |
| 権限 block 無し | `permissions` なしで発行 | 403 | 拒否（scope） |
| revoked（管理画面で削除） | `deleteApiKeyImpl` | 200 → 401 | 拒否（失効） |
| disabled | `updateApiKey({ enabled: false })` | 401 | 拒否（失効） |
| expired | `expiresAt` を過去時刻にした fixture row | 401、その後に row が消える | 拒否（期限） |
| 誤 hash | 発行済み plaintext の最終文字を置換 / 末尾を切断 | 401 | 拒否（hash） |
| header 不正 | header 無し / `Basic …` / `Bearer` のみ | 401、verifier 未呼び出し | 拒否（境界） |

期限切れ fixture だけは `expiresIn` の下限（1 日）の関係で API では
作れないため、local D1 の fixture row を直接 UPDATE している。断言するのは
**Better Auth が期限切れをどう扱うか**であり、この書き込み経路は本番の
運用手順ではない。

実測表（26 行）は
[`docs/verification/security/api-key-scope-matrix.webp`](../verification/security/api-key-scope-matrix.webp)。
表の status / error code はレスポンスから読み戻した値で、契約から
写したものではない。

### 手順

```bash
# 実測（workerd pool。Key を実際に発行して実 HTTP を通す）
pnpm exec vitest run test/integration/api-key-scope.test.ts

# 上記を実行してスクリーンショットを再生成（Playwright + sharp）
pnpm run verification:api-key-scope

# middleware 側の形（verifier はスタブ）
pnpm exec vitest run src/http/api-keys/middleware.test.ts
```

## 5. 秘密値の取り扱い不変条件

- `apikey.key` は plaintext の SHA-256（base64url、43 文字）。plaintext を
  保持しない。`prefix`（`mk_`）と `start`（先頭 6 文字）だけが
  表示用に保存される。
- plaintext は発行時に一度だけ返る（`createApiKeyImpl` の `plaintext`）。
  以後は `listApiKeys` から読めない。失効後は再取得できない。
- 検証 suite はレスポンス body / header を発行済み plaintext 全件と
  突き合わせ、1 件でも一致したら失敗する。表示する表にも `mk_*` を
  載せない。
- 検証スクリーンショットの生成スクリプト
  (`scripts/capture-api-key-scope-matrix.mjs`) は、credential 形状に
  合う行があれば描画を拒否して非ゼロ終了する。判定は cell 単位の
  形状一致（`mk_…` / `Authorization` 値 / SHA-256 長さ / e-mail 住所）で、
  キーワード一致ではない（表は "revoked" や "key" という語を正当に使うため）。
- 実行時の秘密値の一覧出力は `AGENTS.md` §4 の禁止事項。fixture は
  テスト内で生成した値だけを使う。

## 6. 本番を壊さないという制約

- fixture の書き込み先は `@cloudflare/vitest-plugin` が run ごとに用意する
  Miniflare D1 のみ。`wrangler d1 … --remote` も deploy も実行しない。
- 本番に対する確認は destructive に行わない。本番で Key の状態を確かめる
  必要がある場合は、行を読み取る read-only 検査 +
  [`docs/runbook/consumer-api-key-rotation.md`](../runbook/consumer-api-key-rotation.md)
  の手順を使い、失効させる操作は手動承認を要する運用として扱う。
- 権限の観測範囲は ADR-0009 §5 の 2 resource のみ。存在しない resource や
  未実装の action を「許されている」と書かない。

## 7. 既知の制約

- `@better-auth/api-key` の **per-key rate limit は無効**（ADR-0010 が唯一の
  throttle）。この文書の suite は rate limit を検証しない。key ごとの予算は
  `src/http/middleware/rate-limit.ts` が持つ。
- `usage limit`（`remaining` 枯渇）や `customAPIKeyValidator` は
  この release の設定では使わない。枯渇時 Better Auth は 429
  (`USAGE_EXCEEDED`) を返すが、middleware は verifier の失敗を
  1 つに畳むため 401 `invalid_api_key` として見える。将来この設定を
  有効化するなら、fixture 表に「枯渇」行を追加すること。
- スクリーンショットは `.png` ではなく `.webp` で commit している
  （リポジトリ容量の制約。生成スクリプトが width 1600px / quality 80 で
  書き出す）。

## 8. 再評価の契機

- resource / action を増やす ticket（→ fixture 表と `RESOURCES` を更新）
- `@better-auth/api-key` のアップグレード（revoke / expiry / hash の
  挙動が変わると表が古くなる）
- 認証層の rate limit を再度有効化する判断（ADR-0010 の再検討）