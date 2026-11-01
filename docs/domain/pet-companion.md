# Pet companion — Codex ペット (Melty) の Web 再利用

> Status: **Shipped — owner 承認済み（2026-11-01）、0.8.1 sprint で実装**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self
> Owner: rebuildup（§1 owner attestation）
> Issue: #274
> Enforced by: `assets:license:check`（`quality/asset-license-inventory.json#pet-melty-sprites`）、
> `a11y:reduced-motion:check`、`a11y:image-alt:check`、`copy:i18n:check`

## 1. 結論

- 素材は**失われていない**。`~/Documents/Codex/2026-10-07/pets-plugin-work-pets-openai-curated/`
  に v2 スプライトアトラスと生成・検証の全成果物が残っている。期限切れだったのは
  `spritesheet_url`（署名付きの転送用一時 URL）だけで、素材そのものはローカルの Library 側にある。
- 権利は owner の申告（attestation）として記録した。
  **「Melty は owner のオリジナルキャラクターで、owner のアイコンでもある」**（2026-11-01）。
  記録は [`quality/asset-license-inventory.json`](../../quality/asset-license-inventory.json)
  の `pet-melty-sprites`。根拠と未確認項目は
  [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)。
- 表示は **Home の「05 — Companion」セクション**と **`/about` の hero 右カラム**の 2 面。
  どちらも同じ `editorial` プリミティブ（`src/editorial/pet/PetSprite.tsx`）を描く。
- この文書は「素材は何か」「どう出しているか」「何が未確認か」を記録する。
  **実装の正本はコード**であり、この文書はその判断理由を持つ。

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
`~/.codex/pets/` の役割はこの調査では特定していない（空だったという事実だけを記録する）。

### 2.2 失うと再現できないもの

アトラスの再生成は画像生成モデルに依存し、**決定的ではない**。
同じプロンプトでも同じバイトは出ない。したがって
`final/spritesheet-extended.png` は 1 点物として扱う。

このリポジトリは**アトラスを commit しない**（§5.9）。代わりに
`scripts/build-pet-sprites.mjs` が sha256 で固定しており、記録と違うアトラスは拒否する。
つまりリポジトリはバイトを保存していないので、**Library 側の原本が失われると再生成できない**。
Library 外へのバックアップは owner の作業として残っている（§8）。

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

### 3.1 Web で出荷している行

| 行 | 扱い |
| --- | --- |
| 0 idle | **出荷**（第 0 フレームを静止表示） |
| 3 waving | **出荷**（明示トリガの反応、4 フレーム） |
| 4 jumping | 未使用。採用するなら同じトリガ系統にする |
| 1 / 2 running | 使わない（ドラッグ可能なデスクトップ overlay 用） |
| 5 / 6 / 7 / 8 | 使わない（サイト状態と結びつけない） |
| 9 / 10 look | 使わない（ポインタ追従は Web ページの機能ではない） |

### 3.2 既知の警告

`qa/pet-quality.json` は look 方向の連続性に 4 件の警告を出している
（`157.5→180` が局所外れ値、`292.5→315` / `337.5→000` が隣接平均より大きい差分）。
契約上これは warning であり、cardinal / quadrant の誤りではない。
**出荷している行（0, 3）には影響しない**。look 行を使う判断をした場合にだけ再評価する。

## 4. 権利（確定）

`src/legal/contract.ts` の語彙に沿った記録は
`quality/asset-license-inventory.json` の `pet-melty-sprites` にあり、
導出結果は **`publishable`**（findings 0 件）。要点:

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| `origin` | `repository-authored` | owner が自身のオリジナルとして作成・所有していると申告（2026-11-01） |
| `rightsHolder` | `rebuildup` | 同上 |
| `license.spdx` | `NOASSERTION` | 資産単位の SPDX は owner が決めていない。**捏造しない** |
| `verification.method` | `repository-evidence` | 申告の記録（権利レビュー文書）がリポジトリ内にある |
| `publication` | `published` | owner が公開可と判断 |

`L018`（第三者を同梱 + `NOASSERTION` → `hold`）は `origin` が repository 系のため
発火しない。**この 1 点が判定の要**で、`origin` を `third-party-bundled` に戻せば
`hold` に戻る。

未確認のまま残した項目（提供者条件の本文、資産単位の SPDX、第三者確認）は
[`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md) §5。

## 5. 統合設計（実装済み）

### 5.1 所有権の置き場所 — `src/editorial/pet/`

当初案（`src/home/pet/`）は**昇格トリガを自分で書いていた**:
「2 つ目の消費者が現れ、かつ表示とは独立した契約が観測されたとき、
`editorial` か新 obligation かを再判断する」。owner が Home と `/about` の
2 面を指定した時点でこのトリガが成立した。

AGENTS.md §3 の 5 問（現状の答え）:

| 問い | 答え |
| --- | --- |
| Obligation | キャラクターの**表示**（寸法・フレーム・トリガ・reduced-motion 分岐） |
| Change reason | キャラクターの見せ方が変わるとき。ページの主張が変わっても変わらない |
| Authority | `src/editorial/**`（出荷済みの視覚言語）と reduced-motion 契約 |
| Dependency direction | `home → editorial` / `about → editorial`（どちらも §3 の許可済みエッジ）。**新しいエッジは 1 本も追加していない** |
| Lifecycle | 視覚言語と共に生まれ、共に消える |

`/about` は `routes → about → editorial` しか持てない（`about` から `home` は禁止）。
したがって 2 面で共有する表示プリミティブの置き場所は `editorial` 以外にない。
`src/pet/` のような新しい top-level obligation は作っていない — 独立した
authority / lifecycle が観測されていないため。

物理配置:

```text
src/editorial/pet/
  PetSprite.tsx          表示プリミティブ（状態は wave カウンタ 1 つだけ）
  PetSprite.test.tsx     静的マークアップの契約
  PetSprite.stories.tsx  Interactive / ReducedMotion / BothPreferences
  index.ts               re-export
```

アセットは `public/pets/melty/`（§5.9）。

### 5.2 表示位置

| 面 | 位置 | 見出し |
| --- | --- | --- |
| Home | capability 群の後、Contact の前の独立セクション | `05 — Companion`（`<h2>` は `SectionHeading` が持つ） |
| `/about` | hero 右カラム、identity 段落の直後 | `companion`（uppercase monospace ラベル） |

`src/home/brief.md` は「hero illustration を避ける」と明記しているので
Home の hero には置いていない。`/about` の hero 右カラムは `about` 自身の
レイアウト判断で、Home の brief の制約を受けない。

Home 側は既存の eyebrow 連番を `05 — Companion` / `06 — Contact` に振り直した
（`src/home/composer.tsx` の reading-order コメントも同時に更新）。

### 5.3 サイズ

- セル 192 × 208 を **96 × 104 CSS px** で表示する（DPR 2 で原寸 1:1）。
- 72 × 78 は 2 倍系でないため輪郭が甘くなるので採らない。
- `width` / `height` 属性と CSS の固定ボックスで先に確保するので **CLS 0**。

### 5.4 アニメーション

**自動再生しない。** これは好みではなく WCAG 2.2 SC 2.2.2（Pause, Stop, Hide, A）の
制約で、`src/editorial/reduced-motion.ts` は「5 秒を超えて自動で動き続ける内容は
プラットフォームに出荷していない」と宣言している。常時ループする idle を足すと
**その宣言が嘘になる**。

| 状態 | 動き |
| --- | --- |
| 既定 | idle の第 0 フレームを静止表示 |
| 反応 | waving の 4 フレームを 0.6 秒で 1 回だけ再生し、静止フレームに戻る |

実装（`PetSprite.tsx`）:

- 4 フレームは **1 枚の横ストリップ**（`waving.webp`、768 × 208）で、
  `overflow: hidden` の 96 × 104 ボックスの中で平行移動する。
- CSS は `animation: petReaction 0.6s steps(4, jump-none) 1`、
  keyframes は `panda.config.ts#theme.extend.keyframes.petReaction` の
  `translateX(0)` → `translateX(-75%)`。
  `steps(4, jump-none)` なので 4 フレームが等分に当たり、空セルは出ない。
- 再生終了は `onAnimationEnd` が `wave` を 0 に戻し、ストリップが
  `visibility: hidden` に戻る。JS タイマーでフレームを書き換える方式は使わない
  （gate から見えない motion を生むため）。
- ストリップは**最初から mount しておく**（`visibility: hidden`）。初回クリックで
  15 kB の取得待ちが入らない。
- `data-motion="pet-reaction"` を付け、定数 `PET_REACTION_MOTION` を
  `src/editorial/reduced-motion.ts` に公開し、`src/styles.css` の
  `@media (prefers-reduced-motion: reduce)` に
  `[data-motion="pet-reaction"] { animation: none !important; }` を置いた。
  この 3 点は `pnpm run a11y:reduced-motion:check` が要求する。

### 5.5 reduced motion

- `usePrefersReducedMotion()` で**レンダー時に分岐**する（`CounterTile` と同じ形）。
  これは `useSyncExternalStore` 経由で、SSR スナップショットは `false`（= motion allowed）、
  hydration 後に実値を読む。`resolveReducedMotion()` のように media query を
  直接読むと、サーバが送っていないマークアップを最初のクライアント描画で作ってしまう。
- reduced のときは**ストリップもボタンも DOM に出さない**。動きだけが失われ、
  キャラクター（静止フレーム）は残る。動きが唯一の効果であるボタンを、
  動きを減らしてほしい訪問者に差し出す理由がない。
- `reducedMotion` prop は unit test と Storybook のためだけに存在する
  （`override ?? systemPreference`）。gate は `usePrefersReducedMotion(` の
  呼び出しを render-time opt-out として認識する。

### 5.6 遅延ロード / CLS / 転送量（実測）

出荷バイト（`scripts/build-pet-sprites.mjs` が生成、`sharp` WebP q85 / alphaQuality 100 / effort 6）:

| 対象 | フレーム | 元寸法 | バイト | sha256 |
| --- | ---: | --- | ---: | --- |
| `public/pets/melty/idle-rest.webp` | 1 | 192 × 208 | 4,568 | `c23a6880f255fe2bdf2c271e96f3e2b064e1dd4460fbdeb24582b7397efc956f` |
| `public/pets/melty/waving.webp` | 4 | 768 × 208 | 15,644 | `3b345de39791bebc15e499f012da3d77c7b978946496a1ec68e44f35bdd401df` |
| 合計 | — | — | **20,212 B（約 20 kB）** | — |

- 両方 `loading="lazy"` `decoding="async"` `fetchpriority="low"`。
  どちらの面でも初期視野の LCP 候補にならない。
- 固定ボックスがあるので読み込み完了前でもレイアウトは動かない（CLS 0）。
- ストリップは `visibility: hidden` で mount 済みなので、遅延ロードのままでも
  初回クリックが待たされない。

### 5.7 モバイル

- 固定ボックスなのでリフロー時のジャンプはない。
- トリガは `min-height: 44px` のボタン。横並びは `flex-wrap: wrap` なので
  幅が足りなければボタンが下に落ちる。
- 狭いときに非表示にしない（装飾を消す判断はレイアウトの都合ではなくデザイン判断）。
- `prefers-reduced-data` はこのリポジトリで未使用なので、ここでも導入していない。

### 5.8 キーボード / a11y

| 対象 | 扱い |
| --- | --- |
| 画像 | `alt=""` + `aria-hidden="true"`（装飾）。`a11y:image-alt:check` の PASS 形 |
| トリガ | `<button type="button">`。`あいさつしてもらう` が唯一のアクセシブル名 |
| 状態 | トグルではないので `aria-pressed` は付けない |
| focus | `_focusVisible` で `border.focus` の 2px outline + offset 2px |

ボタンの文言は `lang="ja"` の `<span>` で包んでいる（ページの `lang` に依存しない）。

### 5.9 配信形式 / 変換スクリプト

- 状態ごとの**横ストリップ WebP（alpha）**。CSS の `steps()` と相性がよく、
  静止フレームを別ファイルにできる（ストリップ全体を落とさずに済む）。
- 出力先は `public/pets/melty/`。**`src/**` から import しない**。
  Vite に取り込むと `/assets/<hash>` になり、`assets:license:check` の
  監査対象 `PUBLIC_MEDIA` から外れるため（この隙間は Issue #780）。
- 変換は `scripts/build-pet-sprites.mjs`（`pnpm run generate:pets`）:
  - 入力は**ローカルのアトラス**（`--atlas=<path>`）。リポジトリに含まれない。
  - 入力の sha256 が固定値と一致しなければ**何も書かずに失敗する**。
  - 出力は決定的（同じ入力 → 同じバイト）。status-only 出力。
- 静的アセットの既定 `Cache-Control: public, max-age=0, must-revalidate` のままでよい
  （URL が安定していて内容が変わりうるファイルの正しい扱い）。

## 6. 実装ファイル一覧

| ファイル | 役割 |
| --- | --- |
| `src/editorial/pet/PetSprite.tsx` | 表示プリミティブ本体 |
| `src/editorial/pet/PetSprite.test.tsx` | 静的マークアップの契約（装飾 / 寸法 / hook / トリガ / lazy / reduced） |
| `src/editorial/pet/PetSprite.stories.tsx` | `Editorial/PetSprite`（3 story） |
| `src/editorial/pet/index.ts` | re-export |
| `src/editorial/reduced-motion.ts` | `PET_REACTION_MOTION` を追加 |
| `src/styles.css` | `[data-motion="pet-reaction"]` の opt-out |
| `panda.config.ts` | `petReaction` keyframes |
| `src/home/composer.tsx` | `05 — Companion` セクション、Contact を `06` に繰り下げ |
| `src/about/components/AboutPage.tsx` | hero 右カラムに `companion` ラベル + `PetSprite` |
| `public/pets/melty/{idle-rest,waving}.webp` | 出荷バイト（2 ファイル、20,212 B） |
| `scripts/build-pet-sprites.mjs` | アトラス → ストリップ変換（digest 固定） |
| `quality/asset-license-inventory.json` | `pet-melty-sprites` レコード |
| `docs/verification/legal/pet-melty-rights-review.md` | 権利の根拠と未確認項目 |

## 7. 残っている作業（この Issue の範囲外）

1. **原本の退避** — Library 外へのバックアップは owner の作業（§2.2）。
   リポジトリはバイトを保存しない。
2. **`AUDITED_ROOTS` の隙間** — `src/**` から Vite が配信するバイトが
   権利監査の対象外。Issue #780（target 0.9.0）として起票済み。0.8.1 では広げない。
3. **提供者条件** — 生成モデル提供者の利用条件本文はこのリポジトリで読んでいない。
   読む必要があると owner が判断したときに別 Issue にする。

## 8. 関連

- 権利記録: [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)
- 権利契約: `src/legal/contract.ts`（Issue #497）
- reduced motion 契約: `src/editorial/reduced-motion.ts`（Issue #403）
- Home の設計方向: [`src/home/brief.md`](../../src/home/brief.md)
- 権利 gate の監査範囲: Issue #780
