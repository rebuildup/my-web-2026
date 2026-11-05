# 配信バイトの監査範囲を `src/**` へ広げた検証 — Issue #780

- 対象: `scripts/check-asset-licenses.mjs`（`collectServedSourceAssets` / `quality/asset-license-pending.json`）
- 関連: `docs/verification/legal/asset-license-review.md`（判定契約と監査範囲）、`asset-license-review-report.md`（機械生成の実行記録）
- 状態: **検出・fail-closed・台帳の機構まで実装済み。`src/home/digits/*.webp` 10 件の権利判断は owner 未決**（記録は作っていない）

## 1. 何が欠けていたか

gate の監査対象は `public/**` だけで、Vite が `src/**` から取り込んで `/assets/<hash>` として配信する
バイトは対象外だった。同じバイトは `public/` に置けば `L001`（error）で落ちるが、`src/` に置いて
import するだけで通過する。fail-closed を掲げる obligation に対して、置き場所を選ぶだけで回避できる状態だった。

## 2. 何を検出するようにしたか

監査対象を `public/**` ∪ `src/**` の import が指す静的アセットに広げた。後者は**宣言ではなく導出**で、
`src/**` の `import` / `export … from` / `import()` / CSS `url()` の文字列リテラルを静的スキャンし、
`vite.config.ts` の `~` エイリアスを解決し、asset 拡張子の allowlist に一致して実在するファイルを返す。
`*.test.*` / `*.spec.*` / `*.stories.*` は importer から除く（本番グラフに入らないため）。

build は要求しない（`dist/**` を読まない）。ネットワーク・資格情報・binding も使わない。出力は従来どおり
status-only（判定・件数・code のみ）。

## 3. 実測（このブランチ、`node scripts/check-asset-licenses.mjs`）

| 状態 | 監査対象 | 記録が主張 | 未記録 | 判定 |
| --- | --- | --- | --- | --- |
| 台帳なし（検出だけ入れた状態） | 126 | 116 | **10** | **FAIL**（`L001` × 10、exit 1） |
| 台帳あり（この PR の最終状態） | 126 | 116 | **10** | **WARN**（`S002` × 10、exit 0） |

```text
asset license review — WARN
record: quality/asset-license-inventory.json
audited files: 126
pending, declared unreviewed: 10
  WARN  S002 src/home/digits/0.webp: 監査対象のファイルに資産記録がありません。…
  …
  WARN  S002 src/home/digits/9.webp: 監査対象のファイルに資産記録がありません。…
```

- 新たに監査対象になったバイトは 10 件で、すべて `src/home/digits/*.webp`
  （`src/home/access/tiles.tsx` が `?url` で import、`scripts/generate-counter-digits.mjs` が生成）。
- `public/**` の監査結果は変わっていない（116 ファイル・`L001` / `L002` なし。Issue #780 以前の実行記録は
  115 ファイルで、増分 1 は本 Issue と無関係な `public/` の追加）。

## 4. fail-closed の確認

| ケース | 期待 | テスト |
| --- | --- | --- |
| `src/**` から import された未記録アセット | `L001`（error、exit 1） | `scripts/check-asset-licenses.test.mjs`「fails when an asset imported from src/** has no record」 |
| 台帳にない未記録バイト | `L001`（error） | 同上（台帳は宣言した行だけを warn にする） |
| 台帳に宣言済み | `S002`（warn）で毎回列挙、`uncoveredFiles` に残る | 「downgrades a declared-unreviewed asset to S002 without clearing it」 |
| 台帳の行がファイルより長生き | `S003`（error、exit 1） | 「fails when the ledger outlives the reason for an entry」 |
| 台帳の行が記録に置き換わった | `S003`（error、exit 1） | 「fails when a ledger entry is now covered by a record」 |
| import 先が存在しない | `S001`（error） | `collectServedSourceAssets` の unit test |

`quality/asset-license-pending.json` は権利の記録ではない。`licence` / `rightsHolder` / `evidence` を持てず、
`ownerDecision` は `"pending"` 以外を受け付けない（`"excluded"` を書くと台帳が読めず exit 2）。

## 5. owner 判断が必要な残課題

`src/home/digits/*.webp` の 10 件をどう扱うかは**未決**である。次のどちらかを owner が決める。

1. **資産記録を追加** — `web-app-icons` と同型（`repository-generated` / 権利者 `rebuildup` / 根拠 = `LICENSE` +
   生成スクリプト）。ただし digits は**フォントのグリフをラスタライズした画像**なので、生成元フォントの
   ライセンス確認が先に要る。記録はこの PR では作っていない（捏造の禁止）。
2. **台帳のまま** — 未レビューであることを毎回 `S002` で可視化し続ける。権利は主張しない。

台帳を置かない（`S002` を許さず赤を維持する）判断も可能で、その場合は
`quality/asset-license-pending.json` を削除すれば `L001` に戻る。

## 6. 再現

```bash
node scripts/check-asset-licenses.mjs            # 判定（exit 0 / 1 / 2）
node scripts/check-asset-licenses.mjs --report=markdown \
  --report-out=docs/verification/legal/asset-license-review-report.md
node --experimental-strip-types --test scripts/check-asset-licenses.test.mjs
```
