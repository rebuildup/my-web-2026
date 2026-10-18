# 外部 API 表示のタイムアウト・再試行・遮断 — 検証レポート (#499)

- 対象: `src/external-api/**`（外部 read の信頼性契約 + reader + アダプタ 1 件 + 表示 component）
- Issue: #499（`ops(reliability): 公開APIのタイムアウト・再試行・遮断状態を検証`）
- 成果物: `docs/verification/ops/api-timeout-fallback.webp`
- 状態: **契約・adapter・表示component・検証画面まで実装済み**。本番 route への結線（promotion）は §7 の owner 決定事項として未決

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/external-api/ExternalReadCard.stories.tsx` の `ApiTimeoutFallbackGallery`（shipped story module を harness が直接 import して描画） |
| capture 手段 | `node scripts/capture-api-timeout-fallback.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの（実際の `src/styles.css`） |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 1300 px、**97 kB** WebP（quality 80、budget 300 kB） |
| 撮影時の rendered card 数 | 6（script が `cardsRendered !== 6` で失敗する。空ページ撮影の黙認をしない） |
| fixture | **定数**（`T0 = 2026-10-18T00:00:00Z` 基準）。`Date.now()` を使わないので、Storybook を開き直しても「何時間前」の意味が変わらない |
| 外部通信 | **0 件（実測）**。gallery は fixture 描画のみで、upstream には何も要求しない。capture script が Playwright の request イベントを数え、loopback 以外が 1 件でもあれば artefact を書かずに失敗する |
| 成果物の書き込み | **検証通過後にだけ** 確定置き換わる。候補は `.tmp/api-timeout-fallback/staging/` に encode され、budget / card 数 / 外部通信の検証を全部通ってから committed 経路へ move する。失敗した撮影は committed の WebP に触れない |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |

Issue は `.png` 経路を指定しているが、**同名の圧縮 WebP**（幅 1440、quality 80）で commit した。`scripts/capture-api-timeout-fallback.mjs` は `.webp` 以外の出力先を拒否する。PNG はメモリ上の buffer のみで、ファイルは書かない（そのため削除 대상になる path も存在しない）。この置き換えが repo の慣習になるか（Issue 名の `.png` を出荷すべきか）は **owner 判断**で §7 に未決として記す。`release-0-6-3` には `docs/verification/` が存在せず、「リポジトリの他の検証 artefact に合わせた」という先例は本 PR の base には無い（先行する同種の capture は Issue #501 / branch `501` にある）。

## 2. 画面が示している条件

画像の 6 枚の card は、そのまま「外部 read が訪問者に見せる 6 状態」である。**同じ component** がすべて描画している（fixture だけが違う）。

| # | state | 画面の条件 | 提示する操作 |
| --- | --- | --- | --- |
| 01 | `value` / `fresh` | window 内で観測した値 | 再試行なし（正常時） |
| 02 | `value` / `stale` | 同じ値のまま `古い値を表示中` | 再試行なし（age は隠さない） |
| 03 | `degraded`（timeout、breaker closed） | **前回の値を保持したまま** `応答时间内.timeout` を表示 | 再試行（有効） |
| 04 | `degraded`（rate limited、breaker **open**） | 前回の値を保持し `遮断中` + `次の試行 <時刻>` | 再試行（**無効**）。押しても上流が増えない |
| 05 | `degraded`（初回失敗、値なし） | `取得失敗` + `値を取得できません` + reason。**spinner は出ない** | 再試行（有効） |
| 06 | `loading` | まだ一度も値が取れていない状態だけ。badge は `読み込み中`（`古い値を表示中` を借りない） | 操作なし |

**badge が嘘をつかない理由**: badge は「いま画面にあるもの」を名指しする。`loading` は `読み込み中`、値のない失敗は `取得失敗`、値が残っている stale は `古い値を表示中`、遮断中は `遮断中`。近傍状態の文言を借りる経路を持たず、`ExternalReadCard.test.tsx` が各状態で「古い値を表示中」が出ていないこと（loading / 値なし失敗）を固定する。

**永続スピナーが構造的に存在しない理由**: `loading` snapshot は「一度も値を取得していない」場合にしか到達できず、確定した試行は必ず `value` か `degraded` に遷移する（`applySuccess` / `applyFailure` が唯一の遷移）。reader は deadline を自分で強制するため、abort signal を無視する adapter でも `loading` には留まらない。

**元データの状態が明確な理由**: `degraded` は `value`（前回の値）と `observedAt`（その値の観測時刻）を保持したまま `reason` と `failedAt` を追加する。既存表示は「消えない・古さが書ける・理由が言える」の 3 つ。

## 3. 公開情報 / 非公開情報の監査表

宣言は `src/external-api/contract.ts` と `github.ts` にあり、テストで固定している。

### 公開する情報（`GitHubRepoFacts` = allowlist）

| 項目 | 由来 | 備考 |
| --- | --- | --- |
| `stars` / `forks` / `openIssues` | `stargazers_count` / `forks_count` / `open_issues_count` | 非負整数のみ。欠損は `null`（0 を捏造しない） |
| `license` | `license.spdx_id` | **SPDX id のみ**。ライセンス本文は載せない |
| `pushedAt` | `pushed_at` | ISO に正規化。解析不能なら `null` |
| source label | `ExternalSource.label`（`api.github.com`） | host のみ。path / query は表示しない |
| failure reason | `EXTERNAL_FAILURE_LABEL` の 6 種 | repo 内固定文言。リクエストごとの生成なし |
| 観測時刻 | `observedAt` / `failedAt` / `retryAt` | UTC 固定。訪問者のローカル時刻に依らない |

### 公開しない情報

| クラス | 防御 |
| --- | --- |
| 所有者個人情報（`owner.email` / `owner.name`） | allowlist 写像。payload に含まれていても構造的に出力されない（`github.test.ts`） |
| private リポジトリのメタデータ | `private: true` の payload は `malformed-response` として拒否 |
| upstream の status line / body / header / URL | transport が reason に畳んで捨てる。`ExternalReadError` の message は reason のみから生成 |
| 例外 message / stack / `cause` | `classifyThrown` は reason に写像するだけで、投げた値を引き回さない |
| credential | `sendsCredentials: false` を literal 型で強制 + `authorization` / `cookie` / `proxy-authorization` は送信前に拒否（throw） |
| 訪問者個人情報 | 発行しない（session / IP / UA / referrer を一切読まない） |

### 未使用フィールドの実測

GitHub の repository payload には `subscribers_count` / `network_count` / `permissions` / `owner` 等が含まれる。写像後に残るキーは `GITHUB_REPO_FACT_KEYS`（5 個）のみであることを `github.test.ts` が固定している。

## 4. 外部通信と依存の監査

### この PR が**発生**させる外部通信

| 相手 | 通信 | 起動側 | 根拠 |
| --- | --- | --- | --- |
| 第三者 API | **無し** | — | adapter はどの route からも参照されていない。`docs/domain/integrations.md`（Current state: promoted なし） |

### promotion した場合に発生する通信（**未実施・owner 判断**）

| 相手 | 通信 | credential | budget | 公開する返答 |
| --- | --- | --- | --- | --- |
| `api.github.com` | `GET /repos/rebuildup/my-web-2026` | **無し**（未認証） | 60 req/hour per source IP | allowlist 5 項目のみ |

- `docs/domain/integrations.md` の「Capability-scoped first」に従い、参照アダプタの存在自体は promotion の根拠にならない。
- 本 PR で外部通信を発生させないのは、privacy / 外部契約の決定が owner の権限であるための意図的な据置（AGENTS.md §8）。

### 依存

| 依存 | 種別 | 備考 |
| --- | --- | --- |
| `api.github.com`（未接続） | 第三者 API | **runtime dependency ではない**（結線前）。接続時に初めて依存になる |
| Cloudflare `fetch` | platform | 既存の platform dependency。追加の binding なし |
| Node / Workers 標準 API のみ | platform | 追加 package なし（`AbortSignal` / `Response` / `TextDecoder`） |
| `sharp`（devDependency、既存） | 検証ツール | capture の WebP 化のみ |

## 5. 契約テストが固定していること

| テスト | 固定している性質 |
| --- | --- |
| `src/external-api/contract.test.ts` | 遷移が `value` / `degraded` の 2 種しかないこと。`loading` に留まらないこと。失敗が値と観測時刻を壊さないこと。breaker の open/probe/close。**`retryAt` を reader が守る**（cadence 内の試行は refusal になり上流が増えない）。cadence refusal が breaker を `open` と嘘になること（実際の breaker state を報告する）。retry 間隔が有限かつ非負。失敗語彙が label 付きで閉じていること |
| `src/external-api/reader.test.ts` | deadline（signal を無視する adapter でも `timeout` に収束・signal を abort する・**fake timer で timer 残存 0**）。**同期 throw する adapter でも通常失敗遷移へ収束する**。**負荷**: 同時 50 呼び出し → 上流 1 回。blocked 中は上流 0 回。probe は 1 回だけ。cadence 内 retry は上流 0 回 |
| `src/external-api/timeout.test.ts` | status → 公開 reason の写像。応答サイズ上限（body-less 応答でも byte 単位で）。credential header の拒否（送信前に fail）。**transport 自身は source 固有の `accept` を持たない**（adapter が `accept` を持つ）。upstream 詳細が error に残らないこと |
| `src/external-api/github.test.ts` | allowlist（個人フィールド・private payload の拒否）。header に credential がないこと。**GitHub の `accept` は adapter が送る**。404 / 403 が公開 reason になること。**adapter は policy を持たない**: reader が解決した `maxResponseBytes` がそのまま transport の上限になる（1 KiB 指定なら oversized body は `malformed-response`、既定 64 KiB なら同じ body を読む） |
| `src/external-api/ExternalReadCard.test.tsx` | spinner は `loading` のみ。失敗時も値が残る。blocked なら retry が無効。**badge は画面上の状態を名指しする**（loading / 値なし失敗が `古い値を表示中` を出さない）。upstream 詳細が markup に出ない |
| `scripts/capture-api-timeout-fallback.test.mjs` | `.webp` 以外の出力拒否。リポジトリ外への書き出し拒否。harness が shipped story を import すること。静的配信の traversal 防御と不正 percent-encoding の 400。loopback 判定（外部通信の実測に使う純関数）。**候補は `.tmp/` に staging され、通過後のみ promotion される**。`--png` のような「書いたことのないファイルを消す」option は存在しない |

ローカル実測: `pnpm exec vitest run src/external-api/` = **108 passed**、`node --test scripts/capture-api-timeout-fallback.test.mjs` = **12 passed**。

## 6. 残るリスク（測定済み・隠していない）

| リスク | 内容 | 現状の対処 |
| --- | --- | --- |
| Storybook build が manager-only | `@storybook/react-vite` がプロジェクトの `vite.config.ts`（Cloudflare / TanStack plugin）を取り込み、preview bundle が出ない | capture は Vite harness で同じ story module を import する。build 修正は別 ticket（#501 と同じ制約） |
| 実 upstream への接続試験がない | テストは全て注入 transport。GitHub の実レスポンスは `github.test.ts` の fixture（実 API と同一 schema を手入力）で代替 | promotion 時に実接続の contract test を追加する（本 PR のスコープ外） |
| 訪問者のローカル時刻で描画しない | 観測時刻は UTC 固定で描画する | 意図的。localized 表示は「同じ瞬間を指す」ことを崩すため採用しない |
| 未認証 read の budget | 60 req/hour per source IP。共有 egress ではさらに早く枯渇しうる | 同時呼び出しの合流（50→1）、**`retryAt` より前の試行の refusal**、breaker による遮断で 緩和。stale window を 6h に置いた根拠でもある |
| 失敗語彙の文言 | `EXTERNAL_FAILURE_LABEL` の日本語は visitor 向け文言として未レビュー（例: `応答时间内.timeout` は「応答時間内」と読める） | 閉じた語彙であることだけを固定している。文言の最終判断は owner（§7） |

## 7. 未決事項（owner 判断）

1. **promotion するかどうか**。外部通信を**実際に**発生させる decision は privacy / 外部契約に及ぶため、agent は決めない。判断するときの入力は本レポート §3 / §4。
2. **どの capability が adapter を消費するか**。`docs/domain/integrations.md` の観測条件（2 以上の consumer / 独立した auth・rate limit lifecycle）が揃うまで `not integrated` のまま。
3. **Storybook build の修正**は別 ticket。capture harness はその修正に依存しない。
4. **`.png` → `.webp` の置き換えを慣習にするか**。Issue が名指しした `.png` をそのまま出荷する選択も残っている。#499 と #501 が独立に同じ置き換えをしているので、慣習にするなら `skills/quality-gate` か ADR の対象であり、2 つの独立 PR の中で黙って決められるものではない。
5. **`external-api` の reverse import guard を `check-architecture.mjs` に登録するか**。現状登録されているのは `external-api -> {home, routes, portfolio, about, cloudflare, http}` の一方向だけで、`home` / `portfolio` / `about` / `routes` からの reverse edge は機械的に守られていない（現在はどの file も import していない）。promotion 時に「capability が採用した」ことを明示する mechanism にするかは owner 判断。
6. **capture harness の重複**。`scripts/capture-api-timeout-fallback.mjs`（本 PR）と `scripts/capture-error-state-gallery.mjs`（branch `501`）は同形の約 420 行。共通 `scripts/_capture-harness.mjs` へ昇格させるかは AGENTS.md §3 の promotion 規則による owner 調整事項。
7. **失敗語彙の visitor 向け文言**。閉じた語彙としての一貫性は固定済みだが、日本語の文言（特に `応答时间内.timeout`）は出荷前に owner がレビューすること。

## 8. 再生成方法

```bash
node scripts/capture-api-timeout-fallback.mjs          # build → capture → WebP → report
node scripts/capture-api-timeout-fallback.mjs --no-capture  # harness build のみ（ブラウザ不要）
```

生成物 `.tmp/api-timeout-fallback/report.json` には source SHA・viewport・実測サイズ・6 state 数・**loopback 以外の request URL 数（実測値）** が記録される。gallery が fixture 以外を要求した場合（実測値 > 0）は script が失敗し、artefact は書き出されない。
