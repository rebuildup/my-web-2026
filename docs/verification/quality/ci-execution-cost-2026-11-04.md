# CI 実行コストの実測と `ci.yml` のレッグ分割 — Issue #897

> 2026-11-04、`release-0-8-1` を対象にした実測にもとづく、CI の
> **重複実行の除去**の検証記録です。品質ゲートの**検証内容は 1 つも減らして
> いません**（減らすことは本 Issue の成果として認められません）。この文書は
> threshold 宣言でも gate の仕様書でもありません。定義は
> `quality/profile.yaml` と `.github/workflows/ci.yml` が権威です。

## 0. この変更は「文書化された契約への追隨」である

`docs/development.md`（CI の節）は変更前からこう書いていました:

> CI (`.github/workflows/ci.yml`) runs `validate:integration` from the
> `validate` job on every PR and every push to `main` / `release-*`.

つまり**文書化された契約は、最初から数値チケットブランチへの push での完全検証を
含んでいません**。実際の `ci.yml` は文書より広く振る舞っており（`push` トリガが
チケットブランチでも `validate:integration` を走らせていた）、この変更は
**ワークフローを、すでに公開されていた契約に合わせる**ものです。契約の縮小では
ありません（この文の書き換えは行っていません — すでに正しいからです）。

## 1. 方法論

- **サンプル**: 直近 1,000 workflow run。
- **窓**: 2026-11-01T15:36Z – 2026-11-04T11:27Z（約 2.8 日）。
- **合計**: 5,067 runner-minutes。
- **集計軸**: workflow（CI validate / browser compat / viewport regression /
  定期実行）× event（push / pull_request / schedule）× ブランチ種別
  （数値チケット / release-* / その他 / main）。
- **重複の判定**: 数値チケットブランチの push run が検証した SHA を集め、
  同一 SHA の pull_request run の結果と 1 組ずつ突き合わせた（145 組）。
- **1 run の内訳**: ci.yml run `41819487606`（SHA `b9b23248`）の step 所要時間。

数値そのものは Issue #897 本文（更新後の権威版）から転記しています。本文明記の
ない数値は補完していません。自分で実行した検証はコマンド名を併記します。

### 1.1 重複の構造的理由

`ci.yml` は `push` と `pull_request` の両方でチケットブランチ（数字のみ）を
発火します。`concurrency.group: ci-${{ github.workflow }}-${{ github.ref }}` は
push run を `refs/heads/887`、PR run を `refs/pull/888/merge` に割り当てるため、
**両者は互いをキャンセルしません**。同じ SHA に完全検証が 2 回走る構造です。

## 2. 実測（Issue #897 本文の権威値）

### 2.1 1,000 run の内訳

| workflow | event | ブランチ | runs | 実行時間(分) | 全体比 |
| --- | --- | --- | ---: | ---: | ---: |
| CI validate | pull_request | 数値チケット | 145 | 1,241 | 24.5% |
| CI validate | **push** | **数値チケット** | **150** | **1,211** | **23.9%** |
| browser compat | pull_request | 数値チケット | 145 | 488 | 9.6% |
| CI validate | push | release-* | 58 | 474 | 9.3% |
| CI validate | pull_request | release-* | 57 | 406 | 8.0% |
| viewport regression | pull_request | 数値チケット | 145 | 340 | 6.7% |
| browser compat | push | release-* | 58 | 186 | 3.7% |
| CI validate | pull_request | その他 | 26 | 185 | 3.6% |
| browser compat | pull_request | release-* | 57 | 172 | 3.4% |
| viewport regression | push | release-* | 58 | 124 | 2.5% |
| viewport regression | pull_request | release-* | 57 | 124 | 2.4% |
| browser compat | pull_request | その他 | 18 | 64 | 1.3% |
| viewport regression | pull_request | その他 | 18 | 46 | 0.9% |
| 定期実行 3 本 | schedule | main | 8 | 6 | 0.1% |
| **合計** | | | **1,000** | **5,067** | |

- チケットブランチ 1 コミットあたり **22.3 ランナー分**（CI push 8.07 + CI PR
  8.56 + compat 3.37 + viewport 2.34）。
- 変更後: **14.2 ランナー分（−36%）**。プラットフォーム全体から消える共有は
  **23.9%**（＝上表の数値チケット push の 1,211 分）。
- 数値チケット push レッグの置き換え後の想定所要は設計値で **150–180 s**
  （現状の完全実行は平均 8.07 分）。適用後の実測は §8 に記録する。

### 2.2 同一 SHA での両レッグ判定突き合わせ（145 組）

| 組み合わせ | 件数 | 解釈 |
| --- | ---: | --- |
| 一致 | 131 | 重複 |
| push 緑 / PR 赤 | 6 | merge ref（head + base）だけが検出した統合不良。**push レッグには出せない検出** |
| push 緑 / PR キャンセル | 3 | 判定なし |
| push キャンセル / PR 赤 | 1 | 判定なし |
| push 赤 / PR 緑 | 1 | head 単体のみ赤。ただし着地する merge ref は緑 |
| push 赤 / PR キャンセル | 4 | 判定なし |

150 SHA のうち **145 SHA（97%）が同一 SHA で二度検証**されています。push
レッグが単独で成立させた着地阻害の検出は **0 件**、merge ref レッグだけが
**6 件**を検出しています。

### 2.3 1 回の `validate:integration` の中身（run 41819487606 / SHA b9b23248）

`validate:integration` = **555 s**:

| ステップ | 秒 | 比率 |
| --- | ---: | ---: |
| `pnpm run test` | 369.5 | 66.6% |
| `pnpm run build:production` | 90.9 | 16.4% |
| `pnpm run storybook:ownership:check` | 21.2 | 3.8% |
| `pnpm run build:cf:production`（Storybook 後の再ビルド） | 18.3 | 3.3% |
| `pnpm run build-storybook` | 15.6 | 2.8% |
| `pnpm run typecheck` | 14.5 | 2.6% |
| 残り 74 ステップ | 24.9 | 4.5% |

`pnpm run test` の内訳: vitest 251.3 s（198 ファイル、tests 89.6 s / setup
累計 499.5 s）+ `scripts/*.test.mjs` 211 本の直列実行 118 s。

## 3. 変更前後の「実行される検証の集合」マトリクス

6 種の検証 × レッグ。● = 実行、○ = 条件付き実行、— = 実行しない。

| 検証 | レッグ | 変更前 | 変更後 |
| --- | --- | :-: | :-: |
| `validate:integration` | チケット push | ● | **—（除去）** |
| `validate:integration` | チケット PR（merge ref） | ● | ● |
| `validate:integration` | main push | ● | ● |
| `validate:integration` | release-* push | ● | ● |
| `validate:integration` | workflow_dispatch | （トリガ無し） | **●（新設）** |
| `cf-typegen:check` | チケット push | ● | ● |
| `cf-typegen:check` | チケット PR | — | — |
| `cf-typegen:check` | main push | ● | ● |
| `cf-typegen:check` | release-* push | ● | ● |
| `cf-typegen:check` | workflow_dispatch | （トリガ無し） | **●（新設）** |
| attestation（manifest 生成） | チケット push | ●（`validate:integration` 内） | ●（**専用ステップ** `artifact:attestation:check` で生成） |
| attestation（manifest 生成） | チケット PR | ●（merge commit 向け） | ●（同左） |
| attestation（manifest 生成） | main / release-* push | ● | ● |
| attestation（manifest 生成） | workflow_dispatch | （トリガ無し） | **●（`validate:integration` の最後の component）** |
| manifest アップロード | 全レッグ | ● | ●（全レッグが manifest を生成しているため据え置き） |
| attested bytes アップロード | チケット push | ● | ● |
| attested bytes アップロード | チケット PR | — | —（merge commit のバイトは使えず、据え置き） |
| attested bytes アップロード | main / release-* push | ● | ● |
| attested bytes アップロード | workflow_dispatch | （トリガ無し） | **●（新設）** |
| browser compat（`compat.yml`） | チケット push | — | — |
| browser compat | チケット PR（base = release-*） | ● | ● |
| browser compat | main / release-* push | ● | ● |
| viewport regression（`viewport.yml`） | チケット push | — | — |
| viewport regression | チケット PR（base = release-*） | ● | ● |
| viewport regression | main / release-* push | ● | ● |
| Playwright E2E（`ci.yml`） | チケット push | — | — |
| Playwright E2E | チケット PR（`ui-change` ラベルのみ） | ○ | ○ |
| Playwright E2E | main / release-* push | ● | ● |
| Playwright E2E | workflow_dispatch | （トリガ無し） | **●（新設）** |

補足:

- `compat.yml` / `viewport.yml` の `pull_request` ブランチフィルタは
  base 側が `[main, 'release-*']` なので、**stacked**（base が数値ブランチ）の
  PR にはこれら 2 本は発火しません（変更前後とも同じ）。
- `ci.yml` の CI-only 3 ステップ（dependency advisory audit / issue-closure
  audit / SBOM の生成とアップロード）は変更前は全レッグ、変更後は
  **full_validation レッグのみ**。同じ変更に対する判定はその PR レッグが担い、
  チケット push レッグでは実行されません（Issue #897 の決定どおり: push 固有
  義務以外は走らせない）。
- `storybook axe` ジョブ（`ci.yml` の第 2 ジョブ）は**据え置き**。diff 条件を
  付けると穴ができる、という当該コメントの設計判断を変えていません。
- 表の差分で**削除されている検証は「チケット push 上の
  `validate:integration`（＝同一 SHA の二度目）」だけ**です。どの変更にも完全
  検証が 1 回（PR レッグ = 着地する merge ref）残り、trunk（main /
  release-*）の検証も現状維持です。

## 4. `ci.yml` の実装（1 ジョブ・step level の `if:`）

`validate` ジョブは 1 つのまま、ステップを step level の `if:` で振り分けます
（ジョブ間・ワークフロー間への移動は禁止 —
`check-release-gate-coverage.mjs` / `check-asvs-coverage.mjs` は
`jobs.validate.steps[*].run` をこのファイルから読むため）。命名した条件集合は:

- **full_validation** = `pull_request`（base 任意） | `workflow_dispatch` |
  `main` / `release-*` への `push`
  → `validate:integration` + CI-only 3 ステップ。
- **push_obligations** = 数値チケットブランチへの `push` | `workflow_dispatch`
  → `cf-typegen:check`、production Build Output、attestation manifest、
  byte アップロード。チケット push では `build:production` +
  `artifact:attestation:check` の専用ステップが担当
  （`push_obligations && !(full_validation)` で条件付け — dispatch では
  `validate:integration` が同じ work をすでに済ませているので二度目の
  `build:production` は走らせない）。
- **attested_bytes** = `push`（全ブランチ） | `workflow_dispatch`
  → `cf-typegen check` と
  `Upload Cloudflare Build Output (attested bytes)` の 2 ステップが共有。
  「どのブランチに push したか」に依存しない obligation だから。

### 4.1 attestation の生成コマンドについて

Issue の記載では `artifact:attestation:check` が manifest を書くとあります。
`package.json` が実際に公開している動詞を確認したところ、生成できるのは
**`pnpm run artifact:attestation:check`（= `node scripts/check-artifact-attestation.mjs`
のデフォルトモード）だけ**でした（`artifact:attestation:report` は別物、
生成用の `:generate` 等の script は存在しない）。デフォルトモードは
「`release-assets/supply-chain/<version>/artifact-attestation.json` を生成し、
生成物を同じバイトに対して検証し、不一致なら fail」する動詞です
（`--manifest=` 指定時は検証のみ）。つまり `:check` の名前の下に generate +
verify が同居しており、チケット push レッグはこのコマンドを
`build:production` の直後に実行します。`quality/profile.yaml` の
`gates.integration.components` の最後の component と同じ 1 コマンドです。

### 4.2 `workflow_dispatch` は何をするか

「main / release-* への push とまったく同じようにこのブランチ先端を検証す
る」ための逃げ道として、**PR レッグと main / release-* push レッグの和集合**
を実行します: `validate:integration` + CI-only 3 ステップ + `cf-typegen:check`
+ manifest 生成（gate 内） + 両アップロード + Playwright E2E。**dispatch が
push より少ない成果物を作ることはありません**（それが逃げ道を本物の置き換え
にする条件）。PR だけの diff 判定ステップ（head-ref policy、日本語コピー
2 ステップ）は `github.head_ref` / `github.base_ref` を必要とする
pull_request 専用のままです — dispatch には diff がありません。

## 5. 変更しなかったこと（deliberately NOT changed）

- **ゲート内部の重複は 0 件**（Issue 実測 §4）:
  - `validate:integration` は `fast` の 67 ステップを平坦に含む。fast を別
    プロセスで再実行していない。
  - `pnpm run test` は 1 回だけ。`storybook:ownership:check`（21.2 s）と
    `check-storybook-ownership.test.mjs`（22.9 s）は、後者が一時ディレクトリ
    の fixture に対する checker 実行という別物で、同じリポジトリ状態を二度
    検査していない。
  - **2 回目の `build:cf:production`（18.3 s）は重複ではない**:
    `build-storybook` が `.cloudflare/output/` を破壊する（Storybook の Vite
    builder が `vite.config.ts` をマージして Cloudflare plugin を走らせる）ため、
    Storybook のあとの再ビルドが必須。経緯は `quality/profile.yaml` の
    `gates.integration.components` に記録済み。**削りません。**
- `quality/profile.yaml` の gate 宣言（`gates.*.components` /
  `trigger:` / `change_risk_mapping`）— 一切変更しません。
- `storybook axe` ジョブの無条件実行（diff 条件を付けないという設計判断）。
- `compat.yml` / `viewport.yml` のトリガと内容（別 Issue の主題ではなく、
  本 Issue の削減対象は CI validate の重複実行のみ）。
- `concurrency` の group / `cancel-in-progress`（push と PR が互いを消さない
  現行 semantics は残す。重複はレッグ分割で解消する）。
- Playwright E2E の発火条件（main / release-* push と `ui-change` ラベル PR）。
  追加されたのは `workflow_dispatch` だけ（「push と同じ検証」の和集合に含める
  ため）。
- PR 専用の diff 判定ステップ（head-ref policy、copy editorial、日本語コピー
  レポート）の `pull_request` 条件。
- **`continue-on-error` の追加、gate の削除、gate を `ci.yml` 外へ移すこと
  — 0 件。** `check-e2e-d1-bootstrap.test.mjs` が要求する Playwright E2E
  ステップの厳格さ（`continue-on-error` なし / release-* 条件の保持）も維持。
- `docs/development.md` の契約文（すでに正しい）。
- `docs/release.md` の公開リポジトリ ruleset 必須項目リスト（line ~117:
  「PR ごとに `validate` required check、release-* への pushでは追加で
  `cf-typegen check` と Playwright E2E（PR では `ui-change` ラベル gate）」）。
  本変更後も release-* push は完全検証 + cf-typegen + E2E のままなので**リストは
  正確であり、触っていません**。
- **リリース証跡の定義（`docs/release.md` step 9）も変更なし。** 同 step は
  「証跡は release ブランチの push run — `github.sha` が release コミットの
  run。pull_request run は merge commit をビルドするので証跡ではない」と明記
  しています。つまり**チケットブランチ push が作るバイトはリリース手順からは
  参照されない**。それでも Issue #816 の「push したコミットのバイトを残す」
   obligation はチケット push にも及ぶので、本設計はその 2 点（チケット push
  レッグが存在する理由）の一方をそのまま維持します — リリース証跡には
  使われないが義務である、という両方を隠さず書くのがこの記録の立場です。

## 6. ADR-0033 との正確な位置づけ

project-init の ADR-0033（適応的スケジューリング）が扱うのは
**実行間隔の減衰**（同一入力・同一環境の連続成功から間隔を延ばすこと）です。
本 Issue が除去するのは**同一入力に対する重複実行**です。したがってこの変更は
「適応的スケジューリングを適用した」ことには**なりません**。ADR-0033 の不変条件
を満たしたまま重複を消しています:

- 「現在の candidate に必要な検証を、省略された過去の成功で代替しない」—
  代替していない。同じ変更に対して完全検証は **1 回**実行され、その結果が
  required check になる。
- 「PR/ticket integration、release、security、compatibility 等の required
  verification では、実行間隔の減衰を根拠にゲートを省略しない」— 省略して
  いない。間隔も減衰させていない。
- 「検証実行回数・所要時間・失敗検出率・誤った延期の有無を測定して再評価」—
  測定は本文 §2 のとおり。適用後の再測定は §9 のとおり義務とする。

## 7. 比較したが採らなかった案（Issue #897 本文の訂正版に基づく）

| 案 | 判断 |
| --- | --- |
| Vitest 差分実行（`--changed` / `--related`） | `--changed` は変更の影響を受けるファイルだけを実行する（変更検出の既定は `git`、`mtime` も選べる）。これは**選択的実行そのもの**で、ADR-0033 が「反復・任意の実行」に限って許す種類の短縮。PR の required check では使えない。ローカル反復用の `test:watch` は既にある |
| Vitest の結果キャッシュ | 永続キャッシュは**既定で有効**。用途は**実行順の最適化**（失敗・遅いファイルを先に回す）と `--last-failed` であり、通常の `run` は合格済みファイルを**飛ばさない**（＝作業削減にならない）。`--last-failed` が飛ばせるのは前回失敗した分だけなので required check の代替にならない |
| 適応的スケジューリング | 対象は反復・任意の実行のみ。PR / リリース検証は対象外（ADR-0033）。本 Issue はスケジューリングではなく重複除去（§6） |
| 1 ファイルあたりのプール接続削減 | Issue #618 / #261 で setup をファイル単位に限定済み（`vitest.config.ts` の Setup-file scope）。残りはプール接続が本質的に必要なファイル |
| Mac / WSL への実行場所移動 | Issue #147: Windows native と WSL2 は**同一の物理 CPU / RAM / GPU / 電源予算**を共有し、独立した容量として数えられない。ローカル実測でも並行ワーカー下で `validate:fast` が 47 分（専用ランナーでは 9–12 分）。場所の移動では短縮しない |
| 単純な並列化（ジョブ分割） | ランナー分は減らない。install / build が複製される |
| `scripts/*.test.mjs` の並列実行 | 118 s の一部しか減らず（推定 −60 s / run）、パイプライン重複の効果（−1,211 分 / 2.8 日）の 1/20。別 Issue の候補として記録するだけにする |

## 8. 適用後の実測

（push 後の CI run から記録する — 最終コミット時に追記。）

## 9. この記録がどう偽証されるか

1. **1 スプリント後の再測定（完了条件）**: 適用後 1 スプリントで、
   (a) チケットブランチの push レッグを廃止したことによって
   **「検出できなかった着地阻害」が 0 件**であること（PR レッグの赤が漏れて
   いないこと）、(b) **チケットブランチ 1 コミットあたりのランナー分が実測
   どおり減っていること**（22.3 → 14.2 の主張が現実と一致すること）を
   記録する。**満たされない場合はこの変更を差し戻す。**
2. `pull_request` レッグが 1 本でも required check として弱くなった形跡
   （merge ref 検証の欠落、`continue-on-error` の混入）があれば差し戻し。
   `check-release-gate-coverage.mjs` / `check-asvs-coverage.mjs` /
   `ci:pins:check` が green でなくなれば差し戻し。
3. dispatch が push より少ない成果物（manifest / bytes）を作る事実が確認
   されたら、その設計は誤りとして直す（§4.2）。

## 10. 実行した gate（コマンドと結果）

すべて本 worktree（ブランチ `897`、`origin/release-0-8-1` 起点）で実行:

| コマンド | 結果 |
| --- | --- |
| `pnpm run lint:ci`（actionlint v1.7.12、`ci.yml` の expression 含む） | exit 0 |
| `pnpm run ci:pins:check` | exit 0 — `findings: 0`、`status: PASS (workflows 6, jobs 7, pins 40, waivers 0)` |
| `pnpm run release:gate:check`（`check-release-gate-coverage.mjs` の script 名はこれ） | exit 0 — `release gate ledger OK: 36 pass, 2 not run, 5 N/A` |
| `pnpm run asvs:check`（`asvs:coverage:check` は存在しない。実体は `check-asvs-coverage.mjs`） | exit 0 — `45 selected, 29 pass, 0 fail, 6 not run (unverified), 10 N/A` |
| `pnpm run validate:integration` | §10 末尾に記録 |
