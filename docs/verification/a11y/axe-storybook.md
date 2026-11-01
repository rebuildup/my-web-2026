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
| `e2e/a11y/axe-storybook-baseline.json` | 既知の既存違反の台帳。**Issue #718 で記録されていた 11 story × 1 rule = 11 レコードは実装側で直して削除した。現在 0 レコード** |
| `scripts/check-a11y-axe-storybook.mjs` | 静的ゲート（manifest と台帳の整合、登録 story の実在、自己チェック fixture の再現） |
| `scripts/capture-a11y-axe-storybook.mjs` | ゲート自身の実測結果から検証画像（WebP）を作る |

## 2 段構え: 静的ゲートとブラウザ実測

| 段 | 中身 | 実行 |
| --- | --- | --- |
| 静的ゲート | manifest / 台帳 / fixture の整合だけ。**Storybook を起動しない** | `pnpm run a11y:axe-storybook:check`（`validate:fast` に登録済み） |
| ブラウザ実測 | Chromium で story を開き、axe-core を走らせ、宣言・実測・台帳を突き合わせる | `pnpm run a11y:axe-storybook:e2e`（Storybook が必要） |

静的ゲートを高速ゲートに、ブラウザ実測を専用ジョブに分けた理由: Storybook の起動には数分かかり、`validate:fast` のような「毎回通る」ゲートには重すぎる。

**ブラウザ実測は CI の専用ジョブ `storybook axe` で常に走る**（条件なし）。
このジョブは Storybook の dev サーバを loopback に起動し、origin が 200 を返す
ことに加えて **1 つの story が実際に描画されたこと**（fresh checkout の cold start
では Vite の依存最適化が終わるまで preview が開かないことがある）を確認してから
`pnpm run a11y:axe-storybook:e2e` を実行し、失敗したときは dev サーバのログを
表示する。

**条件を設けない**理由: story の描画結果はコンポーネント・依存・Storybook の
設定・トークンのどれででも変わりうるため、`**/*.stories.tsx` の差分や
`accessibility` label で絞り込むと「実測されていないのに green」が再び生まれる。
問題の本質（story が描画できない状態で static ゲートだけ緑になる）を閉じ直すには、
**測る装置そのものを PR ごとに回す**ことが必要である。

判断・起動・結果集約のロジックは `scripts/run-storybook-axe-audit.mjs` にあり、
workflow YAML はジョブの起動と結果の集約に留まる（AGENTS.md §5: 検証ロジックを
YAML に隠さない）。同じスクリプトがローカルでも同じ判定を出す。

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

この 2 値は **型と run time の 2 枚**で守られている:

- **型**: `export type StoryVerdict = 'pass' | 'baseline';`。
  `e2e/a11y/**` は `tsconfig.json#include` にあるので `pnpm run typecheck` が
  manifest を型検査する。`expect: 'fail'` を書くと **型エラー**になる
  （`TS2322: Type '"fail"' is not assignable to type 'StoryVerdict'`）。
- **run time**: 静的ゲートの `manifest-invalid-verdict` が、型を通り越した値
  （たとえば JSON 経由で届いた値）を止める。

型検査に含める範囲は `e2e/a11y/**` である。他の `e2e/` 配下の suite はこの決定に
先立って存在し、まだ型エラーを持つため、この Issue の範囲外として
**今回一并に直さない**（直すと別の Issue の仕事になる）。

- 違反が **恒久的に存在してよい** 場合は、**台帳**
  （`e2e/a11y/axe-storybook-baseline.json`）に 1 レコード追加し、`reason` に許容理由を書く。
  台帳は別ファイルなので、許容の判断は **差分として見える**。
- manifest の宣言は「違反が 1 件もない（`pass`）」か
  「違反がすべて台帳に載っている（`baseline`）」のどちらかでしかあり得ない。
  実測が `fail`（台帳に無い違反がある）なら、宣言の値に関係なく **必ず red**。

### 宣言を書き換えて隠せないことの確認（attack）

reviewer が報告する「manifest を書き換えると新規違反が通る」経路を、自分の作業
ツリーで再現・否定した（攻撃の入力は作業後にすべて戻した）。

| 攻撃 | 静的ゲート | ブラウザ実測 |
| --- | --- | --- |
| `expect: 'pass'` のファイルを `expect: 'baseline'` に書き換える（台帳は空のまま） | **red**（`baseline-missing-record`）。許容にするには台帳のレコードと理由が要る、ということが宣言だけからは逃げられない | — |
| 登録済みファイルから story を 1 つ外す（`Badge.stories.tsx#Accent`） | **red にならない**（未登録 story は open item）。ただしゲートの要約が `100 registered, 1 deferred, 0 not registered yet` から `99 registered, 1 deferred, 1 not registered yet` に変わり、差分でも見える（既知の制約に書いた） | — |
| **実在する story** の台帳レコードを消して恒久 green にする | 緑（静的ゲートは **ファイル単位**で判定するので、同じファイルに別の story の記録が残っている限り `baseline` 宣言は守られる） | **red**（`the scan found violation(s) the ledger does not record`） |
| 台帳の記録が実測と合わなくなった（rule id を変えた、違反が直ったのに残した） | 緑（静的には判定しない） | **red**（`the scan found violation(s) the ledger does not record` / 記録側の陳腐化は `the baseline ledger records violations the scan no longer observes`） |
| **実在しない story** の台帳レコードを足す | **red**（`baseline-story-not-audited`） | 緑（対応する test が存在しないので、この入力はブラウザ実測に現れない） |

3 行目〜5 行目は **別々の装置**が赤くなる。両方を塞げているので、
「台帳を空にして恒久 green にする」迂回が残らない。
ブラウザ実測は CI の専用ジョブ `storybook axe` が条件なしで毎回走らせるので、
「ブラウザ実測が走らないから緑」という状態は起こらない。

> **Issue #718 後の現在地**: 11 レコードは「隠して消した」のではなく
> **実装を直して消した**。ブラウザ実測が緑になるのは違反が無くなったからで、
> ゲートが緩んだからではない。修正前の markup に戻した負の対照では
> **11 failed / 90 passed**（`the scan found violation(s) the ledger does not record`）
> に戻ることを確認している。

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

走査対象は `#storybook-root` の部分木で、プレビュー文書全体ではない。理由は 2 つ。

- **プレビューの道具は監査対象ではない。** Storybook は（component story ではなく）
  道具の画面である。dev サーバがエラーを起こしたときに注入する Vite の
  エラーオーバーレイのような chrome 領域は測定対象から外すため、走査範囲は
  `#storybook-root` の部分木に固定する。**正常状態の dev サーバでは文書全体を
  走査しても部分木走査と同じ結果になる**（`scrollable-region-focusable` は 1 件も
  出ない。オーバーレイはエラーがある時にしか注入されないため）。壊れた環境
  （この Issue が直した「story が描画できない状態」）ではオーバーレイ由来の
  違反が混ざるが、その状態は gate が red にするので、記録に残さない。
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

現在の台帳は **0 レコード**。**Issue #718（2026-11-01）で、2026-10-23 に記録していた
11 レコード（11 story × 1 rule）を実装側で直して削除した。** 原因は home の status
リストが `<dl>` の group に badge 用の `<div>` を置いていたこと（SC 1.3.1、
`src/home/status/tiles.tsx`）。改正の詳細は
[`axe-known-violations.md`](axe-known-violations.md) に記録した。

> **この台帳は「最初に測ったときは空だった」。** Storybook の dev サーバが
> `@storybook/react` を解決できず **story が 1 つも描画されず**、実測が空の
> 要素を測っていたため、違反は 1 件も観測されなかった。依存を直して
> 再実測すると 11 story が `definition-list` を検出したので、台帳に記録した
> （manifest の `expect` も `baseline` に変更）。**空の台帳は「違反が無い」
> ではなく「測れていなかった」** のであり、story が描画されていることを
> 別途確認してから台帳を確定する。

> **2026-11-01 の再実測**: 11 story を `definition-list` が出なくなるよう実装を
> 直し、台帳のレコードを削除して manifest の `expect` を `pass` に変えた。
> 実測は **101 passed / 0 failed**（100 story + index 1 test）。修正前のコードで
> 同じ測定をやり直すと **11 failed / 90 passed**（すべて `definition-list`）に
> なることを確かめている。**空の台帳でもゲートは機能している**。

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

`docs/verification/a11y/axe-storybook-pass-fail.webp`（1400 × 2300 / 284 kB）。

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

# 2'. ブラウザ実測を CI と同じ手順で回す（Storybook の起動も待ちも含む）
pnpm run a11y:axe-storybook:ci

# 3. 検証画像を生成する（Storybook を自分で起動する）
pnpm run capture:a11y-axe-storybook
```

## 実行環境: Storybook の dev サーバが story を描画できること

ブラウザ実測は **Storybook の dev サーバ**（`pnpm run storybook`）が **story を
描画できる**ことに依存する。このリポジトリは pnpm の strict layout（Hoist なし）
で動いているため、Storybook の preview エントリー
（`@storybook/react/dist/entry-preview.mjs`）は **プロジェクト直下から解決できない**。
`@storybook/react` を **直接 devDependency として宣言** してあるのはそのためで、
外すと dev サーバは起動するものの **story が 1 つも描画されず**、
`#storybook-root` が空のままになる。

この状態は **gate が red になる**（spec は「描画された story」を待って 60 秒で
タイムアウトする）ので放置はされない。**検証画像（capture）も**、**gate が red のときは何も書かずに
exit 1** で止まる — 測れていない story を測定結果として描画しないためである。

### cold start（依存最適化の待ち）

checkout したばかりの Storybook は Vite の依存最適化がまだ走っておらず、preview
の iframe が開かないことがある。この状態で最初の数十 story がまとめて落ち、
最適化が終われば通る。**これを「監査が壊れている」と読むのは誤診** である。
CI のジョブは **1 つの story が実際に描画されたことを確認してから** スイートを
走らせる（`scripts/run-storybook-axe-audit.mjs` の `waitForStoryRendered`）。
描画確認が通らないままなら、その状態は **skip ではなく fail** として扱う
（「0 story を測って exit 0」という silent green を作らないため）。

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
   代わりに **CI の専用ジョブ `storybook axe` が条件なしで毎回回す**
   （`.github/workflows/ci.yml`、ロジックは
   `scripts/run-storybook-axe-audit.mjs`）。静的ゲートだけでは違反を
   検出できないため、このジョブが唯一の測定装置である。
6. **axe-core の rule 集合がそのまま監査の範囲である。** axe が検出しない違反
   （読み上げの自然さ、キーボード操作の順番、意味の誤り）はこの監査では検出できない。
