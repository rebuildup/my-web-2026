# Web 機能採用ゲート（Baseline 互換性）

> Issue #414 で導入した、Web API / CSS の採用可否を決める repository-owned gate。
> 機械可読な定義は [`quality/browser-baseline.json`](../../../quality/browser-baseline.json)、
> 実装は [`scripts/check-browser-baseline.mjs`](../../../scripts/check-browser-baseline.mjs)、
> fixture suite は [`scripts/check-browser-baseline.test.mjs`](../../../scripts/check-browser-baseline.test.mjs)。

## なぜ必要か

本リポジトリには `browserslist` も互換変換も存在しない。Panda CSS は素の CSS を、
Vite は素の JS を出力し、Worker は `workerd` で動く。つまり **ツールチェーンのどこも
「採用した Web API / CSS が対象ブラウザで動くのか」を問わない**。1 行の CSS や
`navigator.*` 1 回の呼び出しが非対応ブラウザで静かに壊れても、CI は緑を返す。

そこで「採用」を明示的な宣言（manifest）にし、宣言と実コードを突き合わせる gate を
`validate:fast` に入れた。gate は **offline / deterministic**（web-features の
スナップショットをリポジトリに固定）で、网络にも secret にも触らない。

## 採用バー

| Baseline 状態 | 意味 | gate の判定 |
| --- | --- | --- |
| `high`（Baseline: Widely available） | 新たに利用可能から 30 か月経過 | **pass**（fallback 宣言は不要） |
| `low`（Baseline: Newly available） | 主要ブラウザには実装済みだが 30 か月が経過していない | **warning**（fallback 要件が明示され、evidence が検証できた場合のみ） |
| `false`（limited availability / 非 Baseline） | 一部ブラウザに未実装、または Firefox 未実装など | **warning**（同上）— fallback 宣言が無ければ **fail** |

CSS は `fallback.kind: "progressive"`、Web API は `fallback.kind: "capability"` だけを
受け付ける。CSS に progressive 以外の fallback 宣言は manifest load 時に落ちる。

## 互換対象ブラウザ

`policy.target_browsers` に宣言した floor（宣言）と、採用集合が Baseline Widely
available を満たす範囲から導出した floor（bar-implied）を gate が突き合わせる。

| browser | role | declared floor | bar-implied floor |
| --- | --- | --- | --- |
| Chrome | Baseline core (desktop) | 129 | 129 |
| Edge | Baseline core (desktop) | 129 | 129 |
| Firefox | Baseline core (desktop) | 131 | 131 |
| Safari | Baseline core (desktop) | 18 | 18 |
| Safari on iOS | mobile Baseline representative | 18 | 18 |

bar-implied floor は「採用済み機能のうち最新の `baseline_high_date`（＝2024-09-14、
`dialog` と `focus-visible`）以降の最初のリリース」を vendored したリリース表
（`dataset.browsers`）から導出する。手書きの数字ではなく、宣言 floor がこれを
下回ると **fail** する（下げるのではなく、floor を上げるか機能を外す）。
採用済み機能が 1 つも Baseline Widely available に達していないと bar が何も
示唆しないため、この比較は実行されない。その場合も無言では通さず
`target_floor_unverifiable` を **warning** として出す（「比較が回っていない」
という事実そのものを gate の出力に残す）。

## manifest の構造

```jsonc
{
  "policy": { "bar": "baseline-widely-available", "target_browsers": [ … ] },
  "dataset": { "name": "web-features", "snapshot_date": "2026-10-18", "browsers": { … } },
  "scan": {
    "coverage_root": "src",
    "extensions": [".ts", ".tsx", ".css"],
    "exclude": ["**/*.test.ts", "**/*.test.tsx", "**/*.stories.tsx", "**/*.md"]
  },
  "surfaces": [ { "id": "routes", "root": "src/routes", "min_files": 1, "role": "…" } ],
  "features": [ /* 採用済み。Baseline 状態と fallback を必ず持つ */ ],
  "guarded_features": [ /* 未採用。1 件でも出現すると fail */ ]
}
```

- `surfaces` … gate が走査する obligation ごとの面。`root` か `files` のどちらか一方。
  `files` 型 surface は `panda.config.ts` も含む（生成 CSS の入力の片方。`src/**`
  がもう片方）。1 つの path が 2 つの surface に属すると二重走査・二重計上になる
  ため fail する。`src/` 以外を走査させるには surface への明示的宣言が要る。
- `features[].detect` … その機能の検出正規表現（`RegExp` ソース文字列）。
- `features[].dataset` … Baseline 状態と browser ごとの最初の対応バージョン。
  `compat_key` を指定すると web-features の granular key（例:
  `api.Clipboard.writeText`）を採用する。
- `features[].fallback.evidence[].proves` … その evidence が何を示すかの説明。
  `precedes: true` を付けると、fallback 宣言が機能の宣言より**前**にあることを gate が検証する。

## 無言の合格にならないための fail 条件

誤検知（本来は誤検知でない検出）や、実装されていない route / surface を
gate が黙って通さないよう、以下はすべて **fail**：

| rule | 意味 |
| --- | --- |
| `surface_empty` | 宣言した surface が 1 ファイルも拾えなかった（route が移動した等） |
| `surface_uncovered` | `src/` 配下の走査対象ファイルが、どの surface にも属していない |
| `surface_file_duplicate` | 1 つの path が複数の surface に属している（二重走査・二重計上） |
| `feature_not_detected` | 宣言した機能が未抑制の 등장箇所 0 件（宣言やパターンがずれた） |
| `fallback_required` | バー未満の採用に fallback 宣言が無い |
| `fallback_evidence_missing` | 宣言した fallback の evidence ファイル / パターンが無い |
| `fallback_evidence_unordered` | `precedes: true` の evidence が機能宣言より後ろにある |
| `guarded_feature_adopted` | guarded（未採用）機能が 1 箇所でも使われた |
| `allow_unused` | 誤検知の免除宣言（`allow`）が何も抑止していない |
| `target_floor_below_bar` | 宣言した対象ブラウザ floor が Baseline bar を下回る |
| `surface_file_missing` | `files` 型 surface が宣言したファイルが存在しない |

誤検知を免除したい場合は `features[].allow` に
`{ file: "src/routes/*.tsx", pattern: "…", reason: "…" }` を書く。スコープは
ディレクトリを含む glob 必須（リポジトリ全体の `**` は manifest load で失敗）、
`reason` 必須、かつ「実際に何かを抑止していない」と fail する。全抑止された
宣言は `feature_not_detected` で fail するため、死んだエントリを残せない。

## 実行方法

```bash
pnpm run compat:check                                 # gate 本体（validate:fast に含まれる）
node scripts/check-browser-baseline.mjs --json         # 機械可読な結果
node --test scripts/check-browser-baseline.test.mjs    # fixture suite（20 cases）
pnpm run verify:browser-baseline-screenshot            # report HTML + WebP を再生成
```

期待結果（`src/**` の増加に合わせて scanned files は増える。下の行はこの report を最後に再生成した時点の値）:

```
surfaces  12 declared · 156 files scanned · 0 uncovered
features  14 adopted (3 below the bar, each with a verified fallback) · 9 guarded
warnings (3)   # word-break-auto-phrase / text-wrap-balance / text-wrap-pretty
errors (0)
exit 0
```

## fixture — fail になる場合

`scripts/check-browser-baseline.test.mjs` は temp directory に合成 repository を
作り、同じ checker を通して各 rule を検証する。WebGPU 採用を 2 通りで試す:

- **fixture A**: fallback 宣言なし → `fallback_required` で **fail**（exit 1）
- **fixture B**: `capability` fallback を宣言し evidence が実ファイルに存在
  → **warning のみ**（exit 0）

この 2 例は PR 添付の report
[`browser-baseline.webp`](./browser-baseline.webp) にも同じ checker の実行結果として
載っている（report 内で fixture A / B の判定と exit code を表示）。

## snapshot の更新手順

vendored snapshot（`dataset.snapshot_date` / Baseline ブロック / リリース表）は
手動更新する。CI ではネットワーク取得をしない（gate は hermetic でなければならない）。

```bash
# 1) 最新 dataset を取得する（リポジトリには入らない）
curl -sSL https://unpkg.com/web-features/data.json -o /tmp/web-features.json

# 2) 取得時点で vendored 値との差分を確認する（drift があれば exit 1）
node scripts/check-browser-baseline.mjs --dataset /tmp/web-features.json

# 3) 表示された drift を quality/browser-baseline.json の該当エントリへ転記し、
#    snapshot_date と releases_from 以降のリリース表を更新する
# 4) 再度 --dataset で drift 0 を確認する
node scripts/check-browser-baseline.mjs --dataset /tmp/web-features.json
```

## スクリーンショット

- 保存先: `docs/verification/standards/browser-baseline.webp`
  （Issue 本文の `browser-baseline.png` と同じ path を使い、拡張子のみ `.webp`。
  PNG はリポジトリを不必要に膨らませるため commit しない）
- 生成: `pnpm run verify:browser-baseline-screenshot`
  （Playwright chromium で HTML report を capture → `sharp` で WebP 化。
  中間 PNG はメモリ上のみ）
- 同一条件の再現: 上記コマンド。gate が fail のときは report を生成せず終了する。

## 既知の制約

- 検出は正規表現による。生成済み CSS（`styled-system/**`）は走査対象外だが、その入力である
  `panda.config.ts`（`app-shell` surface の `files` に宣言済み）と `src/**`（surface +
  coverage root）は走査している。逆向きの限界もある: `src/` 以外のファイルは surface に
  明示しない限り走査されない。root-level に CSS 入力を増やした時は、そのファイルも
  surface に足すこと。
- evidence の照合も生テキストへの正規表現照合で、コメント内の文字列でも一致する。
  「宣言された evidence が実宣言の行に載っている」のはレビュー上の規律であって、
  gate がコメントと宣言を区別するわけではない。
- 宣言モデルであるため、manifest に無い機能にはどの rule も掛からない
  （undeclared adoption）。採用する機能は `features[]` に Baseline 状態と fallback と
  ともに、採用しない機能は `guarded_features[]` に理由ごと登録する運用が前提。
  未宣言の採用そのものを検出する仕組み（検出パターンの集合の別途管理）は本 gate の
  スコープ外。
- `guarded_features` の検出パターンもコメントに一致する。例えば `popover` は単語単位の
  パターンなので、走査ファイルのコメントに "popover" と書くと CI が落ちる。意図した
  誤検知は `features[].allow` で明示的に免除する（glob スコープ必須・`reason` 必須・
  空回り fail）。検出パターンを狭めてコメント誤検知を回避すると、本命の検出漏れを
  増やす。よって誤検知はパターンで隠すのではなく、`allow` で明示的に免除する運用を
  優先した。
- web-features に存在しない機能（例: `FormData` コンストラクタ。dataset の
  `fetch-formdata` は `Request/Response.formData()` の話）は manifest に載らない。
  採用を検討する時は Baseline データを另行取得してから登録する。
- `--dataset` の検証は web-features の `features` マップのみを対象にしており、
  リリース表そのものは snapshot 内の値をそのまま使う。