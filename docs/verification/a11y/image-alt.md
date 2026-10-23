# 画像の alt / 装飾画像の公開ルールを検証する（Issue #397）

> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 1.1.1 Non-text Content（レベル A）**。
> 「意味を持つ画像には意味に沿った alt」「装飾画像は装飾であることを明示した空 alt」
> という 2 つの要求を、**どの画像がどちらなのか**を機械検査で固定する。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/**/*.tsx` | 出荷する JSX 表面すべて | `.ts` は JSX を描かないので対象外 |
| `<img>` の開始タグ | 属性は複数行にまたがってよい | 開始タグの範囲を拾って属性を読む |
| `alt` 属性 | literal / 式（`alt={…}`）の両方 | 式は静的には決まらないので「機械では決められない」として別扱い |

### 対象外（除外の理由も gate の出力に明記する）

| 対象外 | 理由 |
| --- | --- |
| `*.test.tsx` | テストは描画を検証するファイルであり、除去すべき欠陥は出荷コード側にある |
| `*.stories.tsx` | Storybook の story はコンポーネントのプレビュー用ハーネスであり、訪問者が到達する表面ではない（コンポーネント本体は別途走査される） |
| `**/fixtures/**` | fixture は形を持つために存在し、本 gate が拒否する形も含む。出荷する同じデータは別途走査される |
| `src/routes/design-system/**` | design-system ルートはリポジトリ内部のコンポーネントギャラリーであり、公開表面ではない（実 primitives は別途走査される） |
| Markdown 本文の画像 | `pnpm run content:links:check`（Issue #434）が `E107 image-alt-missing` / `W103 image-alt-empty` として既に検査している。ここでの二重管理はしない |

### 基準

| 基準 | レベル | 該当箇所 | 判定 |
| --- | --- | --- | --- |
| SC 1.1.1 Non-text Content | A | 出荷するすべての `<img>` | 適合 — `alt` の有無・空/空白の別・装飾印の有無を機械検査（`scripts/check-a11y-image-alt.mjs`） |

## 規則一覧

| rule | 意味 | 判定 |
| --- | --- | --- |
| `img-missing-alt` | `<img>` が `alt` 属性を宣言していない | 違反 |
| `img-empty-alt-not-decorative` | `alt=""`（装飾宣言）なのに、装飾であることを示す印がない | 違反 |
| `img-alt-blank` | `alt` が空白のみ（`alt=" "`）。装飾の宣言として壊れている | 違反 |
| `img-alt-empty` | `alt=""` だが装飾印がある（= 意図された装飾） | **合格**（`ok` として出力する） |

装飾印の定義は gate の中の **1 か所**（`DECORATIVE_MARKS`）にまとめてあり、
fixture も gate も同じ定義を読む。装飾印は次の 3 つのいずれか:

- `aria-hidden="true"`
- `role="presentation"`（`role="none"` も同じ扱い）
- `data-decorative`（**存在**すれば装飾印。値は問わない）

## 既存コードの修正

gate 導入時に `src/**` で 2 件の違反が見つかり、どちらも「装飾画像である」ことが
宣言されていなかった。いずれも**新しい日本語テキストは追加していない**。

| ファイル | 修正前 | 修正後 | 理由 |
| --- | --- | --- | --- |
| `src/home/access/tiles.tsx` | `<img alt="" />` | `<img alt="" aria-hidden="true" />` | 桁のビットマップは装飾。親要素が `role="img"` と実数の `aria-label` を持ち、ビットマップ自体は情報を持たない |
| `src/admin/images/images.tsx` | `<img alt="" />` | `<img alt="" aria-hidden="true" />` | サムネイルは装飾。行のテキスト（id / content type / size / digest）がファイルの同一性を担保し、アップロード画像には作者が書いた説明が存在しない |

`src/portfolio/components/PortfolioMedia.tsx` の `alt={media.alt}` は式の値なので、
静的には空かどうかを判断できない。gate はこれを「機械では決められない」として
合格扱いにし、**空でないことの担保は別の契約**（portfolio の media seed に対する
`content:links:check` の `E107 image-alt-missing`）が担っている。

## fixture（gate が実際に読むディレクトリ）

`scripts/fixtures/a11y-image-alt/` は gate 自身が読む。`pass/` の違反が 1 件でも
出れば `fixture-pass-violation`、`fail/` が期待した rule を出さなければ
`fixture-fail-not-detected` として **gate 自体が失敗する**。
テスト（`scripts/check-a11y-image-alt.test.mjs`）はさらに、fixture ディレクトリの一覧と
期待表が**完全一致**すること（1 個落としても気付けないテストにしない）を assert する。

| ディレクトリ | ファイル | 期待される結果 |
| --- | --- | --- |
| `pass/` | `meaningful-alt.tsx` | 違反 0（意味のある alt） |
| `pass/` | `decorative-aria-hidden.tsx` | 違反 0（空 alt + `aria-hidden="true"`） |
| `pass/` | `decorative-role-presentation.tsx` | 違反 0（空 alt + `role="presentation"`） |
| `fail/` | `missing-alt.tsx` | `img-missing-alt` |
| `fail/` | `empty-alt-without-mark.tsx` | `img-empty-alt-not-decorative` |
| `fail/` | `blank-alt.tsx` | `img-alt-blank` |

`role="presentation"` を `<img>` に書くのは Biome の `lint/a11y/noRedundantRoles`
が冗長とみなすため、出荷コードでは `aria-hidden="true"` を優先する
（fixture の `decorative-role-presentation.tsx` だけは、その装飾印が gate に
受理されることを証明するため `biome-ignore` 付きで残してある）。

## 機械検査と人間の評価の区別

本 Issue の要求どおり、**機械で決まること**と**人が評価すること**を混ぜない。

### 機械検査（`pnpm run a11y:image-alt:check`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| `img-missing-alt` | 出荷する `<img>` がすべて `alt` を宣言している | コメント除去後のソース走査（`scripts/check-a11y-image-alt.mjs`） |
| `img-empty-alt-not-decorative` | `alt=""` には必ず装飾印がある | 同上 |
| `img-alt-blank` | 空白のみの `alt` が 1 件も無い | 同上 |
| `img-alt-empty` | 意図された装飾画像が数え上げられる（合格行） | 同上 |
| fixture の再現 | `pass/` は違反 0、`fail/` は期待した rule | 同上（gate 自身が行う） |
| ブラウザ側の観測 | 各画像の `alt` 属性の有無と値、装飾印の有無 | Chromium 実測（capture） |

### 人間の評価（機械では判定しない）

- alt の文言が実際に画像の内容を正しく伝えているか
- 装飾と宣言した画像が本当に情報を持たないか
- 意味のある画像に `alt` 以外の長い説明（extended description）が必要か
- 実機でのスクリーンリーダー読み上げ（VoiceOver / NVDA）
- 画像の視覚的な順序が読み上げ順序と一致しているか

この項目は gate の出力でも「not machine-checked」として明示され、検証画像内にも
同じ文言が印字される。

## スクリーンショット

`docs/verification/a11y/image-alt.webp`（Issue #397 が指定する `image-alt.png` の
WebP 版。PNG はリポジトリに置いていない — capture script が `.png` を拒否する規約のため）。

- 生成: `pnpm run capture:a11y-image-alt`
- 方式: loopback の一時 HTTP サーバに生成したハーネスを置き、Chromium で描画して
  WebP 化（`sharp`、幅 <= 1600 / quality 80、予算 300 kB）。途中の PNG は削除する
- 画面の内容: **同一画面に**「出荷してよい 2 状態」（意味のある画像 / 空 alt + 装飾印の
  装飾画像）と「gate が拒否する 3 状態」（alt 欠落 / 装飾印なしの空 alt / 空白 alt）を
  並べている
- 失敗条件: ブラウザの実測が画面が主張する verdict と食い違えば、**成果物を書かずに
  exit 1**（見栄えのよい画像だけが残ることを防ぐ）
- 秘密の読み書き・外部通信・remote binding へのアクセスは行わない（画像は data URI）

## 検証コマンド

```bash
pnpm run a11y:image-alt:check        # 機械検査（gate）
pnpm run capture:a11y-image-alt      # Chromium で実測して WebP を生成
node --test scripts/check-a11y-image-alt.test.mjs scripts/capture-a11y-image-alt.test.mjs
```

## 誤検知（false positive）が起きたときの対処

機械検査が誤検知を報告した場合、次のようにする（gate を弱めることはしない）。

1. **その画像が本当に装飾か意味を持つか**を先に決める（装飾印の 3 つのどれかが
   正しいか、意味のある画像なら alt を書く）。
2. 装飾画像なら `alt=""` に加えて装飾印（`aria-hidden="true"` /
   `role="presentation"` / `data-decorative`）を付ける。**新しい日本語テキストは
   追加しない**。意味のある画像なら、既存のテキスト（隣接するキャプションや
   代替テキスト）への参照として alt を書く。
3. それでも誤検知だと判断した場合は、**除外の理由を gate の `EXCLUSIONS` に
   1 件として追記**し、その理由（`docs/verification/a11y/image-alt.md` の
   「対象外」表にも反映する）。gate 全体を緩める形での回避はしない。
4. alt の**文言の良し悪し**に関する指摘は、この gate の管外（人間の評価）です。
   gate の出力（`not machine-checked`）に区別済みなので、報告の
   `known_issues` に残す。

## 既知の制約

- **`alt={…}` の式は静的には空かどうかを判断できない。** 実行時の値に依存する
  ため `dynamic-alt` として合格扱いになる。空の alt を出荷しないことを保証する
  のはデータ側の契約（portfolio の media seed に対する `content:links:check`）の
  責務である。
- **fixture 以外の JSX ライブラリ経由の画像（`next/image` 等）は本 gate の対象外。**
  現時点でリポジトリに存在しないため、導入された時点で本 gate の走査対象を
  見直す必要がある。
- **装飾印の 3 種目は `data-decorative` というリポジトリ固有のフック**である。
  標準属性ではないため、意味だけを持たせる場合は `aria-hidden="true"` または
  `role="presentation"` を優先する。
