# Issue #261 — flaky な統合テスト 2 件の修正記録

> `test/integration/cors.test.ts` と `test/integration/security-headers.test.ts` が
> **"Test timed out in 5000ms"** で間欠的に失敗する flaky の**検証記録**です。
> gate の仕様書でも threshold 宣言でもありません。

## 線引き

| 区分 | 本 Issue の扱い |
| --- | --- |
| timeout 値の延長 | **しません。** `vitest.config.ts` の `testTimeout` は 5000ms のままです。修正前に入っていた `timeout: 60_000` の上書きは、原因が消えたので**削除**しました（数は増やしていません） |
| gate の緩和 | **しません。** `quality/profile.yaml` の gate 定義・閾値は変更していません |
| 計測 instrumentation の commit | **しません。** 一時的に入れた計測は削除済みで、commit には残っていません |
| public copy | **触っていません。** 変更は test / scripts / docs / `vitest.config.ts` だけです |
| アプリケーションのコード | **触っていません。** 変更はテスト環境（pool の設定と test setup）のみです |

## 特定した flaky テスト（名前と file:line）

| # | ファイル | テスト名 | 行（修正前） | 症状 |
| --- | --- | --- | --- | --- |
| 1 | `test/integration/cors.test.ts` | `leaves the SSR surfaces free of API CORS headers` | 472（`it(` の行） | 実測 **4195 ms**。vitest の既定予算 5000 ms の 84% を消費し、競合負荷で "Test timed out in 5000ms" |
| 2 | `test/integration/security-headers.test.ts` | `serves nosniff + referrer + permissions on a public page` | 38 | 同構造（第 1 テストが SSR 文書を 1 枚描画する）。競合負荷で timeout |

2 件とも **「assertion の失敗ではなく timeout」** で壊れていました。失敗した
assertion がないため、ログだけからは原因が読めません（`Test timed out in 5000ms`）。

## 根本原因（2 つ）

### 原因 1 — cold start がタイムバジェットの内側に落ちている

`cloudflare:test` を import する file は workerd pool に接続し、その file の
**最初の `SELF.fetch`** が Worker bundle の cold start を負います
（SSR bundle の module graph / TanStack Start の route tree / 最初の SSR render が
すべて遅延ロードされます）。実測 **2230〜3240 ms**。

この時間が `it()` の 5000 ms 予算の**内側**に入ると、loader / Better Auth 初期化 /
D1 アクセスに必要な残りの時間と合わせて予算を超え、**間欠的に** timeout します。
単独実行では再現しにくく、suite 全体を並列で走らせたとき（他 file が pool / CPU を
奪い合う）に現れます。

### 原因 2 — Worker が自分の origin を呼び出し、テストが public internet に出ている

home route は access-counter と reactions API の**自分自身の利用者**です
（ADR-0011）。したがって `/` を描画すると Worker は**自分の origin**を呼びます。
この pool の request origin は public な host name なので（`cors.test.ts` では
**production origin**）、home の 1 回の描画ごとに実 DNS + TLS + round-trip の
時間が測られます（実測 **1900〜3100 ms**）。

帰結は 3 つ:

- 描画が遅く、原因 1 の budget 超えを押し上げる;
- suite が hermetic でない（public / production の到達性に結果が依存する）;
- **テスト実行から production へトラフィックが飛んでいる**。

## 修正（原因ごとに 1 つ）

### 修正 1 — cold start を hook 予算へ出す（`test/setup/warm-up.ts`）

`test/setup/warm-up.ts` を setup file として 1 つ追加し、**timed test の外**で
warm-up を 1 回だけ行います。cold start は hook 予算（vitest 既定の `hookTimeout`）
で 1 回だけ発生し、各 `it()` は warm な Worker だけを測ります。

- warm-up の対象は `https://example.com/__warmup__`（どの route にも一致しない path）。
  SSR 404 描画は cold start を構成する部分（SSR pipeline と root route）をロード
  しますが、binding / data store / third-party origin には触れません。home を
  測る fixture は D1 の table を要求するため「no such table」の log を各 file に
  出します。そのため home の描画そのものは warm-up の対象にしていません。
- **どの file が warm-up を必要とするか**は `scripts/_vitest-warmup-scan.mjs` が
  計算します。`SELF` は `cloudflare:test` の export なので、**`SELF` を import する
  file だけが worker request を発行できます**。したがって「file 自身の import 文を
  直接読む」走査で正確に決まります（pool 接続の走査が import graph を歩くのと
  対照的）。現状 **49 file** が対象です。
- 対象集合は `test.env[WORKERD_WARMUP_TEST_FILES]` で setup file に渡され、
  `scripts/_vitest-setup-needs.mjs` の `needsWarmup()` が判定します。判定不能な
  入力（env 変数の欠落 / 壊れた JSON / 配列でない / 自分の path が不明）は
  **fail-safe で warm-up する**（`true`）側に倒します。degraded な状態は
  「遅いテスト」であって「落ちる assertion」ではないからです。
- warm-up は**性能施策であって assertion ではない**ので、失敗しても
  ファイルは以前と同じ挙動に戻ります（try/catch で飲み、test を落とさない）。

### 修正 2 — outbound request を pool がローカルで答える（`scripts/_vitest-outbound-policy.mjs`）

pool の `outboundService` が**すべての outbound request を自分で 503 で答えます**。
upstream 呼び出しは即座に失敗し、Worker は**すでに取っていた degradation 分岐**
（以前は public host からの 404/405）をそのまま通ります。assertion も
アプリケーションコードも変わりません。変わるのは latency と、
**リクエストが machine の外に出ないこと**だけです。

## 重複実装の整理（Issue #266 との重複）

`release-0-8-0` には Issue #266 の修正（`c7b8764b`）が既に入っており、
`test/integration/admin-routing.test.ts` に file 単位の `beforeAll` warm-up が
置いてあります。修正 1 は同じ原因（cold start）を同じ手段（hook 予算での warm-up）で
**すべての対象 file に**解くものなので、#266 の file 単位のコピーは冗長です。
1 つの原因に 1 つの修正だけを残す、という方針で
`test/integration/admin-routing.test.ts` の `beforeAll` は削除しました
（この file は `SELF` を import するので共有 setup の対象です）。

削除してよいことの実測: 共有 setup のみに依存した状態で
`admin-routing.test.ts` の第 1 テストは **66 ms**（#266 の file 単位 warm-up 時は
7〜12 ms、修正前は 2672〜2769 ms）。残差は admin route の chunk ロードだけで、
budget の 1.3% です。

## 計測

### 修正後: suite 全体を 5 回連続実行（同一ツリー）

`pnpm exec vitest run` を 5 回連続実行しました（**1 回も落ちしていません**）。

| 回 | 結果 | Test Files | Tests | vitest Duration | 実時間 |
| --- | --- | --- | --- | --- | --- |
| 1 | green | 168 passed (168) | 2814 passed / 1 expected fail (2815) | 84.85 s | 86 s |
| 2 | green | 168 passed (168) | 2814 passed / 1 expected fail (2815) | 57.76 s | 59 s |
| 3 | green | 168 passed (168) | 2814 passed / 1 expected fail (2815) | 59.32 s | 60 s |
| 4 | green | 168 passed (168) | 2814 passed / 1 expected fail (2815) | 65.73 s | 67 s |
| 5 | green | 168 passed (168) | 2814 passed / 1 expected fail (2815) | 83.09 s | 85 s |

### 対象 file 単体（第 1 テストの実測）

| file | 修正前 | 修正後（file 単位 warm-up 時代） | 修正後（共有 setup） |
| --- | --- | --- | --- |
| `test/integration/cors.test.ts` | 4195 ms（timeout 寸前） | 57 ms | 45 ms（SSR surfaces テスト 240 ms） |
| `test/integration/security-headers.test.ts` | 未計測（同構造） | 7〜12 ms（競合 3 way 後） | 58 ms（第 1 テスト）、他は 1〜38 ms |
| `test/integration/admin-routing.test.ts` | 2672〜2769 ms | 7〜12 ms | 66 ms |

`cors.test.ts` の SSR surfaces テストは `/`・`/contact`・`/admin/login` の 3 文書を
描画します。修正前はこれに cold start（+ public origin への往復）が乗って budget を
超えていましたが、修正後は **240 ms** で、**vitest の既定 5000 ms** の 5% です。
このテストに付いていた `timeout: 60_000` の上書きは、原因が消えたので削除し、
既定 budget に戻してあります（数字を増やしたのではなく、戻した）。

### 再現コマンド

```sh
# 対象 file 単体（第 1 テストの時間を可視化）
pnpm exec vitest run --reporter=verbose test/integration/cors.test.ts
pnpm exec vitest run --reporter=verbose test/integration/security-headers.test.ts
pnpm exec vitest run --reporter=verbose test/integration/admin-routing.test.ts

# suite 全体を 5 回連続（Issue の完了条件）
for i in 1 2 3 4 5; do pnpm exec vitest run; done
```

## 再現条件

| 項目 | 条件 |
| --- | --- |
| ブラウザ | 不要（workerd pool 内の `SELF.fetch` のみ） |
| ネットワーク | **不要**。修正後は outbound request が pool 内で完結します（修正前は public / production origin に出ています） |
| 負荷 | **必要**。対象 file 単体では競合が起きたときだけ timeout します。同一 worktree で suite 全体を並行実行すると再現します |
| コマンド | `pnpm exec vitest run`（`pnpm run test` はこれに `scripts/*.test.mjs` の runner を足したもの） |
| Runtime | Node.js `>=22.18`（`package.json#engines`、CI は 22.18 固定） |

## 残存リスク

- **「5 回 green」は負荷なしの 5 回です。** 競合負荷（同一 worktree で suite 全体を
  3 本並行）在の 5 回ではありません。主張しているのは **cold start と outbound
  round-trip がタイムバジェットの外に出たこと**（第 1 テスト 2672〜2769 ms → 45〜66 ms、
  SSR surfaces テスト 4195 ms → 240 ms）です。
- **`env` ではなく `SELF` を使う file だけを対象にしました。** `env` だけを使う file は
  worker request を発行しないので warm-up 不要です（Issue #618 が setup の適用範囲を
  file 単位で決めた決定と同じ枠組み）。
- **outbound を 503 で答える方針は、upstream の payload を必要とするテストでは
  そのままでは成立しません。** そのようなテストは host 単位で意図的に
  mock する（本 Issue で該当するテストはありません）。

## 実装ファイル

| ファイル | 役割 |
| --- | --- |
| `test/setup/warm-up.ts` | warm-up を hook 予算で 1 回だけ実行する setup file |
| `scripts/_vitest-warmup-scan.mjs` | `SELF` を import する test file を列挙する走査 |
| `scripts/_vitest-setup-needs.mjs` | `needsWarmup()` / `encodeWarmupTestFiles()`（fail-safe 判定） |
| `scripts/_vitest-outbound-policy.mjs` | pool の outbound request ポリシー（503） |
| `vitest.config.ts` | setup file / env var / `outboundService` の配線 |
| `docs/development.md` | 2 つの test-environment policy の説明 |
