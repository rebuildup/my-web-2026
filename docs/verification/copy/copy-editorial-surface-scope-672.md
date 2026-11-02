# 公開日本語 copy の surface 宣言 — 差分セグメント実測 (Issue #672)

> Issue #672 の owner 決定（comment 6567572805）に基づく **surface 宣言の
> 変更記録**である。宣言の正本は
> [`quality/copy-editorial-surfaces.json`](../../../quality/copy-editorial-surfaces.json)、
> 判定基準と運用手順は
> [`docs/runbook/copy-editorial-approval.md`](../../runbook/copy-editorial-approval.md)。
> この document は **差分の実測**（どのファイルが何セグメント対象になったか）
> だけを持つ。

## 1. 何が変わったか

| | before | after |
| --- | --- | --- |
| 宣言 | `publicCopyGlobs` のみ（9 エントリ、すべてディレクトリ粒度） | `publicCopyGlobs`（9 エントリ、据え置き） + `publicCopyFiles`（9 ファイル、Issue #672 で追加） |
| `src/keyboard/**` | 対象外 | **ファイル単位**で 6 ファイルを宣言 |
| `src/legal/**` | 対象外 | **ファイル単位**で 2 ファイルを宣言 |
| `src/privacy/**` | 対象外 | **ファイル単位**で 1 ファイルを宣言 |
| 既存の glob | 変更なし | 変更なし（既存の承認 record の fingerprint を壊さないため） |

既存の glob を触らないのは、`quality/copy-editorial-approvals.json` の
記録が **変更文面** に紐づいており、既存の surfaces を削れば shipped な
record が別の文面を指すことになってしまうからである（既存 record の
書き換えは Issue #672 の禁止事項）。

## 2. 測定の方法

セグメントは gate 自身と同じ抽出器で数える（`scripts/_copy-japanese-diff.mjs` の
`extractSegments`）。1 行 1 セグメントで、コメント行は数えない。

```js
// scripts/_copy-japanese-diff.mjs の extractSegments を使う
for (const line of text.split('\n')) count += extractSegments(line).length;
```

再現（リポジトリの `node` で実行できる）:

```sh
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { extractSegments, classifyFile, readJson } from './scripts/_copy-japanese-diff.mjs';
const surfaces = readJson('quality/copy-editorial-surfaces.json', 's');
const files = execSync('git ls-files src/keyboard src/legal src/privacy', { encoding: 'utf8' }).trim().split('\n');
for (const file of files) {
  let n = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) n += extractSegments(line).length;
  if (n === 0) continue;
  console.log(String(n).padStart(4), classifyFile(file, surfaces).public ? 'gated' : 'skipped', file);
}
"
```

## 3. 現状の宣言と新宣言の差分（ファイルごとの内訳）

### 3.1 新しく gate に入る（9 ファイル / 373 セグメント）

| path | セグメント | 描画先 |
| --- | --- | --- |
| `src/privacy/data-lifecycle.ts` | 95 | フッターの privacy notice の本文（`src/home/privacy-notice.tsx` が描く） |
| `src/keyboard/format.ts` | 83 | `/keyboard` のキーキャップと詳細の説明文 |
| `src/legal/contract.ts` | 60 | 権利 review カードのラベルと finding の文言 |
| `src/keyboard/components/KeyboardPage.tsx` | 59 | `/keyboard` のページ本体 |
| `src/legal/AssetLicenseReview.tsx` | 30 | 権利 review カードそのもの |
| `src/keyboard/components/KeyboardDiagram.tsx` | 26 | `/keyboard` のキー配置図と詳細 |
| `src/keyboard/catalog.ts` | 13 | プラットフォーム説明・解析失敗理由・解析メモ |
| `src/keyboard/sources/manifest.json` | 5 | `adoption.note` だけが `/keyboard` の出典 callout に描画される |
| `src/keyboard/load.ts` | 2 | 配列を表示できない状態のメッセージ |
| **合計** | **373** | |

### 3.2 入れなかった（4 ファイル / 115 セグメント）

ディレクトリ単位の追加（`src/keyboard/** src/legal/** src/privacy/**`）なら
これらも対象になり、合計は **488 セグメント** になる。入れなかった理由は
runbook §6.1.2 に書いた判定基準による。

| path | セグメント | 入れなかった理由 |
| --- | --- | --- |
| `src/keyboard/sources/key-map-kanata/win/kay-map-win.kbd` | 90 | key map の日本語コメントは `parseExpressions` が落とすため **画面に 1 文字も届かない** |
| `src/legal/inventory.ts` | 15 | 記録の schema reader。`J` 系の finding は Storybook サンプルの中だけに出る |
| `src/legal/inventory-table.ts` | 8 | Storybook の roster 射影。公開面には出ない |
| `src/keyboard/geometry.ts` | 2 | `note` は型に存在するが **描画されない**（位置の定義） |
| **合計** | **115** | |

### 3.3 差分のまとめ

| | セグメント | ファイル |
| --- | --- | --- |
| ディレクトリ単位の追加なら対象になるもの | 488 | 13 |
| 新宣言が対象にするもの | 373 | 9 |
| 新宣言が対象から外すもの | 115 | 4 |
| うち「画面に出るのに落在していた」もの（false negative） | 373 | 9 |
| うち「画面に出ないのに対象になる」もの（false positive） | 7 | 2（混在ファイル。runbook §6.1.3） |

Issue #672 の issue 本文が計測した “+473” は `main → release-0-7-0` の
時点の値である（`src/privacy/data-lifecycle.ts` は Issue #662 の送信者分割
でその後増えた）。本表は **現在のツリー**（`672` ブランチの HEAD =
`release-0-8-1`）での実測値である。

## 4. 混在ファイル（7 セグメントの over-collection）

file 単位の宣言の代償として、同じファイルの中の非表示文字列も対象に入る。

| file | 非表示のセグメント | 何のためにあるか |
| --- | --- | --- |
| `src/keyboard/sources/manifest.json` | 4 | `sources[].note` — 出典の注記。`/keyboard` には出ないが、同じファイルにある |
| `src/privacy/data-lifecycle.ts` | 3 | `pending` の entry `current-projects-signature` の本文。`filterPublishedEntries` で描画されない |

どちらも「gate の外へ訪問者の文言を逃がす」ことを避けるための選択である。
逆向きにしないのは、**表示されない定義を skip すること**と
**訪問者の文言を gate から逃がすこと**を混同しないため（owner 決定の要旨）。

## 5. 検証

| 対象 | コマンド | 結果 |
| --- | --- | --- |
| gate の自己テスト（false positive / false negative を含む） | `node --test scripts/check-copy-editorial-approval.test.mjs` | 55 tests / 0 fail |
| stale copy gate（宣言に USE された surface の time-sensitive 表現） | `pnpm run copy:stale:check` | 緑（review pending 0） |
| 全体の fast gate | `.tmp/supervisor/bin/vfast` | 緑 |

`src/privacy/data-lifecycle.ts` の `pending` entry の 3 セグメントは
stale copy gate では `excludedExpressions` として除外している（描画されないため）。
詳細は `quality/stale-content-review.json` の当該エントリ。
