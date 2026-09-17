# Principles

> Status: **Draft** — owner 自身が本文を埋めるまで Draft のまま
> Visibility: public (MIT)
> Audience: contributor, agent, future-self

owner が表明してきた architectural / development principles。 ADR-0008 / ADR-0009 の思想的根拠として参照される。 ここに書かれた原則は code や architecture よりも上位の拘束力を持つ (code が原則と矛盾する場合は原則側を修正する)。

## Debt-driven design

> TODO — 自身の言葉で書く。 以下のような核を持つ:
> - path は obligation graph の projection に過ぎない
> - 種別名 / 技術的名称 / 一般名称は債務として成立しない
> - 債務境界は change reason ではなく governing invariant / authority / lifecycle で定義される

## Pluralism over forced unification

> TODO — 自身の言葉で書く。 例:
> - 複数の visual language が並存してよい
> - 共通化は観測された co-change が同じ authority / invariant / lifecycle / expected evolution を持つことが確認されてから
> - DRY < Debt Identity — duplication は shared obligation の **証拠** であり **証明** ではない

## Forward-looking original architecture

> TODO — 自身の言葉で書く。 例:
> - framework の流儀に従属しない
> - 既存の ecosystem convention より project の文脈を優先する
> - 未来に出てくる obligation を吸収できる形を選ぶ

## 6-criterion obligation boundary

> TODO — 自身の言葉で書く。 6 つの基準:
> 1. Obligation
> 2. Governing invariant / Authority / Lifecycle
> 3. Change reason (co-change は証拠であって定義ではない)
> 4. Owner (= authority であり人ではない)
> 5. Dependency direction
> 6. Boundary value (独立させることの実利的価値)

## Promotion and demotion

> TODO — 自身の言葉で書く。 例:
> - capability-scoped obligation は観測によって cross-capability に昇格できる
> - 逆に降格もできる
> - どちらの方向も path convention で壊れない

## YAGNI on abstraction

> TODO — 自身の言葉で書く。 例:
> - 抽象 (interface / port / adapter) は 2 つ目の実装が出現するまで作らない
> - 直接依存から始めて、 2 つ目の backend / mock / alternative が現れた時点で abstraction obligation を昇格させる
> - DI よりも YAGNI を優先する場面でも、 観測されれば DI に切り替える

## Cross-cutting as independent obligations

> TODO — 自身の言葉で書く。 例:
> - telemetry / authorization / locale / feature-flags / accessibility などは `shared/` に逃げない
> - それぞれ独立 obligation として成立させる
> - capability 固有の policy は home/analytics.ts のような形で capability 内に閉じる

## Framework-imposed structures as foreign boundary

> TODO — 自身の言葉で書く。 例:
> - `routes/`, `.storybook/`, `migrations/`, `public/`, generated, dist は framework / toolchain 都合
> - これらは思想の例外ではなく、 toolchain への foreign boundary obligation として承認する

## Co-change is evidence, not definition

> TODO — 自身の言葉で書く。 例:
> - 「何が変わったとき一緒に変わるか」は債務を定義しない、 検証する手段
> - pricing / checkout / analytics が同じ release で co-change しても、 それぞれ別 authority なら別 obligation
> - 同一 obligation の判定基準は co-change の観測ではなく、 governing invariant / authority / lifecycle / expected evolution の共有

## Notes

> TODO — 他の原則、 上記以外の owner 固有の立場、 ADR との対応表
