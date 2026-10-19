# R2 メディア復旧 runbook (Issue #462)

> 公開画像が `MEDIA` bucket から消えたときに、**消えたものと同じ物体**を
> 戻す手順。source 保全の要件、削除時の分岐、metadata 整合の判定基準、
> 失敗時の挙動をここで定義する。専用の proof は
> `pnpm run r2:restore:proof`（fixture のみ・credential 不要）。
>
> **status-only 契約**が本 runbook の中心にある。出力は verdict・
> reason code・件数のみで、**object key・key 断片・namespace・source path・
> credential を一切出さない**（AGENTS.md §4、
> [`infisical-secrets.md`](infisical-secrets.md) の precedent、
> [`r2-media-key-set-audit.md`](r2-media-key-set-audit.md) と同じ契約）。

---

## 1. 何を強制しているのか

公開画像（R2 custom domain 経由）は **bucket に存在すれば誰でも取得できる**
（[`docs/portfolio/decisions.md`](../portfolio/decisions.md) Decision 5、
[`r2-media-visibility.md`](../security/r2-media-visibility.md)）。
その結果、復旧手順が守るべき不変条件は 3 つになる。

| # | 不変条件 | 誰が決めるか |
| --- | --- | --- |
| 1 | 復旧は **公開可否のゲートを通ってから** しか書き込まない | `classifyMediaKey`（`src/cloudflare/media-visibility.ts` が所有） |
| 2 | 復旧は **manifest（sha256 / byte 長 / content type）と一致する bytes** だけを書き込む | 復旧 manifest（operator が削除前に取得する記録） |
| 3 | 復旧は **write 後に read-back で一致を確認できたものだけ** を成功と報告する | `src/cloudflare/media-restore.ts` の復旧モデル |

この 3 つが `restoreMediaObject` に実装されている。危険な帰結は
「画像が残らないこと」ではなく、**誤った物体・誤った metadata・誤った公開可否の
まま「復旧成功」と言われること**である。だから失敗状態
（`refused_key` / `missing_source` / `metadata_drift` / `undecidable`）は
手順の一部であり、抜け道ではない。

## 2. 前提となる source 保全

**R2 の object ではなく、bucket 外の保管物だけが唯一の復旧源である。**

- 復旧に必要な manifest は 4 項目: `key` / `sha256` / `sizeBytes` /
  `contentType`。
- **本 repository の DB は manifest を提供できない**。
  `portfolio_media` 行は `r2_key` と `content_type` を持つが digest と
  byte 長を持たない（`migrations/0007_portfolio.sql`）。したがって manifest は
  **削除前に operator が取得する記録**である。列の追加は別の schema 決定であり、
  この Issue では行っていない（[§7](#7-この手順が閉じないこと)）。
- manifest を持たない key は、復旧の**対象にならない**。取得できない digest を
  「たぶん同じ画像」で埋めることは、公開済み D1 行の先を別の画像で静かに
  差し替えることに等しい。

## 3. 手順

```text
1. manifest を確定する       key / sha256 / sizeBytes / contentType
2. bucket 現状を確認する     deleted / intact / drifted
3. 判定                      intact なら already_intact で終了（write しない）
4. retained source を読む    無ければ missing_source（write しない）
5. source を manifest と照合  ずれたら metadata_drift（write しない）
6. 書き込む                 manifest の content type で保存
7. read-back で照合           不一致なら metadata_drift（= 復旧ではない）
```

各ステップは short-circuit し、`checks` 列は「どこで止まったか」を示す。
`checks` が空 = key gate で停止（bucket を read も write もしていない）。

### 3.1 削除時の対応（分岐）

| 起点状態 | 手順 | 結果 |
| --- | --- | --- |
| object が存在し manifest と一致 | 3 で終了 | `already_intact`（**再 write しない**。冪等） |
| object が存在するが bytes が違う | 5 → 6 → 7 | `restored`（**上書き**。read-back で確認） |
| object が存在するが content type が欠落 / 不一致 | 5 → 6 → 7 | `restored`（manifest の content type で修復） |
| object が存在しない（削除済み） | 4 → 5 → 6 → 7 | `restored` |
| object が存在せず source も無い | 4 で終了 | `missing_source`（exit 1、**bucket は空のまま**） |
| source が読めない | 4 で終了 | `undecidable`（exit 2） |

### 3.2 metadata 整合の判定

3 項目すべてが一致し、**read-back 後にも**一致すること。

| 項目 | 判定方法 | 不一致時の reason |
| --- | --- | --- |
| bytes | sha256（hex、小文字で比較） | `source_digest_mismatch` / `readback_digest_mismatch` |
| 長さ | `sizeBytes` | `source_size_mismatch` / `readback_size_mismatch` |
| content type | media type のみ比較（`; charset=…` 等の parameter は無視） | `source_content_type_mismatch` / `readback_content_type_mismatch` |

保存された content type が**解釈不能な場合**（空文字など）は一致扱いしない。
「読めない metadata は一致ではない」= 修復パスが走る、という扱い。

### 3.3 書き込んではいけないもの

- **private / 未宣言 namespace の key**。`classifyMediaKey` が
  `publiclyServable: false` を返した時点で **write 前に**停止する。
  復旧は「意図的に公開するもの」を戻す操作なので、公開可否を信頼せず再判定する。
- **manifest に無い bytes**。5 を通過できないものは write されない。
- **検証できない write**。6 が成功を返しても 7 を通らなければ復旧ではない。

## 4. 検証方法

### 4.1 fixture proof（credential 不要・本番非接触）

```bash
# 7 ケース（記録済み fixture）を実行し、宣言どおりに振る舞ったか検証する
pnpm run r2:restore:proof

# 検証レポート（Issue が求めるスクリーンショットの生成元）
pnpm run r2:restore:proof:report   # -> .tmp/r2-restore-proof.html
```

Exit codes:

| code | 意味 |
| --- | --- |
| `0` | 全 fixture が宣言どおりに振る舞った（手順が成立している） |
| `1` | 1 ケースでも期待外（**手順が成立していない**）、または leak guard が発火 |
| `2` | bad input（fixture が読めない / 宣言した digest が自分の bytes と一致しない / usage error） |

`missing_source` や `metadata_drift` のケースが **期待どおりだった**こととして
数えられるのは意図通りである。この proof が主張するのは「その状態を手順が
正しく報告する」ことであり、「その状態が発生しない」ことではない。
起こってはならないのは **deviation** だけである。

### 4.2 実 R2 binding（local fixture）

```bash
pnpm exec vitest run test/integration/r2-media-restore.test.ts   # 削除→復旧→配信
pnpm exec vitest run src/cloudflare/media-restore.test.ts        # 純ロジック
```

前者は workerd の local R2 fixture に対して**実際に delete してから**復旧し、
`createPublicMediaDelivery` で配信が戻ることを確認する。production bucket・
deploy・remote mutation は一切行わない。

### 4.3 本番 R2 での実運用

```text
production への復旧 write は operator 専用。
```

- `MEDIA` への write には R2 スコープ credential が必要で、
  `.github/workflows/**` は Cloudflare credential を保持しない
  （[`cloudflare-workers-builds.md`](cloudflare-workers-builds.md)）。
  したがって **CI は復旧を実行しない**。
- 本番 write は事故対応としてのみ行い、通常の release には含めない。
  key-set 監査（Issue #577）と同様、credential 供給は operator の責務である。
- 本番 write 前に必ず **read-only** で現状を確認する:
  `pnpm run r2:media:audit`（key-set）と、本手順の manifest 照合。
  write 後に同じ read-only 監査を再実行し、「allowlist 外の key が増えていない」
  ことを確認する。

## 5. 失敗時の挙動

このコマンド / モデルは **production を変更しない**。operator が実行して
production を書くのは §4.3 の手順だけであり、その判断は operator のものです。
下表は「モデルが自動判定すること」と「その先の判断が誰のものか」の記録である。

| 事象 | モデルの判定 | その後の判断 |
| --- | --- | --- |
| key が private / 未宣言 | `refused_key` (exit 1)、write なし | operator が「公開してよい key か」を判断。prefix の追加は producer と同時レビュー（`src/cloudflare/media-visibility.ts` の要求） |
| source が無い | `missing_source` (exit 1)、write なし | operator が source を確保するか、画像を欠落のまま受け入れるか |
| source が manifest と不一致 | `metadata_drift` (exit 1)、write なし | operator が manifest を取り直す（source が新しければ manifest も新） |
| read-back 不一致 | `metadata_drift` (exit 1) | operator が原因を調査。**復旧完了とは扱わない** |
| bucket / source を読めない | `undecidable` (exit 2) | operator が権限・ネットワークを確認。**「確認できなかった」を成功に落とさない** |

## 6. status-only 出力

```text
[r2-restore] target=test-bucket case=deleted-then-restored
[r2-restore] verdict=restored
[r2-restore] reason=-
[r2-restore] exit=0
[r2-restore] checks=key_gate>store_read>source_read>source_matches_manifest>write>readback
[r2-restore] printed=verdict,reason-codes only (no object key, no source path, no credential)
```

reason code は §5 の表が全体であり、自由なメッセージは出さない。
出力と HTML の両方を**実行前に** `assertNoKeyInText`
（`scripts/_r2-media-key-set.mjs` 由来）を通しており、1 件でも検出すれば
コマンドは非ゼロ終了する。

## 7. この手順が閉じないこと

- **manifest を DB から取れない**。`portfolio_media` に digest / size 列が
  無い（§2）。schema 追加は別 Issue。
- **production の key-set に対する復旧は未検証**。上記 proof は実 R2 に
  対しても **local fixture** に対して実行する。production write は operator が
  §4.3 の手順で行う（本 repository は自動で write しない）。
- **custom domain 越しの実配信は確認できない**。`media.rebuildup.dev` の
  attachment は Cloudflare account 設定であり、本 repository は確認も変更も
  できない（Decision 5 の release prerequisite）。
- **allowlist 内未公開 object の扱い**は別問題（key-set audit と
  `r2-media-visibility.md` の residual）。復旧手順は「公開 key の復旧」だけを
  扱い、未公開 object の公開化は行わない。

## 参照

- [`src/cloudflare/media-restore.ts`](../../src/cloudflare/media-restore.ts) —
  復旧契約の実装（純ロジック・status-only）。
- [`src/cloudflare/media-visibility.ts`](../../src/cloudflare/media-visibility.ts) —
  可視性ゲート（`classifyMediaKey` / `PUBLIC_MEDIA_PREFIXES` の SoT）。
- [`scripts/r2-media-restore-proof.mjs`](../../scripts/r2-media-restore-proof.mjs) —
  fixture proof CLI（`quality/fixtures/r2-media-restore/` を実行）。
- [`docs/security/r2-media-visibility.md`](../security/r2-media-visibility.md) —
  コードが強制する範囲 / しない範囲。
- [`docs/runbook/r2-media-key-set-audit.md`](r2-media-key-set-audit.md) —
  production の read-only 監査（Issue #577）。
- [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) —
  status-only 出力の precedent。