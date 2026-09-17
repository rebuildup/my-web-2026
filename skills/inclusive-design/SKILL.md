---
name: inclusive-design
description: >
  Use when designing or revising a product, service, interface, or 2D artifact to identify
  exclusion created by assumptions about people, tasks, environments, or abilities, then
  create multiple viable ways to participate using evidence from people with relevant lived experience.
---

# Inclusive Design

Inclusive design を「全員向けに薄く平均化すること」や WCAG checklist として扱わない。

**Recognize exclusion → Learn from diversity → Redesign participation → Extend carefully → Verify with people + standards** の順で進める。

この Skill が扱うのは、product / task / environment が要求する能力と実際の人の多様性の間に生じる **mismatch / exclusion** である。

## When to use

次のようなときに使う。

- 新しい product / service / UI の主要 task path を設計するとき
- existing flow で「一部の人だけ完了しにくい」兆候があるとき
- interaction が特定の視覚・聴覚・発話・操作・認知・言語能力を暗黙に要求しているとき
- one-size-fits-all の interaction を複数の participation path へ再設計するとき
- assistive technology / adaptation / environmental constraint を product assumptions に含めるとき
- accessibility compliance だけでは説明できない real-world barrier を設計段階から減らすとき

既存 interface の WCAG / semantic / keyboard / contrast 等の broad audit が主目的なら `accessibility-audit` を使う。
memory / attention / interruption / resumption の詳細設計が主目的なら `cognitive-accessibility` を使う。

## Workflow

1. current product / artifact の主要 task と success condition を確認する。
2. target user を demographic だけでなく functional / situational conditions で記述する。
3. task 各段階で product が要求している能力・環境・strategy を観察する。
4. exclusion point を「人の欠陥」ではなく interaction mismatch として記述する。
5. relevant な lived experience を持つ人の evidence と primary references を確認する。
6. specific exclusion を解く participation path を設計する。
7. その解決が他の人にも有効かを検討する。ただし元の accommodation を弱めない。
8. rendered / interactive artifact で end-to-end task を確認する。
9. user evaluation と standards-based verification の両方を実施する。

## Observe

reference や current product を見るとき、以下を観察する。

### Participation

- primary task を完了するための入口はいくつあるか
- ある能力・device・modality が失われると task 全体が停止するか
- alternative path は同等の目的まで到達できるか、それとも degraded fallback に留まるか
- personalization / adaptation が user に過剰な setup burden を要求していないか
- helper / companion / assistive technology と協調できるか

### Capability demand

各 step が何を要求しているかを具体化する。

- vision / visual discrimination
- hearing / audio discrimination
- speech
- touch / dexterity / reach / sustained pointer precision
- keyboard / switch / alternative input
- memory / attention / sequencing / decision making
- reading / literacy / language
- timing / speed / sustained effort
- environmental assumptions: lighting, noise, motion, connectivity, privacy, one-handed use など

「disabled / non-disabled」の二値分類だけで終えない。

### Exclusion point

- requirement は task 本質に必要か、それとも implementation 由来か
- product が一つの方法だけを success path として固定していないか
- visual hierarchy / content / interaction / hardware assumption のどこで mismatch が発生するか
- permanent / temporary / situational condition のどれで barrier が顕在化するか
- barrier の consequence は inconvenience / delay / error / dependence / task failure のどれか

### Diversity evidence

- 当事者の実際の strategy / workaround は何か
- team が想定した使い方と実際の使い方はどこで違うか
- 同じ disability label の中でも ability / preference / assistive strategy に差があるか
- user feedback のどこまでが individual evidence で、どこから repeated pattern か
- production telemetry / support evidence がある場合、行動の「原因」を user research で確認できているか

## Decision rules

### 1. Exclusion を product-system mismatch として書く

悪い framing:

> この user は drag ができない。

良い framing:

> この task は completion を precise drag だけに依存しており、drag を安定して実行できない状況では代替経路がない。

人を修正対象にせず、design が要求している interaction を修正対象にする。

### 2. Demographic persona だけで ability を推定しない

年齢、diagnosis、職種、gender 等だけから能力を決めつけない。

必要なら user context を次のように分ける。

- goal / motivation
- functional ability
- environment
- device / input method
- assistive / adaptive strategy
- experience / literacy

### 3. Permanent / temporary / situational を inspiration として使い、同一視しない

例として片腕の欠損、腕の怪我、子どもを抱えて片手しか使えない状況は、one-handed interaction という共通 constraint を持ち得る。

ただし duration、fatigue、assistive tool、expertise、risk は異なる。
「同じ constraint だから同じ user need」と断定しない。

### 4. Specific exclusion を先に十分に解く

Microsoft の “solve for one, extend to many” を「万人向け compromise」に変換しない。

1. specific barrier を明確にする
2. affected users にとって実際に成立する解決を作る
3. broader audience に transfer benefit があるか確認する
4. broader optimization により元の accommodation が壊れていないか再確認する

### 5. One-size-fits-all より viable alternatives を検討する

全員へ同一 presentation / input / sequence を強制するより、必要に応じて複数の参加方法を持たせる。

例:

- drag + explicit move controls
- audio + text / captions
- color + text / shape
- pointer + keyboard / switch-operable path
- fixed timeout + extension / saved progress where constraints allow

alternative を増やすこと自体が目的ではない。primary task に不要な complexity を追加しない。

### 6. Lived experience を design evidence にする

relevant な barrier を経験する人を、可能な限り early / repeated に design process へ含める。

- problem framing
- reference / existing-product review
- prototype exploration
- task trial
- post-implementation review

当事者を最終 approval のためだけに呼ばない。

### 7. Simulation / persona / heuristic を代用品にしない

impairment simulation、persona spectrum、exclusion calculator、AI persona は hypothesis generation には使える。

しかし次を証明しない。

- lived experience
- assistive-technology expertise
- learned strategy
- fatigue / trust / stigma / social context
- broad disability population の代表性

simulation の結果だけから「ユーザーの気持ちが分かった」と扱わない。

### 8. User evaluation と standards を併用する

W3C が示すように、少人数の user evaluation だけでは broad accessibility を保証できない。一方、conformance evaluation だけでは real usability barrier を取りこぼす。

- standards → coverage / minimum requirements / systematic checks
- user evaluation → actual strategy / task barrier / usability / unexpected behavior

両方を別の evidence として保持する。

### 9. Individual feedback を universal rule にしない

一人の disabled participant の preference を同じ disability 全体へ一般化しない。

conflict がある場合:

- participant context を記録する
- repeated evidence を探す
- configurable / alternative path が適切か検討する
- standards / known platform convention と照合する

## Responsibility boundaries

### `accessibility-audit`

existing artifact の automated / keyboard / visual / semantic / conformance-oriented re-test を担当する。
`inclusive-design` は upstream で exclusion と participation model を設計する。

### `cognitive-accessibility`

memory、attention、orientation、interruption、timeout、recovery burden の詳細 policy を担当する。
`inclusive-design` は cognition を含む cross-capability な exclusion discovery を担当する。

### `design-intent`

visual direction、reference、density、brand / component character の brief を担当する。
`inclusive-design` は誰が task へ参加できないか、どの assumptions が barrier を作るかを担当する。

### domain Skills

`keyboard-interface`、`touch-interface`、`content-design`、`internationalization-design`、`high-contrast-design` 等は specific solution domain の source of truth とする。
この Skill は exclusion を見つけ、必要な domain Skill へ渡す。

## References

runtime で詳細を読む場合は [`references/inclusive-design.md`](./references/inclusive-design.md) を開く。

最低限、次を比較する。

- Microsoft Inclusive Design: exclusion / diversity / solve-for-one methodology
- Cambridge Engineering Design Centre: capability demand / design exclusion
- W3C WAI: disabled users を project / evaluation に含める方法と generalization の注意
- GOV.UK Design System: universal-design principles と standards + service-level responsibility

一つの framework の terminology を universal rule にしない。

## Avoid

- inclusive design = WCAG compliance と扱う
- 「全員が同じ方法で使える」を目標にする
- disability を本人の固定属性だけで説明する
- diagnosis から interaction need を推測する
- permanent / temporary / situational condition を同一 user need に潰す
- empathy simulation を user research の代替にする
- disabled participant 一人の意見を population 全体へ一般化する
- accessibility feature を最後に別レイヤーとして追加する
- targeted accommodation を broader appeal のために弱める
- generic simplification を inclusion と呼ぶ
- inclusion を理由に必要な precision / security / consequence information を削る

## Verify

最終 artifact では source file や checklist ではなく、代表 task の **participation outcome** を確認する。

### Exclusion matrix

主要 task ごとに最低限記録する。

- task / success condition
- required abilities / environment assumptions
- observed exclusion point
- affected context / user evidence
- proposed participation path
- remaining limitation

### Rendered / interactive trial

該当する artifact を実際に操作し、少なくとも以下を確認する。

- primary path と alternative path が同じ user goal に到達できる
- alternative path が隠れた degraded mode になっていない
- input / modality switch 後も state が保持される
- error / interruption / resize / zoom / assistive mode 等で task が不必要に失われない
- adaptation が他の user に new barrier を作っていない

### User evidence

可能なら relevant な lived experience / functional need を持つ人に representative task を実行してもらう。

見るもの:

- completion / abandonment
- workaround
- unexpected interpretation
- dependence on helper / undocumented knowledge
- fatigue / repeated effort
- preference differences

実 user trial を行っていない場合は、その limitation を明示する。heuristic inspection を user validation と呼ばない。

### Standards cross-check

user trial の結果に関係なく、applicable な WCAG / platform / design-system requirement は別途確認する。

一人または少人数の成功を「accessible to everyone」の証拠にしない。

### Final gate

完了前に確認する。

- exclusion point が person-deficit ではなく interaction mismatch として記述されている
- direct user evidence と inference が区別されている
- specific accommodation が成立している
- broader transfer benefit は実測または明示的 hypothesis として扱われている
- remaining exclusions / untested populations が記録されている
- applicable domain Skills / accessibility audit へ handoff されている
