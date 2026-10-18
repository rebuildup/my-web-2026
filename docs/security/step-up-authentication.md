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
| `POST /api/v1/auth/api-key/create`（HTTP 面） | Better Auth の api-key plugin が公開している endpoint で、`/api/v1/auth/*` 経由で**本ゲートを迂回して到達できる**。ただし scope 付き発行はできない（`permissions` を渡すと `SERVER_ONLY_PROPERTY` で拒否される）ので、本ゲートが守りたい「恒久的な scope 付き権限の発行」は迂回されない。session cookie だけで **scope なし** の apikey 行を作れることは本 Issue 由来の退行ではなく、HTTP boundary 全体の設計上の既存事項。gate 対象へ昇格させるかは owner 判断（未決） |
| 招待の発行 / 画像アップロード | Issue #445 のスコープは 1 種。次回の候補であり、本 PR では実装しない（捏造しない） |
| `/admin` の閲覧・`listApiKeys` | 読み取りのみ。step-up は権限を**付与する**操作に限定 |

**本ゲートは総当たり防御ではない。** `confirmStepUp` は
`auth.api.verifyPassword` を in-process で呼ぶため、Better Auth の
`onRequestRateLimit` を通らない（HTTP 経由の `/api/v1/auth/verify-password`
は既定の窓で保護される）。step-up ゲートが保証するのは
「session cookie だけでは権限を発行できない」ことだけであり、
パスワードの試行回数を制限するものではない。試行回数の制限を
本ゲートの前提とするなら、別 ticket で Better Auth の rate limit
設定を決める必要がある（owner 判断・未決）。

## 状態の定義（必要 / 成功 / 拒否を区別する）

`src/admin/auth/step-up.ts` が返す `StepUpStatus.state` と
`StepUpError.reason` が UI とサーバの唯一のcontracts になる。

| 状態 | 発生条件 | `state` | 返り値 | UI |
| --- | --- | --- | --- | --- |
| 必要 | まだ確認していない | `required` | `createApiKey` が `{ ok: false, reason: 'step_up_required' }` | パスワード入力欄を出現させる |
| 成功 | 5 分以内に確認済み | `confirmed` | `{ ok: true, result }` | 残り分数を表示し、発行ボタンを有効化 |
| 期限切れ | 確認済みだが窓を過ぎた | `expired` | `createApiKey` が `{ ok: false, reason: 'step_up_required' }` | 「期限切れ」と明示して再入力させる |
| 拒否 | パスワード不一致 | `required` のまま | `confirmStepUp` が `{ ok: false, reason: 'step_up_rejected' }` | 固定の文言のみ（詳細を返さない） |

### 判別子は「throw」ではなく「戻り値」で運ぶ

TanStack Start は throw された `Error` を `ShallowErrorPlugin`
（`@tanstack/router-core`）でシリアライズする。この plugin は
**`message` だけ**を保存し、`Error` サブクラスの独自プロパティ
（本案の `StepUpError.reason`）は**落ちる**。したがって UI 側が
`err.reason` を読む実装は `undefined` になり、期限切れ時に
「再入力フォームを出す」分岐が発火しない。

そのため wire 上で分岐するものはすべて**戻り値**として返す:

- `createApiKeyOutcome()` → `CreateApiKeyOutcome`
- `confirmStepUpOutcome()` → `ConfirmStepUpOutcome`

`assertStepUpGranted` / `confirmStepUpImpl` は `StepUpError` を
**投げる**ままでよい（サーバ側の不変条件であり、テストが直接
検証する）。throw を wire 変換するのは server-fn wrapper の責務で、
その変換は `*Outcome` 関数として一緒にテストされる。

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
  Better Auth。gate と発行処理は**一つの関数
  `createApiKeyOutcome`** として実行するので、
  「gate が操作の入口で呼ばれている」ことまで検証している
  （gate と impl を別々に呼ぶテストでは、配線を消しても green に
  なってしまう）。HTTP 境界の `/verify-password` も 400
  `INVALID_PASSWORD` / 200 `{status:true}` を確認する。
- 本番 D1 の破壊的操作は行わない。migration の production 適用は
  リリース時の運用ステップであり、本 PR では適用しない。

UI 側の 3 状態は local dev サーバ（local workerd + local D1 + `.invalid`
ドメインの fixture 管理者）で Chromium から採取した。
`docs/verification/security/step-up-auth-state.webp`
（3 枚を合成。各キャプションに状態と期待結果を記載）。撮影は fixture
アカウントのみを対象とし、production アカウント・本番 D1・本番
credential は使用していない。パスワード欄はマスク表示のため、
画像に資格情報は含まれない。

## ログ / 出力方針

- 提交的されたパスワード、session token、アカウントの email は
  ログ・assert・レスポンスのいずれにも出さない。assert は
  status / reason / code のみを見る。
- 拒否時もBetter Auth のエラーをそのまま UI へ返さず、固定の文言に
  変換する（どの部分が誤りだったかを推測させる情報を持たせない）。