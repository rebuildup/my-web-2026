# history-quiz の host 有効化 — 実測記録（Issue #772）

- 対象: `rebuildup/tool-history-quiz` @ `024676693fd3d91401ddcacb1294ea988801c6eb`
  （`release-0-1-0` の standalone build。`git submodule status` と
  `dist/tool-provenance/history-quiz.json#checkout_sha` の一致を実測）
- host: `my-web-2026` ブランチ `772`（base `release-0-8-1`）
- 測定日: 2026-11-03
- 測定環境: ローカル preview（`pnpm run build` →
  `node scripts/sync-cf-build-output.mjs` → `pnpm run preview --port 4391 --strictPort`、
  `http://127.0.0.1:4391`）、Chromium（`@playwright/test` の bundled Chromium、
  `CHROME_BIN` で絶対パスを指定）
- 測定の再現手順: 上記 preview を起動し、本記録のための計測スクリプト
  （`/tmp/measure-772.mjs` / `/tmp/capture-772.mjs`、**リポジトリには含めない**）で
  `/tools/history-quiz` を開き、`/tools/history-quiz/app/` を sandbox 属性だけ
  変えた frame に読み込んで、最初の `input.blank` に入力 → `button.btn-reset`
  を押す、を 2 条件で実行した。

> この記録は **実測値**の記録である。owner 承認の記録ではない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 1. 成果物の実測

| 項目 | 実測値 |
| --- | --- |
| submodule HEAD | `024676693fd3d91401ddcacb1294ea988801c6eb`（pin と一致） |
| `dist/client/tools/history-quiz/app/index.html` | 314 B |
| `dist/client/tools/history-quiz/app/assets/index-BlLpwlGx.js` | 196,835 B |
| `dist/client/tools/history-quiz/app/history-quiz.html` | 89,935 B（クイズ本体。Tool リポジトリが所有） |
| asset 参照 | `index.html` 内の `<script type="module" crossorigin src="./assets/index-BlLpwlGx.js">` = 相対参照 → `/tools/history-quiz/app/assets/index-BlLpwlGx.js` に解決 |
| `GET /tools/history-quiz/app/` | 200（preview 実測） |
| `GET /tools/history-quiz` | 200（preview 実測、SSR） |
| iframe 属性（host 実出力） | `sandbox="allow-scripts allow-modals"` / `allow="modals"` / `referrerpolicy="no-referrer"` / `src="/tools/history-quiz/app/index.html"` |

## 2. 欠陥（このブランチで直した対象）

Tool のリセット操作は `confirm()` を要求する:

```js
// external/history-quiz/public/history-quiz.html:1180
window.resetSection = function resetSection(btn) {
    if (confirm("このセクションをリセットしますか？")) {
        const section = btn.closest('.quiz-section');
        ...
```

リセットボタンは 5 か所（`history-quiz.html:340, 366, 399, 428, 467`）に
`onclick="resetSection(this)"` として置かれている。sandbox された frame は
`allow-modals` を持たない限りモーダルダイアログを出せず、`confirm()` は
ダイアログを出さずに `false` を返す。したがって旧宣言
`sandbox="allow-scripts"` では、**リセットボタンがホスト画面内で完全に
無反応**だった（ダイアログも出ず、セクションも消えない）。

## 3. A/B 実測（`allow-modals` が原因であることの根拠）

同じ成果物・同じ `src`・同じ `referrerpolicy` のまま、**sandbox 属性だけ**を
変えた frame を 2 種類作り、同じ操作をした。

| 条件 | sandbox | ダイアログ | 入力欄（`x` を入力後） | リセット結果 |
| --- | --- | --- | --- | --- |
| A: 本ブランチ | `allow-scripts allow-modals` | **1 回発火**（accept） | `x` → `""` | **セクションが消える** |
| B: 対照（旧宣言） | `allow-scripts` | 0 回 | `x` → `x` | **何も起きない** |

A/B の差は `allow-modals` の有無だけなので、この 1 token が挙動の原因で
あることが測定で確定する。`allow-modals` は `allow-scripts` 以外の
sandbox token を 1 つも追加で与えない（`allow-same-origin` は付与せず、
frame の origin は opaque のまま、ホストのナビゲーション・popup・storage は
引き続き不可）。

`delivery.iframe.allow` の `"modals"` は、`docs/tools/embed-policy.md` §2 の
条件付き token に対する宣言側の要求（`iframe.allow` 非空 +
`sandbox_rationale`）を満たすためのもので、`allow-downloads` に対する
`"downloads"` と同じ命名規約（`allow-` 接頭辞を落とした名前）に従う。
`modals` は Permissions-Policy の feature 名ではないため、`allow` 属性側は
ブラウザに無視され（console warning `Unrecognized feature: 'modals'.`）、
実際に効いているのは sandbox token のみである。この非対称は manifest の
`sandbox_rationale` に明記した。

## 4. 視覚確認（quality-gate §19）

| 画像 | 何を示すか |
| --- | --- |
| `history-quiz-host-1440.webp` | 出荷状態の `/tools/history-quiz`。iframe 内にクイズ本体（第1回〜第5回、空欄入り本文）が描画されている |
| `history-quiz-reset-with-modals-1440.webp` | A 条件で `x` 入力 → リセット後。1 つ目の空欄が **空に戻り**、セクションが消えている |
| `history-quiz-reset-control-1440.webp` | B 条件で同じ操作。1 つ目の空欄に **`x` が残ったまま**（リセット無反応） |

2 枚目と 3 枚目は同じ操作・同じ frame 寸法（1300×820）で、sandbox 属性だけが
違う。差分がそのまま画像になっている。

## 5. 変更ファイル

- `src/tools/manifest.json` — history-quiz の `delivery.iframe` に
  `allow-modals` と `allow: "modals"` と `sandbox_rationale` を追加し、
  `notes` の「既知の制限: リセットは無効」という記述を、上記 A/B の実測結果に
  置き換えた。
- `docs/verification/tools/history-quiz-*.webp` — 本記録の 3 画像。

## 6. 付随して直した整合性（反例の引き上げ）

history-quiz が `host_disabled` から `same_origin_static` になったことで、
`docs/personal/usable-product-publication.md` の「反例 — 公開できない Tool」が
**実在しない記録を指す**ことになる。同じ節を #854 / #858 / #859 が同じ理由で
順に壊すため（この 4 本で 15 Tool すべてが公開される）、slug を 1 つずつ
差し替えるのではなく、**記録形そのもの**（`delivery.kind = host_disabled` と
`delivery.disabled_reason`）を `src/tools/manifest.schema.json` から読む形へ
引き上げた。

- preview: `UsableProductPublication.preview.ts` の example を
  `kind: 'schema'`（新設）にし、`subject` を `delivery.kind = host_disabled`、
  `record` を `src/tools/manifest.schema.json` にした。
- 検査: `scripts/check-usable-product-preview-parity.test.mjs` の
  「committed records」節に `kind: 'schema'` の分岐を足し、fact が schema の
  実テキストに存在することを照合する（実測: 22 tests / 22 pass）。
- これで残り 3 本（#854 fillgen / #858 ae-expression / #859
  business-mail-block）が公開を完了しても、この節は赤くならない。
