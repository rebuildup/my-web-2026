# business-mail-block の host 有効化 — 実測記録（Issue #771）

- 対象: `rebuildup/tool-business-mail-block` @ `1495b2e5feae6b4d38e1d985e1066b2913d39391`
  （`main` の merge commit。#7 / #9 を統合した状態。`git submodule status` と
  `dist/tool-provenance/business-mail-block.json#checkout_sha` の一致を実測）
- host: `my-web-2026` ブランチ `771`（base `release-0-8-1`）
- 測定日: 2026-11-03
- 測定環境: ローカル preview（`pnpm run build` →
  `node scripts/sync-cf-build-output.mjs` → `vite preview --port 4392 --strictPort`、
  `http://127.0.0.1:4392`）、Chromium（`@playwright/test` の bundled Chromium）
- 測定の再現手順: 上記 preview を起動し、本記録のための計測スクリプト
  （`.tmp/capture-771.mjs`、**リポジトリには含めない**）で `/tools/business-mail-block`
  を開き、iframe 内の「利用可能なブロック」から 4 ブロックを
  「メール作成エリア」へドラッグ&ドロップし、生成メールのコピー・ダウンロードを
  実行して WebP を撮る。

> この記録は **実測値**の記録である。owner 承認の記録ではない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 1. 成果物の実測

| 項目 | 実測値 |
| --- | --- |
| submodule HEAD | `1495b2e5feae6b4d38e1d985e1066b2913d39391`（manifest の `source.pinned_sha` と一致） |
| provenance | `dist/tool-provenance/business-mail-block.json#checkout_sha` = 同 SHA |
| `dist/client/tools/business-mail-block/app/index.html` | 466 B |
| `.../app/assets/index-CqaUp-e7.js` | 346,105 B |
| `.../app/assets/index-BcEETRZJ.css` | 2,609 B |
| asset 参照 | `index.html` 内の `<script src="./assets/index-CqaUp-e7.js">` = 相対参照 → `/tools/business-mail-block/app/assets/...` に解決 |
| `GET /tools/business-mail-block` | 200（preview 実測、SSR） |
| `GET /tools/business-mail-block/app/index.html` | 307 → `/tools/business-mail-block/app/` |
| `GET /tools/business-mail-block/app/` | 200（preview 実測） |
| iframe 属性（host 実出力） | `src="/tools/business-mail-block/app/index.html"` / `sandbox="allow-scripts allow-downloads"` / `referrerPolicy="no-referrer"` / `allow="downloads"` |
| `quality/tool-artifact-inventory.json` | `pinned_sha` = 同 SHA / `license.status` = `verified` / `dependencies.status` = `verified` |

`allow-downloads` の根拠は manifest の
`delivery.iframe.sandbox_rationale` に、以下 §3 の実測とともに記録してある。

## 2. 欠陥 1 — ドラッグ&ドロップが確定しない（上流 Issue #6 / PR #7）

host の前 pin（`e88be11`）で、カードをドラッグしても**合成が起きなかった**。
計測で確認した因果は次のとおり（すべて同じ build での実測）。

1. `mousedown` は `defaultPrevented`（dnd がロックを取得）。
2. dnd のセンサーは `DRAGGING` に到達し、支援技術向けアナウンサは
   「moved from position 2 in list available to list composed in position 1」を発話。
3. しかしカードは視覚的に持ち上がらず（`position: fixed` にならず）、drop アニメーション
   も走らず、store は `DROP_ANIMATING` で止まり `DROP_COMPLETE` が発行されない。
4. `Array.prototype.splice` を計測用に包んで確認したところ、アプリの
   `onDragEnd`（合成の実処理）は一度も呼ばれていない。

原因は Tool 側の JSX で、`Draggable` の 2 つの renderer
（`src/components/AvailableBlocks.tsx` / `ComposedBlocks.tsx`）が
`provided.draggableProps` を spread した後に **`style` prop を平文のオブジェクトで
上書きしていた**こと。`@hello-pangea/dnd` は lift の幾何（`position` / `transform` /
`top` / `left`）を `provided.draggableProps.style` で渡すため、これが消えると
カードが持ち上がらず、dnd は drop アニメーションを完了できず、
`DROP_COMPLETE`（= `onDragEnd`）に到達しない。

修正は `provided.draggableProps.style` を **最初に spread** するだけである
（`styles` の残りは従来どおり）。上流 PR #7（merge commit `52124c7`）で main に入れた。

前 pin / 新 pin の差分は 2 ファイル・11 行（コメント 9 行 + spread 2 行）で、
外部 origin・storage・権限に触れる変更はない。manifest の `privacy.basis` は
この差分を明記したうえで据え置いた。

## 3. 欠陥 2 — 390px で操作ボタンが 1 文字ずつ改行される（上流 Issue #8 / PR #9）

§5 の 390px スクリーンショットを撮った時点で、Tool の「生成されたメール」見出し行が
折り返さず、各ボタンのラベルが 1 文字ずつ改行されていた（「コ / ピ / ー」）。

```
生成され   コ    ダウ    テンプ
たメール   ピ    ンロ    レート
           ー    ード    保存
```

原因は `src/components/GeneratedEmail.tsx` の見出し行が `flex-wrap: nowrap`（既定）で、
ボタン側にも折り返し指定がなかったこと。見出し行に `flex-wrap: wrap` と `row-gap`、
各ボタンに `white-space: nowrap` を追加し、収まらないときは操作群ごと次の行へ落とす
ようにした（上流 PR #9、merge commit `1495b2e`）。

390×844 での実測（変更前 → 変更後）:

| 要素 | 変更前 | 変更後 |
| --- | --- | --- |
| 見出し | 2 行（「生成され / たメール」） | 1 行・143 px |
| コピー | 1 文字改行 | 1 行・104 px |
| ダウンロード | 1 文字改行 | 1 行・152 px |
| テンプレート保存 | 1 文字改行 | 1 行・184 px |

1440px 幅では 1 行に収まるため表示は変わらない。

## 4. 受け入れ条件の実測（ユーザー操作）

同じ preview で、iframe 内を実際にマウス操作して測った。

| 条件 | 実測結果 |
| --- | --- |
| ブロック選択 → 合成 | 「利用可能なブロック」から 4 ブロック（署名・結び・依頼本文・挨拶）をドラッグ&ドロップし、`[data-rfd-droppable-id="composed"]` 内のカード数 = **4** |
| 生成メール | `いつもお世話になっております.{company}の{name}です.` 以下、挨拶・本文・結び・署名の 4 段落が順に生成される |
| コピー | コピーされた文字列 **154 文字**。挨拶（`いつもお世話になっております`）・結び（`ご検討のほど`）・署名（`Email: {email}`）をすべて含む |
| ダウンロード | `business-email.txt` の download イベント 1 件（`allow-downloads` の効果） |
| sandbox iframe 内での drag & drop | 上記の合成が成立（§2 の修正後） |

コピーは opaque origin の frame で `navigator.clipboard` が使えないため、Tool 側の
`document.execCommand('copy')` フォールバックで成立している（manifest の `notes` に記録）。

## 5. 視覚確認（quality-gate §19）

| 画像 | 何を示すか |
| --- | --- |
| `business-mail-block-desktop.webp` | 1440×1000（DPR 2）。4 ブロック合成後の生成メール本文と、コピー / ダウンロード / テンプレート保存の操作群 |
| `business-mail-block-mobile.webp` | 390×844（DPR 2）。390px でも見出しは 1 行、操作群はボタン単位で折り返し、生成メール本文が読める |

入力データは Tool のサンプルブロックのみで、実在の宛先・社名は使っていない
（変数は `{company}` / `{name}` などのプレースホルダのまま）。

390px は**対応**と記録する。横スクロールは発生せず（iframe 内文書の
`scrollWidth` = `clientWidth` = 390）、操作群は画面内に収まる。

## 6. 変更ファイル

- `external/business-mail-block` — gitlink を `1495b2e` へ（`52124c7` は §2 の修正）
- `src/tools/manifest.json` — `source.pinned_sha`、`privacy.basis` の再測定注記、
  `notes`（§2 / §3 の欠陥と修正、上流 Issue / PR 番号）
- `quality/tool-artifact-inventory.json` — `pinned_sha`
- `docs/verification/tools/business-mail-block-{desktop,mobile}.webp` — 本記録の 2 画像

## 7. 未確認事項

- 実機のタッチ操作（iOS Safari / Android Chrome）でのドラッグ&ドロップは未測定。
  本記録は Chromium のマウス入力のみ。
- テンプレート保存は Tool の React state 内だけで成立する（`src/**` に
  `localStorage` / `sessionStorage` / `indexedDB` の参照は 0 件、実測）。
  したがって opaque-origin の sandbox でも動作し、再読込すると消える。
  この挙動自体は Tool 側の仕様で、host の範囲外。
