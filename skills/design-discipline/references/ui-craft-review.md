# UI craft review (conditional)

既存UIの外観改善、または新規UIの表層が既定テンプレートに流れたと疑われる場合に使う。デザインの目的・情報の選択・体験構造の決定は親Skillの責務であり、**このreviewはそれらの代替ではない**。正当な理由のない全面redesignも行わない。

## 1. Inspect what is actually delivered

対象の画面を、可能ならbrowserで実表示・操作する。sourceだけから完成した見た目を断定しない。対象画面・viewport・state、既存design system / brand、優先されるtaskと利用状況を押さえる。

問題を挙げるときは、次を一件ずつ結び付ける。

- **Where:** 具体的な画面・component・state
- **Observation:** 見える違和感（事実）と、問題かもしれないという仮説を分ける
- **Impact:** 理解・比較・操作・信頼・表現に対する影響
- **Cause:** content/structure、visual treatment、implementation drift、または未確定
- **Disposition:** 修正する、検証する、意図的に維持する、のいずれか

監査観点は必要な範囲だけ選ぶ。

- **Meaning:** 他の製品にも当てはまるcopy、根拠不明のclaim、productを示さないdecorative visual、内部featureの単純列挙
- **Attention:** 目立つ要素同士の競合、重要情報の埋没、stateとsemantic priorityが一致しない強調
- **Geometry:** 不揃いなedge、grouping、spacing relationship、density、scroll/overflow、responsive collapse
- **System coherence:** 意味が同じなのに異なるtype / color / radius / icon treatment、用途が異なるのに同じtreatment
- **Motion and interaction:** 理由のない反復運動、feedback不足、操作を妨げるanimation、focusやreduced-motionの欠落

特定のgradient、emoji、font、pill、影、カード数だけで「悪い」と判定しない。それらが意図・ブランド・読みやすさ・操作・表現と衝突するかで判断する。

## 2. Choose scope before editing

- **No material defect:** 変更せず、発見がなかったことを伝える
- **Local defect:** 問題箇所のみ直す。既存の良いdirection・component family・情報構造を維持する
- **Repeated surface debt:** 原因となるshared pattern / token / componentから是正する。画面単位の対症療法を繰り返さない
- **Upstream failure:** 必要な情報が欠落、feature配置が目的を阻害、表示順が誤解を生む場合は、見た目を磨く前に親SkillのPurpose / Select / Structureへ戻る。仕様変更になるなら勝手に実行しない

既存のbrand、実データ、ユーザーが確定した仕様は入力制約である。好みの統一を優先して改変しない。AIっぽさを消すために別の無個性なテンプレートへ移すことも避ける。

## 3. Give the repair a product-specific direction

どんな表現がこのproductの内容・利用環境・素材に由来するか、観察された根拠を説明する。特定のstyle wordだけでは済ませない。

- richなvisualが本当に必要かを判断する。情報密度の高いtool UIではvisualを増やすより実際のdata/stateを明確に見せた方がよいこともある
- 視覚的な個性は、固有のcontent・interaction・material・type・rhythmに現れてよい。印象的なheroや単一accentを義務化しない
- 内容と離れた装飾を減らす際も、表現の楽しさ・文化的な意味・承認済みbrand表現を無条件に削らない

視覚方向の確定や永続化が必要な場合はdesign-intentを使う。

## 4. Repair in causal order, then compare

必要な箇所だけ修正し、影響が広い関係から狭い表現へ進む。順序は依存関係に従い、固定の9工程や全項目修正を強制しない。

1. 誤ったcontent / hierarchy / layout relationがあれば先に扱う。meaningに関わる変更は親Skillの判断へ戻す
2. shared spacing / type / color semantics / iconsの不整合を、既存tokenやcomponentに沿って直す
3. productに根拠のあるvisual、状態表示、motionを必要な場所だけ調整する
4. 同じviewport / theme / stateでbefore/afterを再表示する。直した項目だけでなく、副作用とscreen全体のattentionを確認する

確認対象は、実コンテンツ、長い文字列、狭い表示、hover/focus/disabled/error、contrast、scroll、interaction、motionなどの**変更で影響するもの**。静止画だけで動的挙動まで検証したことにしない。客観的な欠陥には機械的検査を使えても、独自性や魅力をlint結果から推定しない。

## Responsibility and source

- 上流の目的・情報選択・体験: design-discipline
- 具体的なvisual brief: design-intent
- 文言、階層、tokens、motion、accessibilityの専門判断: content-design / visual-hierarchy / token-audit / motion-review / accessibility-audit等
- 本文は[unslop](https://github.com/heydamir/unslop)（Damir Sokolovsky、CC BY 4.0）の現物監査・製品固有性・改善段階化の着眼点を参照して再構成した。原文のチェックリスト、スタイル禁止、数値、コード、素材は移植していない
