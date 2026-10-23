# 独立 story の axe-core 実測と既知違反台帳（Issue #392）

> 検証対象: Storybook の独立 story（28 ファイル / 101 story）の **描画済みの DOM**。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の **A / AA**。
> ブラウザ実測は `e2e/a11y/axe-storybook.spec.ts`、
> 検査対象 manifest は `e2e/a11y/axe-storybook-manifest.ts`、
> 既知違反の台帳は `e2e/a11y/axe-storybook-baseline.json`、
> 静的ゲートは `scripts/check-a11y-axe-storybook.mjs`。

Issue #393 は公開ルートの描画済み DOM を測った。ここが測るのは **ページから
切り離されたコンポーネントそのもの**（デザイナーが触っている顔）である。story は
 周囲にページの無いコンポーネントなので、欠陥はルートに到達する前にここで見える。

## 何を追加したか

| 装置 | 役割 |
| --- | --- |
| `e2e/a11y/axe-storybook-manifest.ts` | 監査した story の明示的な記録（ファイル / 公開する story.export 名 / title / 期待する判定 / 理由）。**story ファイルから自動生成しない**（監査した範囲を自動生成すると、監査記録として反証できなくなるため） |
| `e2e/a11y/axe-storybook-verdict.ts` | 判定の式を 1 か所に置いたもの。ブラウザ実測と静的ゲートの両方が同じ式を使うので、ゲートの判定と実測の判定が食い違えない |
| `e2e/a11y/axe-storybook.spec.ts` | manifest の各 story を Chromium で開き、axe-core で WCAG 2.2 A/AA の違反を収集し、宣言・実測・台帳の 3 者を突き合わせる |
| `e2e/a11y/axe-storybook-baseline.json` | 既知の既存違反の台帳（1 story × 1 rule × 1 レコード） |
| `scripts/check-a11y-axe-storybook.mjs` | 静的ゲート（manifest と台帳の整合、登録 story の実在、自己チェック fixture の再現） |
| `scripts/capture-a11y-axe-storybook.mjs` | ゲート自身の実測結果から検証画像（WebP）を作る |

## 2 段構え: 静的ゲートとブラウザ実測

| 段 | 中身 | 実行 |
| --- | --- | --- |
| 静的ゲート | manifest / 台帳 / fixture の整合だけ。**Storybook を起動しない** | `pnpm run a11y:axe-storybook:check`（`validate:fast` に登録済み） |
| ブラウザ実測 | Chromium で story を開き、axe-core を走らせ、宣言・実測・台帳を突き合わせる | `pnpm run a11y:axe-storybook:e2e`（Storybook が必要） |

静的ゲートを高速ゲートに、ブラウザ実測を専用ジョブに分けた理由: Storybook の起動には数分かかり、`validate:fast` のような「毎回通る」ゲートには重すぎる。実測は
リリース候補を測るものだからであり、CI の通常ゲートに入れると「story が 1 つも
測られていないのに green」という状態を的形成する。

## 判定の 4 段構え

**どれかが 1 つでも red なら spec が落ちる。**

| 状況 | 判定 |
| --- | --- |
| 観測した違反が台帳に無い | **fail**（新しい違反。release candidate を落とす。**manifest を読まない判定なので、宣言を書き換えても回避できない**） |
| 観測した違反がすべて台帳にある | **baseline**（記録済みの違反。**件数を必ず表示する**） |
| 違反が 1 件も無い | **pass** |
| 台帳のレコードに実測違反が対応しない | **fail**（台帳が陳腐化している） |
| 台帳のレコードに理由が無い | **fail**（許容の理由が無い記録は、決定ではなく脱落） |
| manifest の宣言と実測の判定が違う | **fail**（manifest が現実とずれている） |
| manifest が `fail` を宣言している | **fail**（宣言できない。宣言できる値は `pass` / `baseline` だけ） |
| manifest に無い story の台帳レコードがある | **fail**（孤立した台帳レコード） |
| 登録した story がソースに無い | **fail**（登録が実在の story を指していない） |
| 登録した title が story ファイルの `meta` と違う | **fail**（manifest の記録が現実とずれている） |
| defer した story に理由が無い | **fail**（理由の無い defer は許されない） |
| baseURL が loopback ではない | **fail**（skip しない。「0 story を走査して exit 0」という silent green を作らない） |

台帳を空にして恒久 green にする回避は、陳腐化検出で塞いでいる。
1 件の違反を追加して baseline を 1 件減らした状態で **green には戻れない**。

### 「失敗が許される」のは台帳だけ

manifest の `expect` が宣言できるのは `pass` と `baseline` の 2 値だけで、
`fail` は **宣言できない**（型にも run time の検査にも無い）。
manifest の 1 語を書き換えて新規違反を隠す経路を作らないため。

- 違反が **恒久的に存在してよい** 場合は、**台帳**
  （`e2e/a11y/axe-storybook-baseline.json`）に 1 レコード追加し、`reason` に許容理由を書く。
  台帳は別ファイルなので、許容の判断は **差分として見える**。
- manifest の宣言は「違反が 1 件もない（`pass`）」か
  「違反がすべて台帳に載っている（`baseline`）」のどちらかでしかあり得ない。
  実測が `fail`（台帳に無い違反がある）なら、宣言の値に関係なく **必ず red**。

### 宣言を書き換えて隠せないことの確認（attack）

reviewer が報告する「manifest を書き換えると新規違反が通る」経路を、自分の作業
ツリーで再現・否定した（攻撃の入力は作業後にすべて戻した）。

| 攻撃 | 結果 |
| --- | --- |
| `expect: 'pass'` のファイルを `expect: 'baseline'` に書き換える（台帳は空のまま） | 静的ゲートが `baseline-missing-record` で **red**。許容にするには台帳のレコードと理由が要る、ということが宣言だけからは逃げられない |
| 登録済みファイルから story を 1 つ外す（`Badge.stories.tsx#Accent`） | 静的には **red にならない**（未登録 story は open item）。ただしゲートの要約が `100 registered, 1 deferred, 0 not registered yet` から `99 registered, 1 deferred, 1 not registered yet` に変わり、差分でも見える（既知の制約に書いた） |
| 台帳からレコードを消して恒久 green にする | ブラウザ実測が `fail`（台帳が陳腐化している）。**ブラウザ実測なしでは green のまま**なので、この迂回を塞ぐのはブラウザ側 |

## 適用対象

- Storybook の設定（`.storybook/main.ts`）が `stories` として宣言する全ファイル
  （現在 28 ファイル / 101 story）に登録がある。
- 登録は **ファイル単位**で、ファイル内の **すべての story.export 名**を明示する。
  1 つの story だけ測って「登録済み」としないのは、フォームのエラー状態が
  通常状態と同じであることを意味しないため。
- 実測は 100 story（defer した 1 story を除く）。

## 対象外（defer した story とその理由）

| story | 理由 |
| --- | --- |
| `src/home/access/reduced-motion.stories.tsx#Fixture` | 比較ハーネスそのものを描画する fixture で、出荷された表面ではない |

defer した story は `PENDING_STORIES` に理由つきで記録され、理由の無い
defer は静的ゲートが red にする。

## 走査の範囲: story の部分木だけ

走査対象は `#storybook-root` の部分木で、プレビュー文書全体ではない。理由は 2 つで、
どちらも測った結果である。

- **プレビューの道具は監査対象ではない。** Storybook の dev サーバーが差し込む
  Vite のエラーオーバーレイは chrome であり、文書全体を走査すると
  **101 story すべて**で `scrollable-region-focusable` が出る。道具についての話で、
  コンポーネントについての話ではない。
- **コンポーネント story は断片である。** ページ水準の規則（document title、
  landmark、`html-has-lang`）は断片には適用されない。それらはルート監査
  （Issue #393）の対象である。

## 基準（WCAG 2.2 の達成基準と axe の tag の対応）

axe の tag は `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa` / `wcag22aa` を対象とする
（`e2e/a11y/axe-manifest.ts` の `AXE_TAGS`）。したがって、この監査が扱うのは

- Level A: 1.1.1（非テキストの内容）、1.3.1（情報と関係）、1.4.1（色の利用）、
  2.1.1（キーボード）、2.4.3（フォーカス順）、2.4.6（見出しとラベル）、
  3.1.2（部品の名称）、4.1.2（名前・役割・値）ほか
- Level AA: 1.4.3（テキストのコントラスト）、1.4.4（テキストのリサイズ）、
  1.4.10（リフロー）、1.4.11（非テキストのコントラスト）、
  1.4.13（ホバー/フォーカス時の内容）、2.4.11（フォーカスの非遮蔽）、
  2.5.8（ターゲットの最小サイズ）ほか

であり、AAA は対象外である。ただし、この監査の結果をもって
「WCAG 2.2 A/AA 適合」を宣言するものではない（下節）。

## 機械検査と人間の評価の区別

この文書でいちばん重要な区別である。green なゲートは適合の主張ではなく、
スクリーンショットも accessibility 監査ではない。

### 機械が決めること

| SC (WCAG 2.2) | レベル | 主張 | 確認方法 |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | story が描く画像・アイコンに代替テキストがある | **機械**: axe-core の `image-alt` / `role-img-alt` などの rule が story 内で発火しない |
| 1.3.1 Info and Relationships | A | 見出し・リスト・表の構造が DOM に現れる | **機械**: axe-core の `list` / `listitem` / `definition-list` / `dlitem` / `th-has-data-cells` などの rule |
| 1.4.3 Contrast (Minimum) | AA | 前景と背景のコントラストが閾値を満たす | **機械**: axe-core の `color-contrast` |
| 2.1.1 Keyboard | A | 部品がキーボードで操作できる（**この監査は判定しない**） | **機械**: なし。`aria-*` の整合のみを見る。キー操作そのものは人が確認する |
| 4.1.2 Name, Role, Value | A | 部品にアクセシブルな名前がある | **機械**: axe-core の `button-name` / `link-name` / `aria-*` などの rule |

### 人が評価すること（このゲートは判定しない）

- 代替テキスト・`aria-label` の **文言** が読み手に伝わるか
- 記録済みの違反を設計判断として許容してよいか
- 見た目が読み取りやすいか、コントラスト以外の可読性（行間・字面）か
- キーボードだけで主要フローが完了できるか
- 実機のスクリーンリーダーで読み上げ品質が保たれるか

上の SC 表の「機械」欄が **機械で判定できる範囲** であり、適合の
代表ではないこと、読み上げの検証を含まないこと、この表が数千行の
WCAG 適合を意味しないことを明記しておく。

## baseline 台帳の扱い

現在の台帳は **空**（`records: []`）。101 story を実測した結果、WCAG 2.2 A/AA に
抵触する違反は 1 件も観測されなかった。

台帳にレコードを追加する条件は「その違反が恒久的に存在してよい」と
**人が判断した**ことだけである。機械は「記録されているか」を見るだけで、
「記録してよいか」は見ない。

## 誤検知・誤陰性を見つけたときの扱い

- 誤検知（実際には問題ないのに rule が出た）の場合: まず story の実装を直せるか
  考える。直せない場合のみ、台帳に `reason` 付きで記録し、manifest の
  `expect` を `baseline` にする。**reason には「なぜこれが許容されるか」を
  書く**（色の値ならその値と対比を、レイアウト由来なら構造の話を書く）。
- 誤陰性（違反があるのに出てこなかった）の場合: その rule を見逃す事情
  （走査範囲が story の部分木であること、axe の rule 集合）を記録し、
  人が判定する手（スクリーンリーダー、キーボード操作）を別途入れる。

## スクリーンショット

`docs/verification/a11y/axe-storybook-pass-fail.webp`（1400 × 2174 / 285 kB）。

- 上段: **pass**（出荷どおりに描画した story のスクリーンショット）と
  **fail**（同じ story に `<img alt>` を 1 個だけ注入し、axe-core が
  `image-alt` として検出したもの）。負の対照はブラウザ内の注入だけで、
  リポジトリには何も書かない。
- 下段: 実測結果の一覧（story / verdict / 違反の rule id・WCAG tag・対象要素数）。

### WebP, not PNG

Chromium が書けるのは PNG だけだが、検証画像のためにツリーに大きな binary を置く理由はない。
キャプチャは `.tmp/` に取り、既存の `sharp` devDependency で幅 1400 / quality 80 に
エンコードし、300 kB の予算内に収まることを確認してから、コミットされるのは
`.webp` である。スクリプトは **`.webp` 以外の出力先を拒否し**、中間 PNG は削除する。

## 検証コマンド

```sh
# 1. 静的ゲート（validate:fast にも入っている）
pnpm run a11y:axe-storybook:check

# 2. ブラウザ実測（Storybook が要る）
pnpm run storybook            # 別ターミナル
pnpm run a11y:axe-storybook:e2e

# 3. 検証画像を生成する（Storybook を自分で起動する）
pnpm run capture:a11y-axe-storybook
```

## 既知の制約

1. **story の走査はページ水準の規則を含まない。** document title、landmark、
   `html-has-lang` は story には適用されないので測らない（ルート監査の担当）。
2. **走査範囲は story の部分木に限定している。** プレビューの chrome に含まれる
   違反は見ていない。開発者がpreview で見たときの答えは STORY 側の話であり、
   道具の話をしないため。
3. **story ファイルの export 名はソースのテキストから読む**（TypeScript のパーサで
   読むので JSX テキストや文字列リテラルに惑わされない）。ただし manifest の
   title は story ファイルの `meta` から読み、**一致していなければ red**。
4. **未登録の story は open item であり、red ではない。** 段階的登録の設計であり、
   「恒久的に赤くしない」という Issue の要求どおり。ただし、**登録を外すと
   実測対象から外れる**。ゲートは要約行で `registered` と `not registered yet` の
   数を出し続けるので、差分と要約の両方で見える。
5. **ブラウザ実測は fast ゲートに入っていない。** Storybook の起動時間のため。
   CI で回すなら専用ジョブ（`pnpm run a11y:axe-storybook:e2e`）として追加する。
6. **axe-core の rule 集合がそのまま監査の範囲である。** axe が検出しない違反
   （読み上げの自然さ、キーボード操作の順番、意味の誤り）はこの監査では検出できない。
