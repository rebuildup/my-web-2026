# Step-up re-authentication on high-risk admin operations

> Issue #445 / `release-0-6-3`。高リスクな管理操作 1 種に対して
> 「最近ログイン確認（step-up）」を要求する実装的设计記録。

## 対象とした操作と、選んだ理由

Issue #445 が指定する「高リスク管理操作 1 種」を **API キーの発行
（`createApiKey`, `/admin/keys`）** とした。

- 権限という名の**永続的な権限**を発行する。キーは発行セッションが
  失効したあとも `access_counter` / `reactions` の scope を保持する。
- **秘密値そのもの**（bearer token）を 1 回だけ返す。発行失敗 /
  発行成功のどちらでも、管理者のセッションが 30 日有効である
  （ADR-0009 §8）ことは変わらない。
- 既存_surface であり、本 Issue で新規画面や新規権限を作る必要がない。

**対象外とした操作（意図的な線引き）**

| 操作 | 判断 |
| --- | --- |
| `deleteApiKey`（キーの失効） | 権限を**奪う**方向の操作。step-up を課すと非常時の失効手段まで塞ぐ。安全方向なので対象外 |
| 招待の発行 / 画像アップロード | Issue #445 のスコープは 1 種。次回の候補であり、本 PR では実装しない（捏造しない） |
| `/admin` の閲覧・`listApiKeys` | 読み取りのみ。step-up は権限を**付与する**操作に限定 |

## 状態の定義（必要 / 成功 / 拒否を区別する）

`src/admin/auth/step-up.ts` が返す `StepUpStatus.state` と
`StepUpError.reason` が UI とサーバの唯一のcontracts になる。

| 状態 | 発生条件 | `state` | error | UI |
| --- | --- | --- | --- | --- |
| 必要 | まだ確認していない | `required` | `step_up_required` | パスワード入力欄を出現させる |
| 成功 | 5 分以内に確認済み | `confirmed` | — | 残り分数を表示し、発行ボタンを有効化 |
| 期限切れ | 確認済みだが窓を過ぎた | `expired` | `step_up_required` | 「期限切れ」と明示して再入力させる |
| 拒否 | パスワード不一致 | `required` のまま | `step_up_rejected` | 固定の文言のみ（詳細を返さない） |

`expired` と `required` を分けているのは、UI が「一度確認済みだが
失効した」ことを正直に表示できるようにするため。**ゲートは両方を
同じ `step_up_required` として扱う**（緩める方向にも開ける位置に
境界を置かない）。

## 確認手段: `/verify-password` を使う理由

Better Auth 1.7.5 は `/verify-password` を提供し、
`sensitiveSessionMiddleware`（authoritative session、cookie cache
を迂回）の上で `account.password` のハッシュと照合する。
採用理由:

1. **資格情報の経路を増やさない**。ハッシュ照合を自前実装しない。
2. **セッションを 새로発行しない**。`signInEmail` で再サインイン
   すると 2 つ目の session 行が残り、古い session も有効なまま
   残る。再認証でそれは悪化である。
3. **失効したセッションが即座に失敗する**（cookie cache を通らない）。

## 記録先: 署名付き cookie ではなく D1 行

step-up の記録は `admin_step_up_grant(session_id PK, user_id,
confirmed_at)` に置く。

- cookie だと改ざん不能にする**署名鍵**が要る。このリポジトリには
  Better Auth の secret 以外に署名鍵が存在せず、新規 secret の
  追加は運用者（Infisical / `wrangler.jsonc#secrets.required`）の
  決定事項で、本 Issue の権限外（AGENTS.md §4）。
- session id は**サーバ側が cookie から解決した値**であり、
  クライアントが持ち回る値ではない。セッション cookie だけを
  奪った攻撃者は、grant 行を書けない（書こうとしても
  `verifyPassword` を通する必要がある）。
- read-only 検査（`SELECT session_id, user_id, confirmed_at …`）で
  「この session は確認済みか」を**秘密情報を一切扱わずに**答えられる。
- `REFERENCES session(id) ON DELETE CASCADE` により、サインアウト/
  失効した session の grant は残らない。これは衛生措置であって
  セキュリティ境界ではない（session が死ねばゲートに到達できない）。

## 窓の長さ

`STEP_UP_MAX_AGE_MS = 5 分`。短くフォームを 1 つ埋められる長さ、
離席攻撃者が窓を恒久的に引き継げない長さ。UI の文言はこの定数から
生成しており（`STEP_UP_MAX_AGE_SECONDS / 60`）、コードと文言が
分岐しないようにしている。

**これは MFA / TOTP ではない。** パスワード 1 要素の再確認であり、
二次要素の追加は別 ticket の領域。

## 検証の観測範囲

- `src/admin/auth/step-up.test.ts` — 純粋関数の境界値（ちょうど
  5 分）と D1 grant の round-trip / 一意性 / 外部キー制約。
- `test/integration/admin-step-up-auth.test.ts` — local workerd
  プール上の positive / negative ペア。実 entrypoint、実 D1、実
  Better Auth。HTTP 境界の `/verify-password` も 400
  `INVALID_PASSWORD` / 200 `{status:true}` を確認する。
- 本番 D1 の破壊的操作は行わない。migration の production 適用は
  リリース時の運用ステップであり、本 PR では適用しない。

## ログ / 出力方針

- 提交的されたパスワード、session token、アカウントの email は
  ログ・assert・レスポンスのいずれにも出さない。assert は
  status / reason / code のみを見る。
- 拒否時もBetter Auth のエラーをそのまま UI へ返さず、固定の文言に
  変換する（どの部分が誤りだったかを推測させる情報を持たせない）。