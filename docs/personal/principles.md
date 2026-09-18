# Principles

> Status: **Canonical personal principles**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self

この文書は、my-web-2026 の architecture / development 判断を行うときの上位原則を記録する。特定 framework の best practice 集ではなく、私が設計を評価するときの基準である。

## Debt-driven architecture

私にとって architecture は、コードを綺麗に分類することではなく、**存在によって必ず発生する債務を、どこが引き受けるか決めること**である。

ここでいう debt は「悪い実装」だけを指さない。機能やデータが存在すれば、変更する責任、正しさを守る責任、依存を維持する責任、検証する責任、不要になったとき撤去する責任が生まれる。必要な機能であっても debt は発生する。

したがって目標は zero debt ではない。目標は **explicitly owned debt** である。

architecture は概ね次の三つで評価する。

1. **Debt allocation** — その責任をどこが引き受けているか
2. **Dependency direction** — どの責任がどの責任を知ってよいか
3. **Mechanical verification** — 境界や invariant を機械的に壊れにくくできるか

directory path はその結果として現れる projection であって、architecture の定義そのものではない。

## Debt Identity before DRY

同じ形のコードが二つあることと、同じ debt であることは別である。

私は DRY より **Debt Identity** を優先する。同一 obligation とみなせるのは、少なくとも governing invariant / authority / lifecycle / expected evolution が同じ方向を向いているときである。

見た目や implementation が同じでも、別々に変わる責任なら分けたままでよい。逆に implementation が異なっていても、同じ責任を守るために一緒に変わるなら shared obligation の可能性がある。

duplication は shared debt の **evidence** にはなるが、proof ではない。

## Co-change is evidence, not definition

「何が変わったとき一緒に変わるか」は重要だが、それだけで boundary を定義しない。

co-change は仮説を検証する観測手段である。偶然同じ release で変更されたもの、同じ UI に表示されるもの、同じ framework API を使うものを、自動的に同一 obligation としない。

boundary の identity は governing invariant / authority / lifecycle / expected evolution で決め、change history はその判断を支持または反証する evidence として使う。

## Six questions for an obligation boundary

新しい境界を作るときは、少なくとも次の六つを答える。

1. **Obligation** — 何を正しく保つ責任なのか。
2. **Governing identity** — invariant / authority / lifecycle は何か。
3. **Change evidence** — 何が変化圧力になり、どの co-change が観測されているか。
4. **Owner / authority** — 誰という人物ではなく、どの decision power がその判断を持つか。
5. **Dependency direction** — 上流と下流は何を知ってよく、何を知らないべきか。
6. **Boundary value** — 分離することで blast radius、交換可能性、検証可能性、ownership のどれが実際に改善するか。

答えられない項目がある場合は、無理に抽象化せず「未観測」として残す。

## Pluralism over forced unification

一つの project に複数の visual language、interaction model、data shape、implementation strategy が存在してよい。

「共通 component にできる」「同じ型にできる」「同じ framework を使っている」という理由だけでは統合しない。それぞれが異なる invariant や authority を持つなら、plural なままの方が正しい。

統合は美しさのために行うのではなく、同一 debt を二重に所有していることが観測されたときに行う。

## Promotion and demotion are symmetric

architecture の boundary は一方向にしか成長しないものではない。

capability-local な responsibility が複数 capability から必要になり、identity が一致することを観測できたら cross-capability obligation に **promotion** する。

逆に shared として存在していたものでも、実際には一つの capability しか使わなくなった、または authority が分かれたなら **demotion** する。

folder layout や public API は、この移動を不必要に困難にしない。

## YAGNI on abstraction

将来必要そうだからという理由だけで port / adapter / interface / shared abstraction を先に作らない。

最初は直接依存でもよい。二つ目の backend、二つ目の consumer、mock 以外の alternative などが実際に現れたとき、そこで abstraction 自体を新しい obligation として評価する。

YAGNI は「設計しない」という意味ではない。**観測前の debt を増やさない** ための設計判断である。

## Cross-cutting concerns are real obligations

telemetry、authorization、locale、feature flags、accessibility、rate limit などを、便利だからという理由で雑な shared folder に集めない。

複数 capability にまたがるなら、それぞれ独立した policy obligation として authority と invariant を持たせる。逆に一つの capability にしか効かない policy は、その capability 内に閉じる。

cross-cutting であることは global singleton であることを意味しない。

## Framework structures are foreign boundaries

routes、migrations、Storybook configuration、generated files、public assets など、framework / toolchain が物理配置を強制する領域は存在する。

それを architecture の例外として隠さない。**foreign boundary** として明示し、project-side obligation と adapter の接点として扱う。

framework の directory convention が business boundary を決めるのではなく、必要な obligation が foreign boundary に投影される。

## Forward-looking, but evidence-backed

ecosystem convention や framework の流儀は重要な evidence だが、project context より上位ではない。

一方で「独自 architecture」を理由に、将来を想像して巨大な抽象を先に作ることもしない。未来に耐える設計とは、未来を予言することではなく、**新しい obligation を追加・promotion・demotion できる余地を残すこと**だと考える。

unknown は unknown のまま記録し、最小の vertical slice から観測する。

## Verification is part of architecture

boundary は文書だけでは弱い。import rule、type、contract test、quality gate、CI、runtime smoke などで検証できる invariant は、可能な限り mechanical verification に落とす。

ただし test が green であることは設計が正しいことの証明ではない。test は定義した contract が守られている evidence であり、contract 自体が正しいかは別に評価する。

## Architecture documents describe truth, not aspiration

architecture doc は理想図ではなく、現在どこに responsibility と debt があるかを示す地図である。

Stable / Migrating / Legacy Debt / Unknown のような不完全な状態も隠さない。現在の implementation が原則に追いついていない場合は、その差分を debt として可視化する。

原則に実装を無理に合わせるのではなく、観測によって原則が間違っていたと分かった場合は、原則側も修正する。
