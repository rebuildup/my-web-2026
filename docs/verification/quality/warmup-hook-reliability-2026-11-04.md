# warm-up hook の budget が validate:fast を偽赤にする（Issue #900）— 検証記録

> `test/setup/warm-up.ts` の `beforeAll` が **`Error: Hook timed out in 10000ms.`**
> で suite を落とす問題の**検証記録**です。gate の仕様書でも threshold 宣言でもありません。
> 対象 SHA: 本記録の commit（branch `900` / base `origin/release-0-8-1` @ `56a05942`）。

## 何をしないか（線引き）

| 区分 | 本 Issue の扱い |
| --- | --- |
| 検証の削除・`skip`・`retry`・`continue-on-error` | **しません。** warm-up は同じ URL に同じ1リクエストを発行し続けます（ADR-0033） |
| `quality/profile.yaml` の gate 定義 | **変更していません**（`git diff` に含まれません） |
| `vitest.config.ts` の `testTimeout` / `hookTimeout` の global 変更 | **しません。** `testTimeout` は既定の 5000ms のまま、global な `hookTimeout` も追加していません |
| `ogp-card.test.ts` の timeout | **triage（下記の計測）の上でのみ**、2 つの sweep テストに個別 budget を付与。global ではありません |
| 本物のハングの隠蔽 | **しません。** 待ちには有限の上限（60 000ms）を置き、上限の根拠を下記に明記 |

変更ファイルは `test/setup/warm-up.ts` と `test/integration/ogp-card.test.ts` の2件のみです。

## 根本原因

- `test/setup/warm-up.ts` の `beforeAll` が **timeout 引数を持たず**、Vitest 既定の
  `hookTimeout`（10 000ms）が適用されていた。hook の timeout は `try/catch` の
  **外側**で発生するため、同ファイルのコメントが約束していた
  「It therefore never fails a test on its own」は**実装と一致していなかった**。
- 負荷時に workerd の cold start が 10s を超えると、hook が rejected になり
  **ファイル全体が suite failure** になる。検証内容には一切関係ない偽赤である。
- `vitest.config.ts` に `hookTimeout` / `testTimeout` の指定はなく、すべて既定値だった。

## 修正

### 1. warm-up hook を「ファイルを落とせない」構造にする（`test/setup/warm-up.ts`）

- **Bounded race** — `SELF.fetch(__warmup__)` と有限タイマー（`WARMUP_BOUND_MS = 60_000`）
  の race。どちらが先に settle しても hook は終了し、hook 本体が bound を超える経路は
  存在しない。fetch の rejection は race 側が消費するので、abandon 後の後始末でも
  unhandled rejection にはならない（同期 throw も catch で吸収）。
- **明示的な hook timeout** — `beforeAll(fn, WARMUP_HOOK_TIMEOUT_MS = 75_000)`。
  bound（60s）より**strictly 大きい**ので、Vitest 側の timer は race に負け、
  hook を終了させられなくなる。従来の「既定 10s が外側から hook を切る」経路の消滅。
- **予算超過の観測** — cold start が
  `WARMUP_OVER_BUDGET_THRESHOLD_MS = 10_000`（= 旧既定 `hookTimeout`、
  本 Issue が除去した cliff のそのもの）を超えたとき、**1 行だけ** status-only を出す:

  ```
  [warm-up] cold start over budget: 12345ms
  ```

  値は duration のみ。URL・headers・response・どの値も出しません。
  `test/setup/**` は `src/**` の外なので `log:redaction:check` の対象外だが、
  ** assumption ではなく gate を実行して確認した**（修正後の tree で
  `pnpm run log:redaction:check` → `log redaction OK`）。

### 2. `ogp-card.test.ts` の 5000ms timeout は「切り分け」の結果を記録（下記）

## 計測

### Before（修正前）

| # | 条件 | コマンド | 結果 |
| --- | --- | --- | --- |
| 1 | Mac・並行負荷（Issue #900 の実測） | `vitest run test/integration/cors.test.ts` | **1 failed**（`Hook timed out in 10000ms`）/ 4 skipped |
| 2 | 同じく hook に 60s 予算 | 同上（一時変更・測定後 revert） | **1 passed**（4 tests）、**56.7 s** |
| 3 | 同じく full `validate:fast` | `pnpm run test` step | **17 ファイル**が同一 hook timeout（`test/integration/*` 13 + `src/**/load.test.ts` 4）+ `ogp-card` の 1 テストが `Test timed out in 5000ms` |
| 4 | **この box（WSL）・full run** | gate-887-e worktree の `validate:fast` step 39/67（2026-11-04） | `Error: Hook timed out in 10000ms.` @ `test/setup/warm-up.ts:60` → `session-logout.test.ts` suite 失敗。`Test Files 1 failed \| 197 passed (198)`、`Tests 3227 passed`（＝テスト本体は一切赤くない） |
| 5 | この box・**4 ファイル**, load 8.6–8.9 | `vitest run cors session-logout admin-authorization ogp-card` | **再現せず**（4/4 green）。※負荷依存である証拠として記録 |
| 6 | この box・**10 ファイル**, load 11.94 | 上記 + 6 ファイル | hook timeout **0**、**ogp-card が `Test timed out in 5000ms.`（5007ms）** → `Test Files 1 failed \| 9 passed (10)` |

#5 の非再現は「この欠陥は負荷の形に依存する」ことの証拠であり、無視しません。
hook timeout の local な before 証拠は #4（同じ box・同じ日・full run）と
#1–#3（Issue の Mac 計測）が担います。

### After（修正後・同一 10 ファイル）

| 条件 | 結果 |
| --- | --- |
| load **15.92**、かつ**並行 foreign vitest**（`/home/basic/work/897` の `vitest run` が同時実行） | **RC=0、10/10 green**（`Tests 111 passed \| 1 expected fail (112)`）、`Hook timed out` **0 件**、`Test timed out` **0 件**、over-budget line 0 件（この実行ではどの cold start も 10s 未満） |

同一 tree・同一コマンド・**before より過酷な負荷**（load 11.94 → 15.92 ＋ 並行 vitest）で
旧 failure mode が出ていないことが確認できます。

### `ogp-card.test.ts` の切り分け（Issue #900 todo 3）

| 条件 | 測定 |
| --- | --- |
| 修正前・単体（load 11.37、`/tmp/w35` ×34 稼働中） | 13/13 green、tests 合計 **3.17 s** |
| 修正前・10 ファイル競合（load 11.94） | 最初の sweep が **5007ms で `Test timed out in 5000ms.`**（wall で失敗、assertion 失敗ではない）。同一 file の第 2 sweep は green |
| 修正後・単体 verbose（9 surfaces の sweep） | test1 **3158ms** → test2 **1ms**、tests 合計 3.47 s |

**判定: load-induced（本物の遅さではない）。** 単体では1テスト最大 3158ms（予算の 63%）で
余裕があり、ファイル全体も 3.5s 以内。競合時だけ 5000ms の wall に触れる。
`SURFACES` は public **9 surfaces** を **逐次** SSR する sweep で、その初回 touch の
cost がテスト予算の内側に入っている（Issue #266 の admin-routing と同型の構造）。

**対処（global ではない）**: その2つの sweep テストのみ
`{ timeout: SURFACE_SWEEP_TIMEOUT_MS }`（**20 000ms** = 既定の 4 値、観測worst の約4倍）。
`testTimeout` の global 変更はしない、assertion は一字も変えない、skip / retry は追加しない。
wall-clock の予算だけを、計測で裏付けた値に設定しています。

## なぜ 60 000ms か（finite bound の根拠）

1. **観測された最悪 cold start の上に置く**: Issue #900 の Mac 計測で
   **56 700ms**（60s 予算の hook で完了）。これ未満の bound は「まだ完了する cold start」を
   捨て、その残り cost を最初の test に押し込む＝suite failure を test failure に
   換えるだけになる。60s はそれらの観測値の**上**、15s の余裕を hook timeout
   （75s）に残す。
2. **有限であることが本物のハングを隠さない理由**: 上限に達したら hook は**待ちをやめる**。
   Worker が本当に動かなければ、それを必要とする test が**自分の予算で失敗する**——
   それが本物の failure の出る場所。skip・retry・defer は一切していない。
3. **10s の threshold は「観測のためだけ」**: 動作は変えず、旧既定
   `hookTimeout`＝撤去した cliff を超えたことだけを1行で記録する。

## 検証を減らしていない（明記）

- warm-up のリクエストは修正前と**同じ URL・同じ1回**。失敗時の best-effort も同じ。
- `skip` / `retry` / `continue-on-error` / gate の緩和を**追加していない**。
  `quality/profile.yaml` は未変更、`vitest.config.ts` も未変更。
- `ogp-card` の2テストに付けた20s は **wall-clock の予算**であり、
  assertion・観測対象（9 surfaces）・条件はどこも変わっていない。
- `pnpm run log:redaction:check` を修正後の tree で実行し green を確認済み
  （`test/setup/**` が scope 外であることを gate で確認した、仮定ではない）。

## 再現コマンド

```sh
# before（修正前の tree で）: 10 ファイル同時 — ogp-card の Test timed out が再現装置
pnpm exec vitest run test/integration/cors.test.ts test/integration/session-logout.test.ts \
  test/integration/admin-authorization.test.ts test/integration/ogp-card.test.ts \
  test/integration/admin-routing.test.ts test/integration/admin-step-up-auth.test.ts \
  test/integration/analytics-consent.test.ts test/integration/api-key-scope.test.ts \
  test/integration/auth-login-hardening.test.ts test/integration/cache-isolation.test.ts

# after（本 tree）: 同一コマンド — hook/test timeout ともに 0 件
# hook timeout の local before 証拠: gate-887-e の full validate:fast step39
#   （test/setup/warm-up.ts:60 の Error: Hook timed out in 10000ms.）
```

## 残存リスク

- **負荷依存**: 本件は「failure mode を除去した」記録であり、「どのマシンでも絶対に
  赤くならない」主張ではありません（#5 の4ファイル非再現がその実例）。
  cold start が 60s を超える負荷では hook は待ちを切り、残 cost が最初の test に出ます。
  そのとき line は over-budget 記録を残し、失敗すれば本物の failure として出ます。
- `ogp-card` の20s は個別予定。sweep がそれでも超える日が来れば、それは
  「sweep が遅すぎる」という本物の signal です。
