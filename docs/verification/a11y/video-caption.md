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
**fail-closed** な契約として固定する。字幕ソースが「確定している」ことは
**2 つの別々の事実**であり、どちらかが欠けても未確定である:

1. **宣言** — 著者が `data-caption-status="verified"` と書いていること（主張）。
2. **検証** — gate 自身が字幕**ソースのファイル**を確かめたこと（事実）。
   ファイルがリポジトリに実在すること、正しい WebVTT 文書であること、
   キューが 1 つ以上あること。

gate の report はこの 2 つを分けて見せる（`declared vs verified` 節）。
静的な通過が「字幕の配信が検証された」を意味しないことを、
rules とメッセージの文言が明示する。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/**/*.tsx` | 出荷する JSX 表面すべて | `.ts` は JSX を描かないので対象外 |
| `<video>` の開始タグ | 属性は複数行にまたがってよい | 開始タグの範囲を拾って属性を読む |
| `<video>` の子要素 | `<source>`（再生可否）と `<track>`（字幕・音声説明の有無） | |
| `<track kind="captions">` の `src` | 字幕**ソース**の検証対象（ファイルが実在するか / 正しい WebVTT か / キューがあるか） | サイト絶対パスは `public/` 配下 → リポジトリ直下 の順に探す。別ホストの URL と実行時の式は判定不能 |

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
| SC 1.2.2 Captions (Prerecorded) | A | 再生できる `<video>` に `kind="captions"` のトラックがあり、字幕ソースが**宣言**され**かつ gate が検証**できること | 静的検査（`video-without-caption-track` / `video-playable-without-declared-verified-caption` / `video-caption-source-unverified`）+ Chromium 実測 |
| SC 1.1.1 Non-text Content | A | `<video>` に `poster` とアクセシブルな名前（`aria-label` / `aria-labelledby` / `title`）があること | 静的検査（`video-without-text-alternative`） |
| SC 2.1.1 Keyboard | A | 再生できる `<video>` に `controls` があること | 静的検査（`video-without-controls`） |
| SC 1.2.3 / SC 1.2.5 Audio Description (Prerecorded) | A / **AA** | 再生できる `<video>` が**音声説明の判断を宣言**していること（`provided` + `<track kind="descriptions">`、または `not-required`） | 静的検査（`video-without-audio-description`、fail-closed） |

## 規則一覧

| rule | 意味 | 判定 |
| --- | --- | --- |
| `video-without-caption-track` | 再生できる `<video>` に `<track kind="captions">` が無い | 違反 |
| `video-without-text-alternative` | 内容 `<video>` に `poster` が無い、またはアクセシブルな名前が無い | 違反 |
| `video-without-controls` | 再生できる `<video>` に `controls` が無い | 違反 |
| `video-playable-without-declared-verified-caption` | 再生できる `<video>` が字幕トラックを持つが `data-caption-status="verified"` を**宣言していない** | 違反 |
| `video-caption-source-unverified` | 再生できる `<video>` が字幕ソースを**検証できていない**（`src` のファイルがリポジトリに無い / 正しい WebVTT ではない / キューが無い / 静的に判定できない） | 違反 |
| `video-without-audio-description` | 再生できる `<video>` が**音声説明の判断を宣言していない** | 違反 |

- `<track>` の `kind` を省略すると HTML の既定は `subtitles` であり、
  **音声を字幕化したことにはならない**。したがって `kind="captions"` の明示だけを数える。
- **字幕ソースの確定は「宣言」と「検証」の 2 つで成立する**（fail-closed）。
  - **宣言（DECLARED）** — 著者が `data-caption-status="verified"` と書いたこと。
    これは**主張**であって証拠ではない。
  - **検証（VERIFIED）** — **gate 自身**が次の 3 つを確かめたこと:
    (1) `src` が指すファイルが**リポジトリに実在する**、
    (2) そのファイルが**正しい WebVTT 文書**である（`WEBVTT` ヘッダーがあり、名前が `.vtt` で終わる）、
    (3) そのファイルに**キューが 1 つ以上ある**（ヘッダーだけのファイルは placeholder であって字幕ではない）。
  - 宣言だけ・検証だけのどちらでも**未確定**であり、再生できる動画の違反になる。
    値が無い・`awaiting`・`unavailable` などの場合も「未確定」とみなす。
- **音声説明の判断（`data-audio-description-status`）も fail-closed。**
  受け付ける値は 2 つだけ:
  - `provided` — **`<track kind="descriptions">` を実際に同梱している**ときだけ成立
    （宣言だけ・トラックの無い `provided` は「判断なし」として違反）。
  - `not-required` — その作品に視覚情報だけの内容が無いと**人が判断した**とき。
  - 値が無い・未知の値は「判断していない」ので違反（無言は同意ではない）。
- **装飾動画の除外**は 1 箇所（`isDecorativeVideo`）で定義する:
  `muted` **かつ** 支援技術から隠れている（`aria-hidden="true"` /
  `role="presentation"` / `role="none"` / `data-decorative`）場合にだけ、字幕・音声説明・`controls` を免除する。
  `muted` だけの動画は目に見える動画であり、`aria-hidden` だけの動画は音を出す。
  `muted` は**実効値**で判定する（属性があるかどうかではない）ので、
  `muted={false}` は「消音していない」= 装飾ではない。
  `data-decorative` も値が `true`（または値なし）だけをマークとして数え、
  `data-decorative={false}` は装飾ではないという主張として扱う。
- **再生できない動画**（`src` も `<source>` もない）は字幕・音声説明の要求対象外。
  字幕ソースが未確定の作品を「再生可」と誤記しないための状態であり、
  その状態自体は違反ではない（`pass/03-awaiting-caption-source.tsx`）。

## 字幕ソースの検証（宣言 vs 検証）

**この gate の「字幕検証」が意味するのは「字幕ソースの検証」であり、
「字幕の内容の検証」ではない。** 両者は混同してはならない。

| 用語 | 意味 | 誰が決めるか |
| --- | --- | --- |
| **DECLARED（宣言）** | マークアップに書かれた値（`data-caption-status="verified"`）。**主張**である | 著者 |
| **VERIFIED（検証）** | gate 自身がファイルの中身を確かめた事実 | gate（このスクリプト） |

gate が `src` に対して判断できるのは、次の通り:

| `src` | gate の判定 | 理由 |
| --- | --- | --- |
| リポジトリ相対パス（`captions/example.en.vtt`） | **検証**（ファイルが在る / 正しい WebVTT / キューあり） | リポジトリが所有するファイルなので gate が読めれば読める |
| サイト絶対パス（`/captions/example.en.vtt`） | **検証**（`public/` 配下 → リポジトリ直下 の順に探す） | サイトの静的アセットのルートは `public/` であり、リポジトリが所有する |
| リポジトリに無いファイル | **未検証**（missing） | typo・未コミット・別ホストのオブジェクトのいずれか。fail-closed |
| `WEBVTT` ヘッダーが無い / 名前が `.vtt` でない | **未検証**（not-webvtt） | ブラウザが字幕として描画できない |
| ヘッダーはあるがキューが無い | **未検証**（empty） | placeholder であり字幕トラックではない |
| 別ホストの URL（`https://…`） | **判定不能**（undecidable） | 静的 gate は通信しないので読めない |
| 実行時の式（`src={captionUrl}`） | **判定不能**（undecidable） | 静的 gate は実行時の値を読めない |
| リポジトリの外を指すパス | **判定不能**（undecidable） | リポジトリの所有物ではない |

**判定不能（undecidable）は「検証」ではない。** fail-closed なので、
判定不能な字幕ソースを持つ再生可能動画は**違反**として報告される
（`video-caption-source-unverified`）。「読めない = 満たしている」とは読まない。

### 静的な通過が意味しないこと

- 静的な通過が**確立するのは「字幕ソースが検証された」ことだけ**である。
  字幕が動画と対応しているか、字幕が正確か、字幕が将来も配信されるかは
  **この gate は決定しない**（人間評価）。
- `data-caption-status="verified"` は**主張**であり、**証明**ではない。
  gate がその主張を裏付けた事実は「ソースファイルを読んだ」ことだけであり、
  字幕の内容を 1 文字も読んでいない。

## 判断できない値の扱い（fail-closed）

静的な gate は「マークアップが書いていないこと」を読めない。**読めない値を
「条件を満たしていない」と読むのがこの gate の姿勢**（fail-closed）で、
判断の単位は次の 3 つ:

| 値 | 静的に決まる場合 | 判断できない場合 | 判断できないとき gate が読む方向 |
| --- | --- | --- | --- |
| boolean 属性（`muted` / `controls` / `data-decorative`） | `controls`・`controls=""`・`controls={true}` は on、`controls={false}`・`controls={undefined}` は off | 実行時式の値（`controls={isPlaying}`）や、後ろの spread が上書きしうる属性 | **off** として読む（安全側） |
| 再生可否（`src` / `<source>`） | `src="/a.mp4"` または `<source>` があれば playable、`src=""` も `<source>` も無ければ not playable | `src={clipUrl}` のように実行時式 | **playable** として読む（安全側） |
| 属性の spread（`{...props}`） | spread の**後**に書かれた属性は確定（JSX は後の prop が勝つ） | spread が持ちうる属性（書いた属性・書かなかった属性 alike） | その属性が無い/ off として読む（安全側） |
| 字幕ソースの `src`（`<track kind="captions">`） | リポジトリのファイルを指すパスで、そのファイルが実在し、正しい WebVTT で、キューがある | 別ホストの URL、実行時の式、リポジトリの外を指すパス | **未検証**として読む（安全側）。`video-caption-source-unverified` になる |

- この判定は **「静的な false」と「評価不能」を区別する**。両者は同じ違反に
  ならない: 静的 false は「著者が決めたこと」、評価不能は「gate が読めないこと」。
  違反メッセージは後者に `（`controls` の値は静的に決まらないため、controls の無い動画として扱う）`
  のように、何が読めなかったのかを名指しする。gate の report には
  `undecidable-values` の行として、どの文件的どの属性が読めなかったかを出す。
- **動的な `src` で検査を飛ばさない**。`src={clipUrl}` の動画は「再生できる」と
  判定し、字幕・`controls`・音声説明の検査を**そのまま実行する**
  （`fail/06-dynamic-src.tsx`）。「値が動的だから再生できない」と読むと、
  字幕の無い作品が playable として通ってしまう（fail-open）。
- **装飾の免除も「評価不能なら解除」**。`muted={isMuted}` は消音与否が読めないので、
  装飾動画として免除せず、字幕・`controls`・音声説明の要求対象にする
  （`fail/10-dynamic-muted.tsx`）。
- **`controls` の有無も実効値で判定する**。`controls={false}` は「controls が無い」ので
  `video-without-controls` になる（`fail/08-controls-false.tsx`）。
  `controls={isPlaying}` は評価不能なので，同样に off として読む
  （`fail/07-dynamic-controls.tsx`）。
- **spread は「最後の spread より後」の属性だけ確定する**。`{...props}` を
  属性の**後**に書くと、それ以前の属性は全部 shadow されうる
  （`fail/12-spread-overrides-earlier-attributes.tsx`）。前方に置いた spread は
  後続の明示的な属性を壊さない（`pass/04-spread-with-explicit-contract.tsx`）。


## fixture

`scripts/fixtures/a11y-video-caption/` に、gate が **実際に読む** fixture を置いている。

| ディレクトリ | ファイル | 期待される結果 |
| --- | --- | --- |
| `pass/` | `01-captioned-video.tsx` | 違反 0（`controls` + `poster` + 名前 + `kind="captions"` + `data-caption-status="verified"`（**宣言**）+ 実在する WebVTT ソース（**検証**）+ `kind="descriptions"` + `data-audio-description-status="provided"`） |
| `pass/` | `02-decorative-video.tsx` | 違反 0（`muted` + `aria-hidden="true"` の背景動画） |
| `pass/` | `03-awaiting-caption-source.tsx` | 違反 0（**再生不可**。字幕ソース未確定を再生可と誤記しない） |
| `pass/` | `04-spread-with-explicit-contract.tsx` | 違反 0（spread の**後**に契約の属性を書けば確定する） |
| `fail/` | `01-without-caption-track.tsx` | `video-without-caption-track` |
| `fail/` | `02-without-text-alternative.tsx` | `video-without-text-alternative` |
| `fail/` | `03-without-controls.tsx` | `video-without-controls` |
| `fail/` | `04-playable-without-declared-verified-caption.tsx` | `video-playable-without-declared-verified-caption` |
| `fail/` | `05-without-audio-description.tsx` | `video-without-audio-description` |
| `fail/` | `06-dynamic-src.tsx` | `video-without-caption-track`（動的な `src` で検査を飛ばさない） |
| `fail/` | `07-dynamic-controls.tsx` | `video-without-controls`（評価不能な `controls` は pass しない） |
| `fail/` | `08-controls-false.tsx` | `video-without-controls`（`controls={false}` は control ではない） |
| `fail/` | `09-muted-false-is-not-decorative.tsx` | `video-without-controls`（`muted={false}` は装飾ではない） |
| `fail/` | `10-dynamic-muted.tsx` | `video-without-controls`（評価不能な `muted` は消音と読まない） |
| `fail/` | `11-spread-may-carry-controls.tsx` | `video-without-controls`（spread が `controls` を持ちうる） |
| `fail/` | `12-spread-overrides-earlier-attributes.tsx` | 4 rule（`video-without-text-alternative` / `video-without-controls` / `video-playable-without-declared-verified-caption` / `video-without-audio-description`）。**唯一の複数 rule fixture**: spread は属性をまとめて shadow する |
| `fail/` | `13-caption-source-missing.tsx` | `video-caption-source-unverified`（`src` のファイルがリポジトリに無い） |
| `fail/` | `14-caption-source-not-webvtt.tsx` | `video-caption-source-unverified`（`src` のファイルが WebVTT ではない） |
| `fail/` | `15-caption-source-empty.tsx` | `video-caption-source-unverified`（`src` のファイルにキューが無い placeholder） |
| `fail/` | `16-caption-source-undecidable.tsx` | `video-caption-source-unverified`（`src` が実行時の式で判定不能） |
| `fail/` | `17-caption-source-remote.tsx` | `video-caption-source-unverified`（`src` が別ホストの URL で判定不能） |

`captions/` ディレクトリは **gate が実際に読む字幕ファイル**の置き場である。
`pass/01-captioned-video.tsx` などの `src` はここを指しており、
gate が「ファイルが存在する / 正しい WebVTT / キューがある」を確かめられるのは
このファイルがあるためである。

| ファイル | 内容 | gate の判定 |
| --- | --- | --- |
| `captions/example.en.vtt` | ヘッダー + キュー 2 つ | 検証（`verified`） |
| `captions/example.en.desc.vtt` | ヘッダー + キュー 1 つ（音声説明用） | 検証（`verified`） |
| `captions/not-webvtt.vtt` | `WEBVTT` ヘッダーが無い平文 | 未検証（`not-webvtt`） |
| `captions/placeholder.vtt` | ヘッダーのみの placeholder | 未検証（`empty`） |

`pass/` が違反を出せば `fixture-pass-violation`、`<video>` を 1 つも持たなければ
`fixture-pass-no-video`、`fail/` が期待した rule を出さなければ
`fixture-fail-not-detected` として **gate 自体が失敗する**。
テスト（`scripts/check-a11y-video-caption.test.mjs`）はさらに、fixture ディレクトリの
一覧と期待表が**完全一致**すること（1 個落としても気付けないテストにしない）を assert する。
各 `fail/` fixture は **他の違反を同時に起こさない**ように、他の契約（字幕・名前・
controls・音声説明）は充足した状態で 1 つの rule だけを出す
（`12-spread-overrides-earlier-attributes.tsx` だけが例外で、spread が
属性をまとめて shadow するため 4 rule になる）。

## 機械検査と人間の評価の区別

### 機械検査（`pnpm run a11y:video-caption:check` / `pnpm run capture:a11y-video-caption`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| 規則一覧の 6 rule | 出荷する `src/**/*.tsx` の `<video>` | コメント除去後のソース走査（`scripts/check-a11y-video-caption.mjs`） |
| 判断できない値の明示 | 動的な値や spread を持つ動画が、どの属性を読めなかったか | 同上（`facts.undecidable` を report の `undecidable-values` 行に出す） |
| **字幕ソースの検証** | `<track kind="captions">` の `src` がリポジトリのファイルを指しているか、そのファイルが正しい WebVTT か、キューがあるか | 同上（`captionSourceState` が `verified` / `missing` / `not-webvtt` / `empty` / `undecidable` を判定し、report の `declared vs verified` 節に宣言値と検証結果を並べて出す） |
| fixture の再現 | `pass/` は違反 0 かつ `<video>` を持つ、`fail/` は期待した rule | 同上（gate 自身が行う） |
| ブラウザ側の観測 | 各カードの `evaluateVideo` verdict、字幕トラックの `readyState`（LOADED / ERROR）、失敗時に `data-caption-status` が `verified` のままでないこと、320 px で facts が変わらないこと | Chromium 実測（capture） |

capture は **negative control** を内蔵する。各カードが主張と違う rule に解決すれば失敗、
正常な字幕トラックが LOADED にならなければ失敗、存在しない字幕リソースが ERROR にならなければ失敗、
**字幕の読み込みに失敗した動画が `verified` を主張し続ければ失敗**、
**音声説明の `provided` を宣言しながら descriptions トラックが無い場合は失敗**、
320 px で facts が変われば失敗する。片方だけ緑にはできない。

capture 側の字幕ソース検証は、**ハーネスが配信するファイル**に対して行う
（`harnessCaptionResolver` はハーネスのルートを指す resolver）。
missing カードのリソースはハーネスにも無いので、そこで「未検証」になる。

### 人間の評価（機械では判定しない）

- 字幕の内容が正確・完全で、言語も合っているか（SC 1.2.2 の品質）
- **字幕ファイルが、その動画に対応する字幕であるか**
  （gate が検証するのは「ファイルが存在する / 正しい WebVTT / キューがある」までで、
  キューの内容は 1 文字も読んでいない）
- その作品に音声説明が**必要か**（SC 1.2.3 / 1.2.5 の判断そのもの。
  gate が強制するのは「**判断の宣言**があること」であって、
  「必要か」の判断ではない）
- `poster` がその作品を正しく表しているか（SC 1.1.1 の品質）
- 検証した字幕ソースが実際に安定して配信され続けるか
  （gate は gate 実行時点のファイルを読む。配信の継続は運用の責任で、
  capture は「読み込みに失敗したら主張を降格する」ことだけを実測する）
- 実機のスクリーンリーダー / ブラウザの字幕レンダラでの読み上げ

この 6 項目は gate の出力でも「not machine-checked」として明示され、検証画像内にも
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
- 字幕ソース: 検証画像のヘッダー帯には **「宣言は著者の主張、ソースは gate の事実」**
  を印刷する。カードごとに `caption-status` と、gate が判定した字幕ソースの状態
  （`verified` / `missing` / …）を並べて出す
- 失敗条件: 観測が契約と矛盾した場合、**成果物を書かずに exit 1**

### 実測（生成物）

`node scripts/capture-a11y-video-caption.mjs` の実行で実測した値:

| 項目 | 実測値 |
| --- | --- |
| 成果物の寸法 | **1600 × 1284 px** |
| 成果物のサイズ | **97,386 bytes（95 kB）** |
| viewport | 1600 × 900 |
| ヘッダー帯の高さ | 384 px |
| エンコード | WebP / quality 80 / 上限 300 kB（予算内） |

- ブラウザのスクリーンショットはバイト単位で再現しないため、**寸法と予算内であることは
  安定するが、バイト数は実行ごとに多少変動しうる**。上の数値は commit した成果物の実測値。

### ファイル名の乖離（2 点）

1. **ファイル名**: Issue #408 が指定する `video-caption-track` をそのまま維持している
   （別名にしていない）。
2. **拡張子**: Issue は `.png` を要求するが、このリポジトリの規約は WebP のみ
   （capture script が `.png` を拒否し、PNG をツリーに置かない）のため `.webp` にした。
   #396 / #397 / #399 / #400 と同じ扱い。**PNG は作っていない。**

## 誤検知が起きたときの解除手順

gate は「宣言」と「検証」を判定する。以下の 6 つは誤検知の候補であり、**gate を緩めずに**
個別の契約として扱う:

1. **`video-without-caption-track` / `video-playable-without-declared-verified-caption` が誤検知した**
   - 字幕ソースが本当に確定しているなら `data-caption-status="verified"` を宣言する。
     確定していないなら、その動画を**再生不可**（`src` / `<source>` を出さない）にする。
2. **`video-caption-source-unverified` が誤検知した**
   - gate が読むのは**リポジトリのファイル**である。字幕を R2 など
     リポジトリの外に置く設計なら、その source は**判定不能**として違反になる。
     解除は (a) 字幕ファイルをリポジトリに置いて `src` をそこに向ける、
     (b) `src` を**静的に読める**文字列にする、のいずれか。
     `public/` 配下に置いたファイルはサイト絶対パス（`/captions/…`）で参照できる。
   - 「missing」なら `src` の typo を直し、「not-webvtt」なら `WEBVTT` ヘッダーと
     `.vtt` 拡張子を付け、「empty」ならキューを 1 つ以上入れる。
   - gate を緩める手段は**ない**。宣言だけの主張は検証にならない。
3. **`video-without-text-alternative` が誤検知した**
   - `poster` とアクセシブルな名前の両方を宣言する。名前が周辺テキストで足りる場合も、
     `<video>` 自身に `aria-labelledby` を付ける（この gate は兄弟テキストを読まない）。
4. **`video-without-audio-description` が誤検知した**
   - 音声説明が要る作品なら `data-audio-description-status="provided"` と
     `<track kind="descriptions">` を同梱する。要らない作品なら
     `data-audio-description-status="not-required"` を宣言する（**人が判断した**場合のみ）。
5. **装飾動画として除外したい**
   - `muted` と `aria-hidden="true"`（または `role="presentation"` / `role="none"` /
     `data-decorative`）の**両方**を、**静的な値で**付ける。片方だけでは除外されない
     （片方は「見える」「聞こえる」を残す）。`muted` を実行時に切り替える Videos
     は装飾として証明できない（`muted={isMuted}` は「消音与否が読めない」= 判定不能）。
6. **値が動的だから読み飛ばしてほしい**
   - この gate は動的な値を「読めない = 条件を満たしていない」として扱う
     （fail-closed）。読み飛ばしはしない。解除は値を**静的に読める**形にすること
     （`controls={isPlaying}` ではなく `controls`、`muted={isMuted}` ではなく `muted`、
     `poster={poster}` ではなく `poster="/media/…"`）。実行時の値に依存する仕様が
     必要なら、その判断は**別の契約**（例: 動画が装飾かどうかは再生前に決める）として
     記録し、gate 側は静的に読める形にする。

いずれも、解除は「gate の判定を緩める」ことではなく「契約の記録を増やす」こととして扱う。

## 既知の制約 / 未対応範囲

- **出荷面に `<video>` が無いため、実データでの検証ではない。** gate は
  「公開されたときに満たす契約」を fixture と capture で固定している。
- **gate が読むのは静的に決まる値だけである。** 実行時の値（`src={clipUrl}` /
  `controls={isPlaying}` / `muted={isMuted}` / spread）は「読めない」として安全側に
  扱う（上記「判断できない値の扱い」）。この gate は**動的な値を検査の除外理由に
  しない**。動的な値を許す設計に変えたい場合は、判定の単位そのものの変更になるため
  owner の判断と ADR を要する。
- **音声説明は「必要か」ではなく「判断を宣言したか」を機械で判定する。**
  その作品が視覚情報だけの内容を持つかどうかは人評価（下記）。
  gate が機械で強制するのは宣言の**存在**（fail-closed）であり、
  宣言の**正しさ**ではない。
- **`not-required` は人の判断を前提とする宣言**である。gate は宣言の
  事実だけを判定する。
- **アクセシブルな名前は `<video>` 自身からしか読まない。** 兄弟テキストによる説明は
  検出しない（`aria-labelledby` を付けることを契約とする）。名前が実行時の値のときは
  「名前の無い動画」として扱う（安全側）。
- **`verified` は宣言であり、証明ではない。** gate が検証するのは字幕**ソース**
  （ファイルが存在する / 正しい WebVTT / キューがある）までである。
  字幕の内容・対応関係・将来の配信は gate の外（人間評価 / 運用）。
  字幕ソースが実際に配信され続けるかは運用の責任（capture は
  「読み込みに失敗したら主張を降格する」ことだけを実測）。
- **字幕ソースはリポジトリのファイルでなければならない。** R2 など
  リポジトリの外に置く字幕は**判定不能**であり、fail-closed により違反になる。
  これは契約であり偶然ではない: 検証できないソースは「検証済み」と読めない。
- **`descriptions` トラックの source は検証しない。** 今回の検証対象は
  `kind="captions"` の subtitle track だけである（音声説明の source は
  別の契約として必要になった時に扱う）。
- **字幕の品質（正確さ・完全さ・言語）と動画との対応は人評価。**
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
