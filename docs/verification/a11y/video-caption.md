# 動画の字幕・説明・静止画代替を検証する（Issue #408）

> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.2.2 Captions (Prerecorded)（レベル A）**、
> **SC 1.2.3 Audio Description or Media Alternative (Prerecorded)（レベル A）**、
> **SC 1.2.5 Audio Description (Prerecorded)（レベル AA）**、
> **SC 1.1.1 Non-text Content（レベル A）**、
> **SC 2.1.1 Keyboard（レベル A）**。
> **SC 1.2.8 Media Alternative (Prerecorded)（レベル AAA）は参考**であり、
> 本 gate の判定には含めない（AA 適合の要件ではない）。

> **1.2.5 のレベルは AAA ではない。** W3C 推奨（2026-10-23 時点）の
> conformance-level 節を直接読んで **AA** と確認した（`WCAG` / `WCAG_REFERENCE`）。
> したがって「1.2.5 は AAA だから無視」という扱いは誤りで、**AA の要件として強制する**。
> 参照に留めるのは **1.2.8** である。

## 実測（対象の限定）

**出荷コード `src/**` に `<video>` は 1 つも存在しない。**
`video` は `src/portfolio/**` では *facet*（作品カテゴリ）として現れるだけで、
メディア要素ではない。`src/home/access/reduced-motion.stories.tsx` と
`src/editorial/reduced-motion.ts` にある `<video>` はコメント内の言及だけである。

したがって本 Issue は**存在しない動画を作らない**。成果物は
「**動画が公開されたときに満たすべき契約**」を固定する **gate + fixture** であり、
gate は出荷面に対して **0 `<video>` / 違反 0** で緑になる（実測: 74 shipped `.tsx`、
0 `<video>`）。Issue の核心「字幕ソース未確定の作品は再生可と誤記しない」は、
**fail-closed** な契約（`data-caption-status="verified"` が無ければ未確定とみなす）として
固定する。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/**/*.tsx` | 出荷する JSX 表面すべて | `.ts` は JSX を描かないので対象外 |
| `<video>` の開始タグ | 属性は複数行にまたがってよい | 開始タグの範囲を拾って属性を読む |
| `<video>` の子要素 | `<source>`（再生可否）と `<track>`（字幕・音声説明の有無） | |

### 対象外（除外の理由も gate の出力に明記する）

| 対象外 | 理由 |
| --- | --- |
| `*.test.tsx` | テストは描画を検証するファイルであり、除去すべき欠陥は出荷コード側にある |
| `*.stories.tsx` | Storybook の story はコンポーネントのプレビュー用ハーネスであり、訪問者が到達する表面ではない（コンポーネント本体は別途走査される） |
| `**/fixtures/**` | fixture は形を持つために存在し、本 gate が拒否する形も含む。出荷する同じデータは別途走査される |
| `src/routes/design-system/**` | design-system ルートはリポジトリ内部のコンポーネントギャラリーであり、公開表面ではない |
| 字幕・音声説明の内容そのもの | 内容の正確さや、その作品に音声説明が**必要か**は人間の判断（下記「人間の評価」） |

### 基準

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 1.2.2 Captions (Prerecorded) | A | 再生できる `<video>` に `kind="captions"` のトラックがあり、字幕ソースが確定していること | 静的検査（`video-without-caption-track` / `video-playable-without-verified-caption`）+ Chromium 実測 |
| SC 1.1.1 Non-text Content | A | `<video>` に `poster` とアクセシブルな名前（`aria-label` / `aria-labelledby` / `title`）があること | 静的検査（`video-without-text-alternative`） |
| SC 2.1.1 Keyboard | A | 再生できる `<video>` に `controls` があること | 静的検査（`video-without-controls`） |
| SC 1.2.3 / SC 1.2.5 Audio Description (Prerecorded) | A / **AA** | 再生できる `<video>` が**音声説明の判断を宣言**していること（`provided` + `<track kind="descriptions">`、または `not-required`） | 静的検査（`video-without-audio-description`、fail-closed） |

## 規則一覧

| rule | 意味 | 判定 |
| --- | --- | --- |
| `video-without-caption-track` | 再生できる `<video>` に `<track kind="captions">` が無い | 違反 |
| `video-without-text-alternative` | 内容 `<video>` に `poster` が無い、またはアクセシブルな名前が無い | 違反 |
| `video-without-controls` | 再生できる `<video>` に `controls` が無い | 違反 |
| `video-playable-without-verified-caption` | 再生できる `<video>` が字幕トラックを持つが `data-caption-status="verified"` を宣言していない | 違反 |
| `video-without-audio-description` | 再生できる `<video>` が**音声説明の判断を宣言していない** | 違反 |

- `<track>` の `kind` を省略すると HTML の既定は `subtitles` であり、
  **音声を字幕化したことにはならない**。したがって `kind="captions"` の明示だけを数える。
- **字幕ソースの確定は `data-caption-status="verified"` の明示だけで成立する**
  （fail-closed）。値が無い・`pending` などの場合は「未確定」とみなす。
- **音声説明の判断（`data-audio-description-status`）も fail-closed。**
  受け付ける値は 2 つだけ:
  - `provided` — **`<track kind="descriptions">` を実際に同梱している**ときだけ成立
    （宣言だけ・トラックの無い `provided` は「判断なし」として違反）。
  - `not-required` — その作品に視覚情報だけの内容が無いと**人が判断した**とき。
  - 値が無い・未知の値は「判断していない」ので違反（無言は同意ではない）。
- **装飾動画の除外**は 1 箇所（`isDecorativeVideo`）で定義する:
  `muted` **かつ** 支援技術から隠れている（`aria-hidden="true"` /
  `role="presentation"` / `data-decorative`）場合にだけ、字幕・音声説明・`controls` を免除する。
  `muted` だけの動画は目に見える動画であり、`aria-hidden` だけの動画は音を出す。
- **再生できない動画**（`src` も `<source>` もない）は字幕・音声説明の要求対象外。
  字幕ソースが未確定の作品を「再生可」と誤記しないための状態であり、
  その状態自体は違反ではない（`pass/03-awaiting-caption-source.tsx`）。

## fixture

`scripts/fixtures/a11y-video-caption/` に、gate が **実際に読む** fixture を置いている。

| ディレクトリ | ファイル | 期待される結果 |
| --- | --- | --- |
| `pass/` | `01-captioned-video.tsx` | 違反 0（`controls` + `poster` + 名前 + `kind="captions"` + `verified` + `kind="descriptions"` + `data-audio-description-status="provided"`） |
| `pass/` | `02-decorative-video.tsx` | 違反 0（`muted` + `aria-hidden="true"` の背景動画） |
| `pass/` | `03-awaiting-caption-source.tsx` | 違反 0（**再生不可**。字幕ソース未確定を再生可と誤記しない） |
| `fail/` | `01-without-caption-track.tsx` | `video-without-caption-track` |
| `fail/` | `02-without-text-alternative.tsx` | `video-without-text-alternative` |
| `fail/` | `03-without-controls.tsx` | `video-without-controls` |
| `fail/` | `04-playable-without-verified-caption.tsx` | `video-playable-without-verified-caption` |
| `fail/` | `05-without-audio-description.tsx` | `video-without-audio-description` |

`pass/` が違反を出せば `fixture-pass-violation`、`<video>` を 1 つも持たなければ
`fixture-pass-no-video`、`fail/` が期待した rule を出さなければ
`fixture-fail-not-detected` として **gate 自体が失敗する**。
テスト（`scripts/check-a11y-video-caption.test.mjs`）はさらに、fixture ディレクトリの
一覧と期待表が**完全一致**すること（1 個落としても気付けないテストにしない）を assert する。
各 `fail/` fixture は **他の違反を同時に起こさない**ように、他の契約（字幕・名前・
controls・音声説明）は充足した状態で 1 つの rule だけを出す。

## 機械検査と人間の評価の区別

### 機械検査（`pnpm run a11y:video-caption:check` / `pnpm run capture:a11y-video-caption`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| 規則一覧の 5 rule | 出荷する `src/**/*.tsx` の `<video>` | コメント除去後のソース走査（`scripts/check-a11y-video-caption.mjs`） |
| fixture の再現 | `pass/` は違反 0 かつ `<video>` を持つ、`fail/` は期待した rule | 同上（gate 自身が行う） |
| ブラウザ側の観測 | 各カードの `evaluateVideo` verdict、字幕トラックの `readyState`（LOADED / ERROR）、失敗時に `data-caption-status` が `verified` のままでないこと、320 px で facts が変わらないこと | Chromium 実測（capture） |

capture は **negative control** を内蔵する。各カードが主張と違う rule に解決すれば失敗、
正常な字幕トラックが LOADED にならなければ失敗、存在しない字幕リソースが ERROR にならなければ失敗、
**字幕の読み込みに失敗した動画が `verified` を主張し続ければ失敗**、
**音声説明の `provided` を宣言しながら descriptions トラックが無い場合は失敗**、
320 px で facts が変われば失敗する。片方だけ緑にはできない。

### 人間の評価（機械では判定しない）

- 字幕の内容が正確・完全で、言語も合っているか（SC 1.2.2 の品質）
- その作品に音声説明が**必要か**（SC 1.2.3 / 1.2.5 の判断そのもの。
  gate が強制するのは「**判断の宣言**があること」であって、
  「必要か」の判断ではない）
- `poster` がその作品を正しく表しているか（SC 1.1.1 の品質）
- `verified` と宣言した字幕ソースが実際に安定して配信され続けるか（宣言は主張にすぎない）
- 実機のスクリーンリーダー / ブラウザの字幕レンダラでの読み上げ

この 5 項目は gate の出力でも「not machine-checked」として明示され、検証画像内にも
同じ文言が印字される。

## スクリーンショット

`docs/verification/a11y/video-caption-track.webp`（Issue #408 が指定する
`video-caption-track.png` の WebP 版）。

- 生成: `pnpm run capture:a11y-video-caption`
- 方式: loopback の一時 HTTP サーバに生成したハーネスを置き、Chromium で
  5 状態（captioned / no-caption / no-controls / caption-load-fails /
  no-audio-description）と 320 px を描画して撮影
- 字幕: 正常カードは実際の WebVTT を配信して LOADED を、失敗カードは 404 を配信して
  ERROR を実測する。失敗カードは `data-caption-status` を `unavailable` に落とし、
  注記を表示する
- 音声説明: `provided` を宣言するカードは **descriptions トラックも実同梱**する
  （宣言だけの `provided` は fail-closed で違反になる）。`no-audio-description`
  カードは判断を一切宣言しない
- 失敗条件: 観測が契約と矛盾した場合、**成果物を書かずに exit 1**

### ファイル名の乖離（2 点）

1. **ファイル名**: Issue #408 が指定する `video-caption-track` をそのまま維持している
   （別名にしていない）。
2. **拡張子**: Issue は `.png` を要求するが、このリポジトリの規約は WebP のみ
   （capture script が `.png` を拒否し、PNG をツリーに置かない）のため `.webp` にした。
   #396 / #397 / #399 / #400 と同じ扱い。**PNG は作っていない。**

## 誤検知が起きたときの解除手順

gate は「宣言」を判定する。以下の 4 つは誤検知の候補であり、**gate を緩めずに**
個別の契約として扱う:

1. **`video-without-caption-track` / `video-playable-without-verified-caption` が誤検知した**
   - 字幕ソースが本当に確定しているなら `data-caption-status="verified"` を宣言する。
     確定していないなら、その動画を**再生不可**（`src` / `<source>` を出さない）にする。
2. **`video-without-text-alternative` が誤検知した**
   - `poster` とアクセシブルな名前の両方を宣言する。名前が周辺テキストで足りる場合も、
     `<video>` 自身に `aria-labelledby` を付ける（この gate は兄弟テキストを読まない）。
3. **`video-without-audio-description` が誤検知した**
   - 音声説明が要る作品なら `data-audio-description-status="provided"` と
     `<track kind="descriptions">` を同梱する。要らない作品なら
     `data-audio-description-status="not-required"` を宣言する（**人が判断した**場合のみ）。
4. **装飾動画として除外したい**
   - `muted` と `aria-hidden="true"`（または `role="presentation"` / `data-decorative`）の
     両方を付ける。片方だけでは除外されない（片方は「見える」「聞こえる」を残す）。

いずれも、解除は「gate の判定を緩める」ことではなく「契約の記録を増やす」こととして扱う。

## 既知の制約 / 未対応範囲

- **出荷面に `<video>` が無いため、実データでの検証ではない。** gate は
  「公開されたときに満たす契約」を fixture と capture で固定している。
- **音声説明は「必要か」ではなく「判断を宣言したか」を機械で判定する。**
  その作品が視覚情報だけの内容を持つかどうかは人評価（下記）。
  gate が機械で強制するのは宣言の**存在**（fail-closed）であり、
  宣言の**正しさ**ではない。
- **`not-required` は人の判断を前提とする宣言**である。gate は宣言の
  事実だけを判定する。
- **アクセシブルな名前は `<video>` 自身からしか読まない。** 兄弟テキストによる説明は
  検出しない（`aria-labelledby` を付けることを契約とする）。
- **`verified` は宣言であり、真偽を機械では確かめない。** 字幕ソースが実際に
  配信され続けるかは運用の責任（capture は「読み込みに失敗したら主張を降格する」ことだけを実測）。
- **字幕の品質（正確さ・完全さ・言語）は人評価。**
- **capture のハーネスは生成物**であり、出荷する `PortfolioVideo` 等のコンポーネントそのものを
  動かしていない（動画バイトがリポジトリに無いため、実メディアは使わない）。
  gate は出荷する `src/**` を別途走査する。

## 再現手順

```bash
pnpm run a11y:video-caption:check       # 静的検査（gate）
pnpm run capture:a11y-video-caption     # Chromium で状態を実測して WebP を生成
node --test scripts/check-a11y-video-caption.test.mjs
node --test scripts/capture-a11y-video-caption.test.mjs
```

中間産物は `.tmp/a11y-video-caption/`（**gitignore 済み**）に置く。commit するのは
`docs/verification/a11y/video-caption-track.webp` と本ファイル、および索引 1 行。
PNG は作らない。
