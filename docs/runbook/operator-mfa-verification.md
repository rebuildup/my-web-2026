# 運用者 MFA / Passkey 確認 runbook (Issue #469)

> GitHub / Cloudflare / Infisical / ドメイン管理の 4 アカウントについて、
> **運用者がいつ何を確認したか**を `quality/operator-mfa-ledger.json` に記録し、
> その記録が policy を満たしているかを `pnpm run check:operator-mfa` で
> 判定する手順。credential・recovery code・enrollment 一覧・
> アカウント識別子は**収集しない**。

---

## 1. 何を強制しているのか

この repository が観測できるのは **記録** であり、**アカウント実状態** ではない。

4 アカウントの MFA 状態を API で読み出す手段は Worker に存在せず、
(provider API を読むには credential を保持する必要がある — AGENTS.md §4 の
「Infisical が runtime secret 値の SoT」分離が壊れる) ので採らない。
したがって gate が強制する主張は 1 つに尽きる。

> 運用者のチェック表が、対象 4 サービスそれぞれの MFA / Passkey 確認を、
> policy（factor 数・phishing 耐性・鮮度）を満たす形で記録しているか。

記録の**完全性・整合性・鮮度**であって、**登録の事実**ではない。この
区別をコードで閉じているのが `scripts/_operator-mfa-audit.mjs` の
`STATE`（`confirmed` / `unconfirmed` / `stale` / `missing`）である。

## 2. 対象サービス

| service id | 対象 | なぜここに入るか |
| --- | --- | --- |
| `github` | repository / release Pra | ソースと tag の SoT。侵害されると release 前提が崩れる |
| `cloudflare` | Worker / D1 / R2 / ドメイン | 本番配信と全 binding の発行元（ADR-0014） |
| `infisical` | runtime secret の SoT | 全 runtime secret の値がこの 1 箇所に集約される（ADR-0015） |
| `registrar` | ドメイン管理 | `rebuildup.dev` の登録情報。乗っ取りで origin を替えられうる |

## 3. 匿名性契約

これが本 gate の中心制約であり、**schema で構造的に保証**される。

1. **識別子の欄が存在しない。** 行は次の 3 キーだけ:
   `{ "service": ..., "confirmed_at": ..., "factors": [{ "kind": ..., "confirmed_at": ... }] }`
2. **自由記述欄が無い。** `note` / `comment` のような散文の隠れ家に
   ならないよう存在しない。運用者本人の氏名なども書かない。必要なら
   private な GitHub Issue 側に書く。
3. **識別子キーは専用 reason code で拒否。** `account` / `email` / `handle` /
   `login` / `user` / `username` / `owner` / `phone` などを含むファイルは
   `ledger_forbidden_field` で ledger 全体が `UNDECIDABLE`（exit 2）。
   **値は出力されない。**
4. **出力が status-only。** service id・state・ISO 日付・factor kind・
   reason code のみ。enrollment 一覧も credential も出ない。
5. **生成前ガード。** ledger ファイルとレポート HTML の両方を
   `assertNoSensitiveInText` が通す（e-mail / `otpauth://` / base32 seed /
   長い数字列 / Bearer / URL 内 credential / PEM / provider token）。
   1 件でも見つかればコマンドは非ゼロ終了し、ファイルは書かれない。

## 4. 記入手順（運用者）

provider console を開いて確認し、**リポジトリの working tree** で
`quality/operator-mfa-ledger.json` だけを編集する。

| 手順 | 確認するもの | 記録するもの |
| --- | --- | --- |
| 1 | そのアカウントの 2 要素設定に **2 つ以上** の factor があるか | `factors[].kind` を列挙（`passkey` / `security_key` / `totp_app` / `otp_sms`） |
| 2 | **passkey か security key** が登録されているか（`require_phishing_resistant`） | 該当する `kind` |
| 3 | recovery code を失っていないか（**値を書き込まない**） | 確認日を `factors[].confirmed_at` に日付だけ |
| 4 | その確認が今も有効か | 行の `confirmed_at` = 最終確認日（ISO `YYYY-MM-DD`） |

記入例（`github` のみ、値の秘密は書かない）:

```json
{
  "service": "github",
  "confirmed_at": "2026-10-19",
  "factors": [
    { "kind": "passkey", "confirmed_at": "2026-10-19" },
    { "kind": "totp_app", "confirmed_at": "2026-10-19" }
  ]
}
```

規則:

- 行の `confirmed_at` は、その行の factor のうち**最新**の日付より古くならない
  （矛盾すると `confirmation_date_inconsistent`）。
- 未来日は書かない（`confirmation_date_in_future` = 未確認扱い）。
- 行の追加・削除は 4 サービスぶんの行に保つ。
  行を消すと `missing` になる（消したことは「確認済み」にはならない）。

## 5. policy

`policy` ブロックは gate 自身の中核で、**owner が変更する**：

| キー | 既定 | 意味 |
| --- | --- | --- |
| `status` | `proposed` | `proposed`（owner 未承認）/ `ratified`（owner 承認済み）。`proposed` のあいだ `OK` でも note が出る |
| `min_factors` | `2` | `confirmed` に必要な factor 数 |
| `require_phishing_resistant` | `true` | `passkey` か `security_key` が 1 つ以上必要 |
| `max_confirmation_age_days` | `180` | これを超えた `confirmed_at` は `stale`（confirmed ではない） |

> **owner 待ちの判断**: これらの既定値は Issue #469 からの提案であり、
> ratify されていない。`policy.status` を `ratified` に変えるのは
> owner の明示的な決定としてのみ行う。

## 6. 実行と exit code

```bash
# 出荷済みチェック表を監査する（status-only 出力、そのまま貼れる）
pnpm run check:operator-mfa

# 記録済み fixture でのデモ（release verdict ではない。出力に source=fixture と出る）
pnpm run check:operator-mfa -- --fixture=quality/fixtures/operator-mfa/one-unconfirmed.json

# 検証レポート（HTML + WebP）を再生成する
pnpm run verify:operator-mfa-checklist-screenshot

# テスト
node --test scripts/check-operator-mfa.test.mjs
node --test scripts/make-operator-mfa-checklist-report.test.mjs
```

| exit | verdict | 意味 |
| --- | --- | --- |
| `0` | `OK` | 4 サービスすべてが `confirmed` |
| `1` | `OUTSTANDING` | 1 つでも `unconfirmed` / `stale` / `missing`。**緑ではない** |
| `2` | `UNDECIDABLE` | ledger が読めない・筋が通らない・日付が未来・識別子キーがある・usage error。fail-closed |

`2` が pass と同じ信号にならないことがこの gate の要件である。

## 7. 失敗時の挙動（fail-closed の一覧）

ledger **全体**が `UNDECIDABLE` になる状態（行を一切出さない）:

| reason | 状態 |
| --- | --- |
| `ledger_unreadable` | ファイルが読めない |
| `ledger_unparseable` | JSON として壊れている |
| `ledger_shape_invalid` | `version` / `policy` / 非空の `services` が無い |
| `ledger_version_unsupported` | `version` が 1 以外 |
| `ledger_forbidden_field` | 識別子キーが混入（値を出さない） |
| `unknown_field` | schema に無いキーがある |
| `policy_invalid` | policy ブロックが不正 |
| `service_unknown` / `service_duplicated` | 4 サービス以外 / 重複 |
| `factor_kind_unknown` | factor kind が enum 外 |
| `confirmation_date_invalid` | ISO 暦日でない（`2026-02-30` など） |
| `confirmation_date_in_future` | 未来日 |
| `confirmation_date_inconsistent` | 行の日付が自分の factor より古い |
| `clock_invalid` | 時計が読めない |

行単位（`OUTSTANDING`）:

| state | reason | 意味 |
| --- | --- | --- |
| `unconfirmed` | `confirmation_date_missing` | 確認日が書かれていない（**出荷時がこれ**） |
| `unconfirmed` | `factors_missing` / `factors_below_minimum` / `phishing_resistant_missing` / `factor_kind_missing` / `factor_date_missing` | policy を満たさない登録 |
| `stale` | `confirmation_stale` | policy の鮮度窓を超過 |
| `missing` | `service_missing` | 4 サービスのどれかの行が無い |

## 8. CI 上の位置づけ

`check:operator-mfa` は **`validate:fast` / `validate:integration` /
`validate:release` のいずれにも結線していない**。理由は
`quality/profile.yaml#operator_mfa_audit` に記録した：

- 出荷時の ledger は**未記入**であり、operator が記入するまで
  `OUTSTANDING`（exit 1）が正しい判定。CI を恒久的に赤にする意味がない。
- 4 アカウントの実状態は CI からは観測できない（credential を持たない
  GitHub Actions が provider console を読むべきではない）。
- fail-closed な operator gate として、`docs/release.md` の sprint cycle
  で人が実行する運用に置くのが妥当。

Decision は `quality/profile.yaml`、証跡画像は
[`docs/verification/security/operator-mfa-checklist.webp`](../verification/security/operator-mfa-checklist.webp)
（生成: `pnpm run verify:operator-mfa-checklist-screenshot`）。

## 9. 既存 runbook との関係

- [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) が **値** の SoT と
  命名規約を定めるのに対し、本 runbook は **MFA 確認の記録** の
  SoT（`quality/operator-mfa-ledger.json`）を定める。**値** はどちらにも
  書かない。credential は Infisical 側の運用に閉じている。
- [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md) と
  同じく、GitHub Actions は Cloudflare / provider credential を保持しない。
