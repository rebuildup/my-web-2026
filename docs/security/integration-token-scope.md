# 外部連携 token の最小権限と失効手順 (Issue #464)

`docs/domain/integrations.md` の接続候補（GitHub / Notion / Discord。Stripe は
deferred 扱い）はどれも **promote されていない**。つまり現時点で token は 1 本も
取得しておらず、`/integrations/*` は 404 のまま（entry point は未公開）。

この Issue は、その「未公開の状態」のうちに決めるべきことを固定する。

1. その接続が **何を保持してよいか**（required / optional / never accepted）
2. token を **どれくらい持てばよいか**（保管期限）
3. **誰が・いつ・どの手順で** 失効させるか（revocation）
4. 拒否理由を **caller がログに載せて UI に出せる code** としてどう出すか
   （`src/http/integrations/scope-review.ts`）

 companion: [`docs/domain/integrations.md`](../domain/integrations.md) /
 [`docs/security.md`](../security.md) /
 [`docs/runbook/infisical-secrets.md`](../runbook/infisical-secrets.md) /
 [`src/http/integrations/README.md`](../../src/http/integrations/README.md)

## 1. SoT は ledger、判定は adapter、照合は gate

| 関心事 | 場所 | 種別 |
| --- | --- | --- |
| 候補ごとの required / denied scope・保管期限・失効手順 | [`quality/integration-scope.json`](../../quality/integration-scope.json) | owner が編集する宣言（SoT） |
| 候補 roster と現在の status | [`docs/domain/integrations.md`](../domain/integrations.md) の Current state 表 | domain 文書が roster を所有 |
| 「その grant を使ってよいか」の判定 | [`src/http/integrations/scope-review.ts`](../../src/http/integrations/scope-review.ts) `reviewConnection()` | adapter（純関数） |
| 宣言と判定の照合 | [`scripts/check-integration-scope.mjs`](../../scripts/check-integration-scope.mjs) | gate（`pnpm run integration:scope:check`） |
| 上記の測定結果 | [`docs/verification/security/integration-scope-review.webp`](../verification/security/integration-scope-review.webp) | 検証 report（`pnpm run verify:integration-scope-screenshot`） |

宣言（ledger）と判定（adapter）は別ファイルなので、**一致は gate が測定する**。
ledger が `approved` と書いても、gate が adapter を実行して verdict が違えば
fail する。false-green probe `false-green-approval.json` がこの失敗を実証する。

値（token 自体）はどのファイルにも **書かない**。secret の SoT は Infisical
（ADR-0015 §1）。`wrangler*.jsonc` に integration token の secret 名を登録
しない。gate がその名前を検出した場合は、allowlist が空のうちは error になる。

## 2. 最小権限の考え方

- **required** … その接続が成立するために必要な scope。欠ければ
  `insufficient_scope`（`required_scope_missing`）。
- **optional** … 許容する read 系 scope。あれば `usable` に入るが無くても
  判定は変わらない。
- **never accepted（denied）** … write / admin 系。こちらを要求しても、
  受け取ってはいけない。付与されていたら `unapproved_scope`
  （`denied_scope_granted`）。
- **それ以外** … 誰も review していないので `unapproved_scope`
  （`scope_outside_review`）。「危害はなさそう」で受け 넣らない。

scope 名の比較は **完全一致**（前後空白の trim だけ）。RFC 6749 は scope を
case-sensitive と定め、3 provider とも lowercase 命名なので、大文字小文字を
畳むと「typo を consent と読み違える」余地が生まれる。`Read:User` は consent
一致ではない。

provider ごとに authority の表現が違う点にも注意する。

| candidate | authority の表現 | この repository での扱い |
| --- | --- | --- |
| GitHub | OAuth scope 文字列 | scope 名で review する。GitHub App の installation token は scope ではなく repository permission を持つので、**別の reviewed requirement がない限り受け付けない** |
| Notion | scope 文字列ではなく、workspace 側で page / database ごとに checkbox で選ぶ capability | capability 名を同じ語彙で review する。checkbox の集合を我々の policy に読み替えず、review していない capability は拒否する |
| Discord | OAuth2 scope **と**、bot invite の permission integer の二重構造 | scope に加えて `bot_permission_allowlist` / `bot_permission_denylist` も ledger に記録する（integer は scope から導けない） |

## 3. 保管期限（token retention）

| candidate | 保管期限 | provider の expiry | 更新 |
| --- | --- | --- | --- |
| github | 90 日 | OAuth app token は既定で expiry が無い。**期限は provider ではなく我々が持つ** | refresh token が無いので対話的な再認証だけ |
| notion | 90 日 | revoke されるまで有効 | 対話的な再認証 |
| discord | 30 日 | revoke されるまで有効 | refresh token も同じ期限で扱い、access token と一緒に接続を終了させる（無期限に更新しない） |

- 期限の判定は **token の issue 日**基準。issue 日（`issued_at`）を記録しないと
  期限を証言できず、review は `reauth_required`（`issued_at_missing`）になる。
  parse できない値も同じく fail closed（`connection_metadata_unreadable`）。
- 期限は正の整数。`0` や未宣言は「まだ review されていない」状態なので
  `insufficient_scope`（`retention_undeclared`）になる。

## 4. 失効手順（revocation）

ledger の各行が `revocation.owner` / `triggers` / `procedure` /
`deadline_hours`（今日は全て 24 時間以内）を持つ。gate は次を error として落とす。

- `procedure` が 2 手順以上あること
- `triggers` が 1 つ以上あること（trigger のない手順は実行されない）
- `deadline_hours` が正の数であること
- `owner` が placeholder でないこと

手順の本文（どの画面で revoke するか、Infisical のどの値を消すか）は ledger に
あり、provider の UI が変わっても adapter / gate 側は壊れない。

## 5. 未承認 scope と再認証エラーの可視性

verdict は 5 状態で、`approved` だけが許可される。

| verdict | code | 意味 | operator の行動 |
| --- | --- | --- | --- |
| `approved` | `approved` | required が揃い、denied / review 外 scope が無く、期限内 | そのまま保存してよい |
| `unapproved_scope` | `denied_scope_granted` / `scope_outside_review` | consent が広すぎる | consent request を直し、**今の token を失効**してから再認証 |
| `insufficient_scope` | `required_scope_missing` / `retention_undeclared` | review 済みの job をできない | request を直す（権限の追加、または期限の宣言） |
| `reauth_required` | `grant_revoked` / `token_expired` / `token_age_exceeds_retention` / `issued_at_missing` / `connection_metadata_unreadable` / `provider_requires_reauth` | grant が dead / 古い / 読めない | 再認証 |
| `unknown_integration` | `unknown_integration` | reviewed requirement がない service | review するか失効させる（**既定は拒否**） |

優先順位は `unknown_integration` → `unapproved_scope` → `insufficient_scope`
→ `reauth_required`。**最小権限は liveness より強い**——revoke 済みでも scope が
広ければ scope 拒否が先に出る。ただし理由リストは捨てないので `review.reauth`
には `grant_revoked` が残り、caller は 1 回の評価で両方を表示できる。code は
snake_case 固定で message を持たない（upstream の error 文字列は識別子や token
断片を運ぶ可能性があるため）。

## 6. 自動公開しないための構造

- `/integrations/*` は `src/server.ts` が dispatch するが **handler は未 mount**。
  `src/http/integrations/boundary.test.ts` が 404 を固定している（route を出す
  ticket はこの test を同時に変更する義務を負う）。
- `quality/integration-scope.json#allowlist.entries` は **空**。候補の
  `published_surface` が `none` 以外なのに allowlist entry が無い場合は gate が
  error。entry は `id` / `approved_by` / `approved_on` / `reason` を持ち、
  `reason` が placeholder だと error。
- `wrangler*.jsonc` に integration token の secret 名が現れた場合も、allowlist が
  空のうちは error（未公開候補の token を先行 provision しない）。
- ledger の `reviewed_connections` は 1 件以上必要。0 件は「説明はあるが実行して
  いない」状態として error にする。

## 7. 検証

```bash
pnpm run integration:scope:check             # 判定（exit 0 / 1）
pnpm run verify:integration-scope-screenshot # WebP report
node --test scripts/check-integration-scope.test.mjs
pnpm exec vitest run src/http/integrations   # adapter / fixtures / 未公開の固定
```

gate の判定は 3 層に分かれる。

- **構造** … 必須 field の存在、placeholder、required と denied の矛盾
- **整合** … roster と status の drift（`docs/domain/integrations.md` が SoT）、
  evidence path の実在、vendor reference の URL と日付
- **測定** … adapter を実行した verdict と ledger の宣言の一致

false-green probe は `quality/fixtures/integration-scope/` の 5 件。ledger への
patch 形式なので、repository から乖離しない。「壊した ledger は必ず gate で落ちる」
ことを同じ評価関数で示す。

## 8. 既知の制約

- vendor の scope / permission 定義は ledger の `source.url` を 2026-10-19 時点で
  読んだ記録であり、vendor 側の変更は自動追従しない。promotion ticket は
  `verified_on` を更新して再確認する。
- Discord の permission integer は scope から導けないので、bot invite を受け付け
  る ticket は allowlist に bit を足すかどうかの判断が要る。
- Stripe は `review: "deferred"`。billing が product scope に入るまで scope review
  が書ける対象が存在しないため、「Stripe の token は存在しえない」という行にして
  ある。billing ticket はその行を書き換える義務を持つ。
- 本 Issue は **接続の実行・token の取得・外部 API 呼び出しを行わない**。本番に
  対する破壊的操作は一切含まない（実行経路そのものが存在しない）。