# mic-level の host 有効化 — 実測記録（Issue #817 / ADR-0020 §4.5）

- 対象: `rebuildup/tool-mic-level` @ `9506e4619541d8912346648ced1239607acea199`
  （upstream merge SHA。`git ls-remote refs/heads/main` と submodule HEAD の
  一致を実測）
- host: `my-web-2026` ブランチ `817-mic`（base `release-0-8-1`）
- 測定日: 2026-11-02
- 測定環境: ローカル preview（`pnpm run build` → `pnpm run preview`、
  `http://127.0.0.1:4174`）、Chromium（`@playwright/test` の bundled
  Chromium、fake media device 指定）
- 測定の再現手順: `scripts/capture-tool-previews.mjs` と同じ preview を
  起動し、`.tmp/issue-817/mic-measure.mjs` / `mic-sandbox-ab2.mjs`
  （本記録のための計測スクリプト、**リポジトリには含めない**）で
  `/tools/mic-level` を開き、frame 内で `getUserMedia` を試した。

> この記録は **実測値**の記録である。owner 承認の記録ではない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 1. 成果物の実測

| 項目 | 実測値 |
| --- | --- |
| submodule HEAD | `9506e4619541d8912346648ced1239607acea199`（pin と一致） |
| build | `bun install --frozen-lockfile && bun run build` → 成功 |
| `dist/index.html` | 513 B |
| `dist/assets/index-DI3G-JcY.js` | 248,619 B（gzip 78.20 kB） |
| 収集先 | `dist/client/tools/mic-level/app/`（`dist/tool-provenance/mic-level.json` に provenance stamp） |
| asset 参照 | `dist/client/tools/mic-level/app/index.html` 内の `<script type="module" crossorigin src="./assets/index-DI3G-JcY.js">` = 相対参照 → `/tools/mic-level/app/assets/index-DI3G-JcY.js` に解決 |
| `GET /tools/mic-level/app/` | 200（preview 実測） |

## 2. ADR-0020 §4.5.2 の 7 条件の測定結果

| # | 条件 | 測定方法 | 実測 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 許可経路 | frame 内で `getUserMedia({audio:true})`（fake device あり） | `SecurityError: Invalid security origin` / console: `Permissions policy violation: microphone is not allowed in this document.` | **未達** |
| 2 | 拒否経路 | 権限を拒否して同じ URL を開く | `SecurityError`（§1 と同じ原因）→ Tool は「マイクを使用できません。権限が拒否されたか、埋め込み iframe の Permissions Policy でマイクが許可されていません。」を表示。未処理の例外 0 件（page error 0 / uncaught rejection 0） | 破壊しないことは **達**（§1 の未達は #825 の影響） |
| 3 | Permissions-Policy（容器側） | `GET /tools/mic-level` の応答ヘッダ | `permissions-policy: bluetooth=(), camera=(), display-capture=(), geolocation=(), hid=(), microphone=(self "http://127.0.0.1:4174"), …`（origin は配信 origin から導出） | **達** |
| 4 | Permissions-Policy（文書側） | `GET /tools/mic-level/app/` の応答ヘッダ | `permissions-policy: … microphone=(self "https://rebuildup.dev") …`（`public/_headers` の `/tools/mic-level/app/*` 規則） | **達** |
| 5 | 許可属性 | `/tools/mic-level` の HTML | `<iframe title="Mic Level Tool" src="/tools/mic-level/app/index.html" sandbox="allow-scripts" referrerPolicy="no-referrer" allow="microphone" …>` | **達**（`allow="microphone"` が出力される） |
| 6 | sandbox 不在 | 同 iframe の属性 | `sandbox="allow-scripts"` が**残っている** | **未達** |
| 7 | frame origin | frame 内の `window.origin` | `"null"`（opaque origin） | **未達** |

## 3. 未達の唯一の原因（AB 実測）

同じ manifest 宣言・同じ応答ヘッダのままで、**sandbox 属性の有無だけ**を
変えた frame を 2 種類作って測った。

| 条件 | `getUserMedia` | frame origin | console |
| --- | --- | --- | --- |
| A: 現状（`sandbox="allow-scripts"`） | `SecurityError: Invalid security origin` | `"null"` | `Permissions policy violation: microphone is not allowed in this document.` |
| B: 同じ `src` / `allow="microphone"` / 同じ応答ヘッダ、**sandbox なし** | **成功**（fake device `Fake Default Audio Input` が live） | `http://127.0.0.1:4174`（host origin） | なし |

つまり **#1 / #6 / #7 の未達は、manifest の宣言でも応答ヘッダでもなく、
`delivery.iframe.sandbox` に残っている `allow-scripts` が原因**である。
sandbox された frame は opaque origin になるため、その origin は
`Permissions-Policy: microphone=(self "https://rebuildup.dev")` の
allowlist に一致せず、document 側の許可も container 側の許可も効かない。

## 4. 必要な次の一手（まだ入れていない）

ADR-0020 §2.1（D1）は「`same_origin_static` の Tool は sandbox なしで
配信する」と決めており、§4.5.1 は mic-level の `delivery.iframe` に
`sandbox` を持たない形を要求している。しかし本ブランチ（`release-0-8-1`）
のコードは **D1 を実装していない**:

- `src/tools/manifest.schema.json` は `iframe.sandbox` を必須としている
- `src/tools/embed-policy.ts` は sandbox token が 1 個以上ない
  entry を `embed.sandbox.missing` で拒否する
- `src/routes/tools.$slug.tsx` は `sandbox={summary.iframe.sandbox}` を
  常に描画する

D1 の実装は Issue #825 の担当であり、稼働中の 7 Tool
（prototype / readmark / color-palette / qr-generator / text-counter /
sequential-png-preview / svg2tsx）の frame origin と storage 挙動を
同時に変えるため、**mic-level の配線 PR には含めていない**。D1 が
land した時点で §4.5.2 の #1 / #6 / #7 は到達する見込みである（§3 の
B 条件が、その形での実測済みのため）。

## 5. 視覚確認（quality-gate §19）

- `public/tool-previews/mic-level.webp`（1200 × 669、WebP quality 80）を
  `scripts/capture-tool-previews.mjs` で撮影。frame 内に実テキストが
  あること（blank frame チェック）を通過している。
- 撮影画面は **Tool 側の実状態**: upstream の standalone build には CSS
  バイプラインが無く（Tailwind 形式の class 名だけ）、.style 未適用の
  画面になる。画像は偽造せずそのまま記録し、`alt` はその画面の内容を
  正確に記述する。
- 撮影はマイクを許可していない状態（権限取得前）でのもの。メーターは
  描画されていない（これは Tool の欠陥ではなく、権限取得前の状態）。
  権限取得後の画面は §2 #1 が未達である以上、実測できていない。

## 6. この記録が覆盖面ないもの

- 本番 origin（`https://rebuildup.dev`）での実測。上の測定はすべて
  ローカル preview（`http://127.0.0.1:4174`）でのもの。
- ユーザーによる権限許可／拒否の実操作。Playwright の fake device と
  context 権限は、ブラウザの権限 UI を通らない。
- 実ブラウザ（利用者の Chrome / Safari / Firefox）での
  `getUserMedia` 挙動の相違。
