# D1 バックアップ / リストア runbook (Issue #461)

> D1 のバックアップが復元できることを、**使い捨ての local fixture** で
> 実証する手順。本番 DB への実行は禁止する。実 DB での確認は operator が
> **テスト用 DB** に対してのみ行う。
>
> **status-only 契約**が本 runbook の中心にある。出力は verdict・
> reason code・件数のみで、**database id・database 名・table / column 名・
> row 値・credential を一切出さない**（AGENTS.md §4、
> [`infisical-secrets.md`](infisical-secrets.md)、
> [`r2-media-restore.md`](r2-media-restore.md) と同じ契約）。

---

## 1. 何を強制しているのか

| # | 不変条件 | 実装 |
| --- | --- | --- |
| 1 | バックアップが**完全であると証明できるまで、DB に 1 文も書かない** | `parseD1Backup`（構文 → 構造 → 件数 → digest） |
| 2 | import は**単一 transaction** で行う | `restoreD1Database` の 1 回の `D1Database.batch()` |
| 3 | **read-back が一致したときだけ** `restored` と報告する | 復元後にもう一度 export して比較 |
| 4 | schema は SQLite が記録した `CREATE` 文を**そのまま**再作成する | `sqlite_master.sql` を保持 |
| 5 | 出力は verdict / reason code / 件数だけ | `formatD1RestoreReport` |
| 6 | **保存されていた値を復元できない数値は、書き戻さない**（Issue #701） | [`src/cloudflare/d1-numeric.ts`](../../src/cloudflare/d1-numeric.ts) の数値規則（export / parse / bind の 3 箇所が同じ規則を参照する） |

危険な帰結は「復元が何もしないこと」ではない。**バックアップの一部だけが
書かれ、テーブルは存在するが行が欠けている状態**である。その状態は
クエリに応答し、欠落は後から「違うページ」として現れる。だから
unreadable / partial / digest 不一致は手順の一部であり、抜け道ではない。

6 番目も同じ種類の危険を避ける。**値が丸められたのに復元成功と報告される
状態**は、行が存在してクエリに応答し、桁が 1 つ違う形で後から現れる。
だから「digest が一致した」だけでは復元成功の根拠にならない。

## 2. 適用範囲と禁止事項

- この repository が自動実行するのは **local fixture のみ**:
  [`test/integration/d1-backup-restore.test.ts`](../../test/integration/d1-backup-restore.test.ts)
  が workerd の local `env.DB` に対して seed → export → drop → import →
  read-back を行う。整数精度の境界は
  [`test/integration/d1-backup-integer-precision.test.ts`](../../test/integration/d1-backup-integer-precision.test.ts)
  が同じ binding に対して検証する（Issue #701）。
- **production の D1 に対して export / import / drop を実行しない。**
  canonical な production database id を引数に取る操作は、この手順の
  対象外である。`pnpm run db:migrate:apply:production` も使わない。
- `.github/workflows/**` は Cloudflare credential を保持しない
  （[`cloudflare-workers-builds.md`](cloudflare-workers-builds.md)）。
  remote なテスト DB 操作は **operator の責務**であり、CI では実行しない。
- `cf` は D1 を **remote 既定**で扱う。`cf d1 ... --local` を省略した
  コマンドは本手順では使用しない。local 操作は
  `--persist-to .tmp/d1state` まで含めて明示する。
- `wrangler` を使う場合も、`--remote` の対象が**自分が作った使い捨ての
  テスト DB** であることを実行前に確認する。production の database id を
  コマンドラインに置かない。
- **値を表示しない。** `SELECT *` の結果、row の内容、row の先頭文字列、
  database id、token を出力・貼り付けしない。比較は件数・`MATCH` /
  `DIFFER`・reason code までで止める。

## 3. 手順

### 3.1 local fixture proof（credential 不要・本番非接触）

```bash
pnpm run d1:backup:proof
# 検証レポート（Issue が求めるスクリーンショットの生成元）
pnpm run verify:d1-backup-restore-screenshot
#   -> .tmp/d1-backup-restore.html
#   -> docs/verification/security/d1-backup-restore.webp
```

suite は 7 ケースを実行する。

| ケース | 期待 |
| --- | --- |
| export → drop → import → read-back | `restored`、schema / rows / digest が一致 |
| truncated JSON | `unreadable_backup`、テーブルは作られない |
| 保存後に row を編集 | `digest_mismatch`、既存行は変わらない |
| `rowCount` と rows の不一致 | `row_count_mismatch`、書き込みなし |
| row の幅と columns の不一致 | `row_shape_mismatch`、書き込みなし |
| JSON が表現できない数値（`1e999`） | `invalid_backup`、既存行は変わらない |
| batch 内の制約違反 | `apply_failed`、**batch 全体が rollback** |

最後のケースが「半端に書かない」ことの証明である。同じ batch に入れた
`CREATE TABLE` と先行 INSERT も、失敗した INSERT と一緒に rollback され、
テーブルは 1 つも残らない。

### 3.1.1 整数精度の fixture（Issue #701）

同じ `pnpm run d1:backup:proof` が
[`test/integration/d1-backup-integer-precision.test.ts`](../../test/integration/d1-backup-integer-precision.test.ts)
も実行する。比較の基準は **fixture に書かれたリテラル**であり、export した
文書の値ではない。export した値と比較すると、両者が同じ丸め後の値を持つの
で通ってしまうため。

| 入力 | 期待 |
| --- | --- |
| ±(2^53 − 1) / REAL / NULL | export → drop → import → `restored`。fixture のリテラルと一致 |
| ±2^53 / SQLite int64 上下限 | export が `unsupported_value` で失敗。行は変更されない |
| digest が正しくても整数が安全範囲外の文書 | `invalid_backup`（exit 2）。テーブルは 1 つも作られない |

規則そのものは
[`src/cloudflare/d1-numeric.test.ts`](../../src/cloudflare/d1-numeric.test.ts)
（unit）が境界値を固定する。

### 3.2 実テスト DB での operator 手順

**production では実行しない。** 以下は operator が自分で作成した
使い捨てのテスト DB に対してのみ行う。database id や接続情報は
コマンドライン・ログ・PR に残さない。

```text
1. テスト DB を用意する
   使い捨ての D1 を 1 つ作成する（名前は operator の管理下）。
   production の DB / binding / id は使わない。

2. 合成行を seed する
   固定の文字列・数値・小さな BLOB だけを入れる。
   個人情報、実在の識別子、本番からコピーした行を入れない。

3. baseline を取る
   export を 1 つ取得し、ファイルの digest と table 件数を記録する。
   出力は digest / 件数のみ。row 値は表示しない。
   export は Cloudflare dashboard の D1 export や operator が管理する
   `wrangler d1 export` など、repository script ではない surface を使う。
   `--remote` を渡す場合は、対象がテスト DB であることを先に確認する。

4. 復元可能性を壊す
   テスト DB のテーブルを drop する、またはテスト DB 自体を
   delete → create する。production に対して同じ操作をしない。

5. import する
   3 の export をテスト DB に戻す。コマンドの exit code を記録する。

6. 比較する（status-only）
   もう一度 export し、3 の baseline と比較する。
   - table 件数が一致
   - export の digest が一致
   - import の exit code が 0
   すべて一致したときだけ MATCH。1 つでも違えば DIFFER として停止する。

7. 後片付け
   テスト DB を削除する。export ファイルは `.tmp/` に置き、
   repository に commit しない。
```

比較は次の形で止める。**row 値も database id も出さない。**

```text
[d1-operator] target=test-db
[d1-operator] baseline=recorded
[d1-operator] tables=2
[d1-operator] import_exit=0
[d1-operator] verdict=MATCH
```

`DIFFER` のときは「たぶん同じ」で進めない。§4 の reason code に対応する
原因（partial export、digest 不一致、import の制約違反）を切り分け、
baseline を取り直すか、テスト DB を作り直して最初からやり直す。

### 3.3 local D1 を CLI で確認する場合

local の D1 は credential 不要で、`cf` の `--local` と
`--persist-to .tmp/d1state` で操作できる。`--local` を省略しない。

```bash
# 読み取りのみ（counts）
pnpm exec cf d1 raw <database-id> --local --persist-to .tmp/d1state \
  --sql "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
```

`<database-id>` は local の識別子であり、production の id を渡す必要は
ない。production の id を local コマンドに混ぜないこと自体が、取り違えを
防ぐ。

## 4. 失敗時の挙動

`restoreD1Database` は次の reason code を返す。**書き込みの有無**が
判定の一部である。

| reason | exit | 発生条件 | DB の状態 |
| --- | --- | --- | --- |
| `unreadable_backup` | 2 | JSON として読めない（truncate / 破損） | 1 文も届かない |
| `invalid_backup` | 2 | format / version / 構造が不正 | 1 文も届かない |
| `row_count_mismatch` | 2 | 宣言した `rowCount` と rows が違う | 1 文も届かない |
| `row_shape_mismatch` | 2 | row の幅が columns と違う | 1 文も届かない |
| `digest_mismatch` | 2 | 保存後に内容が変わった | 1 文も届かない |
| `apply_failed` | 1 | batch が制約違反などで失敗 | **batch 全体が rollback** |
| `readback_mismatch` | 1 | commit 後の export が一致しない | 成功として扱わない |

`refused`（exit 2）は **bad input**、`failed`（exit 1）は **手順が成立して
いない**ことを意味する。どちらも「復元できた」ではない。

## 5. status-only 出力

fixture proof の出力例:

```text
[d1-restore] target=local-fixture
[d1-restore] verdict=restored
[d1-restore] reason=-
[d1-restore] exit=0
[d1-restore] tables=2 rows=6
[d1-restore] checks=parse>validate>apply>readback
[d1-restore] printed=verdict,reason-codes,counts only (no table name, no row value, no database id, no credential)
```

`D1RestoreResult` は table 名・column 名・row 値・database id を保持しない。
report は verdict / reason / 件数 / checks だけを描画する。

## 6. この手順が閉じないこと

- **production-scale の backup / restore は本 module の対象外**。全行を
  メモリに載せ、1 行 1 INSERT で戻す形は、使い捨てのテスト DB の
  proof に合わせた大きさである。本番規模は Cloudflare の export /
  import surface を operator が使う。
- **remote テスト DB の自動化はない**。Cloudflare credential を持つ
  workflow が存在しないため、§3.2 は operator の手順として残る。
- **point-in-time / Time Travel は検証していない**。この Issue は
  export → import の往復だけを扱う。
- **復元対象は backup に含まれるテーブルだけ**。backup に無いテーブルは
  変更しない。テスト DB 全体を作り直す場合は、DB 自体を delete →
  create する（§3.2 の 4）。
- **view / trigger / virtual table は export しない**。`sqlite_master` の
  `table` / `index` だけを対象にしている。これらを含む schema は、
  Cloudflare の export surface で取得した SQL を別途検証する。
- **INTEGER が IEEE-754 の安全範囲を超える値は export が失敗する**。
  丸めた値を黙って書き戻すより、`unsupported_value` で止まる方を選ぶ。
  規則の詳細は §7。
- **保存された値の型（INTEGER / REAL）は復元されないことがある**。保証
  されるのは*数値*の一致であり、SQLite の列 affinity が bind した値の
  型を決める。値は厳密に一致する。
- **外部キー**は batch 内で `PRAGMA defer_foreign_keys = ON` を先頭に
  置く。batch の外に参照がある schema は、テスト DB を分けて検証する。

## 7. 整数の精度境界（Issue #701）

SQLite は INTEGER を 64-bit 整数で保存する。D1 の JavaScript アダプタは
数値列を `number`（IEEE-754 double）として返す。この 2 つの表現は
±(2^53 − 1) を外れた int64 で**一致しない**。実装の `encodeValue()` は
`Number.isFinite()` だけで number を受理していたため、
±(2^53 − 1) を超える値は丸められた上で export され、digest も read-back
比較もその丸め後の値を使っていた。**digest が一致しても、保存されていた
int64 が復元できたことの証明にはならない。**

### 規則

数値は次の 3 経路すべてで同じ判定を通る
（[`src/cloudflare/d1-numeric.ts`](../../src/cloudflare/d1-numeric.ts)）。

| 値 | 判定 | 根拠 |
| --- | --- | --- |
| 安全整数（\|v\| ≤ 2^53 − 1） | 受理 | この範囲の int64 は double が正確に保持できるので、アダプタの値は保存されていた整数そのもの |
| 有限の小数 | 受理 | int64 は必ず整数 double に変換される。小数を作れるのは REAL だけ。REAL は double として保存されるため値は厳密 |
| 安全範囲外の整数値 | **拒否** | 丸められた int64 である可能性があり、文書がどちらの int64 だったかを示せない |
| 非有限値（NaN / Infinity） | **拒否** | JSON が表現しない |

拒否は片側（fail-closed）で、**復元できたはずの値まで拒否する**。規則は
1 本の線（2^53 − 1）で描き、2^53 を超える整数値は REAL であっても拒否する。
規則が判断できるのは**値だけ**である（列の storage class は adapter 経由で
値に含まれない）。int64 範囲外の値は REAL 確定であるとして 2 本目の線を
引けば該当ケースは救えるが、主張・証明・監査が 1 つ増えるだけで、Issue が
求める検査は safe integer である。復元できたはずの値を拒否する代償は、
復元できない値を受け入れる代償より小さい。

### 失敗時の挙動

| 経路 | 結果 | DB の状態 |
| --- | --- | --- |
| export | `D1BackupExportError('unsupported_value')` | 文書を作らない。部分バックアップを作らない |
| parse | `invalid_backup`（exit 2） | 1 文も届かない |
| restore の bind | `invalid_backup`（exit 2） | 文書を作り終える前に fail-closed。1 文も発行されない |

### adapter 制約（記録）

損失は **SQLite ではなく JavaScript アダプタ**で起こる。SQLite 自身は
int64 を正確に保持し（SQLite の JSON surface は 9223372036854775807 を
正確に印字する）、アダプタだけが 2^63 として返す。この module はその値を
「それらしい数字」として書かず、拒否する。

**この module は、JS の `number` を通らない経路の代替ではない。** int64 を
テキストとして書く Cloudflare 側の export surface（§3.2 の operator 手順）
がこの種のデータベースに対する operator 経路である。実データ損失の発生は
未確認であり、本 Issue は「損失が起きている証拠」ではなく「丸めた値を
成功扱いしない契約」を作るためのものである。

## 参照

- [`src/cloudflare/d1-backup.ts`](../../src/cloudflare/d1-backup.ts) —
  export / parse / restore の契約（status-only）。
- [`src/cloudflare/d1-numeric.ts`](../../src/cloudflare/d1-numeric.ts) —
  D1 と JavaScript の数値境界の規則（Issue #701）。
- [`test/integration/d1-backup-restore.test.ts`](../../test/integration/d1-backup-restore.test.ts) —
  local workerd D1 に対する 7 ケース。
- [`test/integration/d1-backup-integer-precision.test.ts`](../../test/integration/d1-backup-integer-precision.test.ts) —
  整数精度の fixture（Issue #701）。
- [`scripts/make-d1-backup-restore-report.mjs`](../../scripts/make-d1-backup-restore-report.mjs) —
  検証レポートと WebP の生成元。
- [`docs/verification/security/d1-backup-restore.webp`](../verification/security/d1-backup-restore.webp) —
  Issue #461 の検証画像。
- [`docs/runbook/r2-media-restore.md`](r2-media-restore.md) —
  同じ「復元したことを read-back で証明する」契約。
- [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) —
  status-only 出力の precedent。
