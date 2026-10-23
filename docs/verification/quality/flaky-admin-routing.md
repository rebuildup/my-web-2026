# admin routing 統合テストの cold-start timeout（Issue #266）

> `test/integration/admin-routing.test.ts` の `GET /admin/login` が
> **"Test timed out in 5000ms"** で間欠的に失敗する flaky の**検証記録**です。
> gate の仕様書でも threshold 宣言でもありません。

## 何をしないか（線引き）

| 区分 | 本 Issue の扱い |
| --- | --- |
| timeout 値の延長 | **しません。** `vitest.config.ts` の `testTimeout` は 5000ms のままです（globals の数値変更は Issue #261 の領域） |
| gate の緩和 | **しません。** `quality/profile.yaml` の gate 定義・閾値は変更していません |
| 計測 instrumentation の commit | **しません。** 一時的に入れた計測は削除済みで、commit には残っていません |
| public copy | **触っていません。** 変更は test 1 ファイルとこの記録だけです |

## 根本原因

`test/integration/admin-routing.test.ts` は `cloudflare:test` を import するため
workerd pool に接続します（`vitest.config.ts` の Issue #618 コメントも同じことを記録しています:
pool 接続に **file あたり約 2.4 秒**かかる）。pool 内の**最初の** `SELF.fetch` は
SSR bundle の cold-start を含み、実測で **2230〜2616 ms**（5 回の計測）でした。

その cold-start が `it()` の 5000ms 予算の**内側**に入ると、loader / Better Auth 初期化 /
D1 アクセスに必要な残りの時間と合わせて予算を超え、**間欠的に** timeout になります。
単独実行では再現しにくく、suite 全体を並列で走らせたとき
（他 file が pool / CPU を奪い合う）に現れます。

### 決定的な証拠: cold-start は「どの test が時間を消費しているか」に現れる

対象 file だけを `--reporter=verbose` で走らせると、**第 1 テストだけが突出**します。
修正前の 5 回の実測:

| test | 実測時間（5 回） |
| --- | --- |
| `GET /admin/login returns 200 HTML with the sign-in form (anonymous)` | **2672 / 2672 / 2685 / 2741 / 2769 ms** |
| 残り 6 テスト | 2〜57 ms |

第 1 テストだけが 5000ms 予算の **53〜55%** を消費しており、残りは数 ms です。
これは「某个の test が遅い」のではなく、**pool 内の最初の cold-start が
タイムバジェットつきの test の中に丸ごと入っている**ことを示します。

## 修正

`describe` レベルの `beforeAll` で `/admin/login` へ 1 回だけ fetch する **warm-up** を置きます。
cold-start は hook の予算（vitest 既定の `hookTimeout`）で 1 回だけ会发生し、
各 `it()` は warm な SSR だけを測ります。**どの timeout の数値も変えていません。**

## 計測

同じ tree・同じコマンドでの比較です。対象は
`test/integration/admin-routing.test.ts` の
`GET /admin/login returns 200 HTML with the sign-in form (anonymous)`（第 1 テスト）です。

### 対象 file 単体（`npx vitest run --reporter=verbose test/integration/admin-routing.test.ts`）

| 条件 | 修正前 | 修正後 |
| --- | --- | --- |
| 対象 file を 5 回連続実行 | 5/5 green、ただし第 1 テストが **2672〜2769 ms** | 5/5 green、第 1 テスト **7〜12 ms** |
| 残り 6 テスト | 2〜57 ms | 2〜67 ms |

### 競合負荷（対象 file の実行中に suite 全体を並行実行）

対象 file だけを走らせただけでは CPU / workerd pool の競合が起きず、timeout は再現しません。
CI 相当の状態（多数の file が pool を奪い合う）を再現するため、**同一 worktree で
suite 全体を並行実行**します。

| 並行 suite 数 | 修正前 第 1 テスト | 修正前 結果 | 修正後 第 1 テスト | 修正後 結果 |
| --- | --- | --- | --- | --- |
| 0（本file のみ） | 2672〜2769 ms | green | 7〜12 ms | green |
| 1 | 2666〜3680 ms | green | — | — |
| 2 | 3711〜4055 ms | green | — | — |
| 3 | **5006 / 5007 / 5007 ms** | **3/3 timeout** | **11〜12 ms** | **3/3 green** |

### suite 全体（`npx vitest run --reporter=dot`）

| 条件 | 修正前 | 修正後 |
| --- | --- | --- |
| suite 全体を 5 回連続実行 | 5/5 green（168 files / 2814 tests、84.10〜109.88 s） | 3/3 green（168 files / 2814 tests、86.51〜96.23 s） |

単独実行では競合が起きて timeout しないため、suite 全体だけの実行は再現装置として
使いません（上の「競合負荷」の表が再現装置です）。

### 再現コマンド

```sh
# 対象 file 単体（修正前は第 1 テストが 2.7 秒程度）
npx vitest run --reporter=verbose test/integration/admin-routing.test.ts

# 競合負荷（修正前は 3 回とも "Test timed out in 5000ms" で fail）
# 同一 worktree で suite 全体を 3 本並行起動した状態で対象 file を走らせる
for k in 1 2 3; do npx vitest run --reporter=dot & done
npx vitest run --reporter=verbose test/integration/admin-routing.test.ts
wait
```

## 再現条件

| 項目 | 条件 |
| --- | --- |
| ブラウザ | 不要（workerd pool 内の `SELF.fetch` のみ） |
| ネットワーク | 不要（外部 fetch なし） |
| 負荷 | **必要**。対象 file 単体では競合が起きたときだけ timeout する。同一 worktree で suite 全体を並行実行すると 3/3 で再現する |
| コマンド | `npx vitest run --reporter=dot` / `--reporter=verbose`（`pnpm run test` はこれに `scripts/*.test.mjs` の runner を足したもの） |
| Runtime | Node.js `>=22.18`（`package.json#engines`、CI は 22.18 固定） |
| ソース SHA | 修正は `test/integration/admin-routing.test.ts` のみ |

## 残存リスク

- 他の `cloudflare:test` を import する file にも同じ cold-start が存在します。本修正は
  **この file だけ**を対象にします（Issue #618 が setup の適用範囲を file 単位で決めた
  決定と整合させるため、範囲を広げる判断は別 ticket の領域です）。
- warm-up 対象 URL と対象の test URL が同じである以上、warm-up が target の route を
  壊す Regression はありません（route は read-only の GET）。
- 競合負荷の 3 本並行という条件は CI より意図的に過負荷です。したがって
  「CI でも必ず落ちなくなる」ことまでは主张せず、**cold-start がタイムバジェットの外に
  出たこと**（第 1 テスト 2672〜2769 ms → 7〜12 ms）を主張します。

## 2026-10 更新（Issue #261）— warm-up は共有 setup に統合

Issue #261 が **同じ原因**（workerd pool の cold start）に対して **同じ手段**
（hook 予算で 1 回だけ warm-up する）を **すべての対象 file に**適用する
共有 setup（`test/setup/warm-up.ts`）を追加しました。対象 file は
`scripts/_vitest-warmup-scan.mjs` が `SELF` の import から決定します
（現状 49 file。`admin-routing.test.ts` も含まれます）。

そのため、この Issue が置いていた **file 単位の `beforeAll` warm-up は冗長**になり、
削除しました。1 つの原因に 1 つの修正だけを残します。

| 項目 | 値 |
| --- | --- |
| 削除したコード | `test/integration/admin-routing.test.ts` の `beforeAll`（`SELF.fetch('https://example.com/admin/login')`）と `beforeAll` の import |
| 代替 | `test/setup/warm-up.ts`（共有 setup、条件付き） |
| 第 1 テストの実測 | 7〜12 ms（file 単位 warm-up 時代） → **66 ms**（共有 setup のみ。admin route の chunk ロード分の残差） |
| 修正前 | 2672〜2769 ms |

 共有 setup のみに依存する状態でも第 1 テストは budget の 1.3% で、timeout には
なりません。cold start と outbound round-trip の詳細は
`docs/verification/quality/flaky-unit-suite-261.md` にあります。
