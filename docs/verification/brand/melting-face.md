# 「時間を溶かしています」モチーフ — 表示プレビューの検証画像 (#522)

- 対象: `docs/brand/melting-face.md`（参照文書）と `src/personal/melting-face/`（preview データ + component + Storybook story）
- Issue: #522（`feat(brand): 「時間を溶かしています」モチーフの表示コンポーネント`）
- 成果物: `docs/verification/brand/melting-face-preview.png`・`docs/verification/brand/melting-face-fallback.png`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は文書の「未確認（owner 確認待ち）」節

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象（preview） | `src/personal/melting-face/MeltingFace.stories.tsx` の `Default` story（story 自身の `render()` 出力） |
| 描画対象（fallback） | 同ファイルの `Fallback` story（文字だけの alt/fallback 表示） |
| capture 手段 | `node scripts/capture-melting-face.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → PNG） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | preview: 1440 x 2280 px、**444 KB** PNG。fallback: 1440 x 2064 px、**401 KB** PNG（いずれも budget 1024 KB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ `storybook dev` ではなく harness なのか

`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る。出力に `iframe.html` が無い）。同じ事実を `scripts/capture-handle-map.mjs`（#524）と `scripts/capture-error-state-gallery.mjs`（#501）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、story 自身の `render()` が出力するものをレンダリングする。harness が描くものは「コピーした preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。1 つの build が `?story=` で `Default` / `Fallback` / `MotionStates` を切り替える。

### なぜ PNG なのか

Issue #522 が成果物の path を `docs/verification/brand/melting-face-preview.png` と `docs/verification/brand/melting-face-fallback.png` と指定している。

## 2. 画面が示しているもの

### melting-face-preview.png（`Default` story）

1. **document title** — `「時間を溶かしています」モチーフ — melting face preview`。
2. **文書メタ情報 4 点** — status / 典拠 / 機械検証 / プレビューの path。
3. **モチーフの連鎖（`MeltingFaceMotif` component）** — 連鎖 4 段（361℃ → 『時間を溶かしています』 → melting face → SNS アイコンのキャラクター）を順に並べ、役割を分離して表示する:
   - **アイコンの役割** — placeholder の melting face mark（`role="img"` + alt テキスト）とアセット状態の注記。
   - **コピーの役割** — short copy（『時間を溶かしています』）/ long copy（候補・未採用と明記）/ english line（`Lost in time. 🫠 Found it nowhere.`）を別々の組版で表示。
   - **説明の候補** — 『熱中』『時間を惜しみなく投資』『無駄なこと』を「explanation candidates — kept unresolved」として併記。矛盾は解消していない。
4. **文書セクション** — コピーとアイコンの役割 / 説明の候補（未決着）/ アートワークと fallback / 典拠 / 実装と機械検証 / 未確認（owner 確認待ち）。

### melting-face-fallback.png（`Fallback` story）

アートワークが使えないときの文字だけの表示。fallback グリフ（`🫠 melting face（placeholder）`）、short copy、alt テキストと同じ説明文、アセット状態を可視テキストとして出す。SVG mark は描画しない（`[data-melting-face-mark]` が 0 件であることを capture が検査する）。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が FAIL する条件は以下（描画から読み取った値が preview データと一致しない場合、non-zero exit で artefact は書かれない）。

| 項目 | 判定 | 実測 |
| --- | --- | --- |
| document title | 描画された `<h1>` が `MELTING_FACE_DOCUMENT.title` と一致 | 1 件一致 |
| 文書メタ情報 | status / source / verification / preview の 4 点が `<header>` の `<ul>` に存在 | 4 件一致 |
| chain steps | `[data-melting-face-chain-step]` が `MELTING_FACE_CHAIN[].label` と順序込みで一致 | 4 件一致 |
| copy roles | short / long / english の 3 文字列が `[data-melting-face-copy-roles]` に存在 | 3 件一致 |
| icon role | mark の `aria-label` が `MELTING_FACE_ICON.alt` と一致、`data-motion-state` が `animated` または `reduced` | 一致 |
| asset status | `MELTING_FACE_ICON.assetNote` が icon カードに存在 | 一致 |
| explanation candidates | 3 候補の label が `[data-melting-face-explanations]` に存在（消失＝ FAIL） | 3 件一致 |
| fallback（preview 側） | preview ページに `[data-melting-face-fallback]` が無いこと | 0 件 |
| fallback（fallback 側） | fallback panel が 1 件、glyph / short copy / alt / asset status を含み、SVG mark が 0 件 | 全件一致 |
| section 集合と順序 | 描画された `<h2>` が legend 見出し（または fallback 見出し）+ `MELTING_FACE_SECTIONS[].heading` と一致 | 7 件一致 |
| note 箇条書き | `[data-notes-list] li` が `sections[].bullets` と一致 | 全件一致 |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow） | 1440 <= 1440 |
| artefact budget | commit した PNG が 1024 KB 以下 | 444 KB / 401 KB |

### light / dark・reduced motion・alt/fallback の実表示

Issue の完了条件「light/dark、reduced motion、alt/fallback を実表示」は、文書上の主張ではなく **実レンダリングの pass** で検証した。commit する PNG は issue 指定の 2 枚だが、capture は追加で 2 つの pass を同じ build・同じ DOM 検査で実行し、report（`.tmp/melting-face/report.json`）に記録する:

| pass | エミュレーション | 実測 |
| --- | --- | --- |
| preview | `colorScheme: light`, `reducedMotion: no-preference` | body 背景 `rgb(237, 237, 232)`、mark `data-motion-state="animated"`、drip `animation-name: meltingFaceDrip` |
| fallback | 同上 | fallback panel 1 件・mark 0 件 |
| dark | `colorScheme: dark` | `prefers-color-scheme: dark` が真、body 背景 `rgb(10, 10, 12)` — light pass と異なる値で、`prefers-color-scheme` への追従を実測 |
| reduced | `reducedMotion: reduce` | `prefers-reduced-motion: reduce` が真、mark `data-motion-state="reduced"`、drip の computed `animation-name` が `none` — `animation-name` を emit しない resting frame であり、かき消された animation ではない。short copy は引き続き描画される（motion を切っても情報は減らない） |

reduced-motion の仕組みは `src/editorial/reduced-motion.ts` の契約どおり 2 層: component が `usePrefersReducedMotion()` で render 時に `animation-name` を出さない層と、`src/styles.css` の `@media (prefers-reduced-motion: reduce)` 内 `[data-motion="melting-face"] [data-motion-part="drip"]` selector が backstop になる層。`scripts/check-reduced-motion.mjs` がこの pairing を検査する。Storybook 側でも `MotionStates` story が live preference と `reducedMotion` prop 固定の resting frame を並べて表示する。

## 4. 本文との一致（parity gate）

本文 `docs/brand/melting-face.md` と preview データ `src/personal/melting-face/MeltingFace.preview.ts` の一致は `scripts/check-melting-face-preview-parity.test.mjs` が検証する。

- `##` 見出しの集合と順序が一致する。
- 「モチーフの連鎖」節の箇条書きが `meltingFaceMotifBullets()` の生成物と一致する（連鎖・コピー 3 役割・アイコン・アセット状態）。
- 各 section の箇条書きが一致する。
- chain label・copy 3 役割・icon の alt / fallback / asset 文字列・explanation 3 候補の label が文書中に存在する。
- 「説明の候補（未決着）」節が存在し、「矛盾を消さず」「決定も行っていない」を記録している — 熱中 / 時間を惜しみなく投資 / 無駄なこと の矛盾を消さないことの機械的な形。

本 capture は parity gate の別系統である。parity gate は「本文と preview データの一致」を、capture は「preview データと **描画された DOM** の一致」を見る。

## 5. 採用 / 保留の判断

- **採用**: Issue #522 本文が挙げるモチーフ連鎖（361℃ → 『時間を溶かしています』 → melting face → SNS アイコンのキャラクター）と英語コピー `Lost in time. 🫠 Found it nowhere.`。コピーとアイコンの役割分離。placeholder + alt/fallback の表示。説明候補 3 案の未解決併記。単体 component + Storybook preview（route mount は本 Issue の範囲外）。
- **保留**: 元画像・元アートワークの内容（未確認のため placeholder のまま。本番アセットは採用しない）。3 つの説明候補の採否。長文コピー・英語コピーの公開可否。モチーフを置く公開 surface（SNS アイコン、OG、ヘッダー等）の選定。Miro 付箋本文由来の情報（アクセス不可）。

## 6. 再現手順

```sh
# 検証画像の再生成（harness build → loopback → Playwright → PNG ×2 + 4 pass の report）
node scripts/capture-melting-face.mjs

# preview データと文書の一致検査
node --experimental-strip-types --test scripts/check-melting-face-preview-parity.test.mjs

# capture script の契約テスト
node --experimental-strip-types --test scripts/capture-melting-face.test.mjs

# Storybook での確認
pnpm run dev   # または storybook dev — Preview / Melting face
```
