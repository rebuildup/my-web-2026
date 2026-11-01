# flat vs depth — 「シンプル / 平面的になりがち」の visual review

本稿は Issue #520 の visual review である。公開されている 2 画面を実測し、
「平坦さが有効だった場面」と「平坦さが不十分だと考えられる場面」を 具体的な
数値で並べ、流行り UI への平均化を避ける判断と、本人の自己否定を恒久的なブランド
要件にしない判断を記録する。

- **典拠**: Issue #520 本文が引用する Miro の見出し語のみ
  （作品 > 世界観 > シンプル / 平面的 / 独自性への自己評価）。Miro の付箋には
  アクセスできないので、引用以外の情報は創作していない。
- **観測対象**: 本リポジトリが公開する 2 画面。実測値のみを記述する。
- **成果物**: 本書、preview（`src/personal/flat-vs-depth/FlatVsDepth.stories.tsx`）、
  一致の機械検証（`scripts/check-flat-vs-depth-preview-parity.test.mjs`）、
  検証画像（`docs/verification/visual/flat-vs-depth-comparison.webp`）。
- **非目標**: 画面スタイルの変更、全サイト再設計、公開日本語 copy の変更。

## 観測対象と方法

比較の対象は、このリポジトリが公開している 2 画面。記述はすべて実測値であり、推測は書かない。

- 観測対象は `https://rebuildup.dev/` と `https://rebuildup.dev/portfolio` の 2 画面。
- 観測は Chromium（Playwright）、viewport 1440x900、deviceScaleFactor 1、2026-10-28 実施。
- 再現コマンドは `node scripts/measure-flat-vs-depth.mjs`。結果は `.tmp/flat-vs-depth/measurements.json`。
- この Issue は画面のスタイルを変えない。成果物は記述（文書）と preview だけである。

| 項目 | 値 |
| --- | --- |
| origin | https://rebuildup.dev |
| viewport | 1440x900 / deviceScaleFactor 1 |
| browser | Chromium (Playwright) |
| 実施日 | 2026-10-28 |
| 再現コマンド | `node scripts/measure-flat-vs-depth.mjs` |
| 実測レポート | `.tmp/flat-vs-depth/measurements.json` |
| preview | `src/personal/flat-vs-depth/FlatVsDepth.stories.tsx` |

### 判断

- **`decision-observe-production`**（採用）— 本番 origin の実測を典拠にする
  - 理由: ADR-0014 が定める canonical production origin が、読者が実際に見る面だからである。ローカルの build は D1 が空で 2 画面を再現しない。

## 2作品に観測された視覚的特徴

5 つの観点（階層・余白・密度・コントラスト・motif）で 2 画面を並べた観測結果。

- 階層は「h1 / h2 / h3 の文字サイズ段」と「見出しの立ち位置」で決まっている。
- 余白は section padding と section 間の beat で決まっている。
- 密度は描画要素数と文書高の比で比べる。
- コントラストは白地に対する計算比で比べる。
- motif は画面内で 1 個だけ意味を持てる。

### ホーム / Home（`case-home`）

サイトの入口。identity motif と 5 つの本文セクションと状態表示を 1 画面にまとめた画面。

- URL: `https://rebuildup.dev/`
- 最初の层面上 motif が 1 個だけある（h1 = SiteMark の SVG 141x96px）
- 6 つのセクションが同じ 96px padding で積まれる（hero だけ 128px）
- セクションを区切るのは shadow でも罫線でもなく、192px の余白だけ
- 見出しは全部同じ左カラム（240px-547px）に立ち、本文は右カラム（587px-1200px）

| 観測 | 値 | 観測方法 |
| --- | --- | --- |
| 文書全体の高さ | 3243px | documentElement.scrollHeight / Chromium 1440x900 |
| 描画される要素数 | 323 | document.querySelectorAll("body *") のうち幅か高さが 0 でないもの |
| 密度（描画要素数 / 文書高） | 0.0996 要素/px | 323 / 3243 |
| 立体の手がかり | box-shadow 1 / gradient 0 / background-image 0 / border 10 | getComputedStyle で可視要素を走査 |
| 背景色 | #ffffff / #f8fafc / #f1f5f9 / #0369a1 / #047857 | getComputedStyle(el).backgroundColor を集計 |
| 文字色 | #0f172a / #64748b / #0369a1 / #ffffff / #000000 | getComputedStyle(el).color を集計 |
| 実際の文字サイズ段 | 12 / 14 / 16 / 18 / 24 / 32 / 64 px | テキストを持つ要素の computed font-size を集計 |
| h1 | SiteMark の SVG 141x96px（#ffd627 / #ffffff / #000000 の 3 色）。h1 のテキスト自体は 16px / 400 の視覚的隠蔽 | h1 の computed style と内側 svg の getBoundingClientRect |
| h2 | 32px / 700 / line-height 1.15 / letter-spacing -0.8px / コントラスト 17.85:1 | main h2 の computed style と背景色から計算したコントラスト比 |
| カラム分割 | 306.656px + 613.344px（gap 40px / コンテンツ幅 960px） | grid container の解決済み grid-template-columns |
| セクション間の余白 | 224px（hero → capabilities）/ 192px（本文セクション間） | 前セクションの末尾要素の底辺と次セクションの先頭要素の上辺の差 |
| セクション構成 | 6（hero / capabilities / status / reactions / access / contact） | position が fixed / sticky でない section 要素を数える |
| 最多文字色のコントラスト | #64748b が 116 要素 / 4.76:1（白地） | 最多の文字色を白地 #ffffff と对比 |

### ポートフォリオ / Portfolio（`case-portfolio`）

制作物の一覧。1 枚の見出しと 3 件の作品カードからなる画面。

- URL: `https://rebuildup.dev/portfolio`
- motif が 0 個（svg 要素は 1 つも無い）。画面上の語りは type だけ
- 文字サイズ段に 32px が無い（12 / 14 / 16 / 18 / 24 / 64 px のみ）
- h1 64px から h3 24px へ 40px 跳ぶ、中間の段が無い
- 作品の並びは 3 件、各カードの見出しは 8/12 カラム（581px-1200px）に揃う

| 観測 | 値 | 観測方法 |
| --- | --- | --- |
| 文書全体の高さ | 1799px | documentElement.scrollHeight / Chromium 1440x900 |
| 描画される要素数 | 125 | document.querySelectorAll("body *") のうち幅か高さが 0 でないもの |
| 密度（描画要素数 / 文書高） | 0.0695 要素/px | 125 / 1799 |
| 立体の手がかり | box-shadow 1 / gradient 0 / background-image 0 / border 12 | getComputedStyle で可視要素を走査 |
| 背景色 | #ffffff / #f8fafc / #f1f5f9 / #0369a1 / #64748b | getComputedStyle(el).backgroundColor を集計 |
| 文字色 | #0f172a / #64748b / #ffffff | getComputedStyle(el).color を集計 |
| 実際の文字サイズ段 | 12 / 14 / 16 / 18 / 24 / 64 px（32px の段は無い） | テキストを持つ要素の computed font-size を集計 |
| h1 | 64px / 700 / line-height 1.05 / letter-spacing -1.92px / 幅 720px / コントラスト 17.85:1 | h1 の computed style と bounding box |
| 作品カードの見出し | 24px / 700 / 左 581px・幅 619px（8/12 カラム） | main h3 の computed style と bounding box |
| 画像 | 3 枚（1280x720 → 309x174、1280x720 → 309x174、1920x1920 → 309x309） | img の naturalWidth / naturalHeight と bounding box |
| h1 から最初の作品タイトルまで | 469px | h1 の底辺と最初の main h3 の上辺の差 |
| 作品タイトル間の距離 | 223px / 248px | 連続する main h3 の下辺と上辺の差 |
| カラム分割 | 309.328px + 618.672px（gap 32px / コンテンツ幅 960px） | grid container の解決済み grid-template-columns |
| motif | 0 個（svg 要素は 1 つも無い） | document.querySelectorAll("svg") を数える |

## flatness が有効だった場面

平坦な面が読み手的にも構造的にも成立した画面。flatness を維持する根拠。

- `https://rebuildup.dev/portfolio` は反復する 3 件の一覧で、階層は整列と反復だけで成立する。
- 立体の手がかりは box-shadow 1 / gradient 0 / background-image 0 で、実質的に無い。
- それでも 3 件のカードは同じ型（画像 + 24px の見出し + 説明）なので、面が平でも並びが階層を作る。

比較対象は `https://rebuildup.dev/portfolio`（`case-portfolio`）。

- 階層は整列と反復だけで成立する。h1 64px、作品のタイトル 24px、説明 16px。
- 立体の手がかりが無い（box-shadow 1 / gradient 0 / background-image 0）のまま、
  3 件の並びは「同じ型を縦に並べたもの」として読める。
- rhythm が揃うので余白が崩れない: h1 から最初の作品タイトルまで 469px、
  作品タイトル間は 223px / 248px。

**不十分な点がない理由**: 1 画面 1 テーマで、中間の段（32px）が無くても h1 と h3 の
差 40px がそのまま階層になる。面を増やしても階層は増えない。

### 判断

- **`decision-keep-portfolio-flat`**（採用）— 一覧画面は平坦なまま維持する
  - 理由: 反復する同型の並びは shadow や面を手入れなくても読みやすい。ここで立体化しても階層は増えず、面の数だけが増える。

## flatness が不十分だと考えられる場面（人による評価待ち）

平坦な面だけでは成立しなかったと考えられる画面。幾何の観測事実と編集上の仮説を分けて置き、判断は人による評価が出せるまで保留する。

- `https://rebuildup.dev/` は 6 セクションが同じ 96px padding で積まれ、区切りは 192px の余白だけである。
- 画面最大の type は h2 の 32px で、視線の止まり場 となるのは 141x96px の SVG motif だけである。
- セクションの幾何が 5 回そのまま繰り返されるので、セクション間の差が数値で出ない。

比較対象は `https://rebuildup.dev/`（`case-home`）。

- 6 セクションが同じ 96px padding で積まれ、区切りは 192px の余白だけ。
- 画面最大の type は h2 の 32px。視線の止まり場 となるのは 141x96px の SVG motif だけ。
- セクションの幾何が 5 回そのまま繰り返される（heading 307px + body 613px）。
- 密度は 0.0996 要素/px で、ポートフォリオ（0.0695 要素/px）より約 1.43 倍。

**観測事実**: 6 セクションの幾何が同一で、区切りと type size の差が数値として現れない。

**編集上の仮説（未検証）**: 「平坦であること」自体は問題ではなく、**すべての section が同じ深さである**ことが
重要度の伝播を弱めている可能性がある。ただし、この仮説は幾何の計測値だけでは検証できない —
「重要度が伝わらない」「flatness が不十分」という視覚評価を確定させるには、比較画像における視線誘導の
具体的な根拠（視線が止まる位置・順序）または人による評価が要る。どちらもこの Issue では実施していない。
したがって**判断を保留**し、§採用と保留の改善候補（すべて保留）として記録する。

改善候補は「採用と保留」節に、観測値ごとに記録する（すべて保留）。

### 判断

- **`decision-home-candidates-deferred`**（保留）— ホームの beat 改善は候補として記録し、今回は適用しない
  - 理由: 適用すると公開画面のスタイルが変わる。Issue #520 はレビューであり、再設計を含まない。候補は measurement に紐づけて記録する。

## 流行り UI への平均化を避ける

「よく見る UI の形」に寄せて観測を壊さないための判断記録。何を記述しないか。

- 影・グラデーション・glass・角丸カード・影付きボタンの追加は採用しない。
- 観測の記述（平坦であることを印象ではなく数値として書く）は採用する。

何を「しない」と決めたか（descriptive でないもの）:

- 「陰のついた影」「ガラスの面」「角丸カード」という流行りの形を足さない。
- 他の作品の visual language への追随を、観測の根拠にしない。
- 数値で観測できたことは数値で書く（印象で書かない）。

### 判断

- **`decision-no-trend-decorations`**（保留）— shadow / gradient / glass などの装飾を足さない
  - 理由: 2 画面の観測では立体の手がかりは既に box-shadow 1 / gradient 0 / background-image 0 である。装飾は階層を直さず、面の数だけを増やす。
- **`decision-describe-dont-copy`**（採用）— 他の作品の追随ではなく観測した数値で書く
  - 理由: レビューは Miro の自己評価を公開面への要求に変換しない。数値で書けば、同じ画面が誰に読まれても検証できる。

## 本人の自己否定を恒久的なブランド要件にしない

Miro 側の自己評価（作品 > 世界観 > シンプル / 平面的 / 独自性への自己評価）を、個人の断定プロフィールとして公開しない。

- Miro の付箋にはアクセスできない。Issue 本文が引用する見出し語だけを典拠として扱う。
- 「独自の何かは無い」という自己評価は、対話的な所感であり恒久的な要件ではない。
- ブランド要件は「editorial token が出す視覚言語」であり、「平坦であること」ではない。

要件として残すのは次だけである:

- 視覚言語は `src/editorial/` の token と primitive が出す。
- 画面の階層は実測値で説明できる状態にある。
- 個人の断定プロフィールとして、本人の自己評価を公開しない。

### 判断

- **`decision-no-self-negation-as-requirement`**（採用）— 自己否定を視覚言語の要件に書き換えない
  - 理由: 自己評価を要件に固定すると、確認できない所感が恒久的な契約になる。token と実測値で要件を書けば、観測と実装のどちらかが間違っているときに指摘できる。
- **`decision-miro-detail-unverified`**（保留）— Miro の付箋の詳細は未確認（owner 確認待ち）とする
  - 理由: agent は Miro にアクセスできない。Issue 本文に引用された見出し語以外の情報は、作成しない。

## 採用と保留

この Issue で採用するもの、保留するもの、そして保留の理由のまとめ。

- 採用は「観測の記述」「preview」「parity 検証」「再現手順」の 4 点。
- 保留は「改善候補 4 件」「装飾の追加」「Miro の詳細」で、いずれも公開画面のスタイルを変えない。
- 本 Issue は大幅な全サイト再設計を含めない。

### 改善候補（すべて保留）

- **`candidate-portfolio-type-step`**（保留）— 文字サイズ段の中間段（32px）を 1 つ戻す
  - 根拠: 実際の文字サイズ段 12 / 14 / 16 / 18 / 24 / 64 px（32px の段は無い）
  - 提案: 作品一覧のように中核となるセクションに 32px の見出し段を 1 つ置き、h1 64px と作品タイトル 24px の間に中間段を戻す。
  - 対象画面: `case-portfolio`
- **`candidate-portfolio-title-gap`**（保留）— h1 と最初の作品タイトルまでの 469px を詰める
  - 根拠: h1 から最初の作品タイトルまで 469px
  - 提案: 作品一覧の lead を 1 段、先に 1 つの beat を置いて、h1 と 1 件目のあいだの空白を減らす。
  - 対象画面: `case-portfolio`
- **`candidate-home-section-beat`**（保留）— 同一の 96px beat を全セクションに適用し続ける
  - 根拠: セクション間の余白 192px（本文セクション間）
  - 提案: 静かなセクション（アクセスカウンタ等）と主要なセクション（状態・反応）で beat を分ける。beat の管理条例は owner 決定が要る。
  - 対象画面: `case-home`
- **`candidate-home-motif-weight`**（保留）— motif（SiteMark）を画面唯一の視線の止まり場 にする
  - 根拠: h1 は SiteMark の SVG 141x96px。画面最大の type は h2 の 32px
  - 提案: hero の motif と type の関係を組み直す。type と motif が同じ段落で同列に立つので、hero の beat を調整して motif が単独で読めるようにする。
  - 対象画面: `case-home`

### この Issue で採用するもの

- 観測値の記述（本書）と、その再現手順（`scripts/measure-flat-vs-depth.mjs`）。
- 2 画面の構成を再現した preview（模式図。実画面のスクリーンショットではない）。
- 本書と preview の一致を検証する parity 検証。

### この Issue で行わないこと

- 公開画面のスタイル変更（改善候補の適用は owner 判断）。
- 全サイト再設計。
- 公開日本語 copy の変更。

### 判断

- **`decision-adopt-review-only`**（採用）— この Issue は文書 + preview + 検証に限定する
  - 理由: Issue #520 の完了条件は「単独 fixture / Storybook / 文書 preview で完結する」ことである。

## 未確認（owner 確認待ち）

この Issue で確認できなかった事項。推測で埋めない。

- Miro の付箋の内容そのもの（Issue 本文の引用以外の情報）は未確認（owner 確認待ち）。
- 本番が:main のリリース版を表示している点は観測済み。repository のリリースブランチとの差分は未確認（owner 確認待ち）。
- 改善候補を適用すべきかどうかは owner の判断（保留）。

観測時点の記録（参考）: 本番は 0.7.0 を表示し、repository 側は release-0-8-0 ブランチであった。上記の記載は版番号そのものではなく「本番と repository の差があるか」だけを記録している。

以下は owner に確認するまで確定しない。

