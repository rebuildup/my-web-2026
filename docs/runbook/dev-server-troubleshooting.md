# Dev server トラブルシューティング runbook (Issue #1317)

> `pnpm dev` 系の開発サーバーが「起動したのに応答しない」「ページが
> 500 になる」状態に陥ったときの診断・復旧手順。#1266 redesign
> program 中に観測された 3 つの障害モード（空のローカル D1、stale
> `workerd` 子プロセス、高負荷時の極端な起動遅延）を対象とする。

データソースのモード自体（local / mock / production-readonly）の正本は
[`development-data-source.md`](development-data-source.md)。本書は
その上で「サーバーが応答するか」を診断する。

---

## 0. 大原則: 「vite ready」は readiness ではない

`vite dev` が `ready in …` を表示しても、それは Vite の HTTP
リスナーが立ったことしか意味しない。**SSR（workerd）が実際に
応答するかどうかは別問題**であり、#1266 中はこの 2 つがずれて
「ready なのに全リクエストが 0 byte でハングする」状態が実際に
発生した。

readiness の契約は 1 つ:

```
GET /api/v1/health → 200
```

このルートは外部 HTTP boundary（Hono）配下の最軽量プローブで、
D1 / R2 / 認証のいずれにも触れない。**これが 200 を返すことだけが
「キャプチャや E2E を始めてよい」の根拠**である。

---

## 1. どの dev モードを使うか

| やりたいこと | コマンド | バインディング | 備考 |
| --- | --- | --- | --- |
| UI / SSR の通常開発 | `pnpm dev` | ローカル miniflare | **ローカル D1 に migration が必要**（§3） |
| API のモック応答を見たい | `pnpm dev:mock` | ローカル miniflare | `/api/v1/*` は canned fixture。SSR の loader は実 D1 を読むので §3 は同じ |
| 本番データを読み取り専用で見たい | `pnpm dev:production-data` | **本番 D1 / R2（remote）** | 書き込みは全て拒否。remote session 用の Cloudflare 認証が必要 |
| 書き込み拒否だけを安全に試したい | `pnpm dev:read-only-guard` | ローカル miniflare | production-readonly の write policy + ローカル bindings |

迷ったら `pnpm dev:production-data`。「空のローカル D1 で 500」
（§3）を構造的に回避できる。ローカルでの書き込み検証が目的なら
`pnpm dev` + `pnpm db:migrate:apply:local`。

---

## 2. 診断コマンド: `pnpm dev:doctor`

```bash
pnpm dev:doctor                  # http://127.0.0.1:3000 を 1 回診断
pnpm dev:doctor -- --wait=300    # health が 200 になるまで最大 300 秒待ってから診断
pnpm dev:doctor -- --timeout=20000   # 1 プローブの待ち時間を伸ばす（既定 10 秒）
pnpm dev:doctor -- http://127.0.0.1:3100   # ポート違いのサーバー
```

read-only。kill・書き込み・秘密情報の表示は一切しない。プローブは
`/api/v1/health` → `/api/v1/db/ping` → `/`（SSR + 宣言された
data source）→ `/portfolio`（データ系ルートのカナリア）の順。

終了コードで失敗モードが機械判定できる:

| code | モード | 意味 |
| --- | --- | --- |
| 0 | healthy | 全プローブが期待通り |
| 3 | vite-not-listening | 接続拒否。dev サーバーが起動していない/落ちた |
| 4 | wedged | ポートは開くが応答が無い。stale `workerd` の疑い大 |
| 5 | probe-failed | 応答はあるが期待と違う（5xx、health が 200 以外等） |
| 6 | empty-local-d1 | `/portfolio` が 5xx で、ローカル D1 に `portfolio_project` が無い |

wedged（code 4）と empty-local-d1（code 6）では、workerd プロセス
一覧（pid / ppid / 経過時間 / コマンド）または D1 スキャン結果を
併記する。**doctor はプロセスを kill しない** — 対象 PID は必ず
人間が確認してから止める。

---

## 3. 障害モード別の見分け方と復旧

### 3.1 empty-local-d1 — `/portfolio` `/about` が 500、`/` は正常

**症状**: `pnpm dev`（ローカル bindings）で `/` は表示されるのに
`/portfolio` や `/about` が `D1_ERROR: no such table:
portfolio_project` で 500。dev サーバー自体は健康。

**原因**: `.tmp/d1state`（`LOCAL_STATE_DIR`）のローカル D1 に
migration が適用されていない。Vite 起動時に
`vite.config.ts` の `devLocalD1StatePlugin` がこの状態を検出して
警告を出す（本 Issue で追加）。

**復旧**:

```bash
pnpm db:migrate:apply:local   # ローカル D1 に全 migration を適用
# または、ローカル D1 を使わず本番データを読む:
pnpm dev:production-data
```

`pnpm dev:doctor` が code 6 でこのモードを名指しする
（`v3/d1` 配下の sqlite/WAL を `portfolio_project` のスキーマ文字列で
スキャンするヒューリスティック。観測用 trace store は対象外）。

### 3.2 wedged — ready 表示後、全リクエストがハング（0 byte・無応答）

**症状**: 前回の dev サーバーを kill した後などに、新しい dev
サーバーが `ready` を表示するのに `/favicon.ico` すら応答せず、
ログにもエラーが出ない。ブラウザも Playwright もタイムアウトする。

**原因**: 前の dev サーバーの `workerd serve --binary` 子プロセスが
孤児として残り、ポート/状態を握ったままになっている。

**見分け方**: `pnpm dev:doctor` が code 4（wedged）を返し、
`workerd` プロセス一覧を表示する。`ppid=1` や、親が現在の
`vite dev` ではない `workerd` が stale 候補。

**復旧**（doctor が表示した PID を人間が確認してから）:

```bash
# 個別に止める（推奨 — 他プロセスを巻き込まない）
kill <pid> [<pid> …]

# workerd だけをまとめて止めたい場合
pkill -f 'workerd serve'

# それでも駄目なら vite/node 側も確認
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

その後 dev サーバーを起動し直し、`pnpm dev:doctor` で code 0 を
確認してから作業を再開する。**`pkill -f vite` のような広いパターンは
他の vite プロジェクトを巻き込むので使わない。**

### 3.3 起動が異常に遅い — 「ready in」が数分かかる

**症状**: マシン高負荷時に Vite の `ready in` が 100–600 秒。
`networkidle` 待ちのキャプチャが途中でタイムアウトする。

**対処**（本 Issue で実装済み）:

- `scripts/capture-design-matrix.mjs` は起動前に
  `waitForDevServer`（`GET /api/v1/health` ポーリング、既定
  600 秒・`--ready-timeout=<秒>` で変更可）を行い、ready になら
  なければ Playwright タイムアウトではなく原因名指しで即失敗する。
- `page.goto` の `networkidle` タイムアウトは 240 秒、
  `page.screenshot` は 180 秒（#1294 で導入済みの値を維持）。
- 単発の撮影でも、開始前に `pnpm dev:doctor -- --wait=600` を
  挟むと「まだ起動中」と「wedged」を区別できる。

---

## 4. キャプチャ系スクリプトの readiness 契約

Playwright / スクリーンショット系のスクリプトは、サーバーに
ブラウザを向ける前に `GET /api/v1/health` が 200 になることを
確認すること（Issue #1317 の契約）。実装は
`scripts/dev-doctor.mjs` の `waitForDevServer` を import して
再利用する。`vite ready` のログ行やポートの LISTEN 状態を
代用にしない — それらは SSR が答えることを保証しない。

---

## 5. 関連

- [`development-data-source.md`](development-data-source.md) —
  dev モード（local / mock / production-readonly）の正本。
- `scripts/dev-doctor.mjs` — 診断の実装。終了コード表は §2。
- `scripts/_local-d1-state.mjs` — ローカル D1 スキャンの実装。
- `vite.config.ts` `devLocalD1StatePlugin` — 起動時警告。
- `scripts/capture-design-matrix.mjs` — pre-flight 実装例。
