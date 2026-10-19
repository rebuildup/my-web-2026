# Secret drift / rotation 期限ステータス

> Issue #477 の operator リファレンス。既存の secret SoT（ADR-0015）と
> [`infisical-secrets.md`](infisical-secrets.md) を拡張するものであり、
> **置き換えない**。cross-link:
> [`AGENTS.md §4`](../../AGENTS.md) /
> [`ADR-0015`](../adr/ADR-0015-infisical-env-management.md) /
> [`cloudflare-workers-builds.md`](cloudflare-workers-builds.md) /
> [`release.md`](../release.md).
>
> **status-only 契約。** この gate は secret の値を読み取らず、
> どこにも保存せず、出力もしない（AGENTS.md §4、Issue #139 の経緯）。
> 出力は **name / verdict / 件数 / 日付** のみ。値の貼付けで何かを直す
> ことは、ここでも禁止。

## 1. 何が問題だったか

runtime secret 名簿には 2 つの事実がある。

| 事実 | 「前」 | 「後」（本 gate） |
| --- | --- | --- |
| **drift**：Infisical の inventory が契約と一致しているか | `scripts/check-cf-secrets.mjs --execute` の transcript にしか無い。CI ログには残らない | 名前ごとに `MATCH` / `MISSING` / `UNEXPECTED` / `NOT_OBSERVED` として判定される |
| **期限**：rotation の cadence を超えたか | [`infisical-secrets.md`](infisical-secrets.md) §2.1 の prose だけ | ledger の cadence + 記録日 + 現在日から `OVERDUE` / `DUE_SOON` を計算 |

値の照合は行わない。Cloudflare の Worker binding 値は API で読み戻せず
（値読み取り endpoint が無い）、Infisical も値を保持しない設計なので、この 2 つが
観測できる全部である。

## 2. gate の置き場所

| 対象 | コマンド | 置き場所 |
| --- | --- | --- |
| repository 側（ledger が契約の inventory を覆うか、期限を超えていないか） | `pnpm run secrets:status:check` | `validate:fast` の `infisical:check:coverage` 直後。offline・read-only・credential 不要なので CI で走る |
| environment 側（Infisical の実 name parity） | `pnpm run infisical:check:cf -- --execute --environment=prod` の **status-only 出力**を operator が記録して `--observation` に渡す | operator step（credential が要るため CI には置けない。Issue #470 / #577 と同じ理屈） |
| ダッシュボード（再現可能な artefact） | `pnpm run secrets:status:report` | gate 外。`validate:*` はレポートを走らせない |

## 3. 判定と終了コード

| verdict | exit | 条件 |
| --- | --- | --- |
| `OK` | 0 | drift failure なし・期限超過なし。advisory は表示のみ |
| `DRIFT` | 1 | `MISSING` / `MISSING_ROW` / `EXTRA_ROW` が 1 件以上 |
| `OVERDUE` | 1 | cadence を超えた rotation が 1 件以上 |
| `UNDECIDABLE` | 2 | ledger / observation が読めない・parse 不能、clock 不正、usage error |

**`UNDECIDABLE` を独立の verdict にしているのは、「読めなかった」を
「大丈夫だった」と同じ signal にしないため。** release pipeline に
渡る数字が 0 なのは「読んで OK」のときだけ。

### drift の 4 状態

| 状態 | 意味 | severity |
| --- | --- | --- |
| `MATCH` | 観測がその name を期待された場所に持つ | — |
| `UNEXPECTED` | 観測が契約に無い name を報告 | advisory（ADR-0015 §1.4 上、環境は Worker が bind しない name を保持してよい） |
| `UNEXPECTED` | 観測が契約に無い name を報告 | advisory（ADR-0015 §1.4 上、环境は Worker が bind しない name を，申请してよい） |
| `NOT_OBSERVED` | 観測が渡されていない | advisory。**「一致」とは書かない** |
| `MISSING_ROW` / `EXTRA_ROW` | ledger が契約の inventory を正確に覆っていない | **fail** |

### deadline の 4 状態

| 状態 | 意味 |
| --- | --- |
| `WITHIN_CADENCE` | cadence 内 |
| `DUE_SOON` | 期限が 14 日以内（gate の既定窓） |
| `OVERDUE` | 期限超過 → **fail** |
| `UNRECORDED` | 記録された rotation 日が無い → advisory |
| `EVENT_DRIVEN` | cadence が event-driven（「侵害が疑われるとき」「必要時」）なので**期限を持たない** |

## 4. ledger の読み方と更新

`quality/secret-rotation-ledger.json` は [`infisical-secrets.md`](infisical-secrets.md)
§2.1 の **Cadence 列**の機械可読投影であり、runbook の写しではない。
同じことを 2 か所に書くと片方が腐るので、片方を消すなら runbook 側。

| field | 意味 |
| --- | --- |
| `name` | runtime secret 名。§3.2 の命名規約を満たすこと（gate が parse 時に検査する） |
| `cadence.kind` | `calendar`（日数で期限を持つ）or `event_driven`（期限を持たない） |
| `cadence.days` / `cadence.label` | `calendar` の日数と、その cadence の runbook 上の文言 |
| `last_rotated_at` | 最終 rotation 実施日（`YYYY-MM-DD`）。**未記録は `null`** |
| `driver` | その name を変える operator 経路（script path、または明示された operator 操作） |
| `runbook` | 対応する runbook |

**更新は rotation と同じ PR で。** `last_rotated_at` は「予定日」ではなく
「実施日」を書く。書いた日から cadence が走り、90 日の窓が切れると
`OVERDUE` で `validate:fast` が落ちる。これは意図した挙動である。

**`null` のまま motiv にする理由**：本リポジトリは本番 secret をいつ
ローテーションしたか知らない。実施日は owner の記録であり、
agent が埋めるものではない。

## 5. 観測手順（operator）

```bash
# 1. 既存の status-only スクリプトを実行する（値は出ない）
pnpm run infisical:check:cf -- --execute --environment=prod | tee .tmp/cf-secrets-prod.txt

# 2. その出力をそのまま gate に渡す（構造化された record でも可）
pnpm run secrets:status:check -- --observation=.tmp/cf-secrets-prod.txt
```

受け付ける観測は 2 形。どちらも **name だけ**を持つ。

- `check-cf-secrets.mjs` の transcript。`[OK]` / `[FAIL]` 行と
  `missing:` / `extra:` 行を読む。
- 構造化された record `{ "environment": "prod", "captured_at": "YYYY-MM-DD",
  "missing": ["NAME"], "extra": ["NAME"] }`。

`missing` / `extra` に §3.2 grammar に合わない token が混ざると
`UNDECIDABLE`（exit 2）になる。**その token 自体は一度も出力されない。**
「値が混ざった transcript」を貼って直すのではなく、name だけを記録し直す。

## 6. 異常時の修復手順

| 観測 | 意味 | 対応 |
| --- | --- | --- |
| `MISSING` | 契約の required name を観測した環境が持っていない | §7 の canonical path で再投入する（`docs/runbook/cloudflare-workers-builds.md`）。投入後に同じ観測を取り直す。**値の貼付けはしない** |
| `MISSING_ROW` | 契約の name に ledger 行が無い | `quality/secret-rotation-ledger.json` に行を追加する。新規 runtime secret 追加は [`infisical-secrets.md`](infisical-secrets.md) §4.1 の手順（runbook 更新も同じ PR で行う） |
| `EXTRA_ROW` | 契約に無い name の ledger 行がある | 該当行を削除する。削除するのは ledger の行だけで、Infisical 側の実体を消すのは別の operator 判断 |
| `OVERDUE` | cadence 超過 | runbook の `driver` を operator 承認つきで実行し、rotation と同じ PR で `last_rotated_at` を更新する（§4） |
| `UNEXPECTED` | 環境が契約に無い name を持つ | 正常。削除要否は owner 判断。gate は報告のみ |
| `UNRECORDED` / `DUE_SOON` | 記録が無い / 期限が近い | rotation 実施日を記録する。advisory なので gate は落とさない |
| `UNDECIDABLE` | ledger / observation を読めない | exit 2。まず入力を直す（name の形だけ）。生のファイル本文を貼り付けない |

## 7. 正常時の確認手順

```bash
pnpm run secrets:status:check                       # repository 側（credential 不要）
pnpm run secrets:status:check -- --observation=.tmp/cf-secrets-prod.txt
pnpm run secrets:status:report                      # ダッシュボードの更新
```

正常 = `verdict=OK` かつ `advisory` がすべて解消している状態。
`NOT_OBSERVED` が残る限り、環境側は「まだ見ていない」であり
「問題がない」ではない。この 2 つは別の句子として表示するのが本 gate の目的。

## 8. 検証アーティファクト

- ダッシュボード: `pnpm run secrets:status:report` → `.tmp/secrets-status-only-report.html`
- コミット済み画像: `docs/verification/security/secrets-status-only.webp`
- _cases_: `quality/fixtures/secret-rotation-status/*.json`（6 ケース。value は含まれない）
- テスト: `node --test scripts/check-secret-rotation-status.test.mjs`
- fixture 単体の再現:
  `node scripts/check-secret-rotation-status.mjs --case=quality/fixtures/secret-rotation-status/<case>.json`

画像とこの runbook のどちらも proof としては **不十分**。判定は
`pnpm run secrets:status:check` の終了コードとテストが担保する。

## 9. 禁止事項（AGENTS.md §4 の再掲）

- `infisical secrets …` / `wrangler secret list --format pretty` による値の listing。
- 観測ファイルや Issue / PR に値を貼り付けること。
- `--now` による時計の固定（`--case` 同時に与えられないので、gate 自身は
  時計を固定できない）。
- 本 gate で rotation / deploy を行うこと（operator flow の領域）。

## 10. 未決の owner decision

- 全行に `last_rotated_at` を入れた後、`UNRECORDED` を fail にするか advisory のままにするか。
- `DUE_SOON` の窓を ledger（name ごと）に持たせるか、gate の既定値（14 日）に留めるか。
- environment 観測を operator 手記録のままにするか、status-only の出力を機械的に記録する経路を別途用意するか。