# Pet companion — Codex ペット (Melty) の Web 再利用

> Status: **Proposal / owner 判断待ち（実装なし）**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self
> Owner: 未確定 — §7 の判断待ち
> Issue: #274
> Enforced by: なし（アセットを公開していないため、どの gate の対象にもなっていない）

## 1. 結論

- 素材は**失われていない**。`~/Documents/Codex/2026-10-07/pets-plugin-work-pets-openai-curated/`
  に v2 スプライトアトラスと生成・検証の全成果物が残っている。
- 期限切れだったのは `spritesheet_url`（署名付きの**転送用一時 URL**）だけで、
  素材そのものはローカルの ChatGPT Library 側にある。
- ただし**権利が未記録**である。公開面には載せない（fail-closed）。
  権利記録の案と導出結果は
  [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)。
- したがって本 Issue は **設計と権利レビュー案まで**で停止し、実装は owner 判断後に行う。

この文書は「何があるか」「どう出すか」「何を owner が決めるか」だけを扱う。
実装（コード・アセットの commit）はまだ 1 バイトも存在しない。

## 2. 素材の実体（証拠）

発見場所（この Mac のローカル。リポジトリ外）:

```text
~/Documents/Codex/2026-10-07/pets-plugin-work-pets-openai-curated/outputs/Pets/Melty/
```

| ファイル | 寸法 | バイト | sha256 |
| --- | --- | ---: | --- |
| `final/spritesheet-extended.png` | 1536 × 2288（v2） | 1,546,230 | `78aa007c7d183e6087593463d77297bb0c707368f9c05cd871145281bbf63902` |
| `final/spritesheet.png` | 1536 × 1872（v1） | 1,225,950 | `31d1b8ab26c90d7747eb1a7a36a5cfb098bbd1fcb6e7244754c348400a1f4471` |
| `final/spritesheet-extended-raw.png` | 1536 × 2288（despill 前） | 1,548,910 | `c4bb4ae5662f6409b464519a1a6bdeb6d95c88a47db628f437efd0af6ea988a8` |

付随する記録:

| ファイル | 内容 |
| --- | --- |
| `pet-record.json` | `id: pet_6ac5adc2388481919ad57cc91ead3f51` / `name: Melty` / `sprite_version: 2` / `selected: true` |
| `final/validation-extended.json` | `ok: true`, `errors: []`, `warnings: []`, 8 列 × 11 行, `sprite_version_number: 2`, 透明 RGB 残渣 0 px |
| `qa/pet-quality.json` | `ok: true`, `errors: []`。look 方向の連続性に 4 件の警告（§3.2） |
| `qa/final-contact-sheet.png` | 全 11 行のコンタクトシート（目視確認済み） |
| `qa/final-previews/*.gif`, `*.mp4` | 状態ごとのループ、全状態、idle→jump→idle |
| `qa/blind-*.json` | 方向のブラインド判定 |

`~/.codex/config.toml` の `selected-avatar-id` はこの `pet_id` と一致する。
つまりこの Mac の Codex デスクトップは今も Melty を選択しており、
実体は「消えた」のではなく「`~/.codex/pets/` とは別の場所に保存されていた」。

### 2.1 なぜ `~/.codex/pets/` が空なのか

`~/.codex/pets/` は空である（確認済み）。一方、`work-pets` プラグインの契約は
「ペットの成果物は ChatGPT Library に保存する」と定めており
（`~/.codex/plugins/cache/openai-curated-remote/work-pets/0.1.6/references/sprite-sheet-contract.md`
§Save artifacts to Library）、この Library の実体が上記 `~/Documents/Codex/**` である。
つまり正本は Library 側にあり、`~/.codex/pets/` が空であることは
「素材が無い」ことを意味しない。`~/.codex/pets/` の役割はこの調査では特定していない
（空だったという事実だけを記録する）。

### 2.2 再取得経路（owner が何かをする必要があるか）

**現時点では不要。** ローカルに実体がある。将来失った場合の経路は次の 3 つ:

1. この Mac の Library フォルダ（上記パス）— 今すぐ使える。
2. ChatGPT デスクトップ → Library → Pets → `Melty` — 再ダウンロード。
3. `get_pet_download_link`（pets MCP）— 署名 URL は**短命**。取得したら即座に使う。
   stable pet ID は `pet_6ac5adc2388481919ad57cc91ead3f51` で、URL は保存しない。

### 2.3 失うと再現できないもの

アトラスの再生成は OpenAI の画像生成に依存し、**決定的ではない**。
同じプロンプトでも同じバイトは出ない。したがって
`final/spritesheet-extended.png` は 1 点物として扱う。
本 Issue の権利判断より先に、Library 外（owner のバックアップ）へ退避することを推奨する。
これはこのリポジトリが代行しない — 素材を commit すること自体が公開だからである。

## 3. アトラス契約（v2）

セルは **192 × 208 px**、8 列固定。各状態は行の左端セルから並ぶ。

| Row | 状態 | フレーム | 意味 |
| ---: | --- | ---: | --- |
| 0 | idle | 6 | 静かな呼吸・まばたきのループ |
| 1 | running-right | 8 | 画面右向きの移動 |
| 2 | running-left | 8 | 画面左向きの移動 |
| 3 | waving | 4 | 手を振る挨拶 |
| 4 | jumping | 5 | 上昇して基準線に戻る |
| 5 | failed | 8 | 失敗の反応 |
| 6 | waiting | 6 | 承認・入力待ち |
| 7 | running | 6 | 処理中・作業中 |
| 8 | review | 6 | 成果物の確認 |
| 9 | look 000–157.5 | 8 | 視線方向（前半） |
| 10 | look 180–337.5 | 8 | 視線方向（後半） |

未使用セルは完全透明。合計 73 フレーム + 15 透明セル = 88 セル。

### 3.1 Web で必要な行

| 行 | Web での扱い |
| --- | --- |
| 0 idle | **必要**（静止フレームとして） |
| 3 waving | **必要**（明示トリガの反応） |
| 4 jumping | 任意（同じトリガ系統） |
| 6 waiting / 7 running / 8 review / 5 failed | 将来（サイト状態と結びつける場合） |
| 1 running-right / 2 running-left | **不要**（ドラッグ可能なデスクトップ overlay 用） |
| 9 / 10 look | **不要**（ポインタ追従用。Web ページでは使わない） |

### 3.2 既知の警告

`qa/pet-quality.json` は look 方向の連続性に 4 件の警告を出している
（`157.5→180` が局所外れ値、`292.5→315` / `337.5→000` が隣接平均より大きい差分）。
契約上これは warning であり、cardinal / quadrant の誤りではない。
**Web で使う行（0, 3, 4）には影響しない**。look 行を使う判断をした場合にだけ再評価する。

## 4. 権利の現状

別文書 [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)
で `src/legal/contract.ts` の語彙に沿って記録案を書いている。要点だけ:

- `origin` は `third-party-bundled`（バイトは OpenAI の画像生成由来で、
  このリポジトリのスクリプトが生成したものではない）。
  `repository-generated` と書くのは**事実に反する**ので使わない。
- `license.spdx` は現時点で `NOASSERTION`。
- 導出される公開判定は **`hold`**（fail-closed）。
- `hold` のまま公開面へ出すと gate は `L018` / `L017` / `L010` を出す。

## 5. 統合設計

### 5.1 所有権の置き場所

**`src/home/**` に置く。`editorial` には置かない。**

AGENTS.md §3 の 5 問:

| 問い | 答え |
| --- | --- |
| Obligation | 「Home にこのキャラクターを出す」という表示判断と、その状態機械・アセット経路 |
| Change reason | キャラクターの見せ方が変わる時。visual language 全体が変わっても、この表示が不要にならない限り変わらない |
| Authority | `src/home/brief.md` の設計方向（owner / Issue #21） |
| Dependency direction | `home → editorial`（既存の許可済みエッジ。`usePrefersReducedMotion` とプリミティブのみ） |
| Lifecycle | Home の表示から生まれ、Home の表示から消える |

- `editorial` は**視覚言語**（token / semantic token / primitive）を所有する。
  キャラクターは「状態を持ち、アセットを配信し、トリガを受ける」対象で、
  表示プリミティブではない。`editorial` に入れると、Home 固有の状態機械が
  visual language の一部として固定される。
- `src/pet/` のような新しい top-level obligation は**作らない**。
  独立した authority・lifecycle がまだ観測されていない
  （AGENTS.md §3「独立した契約が観測されるまで昇格しない」）。
- 昇格トリガ: 2 つ目の消費者（About / Portfolio など）が現れ、
  かつ表示とは独立した契約が観測されたとき。その時点で `editorial` か
  新 obligation かを再判断する。

物理配置は `src/home/pet/`（`home/` 配下の機能サブディレクトリ。
`digits/` `reactions/` `access/` と同じ既存の形）。

### 5.2 表示位置

`src/home/brief.md` は「hero illustration を避ける」「hero と footer は静止」と明記している。
したがって **hero には置かない**。hero に置くなら brief 自体の更新が必要で、
それはこの Issue ではなく設計方向の変更として扱う。

推奨: capability セクション群の後、footer の前に**小さな独立セクション**として置く。
- ページの読み順を壊さない（主張 → 実績 → 余韻）。
- 装飾なので `<h1>`〜`<h3>` を消費しない（`aria-hidden`、見出しは本文レベルのラベル）。
- 初期視野の LCP 候補にならないため、遅延ロードと両立する。

代替（より安い）: Home には出さず、`/design-system` の story だけで先に見せる。
権利判断が下りるまでこの選択肢が最も安全である。

### 5.3 サイズ

- セル 192 × 208 を **96 × 104 CSS px** で表示する（DPR 2 で原寸 1:1）。
- モバイルでも同じ比率。72 × 78 は 2 倍系でないため輪郭が甘くなるので避ける。
- 固定ボックス（`width` + `aspect-ratio: 192 / 208`）で確保し、**CLS 0**。

### 5.4 アニメーション

**自動再生しない。** これは「好み」ではなく WCAG 2.2 SC 2.2.2（Pause, Stop, Hide, A）の
制約で、`src/editorial/reduced-motion.ts` は
「5 秒を超えて自動で動き続ける内容はプラットフォームに出荷していない」と宣言している。
常時ループする idle を足すと**その宣言が嘘になる**。

設計:

| 状態 | 動き |
| --- | --- |
| 既定（静止） | idle の 0 フレーム目を静止表示 |
| 反応（waving 4 フレーム ≈ 0.5 s） | 明示トリガ（ボタン）でのみ 1 回再生し、静止フレームに戻る |
| jumping（5 フレーム） | 同上。採用するなら同じトリガ系統にする |

- 実装は CSS の `steps(n)`（`background-position` の横送り）。JS タイマーで
  フレームを書き換える方式は、gate から見えない motion を生むので使わない。
- 有限回再生（`animation-iteration-count: 1`）なので「5 秒超の自動再生」に当たらない。
- `data-motion="pet-reaction"` を付け、hook 名 `PET_REACTION_MOTION` を
  `src/editorial/reduced-motion.ts` に公開し、`src/styles.css` の
  `@media (prefers-reduced-motion: reduce)` に
  `[data-motion="pet-reaction"]` のセレクタを置く。この 3 点は
  `pnpm run a11y:reduced-motion:check` が要求する（hook 定数は
  preference contract モジュールにしか置けない）。

### 5.5 reduced motion

- `usePrefersReducedMotion()` を**レンダー時に分岐**に使い、
  reduced のときは `animation-name` を一切出さない。
- reduced では状態を「フレームの入れ替え」で表現する
  （reduced-motion.ts の原則: 値や状態は休止ドキュメントが運ぶ）。
  反応トリガが押されたら waving の最終フレームを一瞬表示して戻す、ではなく
  **何も動かさない**。動きが装飾である以上、失われる意味はない。
- SSR は `false`（= motion allowed）を返し、hydration 後に実値を読む。
  ハイドレーション不一致は `useSyncExternalStore` が通常の更新として処理する。

### 5.6 遅延ロード / CLS / 転送量

実測値（この Mac で `sharp` により計測。元アトラスから行を切り出して WebP q85 で encode）:

| 対象 | フレーム | 元寸法 | PNG | WebP q85 |
| --- | ---: | --- | ---: | ---: |
| 静止フレーム（idle #0） | 1 | 192 × 208 | 33,393 B | **4,552 B** |
| waving ストリップ | 4 | 768 × 208 | 100,213 B | **15,348 B** |
| jumping ストリップ | 5 | 960 × 208 | 120,131 B | 19,092 B |
| idle ストリップ | 6 | 1152 × 208 | 191,538 B | 25,442 B |
| 9 状態すべて（不要な 2 行を除く） | — | — | — | 約 169 kB |

推奨の初期出荷は **静止フレーム + waving** の 2 ファイル = **約 20 kB**。

- `public/pets/melty/` に置く（`src/**` から Vite に取り込むと `/assets/` の
  hashed URL になるが、その場合 `assets:license:check` の監査対象
  `public/**` から外れる。権利が未記録のバイトを gate の外へ出すのは本末転倒）。
- 静的アセットの既定 `Cache-Control: public, max-age=0, must-revalidate` のままでよい
  （URL が安定していて内容が変わりうるファイルの正しい扱い）。
- 画像は `loading="lazy"` `decoding="async"` `fetchpriority="low"`。
  §5.2 の位置なら初期視野外なので `lazy` が妥当。
  固定ボックスがあるので読み込み完了前でもレイアウトは動かない（CLS 0）。

### 5.7 モバイル

- 固定ボックスなのでリフロー時のジャンプはない。
- トリガがボタンなら**タップ領域 44 × 44 CSS px 以上**（表示は 96 × 104 なので満たす）。
- 画面幅が狭いときに非表示にしない。表示位置が decorative なので、
  消す判断はレイアウトの都合ではなくデザイン判断として扱う。
- `prefers-reduced-data` はこのリポジトリで未使用なので、ここで新規に導入しない。

### 5.8 キーボード / a11y

2 案があり、**どちらを採るかは owner 判断**（§7）。

| 案 | 中身 | 利点 | 欠点 |
| --- | --- | --- | --- |
| A: 純装飾 | `aria-hidden="true"`, `alt=""`, フォーカス不可、トリガなし | キーボード負荷ゼロ、読み上げに一切現れない | 反応アニメを見せる手段がない（静止のみ） |
| B: 装飾 + 明示ボタン | 画像は `aria-hidden`、隣に `<button>`「ペットを反応させる」 | 反応を再現できる、focus ring は editorial のものを使う | 読み上げ順に意味のないボタンが 1 つ増える |

推奨は **B**。ただし Charter の「自動再生を前提にしない」を満たすにはボタンが必要で、
装飾画像自体は `aria-hidden` に保つ。ボタンに押下状態の意味を持たせないなら
`aria-pressed` は付けない（トグルではない）。

### 5.9 配信形式

- 状態ごとの**横ストリップ WebP（alpha）**。CSS の `steps()` と相性がよく、
  静止フレームを別ファイルにできる（ストリップ全体を落とさずに済む）。
- 元アトラス PNG（1.5 MB）は**リポジトリに入れない**。
  入れると公開コピーが 2 つになるうえ、git 履歴に 1.5 MB が残る。
  代わりに sha256 を権利・出所記録に書く（§2 の値）。
  代償: 再生成には owner の Library が必要（再現性は「記録された digest と一致すること」で担保）。
- 変換スクリプトは `scripts/` に置く（`digits/README.md` の `pnpm run generate:digits` と同じ形）。
  **入力はローカルのアトラス**、出力は `public/pets/melty/*.webp`。

## 6. 権利判断後に必要な作業（まだ着手しない）

1. `scripts/build-pet-sprites.mjs`（入力: アトラス、出力: ストリップ WebP、決定的）
2. `quality/asset-license-inventory.json` に record を 1 件追加（owner が決めた licence で）
3. `src/home/pet/` のスプライト幾何 + component + unit test + story
4. `src/editorial/reduced-motion.ts` に `PET_REACTION_MOTION`、`src/styles.css` に opt-out セレクタ
5. `src/home/public.ts` / Home ページへの配置
6. `pnpm run validate:fast` と、`ui-change` ラベル時の Playwright E2E

## 7. owner に決めてほしいこと

1. **権利** — これが唯一の blocker。
   - A: `NOASSERTION` のまま `hold`（公開しない）。現状維持。
   - B: owner が自分に権利があると判断し、`MIT` を記録して公開する
     （この場合も evidence はこのリポジトリのファイルで、OpenAI 側の条件を
     このリポジトリは読まない）。
   - C: 別のライセンス / 別の扱い。
2. **表示位置** — §5.2 の推奨（footer 前の独立セクション）でよいか。
   hero に置くなら `src/home/brief.md` の更新もセットで必要。
3. **反応トリガ** — §5.8 の A（純装飾・静止のみ）か B（明示ボタン）か。
4. **原本の退避** — Library 外へのバックアップを owner が行うか（推奨）。
5. **リリース** — 0.8.1 で扱うか、権利判断後に次のスプリントへ送るか。

## 8. 関連

- 権利レビュー案: [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)
- 権利契約: `src/legal/contract.ts`（Issue #497）
- reduced motion 契約: `src/editorial/reduced-motion.ts`（Issue #403）
- Home の設計方向: [`src/home/brief.md`](../../src/home/brief.md)
