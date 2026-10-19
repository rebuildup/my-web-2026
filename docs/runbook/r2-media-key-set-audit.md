# R2 key-set 監査 runbook (Issue #577, owner 案 (a))

> `MEDIA` bucket に存在する key 集合を**読み取り専用**で列挙し、
> `PUBLIC_MEDIA_PREFIXES` の外側に 1 件でもあれば release gate を
> fail させる監査の手順。Issue #577 の owner 決定（2026-10-19 09:06 JST、
> 案 **(a)**）を実装したものがこの runbook の対象。

**status-only 契約**が本 gate の中心にある。出力は verdict・件数・
reason code のみで、**object key・key 断片・credential・bucket の一覧を
一切出さない**（AGENTS.md §4、`docs/runbook/infisical-secrets.md` の
precedent）。出力はそのまま PR 本文や Issue に貼れる。

---

## 1. 何を強制しているのか

公開 R2 custom domain（`docs/portfolio/decisions.md` Decision 5）は
**Worker を迂回する**。`src/cloudflare/media-visibility.ts` の namespace
allowlist はコード上 2 経路（`composeMediaUrl` / `getImageStream`）でしか
発動しないため、**bucket に既に存在する object** は anonymous で取得できて
しまう。 Issue #459 が閉じられなかった「bucket 側の強制手段」がここである。

本 gate の主張は 1 つに尽きる。

> `MEDIA` bucket の全 key が、公開配信を許可された namespace に属する。

1 件でも破れば release gate は fail する。allowlist は
`src/cloudflare/media-visibility.ts` の `PUBLIC_MEDIA_PREFIXES` を**そのまま
使い**、スクリプト内に prefix を再宣言しない（SoT は 1 つ）。

## 2. 実行方法

```bash
# 本番 release gate（read-only / R2 スコープ credential が必要）
CLOUDFLARE_R2_API_TOKEN=… pnpm run r2:media:audit

# ローカル store（配線確認のみ。本番の verdict ではない）
pnpm run r2:media:audit:local

# 記録済み listing でのデモ（release verdict ではない。出力に source=fixture と出る）
pnpm run r2:media:audit -- --fixture=quality/fixtures/r2-media-key-set/out-of-allowlist.json

# 検証用 HTML レポート（下記スクリーンショットの生成元）
pnpm run r2:media:audit:report   # -> .tmp/r2-media-key-set-report.html
```

Exit codes:

| code | verdict | 意味 |
| --- | --- | --- |
| `0` | `OK` | 全 key が allowlist 内 |
| `1` | `VIOLATION` | allowlist 外の key が 1 件以上 |
| `2` | `UNDECIDABLE` | **判定不能**（fail-closed）。credential 無し / API 失敗 / 解析不能 / 空の production key 集合 / 列挙不完全 / usage error |

`2` が pass と同じ信号にならないことがこの gate の要件である。
「読めなかった」を「clean」に落とす実装は、この gate の存在意義を消す。

### CI からの実行方針（credential 供給）

**GitHub Actions からは実行しない。** この repository の
`.github/workflows/**` は Cloudflare credential を**一切保持しない**
（`grep 'secrets\.' .github/workflows/` は 0 件）。production の R2
read token を Actions の secret store に複製することは、
`docs/runbook/cloudflare-workers-builds.md` が定める
「Infisical が runtime secret 値の SoT」「GitHub Actions は検証と手動
production smoke のみ」という分離を壊す。

そのため:

- `r2:media:audit` は `validate:fast` / `validate:integration` /
  `validate:release` の**いずれにも含まれない**。
- 実行主体は **R2 スコープ credential を保持した operator** であり、
  release 手順（`docs/release.md` §Sprint cycle 9 の前）で行う。
- decision は `quality/profile.yaml#r2_media_key_set_audit` に記録する。
  dependency advisory gate（Issue #470）が「CI ステップだが credential を
  要しない」的那个であるのに対し、本 gate は remote read 自体に credential
  が要るため、もう一段厳しい（operator 実行）方針を採る。

### 既存 secret SoT / deploy への影響

**deploy・mutation は一切行わない。** 本 gate は `cf r2 objects list`
（read）しか呼ばない。`scripts/_r2.mjs` の production **write** gate
（`assertProductionWriteAllowed`）は呼ばれないので、production への書き込み
経路はこの gate には存在しない。credential は R2 スコープの read token だけ
で足り、Worker deploy token（`CLOUDFLARE_API_TOKEN`）でも D1 token
（`CLOUDFLARE_D1_API_TOKEN`）でも代用しない（`scripts/_r2.mjs` の
credential 分離）。raw な CLI エラー文字列は出力しない（唯一の
credential 混入しうる入力なので、reason code に丸める）。

## 3. 正常時の観測

```text
[r2-key-set] source=production target=production bucket=my-web-2026
[r2-key-set] verdict=OK
[r2-key-set] reason=-
[r2-key-set] keys_total=… keys_inside_allowlist=… keys_outside_allowlist=0
[r2-key-set] allowlist_prefixes=2 prefix_source=src/cloudflare/media-visibility.ts
[r2-key-set] pages_walked=1 enumeration=complete
[r2-key-set] diff=none
```

`verdict=OK` かつ `keys_outside_allowlist=0` かつ
`enumeration=complete` の 3 つが揃って初めて release gate を通過する。

### スクリーンショット

コミット済み検証物
[`docs/verification/security/r2-media-key-set-audit.webp`](../verification/security/r2-media-key-set-audit.webp)
は `pnpm run r2:media:audit:report` の出力（記録済み listing 4 ケースの実測
verdict ＋ status-only の CLI 出力）を撮影したものである。object key・
credential・bucket の一覧は写っていない（生成側が leak guard を通している）。

## 4. 異常時の観測と手順

### 4.1 `verdict=VIOLATION`（exit 1）

`keys_outside_allowlist` が 1 以上。allowlist 外の object が bucket に
存在する、つまり custom domain から匿名で取得できる状態。

判断は operator 側のもの（**この repository は production を変更しない**）。

1. 出力には key 名が出ない。どの key なのかを特定する必要がある場合は
   operator の端末で read する。`docs/runbook/infisical-secrets.md` の
   「status-only 出力は専用スクリプトが担う」という原則に従い、
   transcript に残すのは operator が承認した情報だけとする。
2. 対応は原则上「その object を公開配信に載せない」こと:
   - 公開してよい object なら、**producer と同じ review** で
     `PUBLIC_MEDIA_PREFIXES` に prefix を追加する
     （`src/cloudflare/media-visibility.ts` のコメントが要求する
     「producer と同時レビュー」の规矩）。
   - 公開しない object なら、production bucket からの削除・移設は
     operator の判断（agent は mutation を行わない）。
3. 修正後は `pnpm run r2:media:audit` を再実行し、`verdict=OK` を確認する。

### 4.2 `verdict=UNDECIDABLE`（exit 2）

| reason | 意味 | 対処 |
| --- | --- | --- |
| `credential_missing` | `CLOUDFLARE_R2_API_TOKEN` 未設定 | Infisical から R2 スコープ token を供給して再実行 |
| `listing_failed` | R2 API 呼び出し失敗 | ネットワーク / token 権限を確認。**raw エラーは出力されない**ので、operator が read 相当を自分で実行して原因を見る |
| `listing_unparseable` | 応答が JSON 配列でも `{objects:[…]}` でもない / entry に key が無い | CLI / API の応答形状が変わった可能性。`_r2-media-key-set.mjs` の `readPageKeys` を見直す |
| `listing_empty` | production key 集合が空 | 「本当に空」か「空が返っただけ」か区別できないため fail-closed。read を個別に再現して判断する |
| `listing_incomplete` | page が上限（1000）ちょうどで返った、または応答が `truncated: true` | **既知の制約**。この driver は cursor を取得できない（後述）ため、1000 key 以上の bucket は本 gate の対象外。bucket 分割（owner 案 (b)）か driver のページング対応が必要 |

いずれも **fail-open ではなく fail-closed** であり、`OK` へ落とす
escape hatch は存在しない（意図的）。

## 5. スコープ境界（強制しないこと）

この gate は **namespace allowlist の外**だけを強制する。以下は強制しない。

| 対象 | なぜこの gate では閉じないか |
| --- | --- |
| allowlist **内**の未公開 object（`portfolio/` にある draft project の cover など） | namespace は公開可だが公開状態は D1 の行が決める。本 gate は D1 を読まない。custom domain からは取得できるままである |
| custom domain の添付有無そのもの | Cloudflare account 設定であり、この repository は確認も変更もできない（Decision 5 の release prerequisite） |
| object 本文の内容・承認ワークフロー | 配信経路の gate ではなく公開判定（`status='published'`）の責務で、`src/portfolio/` が所有 |
| 1000 key 以上の bucket | driver が cursor を取得できない既知の制約（4.2 参照） |

したがって「namespace 内外の強制」としての本 gate は、
**Issue #459 の受け入れ条件 1 の前提**を満たす（key-set の実測 enforcement が
存在した）が、**allowlist 内の公開状態**は別 Issue の領域として残る。

## 参照

- [`src/cloudflare/media-visibility.ts`](../../src/cloudflare/media-visibility.ts) —
  allowlist と分類規則（本 gate の SoT）。
- [`docs/security/r2-media-visibility.md`](../security/r2-media-visibility.md) —
  コードが強制する範囲 / しない範囲。
- [`docs/portfolio/decisions.md`](../portfolio/decisions.md) Decision 5 —
  配信 mechanism の決定と Issue #577 amendment。
- [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) —
  status-only 出力の precedent。
- [`scripts/check-r2-media-key-set.mjs`](../../scripts/check-r2-media-key-set.mjs) /
  [`scripts/_r2-media-key-set.mjs`](../../scripts/_r2-media-key-set.mjs) —
  gate と純粋 seam。