# Composition Review — 原則カード

完成した Web 画面・ページ全体の構図を監査するための原則カード集。各カードは **違反となる状態 / 観察可能な特徴 / 検出方法 / 正当な例外 / 誤検出の可能性 / 検証 fixture の考え方** を定義する。

検出方法の表記:

- **rendered**: screenshot・実際の表示を見る
- **geometry**: DOM の bounding box・computed style・layout 計測を見る
- **code**: source・class・構造を読む（rendered の補助。単独で構図を断定しない）

原則の多くは複合的に働く。1 つの見た目の問題が複数カードにまたがることがあるため、finding は「最も直接的な原則カード」に紐付け、関連カードを併記する。

---

## 1. Gestalt grouping（proximity / similarity / common region / figure-ground / continuity / closure）

- **違反となる状態**: 関連要素が離れ、無関係な要素が近接している。色や形の類似が機能の違いを打ち消している。背景と前景の区別がつかず、どこがコンテンツでどこが chrome か読めない。視線の流れ（continuity）を妨げる配置。欠けた形状が閉じない（closure の失敗）
- **観察可能な特徴**: 見出しとその本文の距離が、前節の本文との距離より大きい。カード内の余白とカード間の余白が逆転している。ボタン群の中に無関係な操作が混ざる。画像とキャプション・ラベルの結び付きが色だけに依存する
- **検出方法**: rendered（第一印象でのグルーピング）+ geometry（要素間距離の比較）。code は DOM の入れ子構造が grouping 意図を示す場合の補助
- **正当な例外**: 意図的に関連を弱める editorial な配置、没入型の full-bleed 表現、ゲーム・アート的な知覚的錯誤を狙う作品
- **誤検出の可能性**: 高い。proximity は他の cue（similarity・common region）を上書きしうるため、「近い＝関連」と機械判定すると border・背景で既に grouping 済みの要素を誤検出する。実際の知覚は rendered でしか確かめられない
- **fixture の考え方**: (a) 見出し-本文間距離 < 前節本文-見出し間距離の正常系、(b) 逆転した異常系、(c) common region（card 背景）だけで grouping している系、の 3 パターンで判定器を試す

## 2. CRAP をページ全体へ適用

CRAP（Contrast / Repetition / Alignment / Proximity、Robin Williams『The Non-Designer's Design Book』）を component ではなくページ単位で見る。

- **違反となる状態**: ページ内で「同じ役割の要素」が異なる扱いを受けている（repetition の破綻）。弱い対比の羅列で何も強調されない（contrast の失敗）。alignment の例外が意図を持たない。proximity の誤用（§1 と同根）
- **観察可能な特徴**: 同種カードの余白・角丸・影がページ内で揺れる。section 間と section 内の余白の比率が一貫しない。「揃っていない」ことで目立つ要素が、重要度と無関係
- **検出方法**: geometry（同種要素の computed style・位置の分散）+ rendered（揃いの知覚）
- **正当な例外**: 意図的な variation（繰り返しの中の変化で rhythm を作る）、A/B テスト中の暫定差異、legacy 領域の段階的移行
- **誤検出の可能性**: 中。repetition の「同じ」は pixel 一致ではなく role の一致。見た目が違っても役割が同じなら repetition 違反ではない（§10 と表裏）
- **fixture の考え方**: 同一 role の要素を 3 つ以上並べた fixture で、style 分散が閾値を超えるかを見る。閾値は project の scale に依存するため絶対値を固定しない

## 3. Visual hierarchy / emphasis / focal point

- **違反となる状態**: 最初に目に入るものが意図した主役でない。重要度の異なる要素が同じ視覚的重みを持つ。階層が font-size の差だけで作られ、位置・面積・余白・密度の手掛かりがない
- **観察可能な特徴**: blur test（画面をぼかして見る）で主役が浮かばない。全要素が同じサイズ・同じ色・同じ余白。見出しが本文と同じ重さ。focal point が複数あって競合する
- **検出方法**: rendered（ぼかし・縮小・一時停止した first-glance）+ geometry（面積・位置・contrast の定量比較）
- **正当な例外**: 階層を意図的に平坦化する design（例: 均質な grid の portfolio index）、没入型の narrative scroll
- **誤検出の可能性**: 中。「主役」は IA と意図に依存する。意図が読み取れない場合は断定しない（`visual-hierarchy` は設計側、ここでは完成形の判定のみ）
- **fixture の考え方**: 主役が明確な fixture と、全要素同重みの fixture を用意し、「first glance で主役を特定できるか」を人間または独立 reviewer に問う形で較正する

## 4. Grid / asymmetry / composition

- **違反となる状態**: 要素が共有する座標系に乗っていない。あるいは全要素が同一 column pattern に閉じ込められ、画面が単調。意図的非対称に見えるが、実際には alignment の規則が存在しない無秩序
- **観察可能な特徴**: 端が揃わない・中央揃えと左揃えが混在する・余白が不規則。逆に「非対称」を名乗るが、よく見ると何も揃っていない。breakout（grid からの逸脱）が規則なく散在する
- **検出方法**: geometry（edge・baseline・margin の座標系への snap 度）+ rendered（全体の秩序感）
- **正当な例外**: editorial な自由配置、poster 的・芸術的な構図、brutalist な意図的破綻、grid をあえて見せない design
- **誤検出の可能性**: 高い。「揃っていない」は欠陥ではなく、揃える規則が読めないことが欠陥。非対称か無秩序かは **繰り返される関係**（§3 of design-principles: relationship over isolated values）があるかで判定する
- **fixture の考え方**: (a) 明確な grid に乗る系、(b) 規則ある非対称系（同じ offset が繰り返される）、(c) 無秩序系、の 3 分類で判定を較正する

## 5. Typography / measure / scale

- **違反となる状態**: 行長（measure）が読みにくい範囲（目安 45–90 chars、Practical Typography）を外れる。type scale がなく、サイズの種類が多すぎる/少なすぎる。行間・段落間が本文の読みやすさを損なう。responsive で measure が崩壊する
- **観察可能な特徴**: 極端に長い行または 1 行数文字の細切れ。見出しと本文のサイズ差が小さすぎる/大きすぎる。同じ役割のテキストがページ内で異なる size・leading を持つ
- **検出方法**: geometry（computed font-size・line-height・コンテナ幅から measure を推定）+ rendered（実際の読み心地）
- **正当な例外**: display typography（ヒーロー見出し等、measure の制約を受けない大サイズ）、詩・歌詞など行長が表現の一部、縦書き（`vertical-writing` の領分）
- **誤検出の可能性**: 中。measure は font-size とコンテナ幅の組み合わせで決まるため、片方だけ見て判定すると誤る。CJK は alphabet test が使えないため文字数での近似が必要
- **fixture の考え方**: measure が範囲内/外の本文ブロックと、responsive で measure が変わる fixture を用意する。実際のフォント・言語で測る

## 6. Color / surface composition / contrast

- **違反となる状態**: 色の役割が一貫しない（同じ意味に別の色、同じ色に別の意味）。surface（背景・card・overlay）の階層が border だけに依存し、面のトーン差がない。重要な要素の contrast が周囲に埋もれる
- **観察可能な特徴**: 同種の状態・カテゴリがページ内で異なる色相・彩度。背景と前景の面積比が極端。dark section と light section の切り替えが不規則
- **検出方法**: rendered（面と色の知覚）+ geometry/computed style（実際の色値の分布。WCAG contrast は `accessibility-audit` の領分であり、ここでは構図上の役割の一貫性を見る）
- **正当な例外**: ブランドの意図的な多色表現、季節・キャンペーンごとの palette 変更、写真・イラスト内の色（UI 色ではない）
- **誤検出の可能性**: 中。「色が多い」は欠陥ではなく、役割の対応が取れていないことが欠陥。token の遵守は `design-system-enforcement` の領分
- **fixture の考え方**: 同じ semantic role に異なる色が割り当てられた fixture と、一貫した fixture を比較する

## 7. White space / density / rhythm

- **違反となる状態**: 余白が均一で rhythm がない（全部同じ間隔＝機械的）。密度が内容の重要度と対応しない（重要情報が詰まり、補足が散らかる）。余白が「埋めるべき空白」として扱われ、要素が不自然に引き伸ばされる
- **観察可能な特徴**: section 間・要素間・行間の余白がすべて同じ単位。カード内の余白よりカード間の余白が小さい（§1 と同根）。スクロールしても「呼吸」の変化がない
- **検出方法**: geometry（余白の分布・比率）+ rendered（密度の知覚・リズム）
- **正当な例外**: データ密度が求められる dashboard、印刷物的な compact layout、意図的な詰め込み（brutalism・terminal aesthetic）
- **誤検出の可能性**: 中。`information-density` が密度の mode を設計する側であり、ここでは完成形でその mode が一貫しているかを見る。「広い余白＝良い」ではない
- **fixture の考え方**: (a) rhythm のある余白配分、(b) 均一余白、(c) 過密、の 3 系で「構造が読めるか」を比較する

## 8. Image / media / art direction

- **違反となる状態**: 画像の crop が被写体・focal point を切る。text と画像の関係が読みやすさを損なう（画像上の文字が背景と同化、画像が本文の measure を破壊）。responsive で画像の構図が再編成されず、重要部分が切れる。画像が「飾り」として置かれ、内容と無関係
- **観察可能な特徴**: 被写体の顔・製品の中心が crop で欠ける。画像上のオーバーレイ文字が読めない。mobile で hero 画像が縦長に引き伸ばされ、被写体が消える。画像とキャプション・ラベルの結び付きが弱い
- **検出方法**: rendered（実際の crop・focal point・text との関係）+ geometry（画像コンテナと object-fit/object-position の結果）+ code（`srcset`/`sizes`/`picture` の有無は art direction が実装されているかの手がかりだが、実際の crop は rendered で見る）
- **正当な例外**: abstract / texture として使う画像（focal point を持たない）、意図的な crop による緊張感、ユーザー upload 画像（制御不能）
- **誤検出の可能性**: 中。focal point は画像内容に依存するため機械判定は困難。「切れている」は欠陥ではなく、被写体・意図が失われていることが欠陥
- **fixture の考え方**: (a) 被写体が中央の画像を `object-fit: cover` で crop する fixture、(b) `object-position` で focal point を保持する fixture、(c) mobile で aspect ratio が変わる fixture、で判定を較正する

## 9. Balance / proportion / visual weight

- **違反となる状態**: 視覚的重みが片側に偏り、画面が「傾いて」見える。要素の面積・contrast・密度の合計が左右（または上下）で不均衡。ただし非対称 balance が意図的に取られている場合は除く
- **観察可能な特徴**: 大きな画像や濃い色面が一方に偏る。テキスト量が左右で大きく異なるのに視覚的重みの調整がない。重心が画面外にあるように見える
- **検出方法**: rendered（全体の安定感）+ geometry（面積・contrast・位置の分布から重心を推定）
- **正当な例外**: 動的・エネルギッシュな非対称 balance（asymmetrical balance は欠陥ではない）、radial balance、意図的な tension を狙う構図
- **誤検出の可能性**: 高い。balance は数学的対称ではなく知覚的安定。DOM の左右対称性を機械測定しても rendered の balance は分からない
- **fixture の考え方**: 対称・非対称 balance・意図的 imbalance の 3 fixture で「安定して見えるか」の人間判定と機械推定を比較し、較正する

## 10. Repetition / variation / unity

- **違反となる状態**: 同じ役割の要素がページ内で異なる style を持つ（unity の破綻）。逆にすべてが同じで variation がなく単調。repetition のパターンが途中で変わり、ページが「別々のサイトの寄せ集め」に見える
- **観察可能な特徴**: カードの装飾・角丸・余白が section ごとに変わる。ボタンの style が用途なく複数ある。同じ見出し階層がページ内で異なる typography を持つ
- **検出方法**: geometry（同 role 要素の style 分散）+ rendered（全体の統一感）
- **正当な例外**: 意図的な variation（繰り返しの中の変化で rhythm・強調を作る）、page ごとの theme 差（blog の個別記事等）、legacy 領域の段階的統一
- **誤検出の可能性**: 中。`design-system-enforcement` が契約の静的強制を担うため、ここでは「契約にないが構図上の統一感を損なう variation」を見る。契約違反はそちらへ渡す
- **fixture の考え方**: 同じ component が 3 箇所以上で異なる余白・装飾を持つ fixture と、一貫した fixture を比較する

## 11. Responsive composition

- **違反となる状態**: desktop の構図をそのまま縦に積んだだけで、mobile で構図が再構成されていない。breakpoint を跨いでも同じ要素順・同じ面積比が保たれ、mobile で読めない/操作しにくい。画像・ナビ・CTA の優先順位が mobile で変わらない
- **観察可能な特徴**: desktop で 3 カラムだったものが mobile でただ縦積み。hero が mobile で画面の大半を占め、コンテンツが押し下げられる。ナビが mobile で隠れすぎる/出すぎる。横スクロールや意図しない折り返し
- **検出方法**: rendered（複数 viewport での実際の構図）+ geometry（breakpoint ごとの layout 計測）
- **正当な例外**: コンテンツが本質的に linear（記事本文等）、table のような横幅を必要とする要素、intentional に desktop 優先の design
- **誤検出の可能性**: 中。「縦積み」は欠陥ではなく、mobile での優先順位の再構成がないことが欠陥。単純に column 数が減ること自体は正常な responsive 対応
- **fixture の考え方**: 同じコンテンツを desktop/tablet/mobile の 3 viewport で描画し、各 viewport で「最初に目に入るもの」「操作の主役」が意図通りかを確認する fixture を用意する

## 12. Information architecture と視覚的表現の対応

- **違反となる状態**: IA 上の重要度と視覚的重みが対応しない。ナビゲーションの構造と page の視覚的構造が一致しない。コンテンツのグルーピングが IA のグルーピングと異なる。ユーザーが「どこに何があるか」を視覚から予測できない
- **観察可能な特徴**: 一次ナビと二次ナビの視覚的差が小さい。カテゴリ間の関係が視覚的に表現されない。検索・フィルタなどの発見手段が視覚的に埋もれる。breadcrumb 的な位置手掛かりがない
- **検出方法**: rendered（視覚的階層と IA の対応）+ code（見出し構造・landmark・nav の DOM 対応）
- **正当な例外**: 探索的・遊び心のある IA（ゲーム・アートサイト）、IA 自体が未確定の段階
- **誤検出の可能性**: 高い。IA は project の設計判断であり、視覚からは「あるべき IA」が分からない。Spec・sitemap・user task を確認してから判定する
- **fixture の考え方**: 明確な IA を持つ fixture（例: product → category → detail）と、IA が曖昧な fixture を用意し、前者でのみ「視覚と IA の対応」を採点する

## 13. Accessibility / 認知負荷

- **違反となる状態**: 視覚的複雑さが認知負荷を過剰にする。重要な操作が視覚的に埋もれ、発見しにくい。色・形・位置だけに依存した情報伝達（`cognitive-accessibility` / `accessibility-audit` の詳細領分）。アニメーション・parallax が構図の把握を妨げる
- **観察可能な特徴**: 一画面に競合する focal point が複数。重要な CTA が他の要素と同じ重み。テキストと背景の contrast が構図上の階層を損なう（WCAG 適合は別 Skill）。動きが止まらず構図が安定しない
- **検出方法**: rendered（実際の認知負荷・注意の分散）+ code（`prefers-reduced-motion`・focus 順・aria の存在は補助）
- **正当な例外**: 没入型の体験（ゲーム・art installation）、専門家向けの高密度 tool（訓練されたユーザーが対象）
- **誤検出の可能性**: 高い。「複雑」は欠陥ではなく、対象ユーザーとタスクに対して過剰かどうかが問題。WCAG・認知アクセシビリティの適合判定は専門 Skill に委ね、ここでは構図が認知負荷を増幅していないかだけを見る
- **fixture の考え方**: (a) focal point が明確で認知負荷が低い fixture、(b) 競合する focal point が複数ある fixture、で「初見で目的を理解できるか」を比較する

---

## 使い方の注意

- これらのカードは **構図の監査** であり、個々の component の設計・token の遵守・interaction の良し悪しを判定しない
- 各カードの「正当な例外」を必ず確認してから finding にする。例外に該当する場合は finding ではなく `note` として記録する
- 「検出方法」が rendered のみの原則を code だけで判定しない。逆に code でしか分からない情報（DOM 順・aria）を rendered のみで推測しない
- この Skill の結果は「構造的欠陥がある/ない」の判定であり、「デザインが良い/悪い」の採点ではない
