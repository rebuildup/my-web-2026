---
name: cognitive-accessibility
description: >
  Use this skill when designing or revising digital task flows to reduce avoidable memory, attention,
  orientation, sequencing, interruption, timeout, and error-recovery burdens for people with cognitive
  and learning disabilities and for users operating under distraction or fatigue.
---

# Cognitive Accessibility

認知 accessibility を「画面を簡単にする」「文章を短くする」という generic minimalism に変換しない。

**Inspect → Extract → Translate → Implement → Verify** の順で、user が task を完了するために何を覚え続け、どこで注意を切り替え、どこで迷い、どの失敗から復帰しなければならないかを観察する。

この Skill は proactive な task-design policy である。WCAG conformance checklist ではない。
W3C COGA の Cognitive Accessibility Guidance は WCAG 2 の supplemental guidance であり、それ自体が WCAG 適合要件ではない。

詳細 reference は `references/cognitive-accessibility.md` を読む。

## When to use

次のような task / flow を設計・改善するときに使う。

- multi-step application / onboarding / checkout
- settings / administration / data-entry workflow
- long-running task や中断・再開が起こる task
- deadline / timeout / session expiration を含む task
- destructive / consequential action
- notification、live update、assistant、upsell 等が primary task と競合する surface
- users が現在地、前回の選択、次の step を記憶し続ける必要がある interface
- user test で「何をしていたか分からなくなる」「戻るのが怖い」「最初からやり直す」が発生する flow

単一 component の accessible name や contrast を直すだけなら `accessibility-audit`、文章そのものを設計するなら `content-design` を優先する。

## Workflow

1. current task の start / completion / critical path を特定する。
2. user が画面外で保持しなければならない情報、判断、状態を洗い出す。
3. `references/cognitive-accessibility.md` から relevant な primary reference を実際に開く。
4. 複数 reference を下記 observation axes で比較する。
5. avoidable cognitive burden と、domain 上どうしても必要な complexity を分ける。
6. orientation、progress、recovery、interruption、time、help の設計へ翻訳する。
7. rendered / interactive artifact で interruption・resume・error・back/undo を含む task trial を行う。

## Observe

### Critical path

- completion に本当に必要な step はどれか
- optional offer / personalization / education / promotion が critical path に割り込んでいないか
- frequent task が深い navigation や repeated confirmation を要求していないか
- choice を増やすことが user control ではなく decision burden になっていないか

step 数そのものを品質指標にしない。必要な safety / legal / domain decision を消して短く見せない。

### Orientation and external memory

- page / task / section の目的が現在地から分かるか
- multi-step flow で completed / current / pending の状態を必要に応じて確認できるか
- user が前の選択を覚えなくても現在の decision を理解できるか
- interruption 後に「何をしていたか」を再構成できる signpost があるか
- critical state が一時的 toast や animation の記憶だけに依存していないか

### Familiarity and consistency

- 同じ action が surface ごとに別 vocabulary / icon / interaction を使っていないか
- standard browser / platform behavior を理由なく上書きしていないか
- user が既に学んだ placement / hierarchy / control meaning を再利用できるか
- novelty が task comprehension を改善する evidence を持つか

familiarity は「古い pattern を絶対に維持する」という意味ではない。既存 pattern 自体が confusing / unsafe なら改善する。

### Attention and interruption

- primary task の途中で modal、banner、notification、live update、motion、sound が注意を奪わないか
- interruption は emergency / user-requested / task-critical か
- non-critical interruption を postpone / dismiss / mute できるか
- dismissal 後に task context と入力状態が維持されるか
- repeated interruption が habituation を起こし、本当に重要な警告まで弱めていないか

### Error prevention and recovery

- mistake を起こしにくい input / choice structure になっているか
- back / undo / edit が predictable か
- correction で unrelated data を再入力させていないか
- destructive / irreversible action の consequence を action 前に理解できるか
- error 後に user が task のどこへ戻ったか分かるか

error wording は `content-design`、validation timing / question flow は `form-design` の責務と協調する。

### Time and persistence

- timeout が本当に security / domain 上必要か
- time limit を task 開始前または十分早く知れるか
- extension / save / resume が可能か
- timeout 後、安全に保持できる入力まで失わせていないか
- user が notes / records / help を確認するために画面から離れる時間を想定しているか

security requirement を cognitive accessibility のために無効化しない。sensitive step を後段へ寄せる、非機密 work を保存する等で両立を探す。

### Help and support

- stuck した地点から help に到達できるか
- help を探すために deep menu や別 vocabulary を学ばせていないか
- help を読んだ後に元 task / state へ戻れるか
- user が feedback / support channel を選べる余地があるか

## Decision rules

### Externalize state instead of demanding recall

UI が保持できる task state を user の記憶へ押し戻さない。

必要に応じて:

- current step / task heading
- selected option summary
- saved progress
- pending item state
- review / edit path
- previous result / status

を visible / retrievable にする。

すべてを常時表示して画面を過密にする必要はない。必要な時に再取得できることを重視する。

### Keep the required path coherent

required completion と optional activity を分ける。

optional activity が必要なら:

- task 前後へ移す
- secondary path にする
-明確に skip 可能にする

などを検討する。

「1ページ1項目」や「最大N step」のような magic number にしない。task cohesion と interruption cost を見る。

### Preserve work across ordinary mistakes

back、edit、temporary navigation、validation error で user work を不要に失わせない。

irreversible action は必要に応じて explicit confirmation / review を持たせるが、routine action 全てに confirmation dialog を足して認知負荷を増やさない。

### Interrupt only with a reason

interruption は次のいずれかを説明できる場合に限定する。

- immediate safety / security
- action を続ける前に知る必要がある重大 consequence
- task completion に必要な missing state
- user が明示的に要求した reminder / update

marketing / suggestion / engagement の都合だけで critical task を遮断しない。

### Give time without hiding constraints

不要な timeout は避ける。必要な timeout は隠さない。

- duration / condition を早く伝える
- warning を読む時間自体を確保する
- extension / resume を提供できるか検討する
-安全に保存可能な work を保持する

### Simplify burden, not meaning

減らす対象:

- unnecessary step
- duplicated choice
- hidden state inference
- repeated data entry
- avoidable context switch
- decorative interruption

残す対象:

- consequence
- safety information
- required domain distinction
- precise legal / medical / financial meaning
- user が判断に必要な context

## Responsibility boundaries

### `content-design`

owns wording、information priority、labels、instructions、errors、status messages。

`cognitive-accessibility` owns whether the surrounding task requires avoidable recall, attention switching, hidden-state inference, or rework.

### `form-design`

owns question sequencing、field grouping、validation timing、review/check-answers structure。

`cognitive-accessibility` owns interruption/resumption、progress memory、timeout/data persistence、cross-step recovery burden。

### `navigation-design`

owns information-space movement、navigation model、location hierarchy。

`cognitive-accessibility` owns whether a user can re-orient after distraction without reconstructing their path from memory.

### `accessibility-audit`

owns broad automated / keyboard / visual / semantic conformance re-testing。

`cognitive-accessibility` is design-time policy for barriers that are often not detectable by automated tooling or criterion-only review.

## Avoid

- cognitive accessibility を「less text」「fewer controls」「minimal UI」と同義にする
- arbitrary な最大 step 数、最大 choice 数、文字数を universal rule にする
- user の diagnosis を推測して UI を決める
- animation / toast / transient banner だけで重要 state を伝える
- optional upsell / survey / onboarding tip を completion path に強制する
- back で入力を失う、edit で unrelated data を消す
- timeout を開始後まで隠す、warning を読んでいる間に timeout させる
- every action に confirmation を追加して安全性の名目で friction を増やす
- familiar という理由だけで confusing な legacy interaction を固定する
- heuristic / persona だけで実 user research や task trial を代替する
- W3C COGA guidance を WCAG conformance requirement と表現する

## Verify

source / design file の確認だけで完了しない。可能なら representative user task を rendered interactive artifact で通す。

最低限確認する:

- primary task の required / optional path を区別できる
-途中で別画面や別資料を見た後、元の task を再開できる
- current step / task purpose / prior important choice を memory だけに頼らず再取得できる
- back / edit / validation recovery で entered work が不要に失われない
- interruption を dismiss / postpone した後も context が維持される
- destructive / high-consequence action から安全に戻れる、または consequence が事前に明確
- timeout がある場合、事前説明・warning・extension/resume・data preservation の実挙動を確認した
- help へ到達し、元 task に戻れる
- necessary complexity を削って意味・安全性・precision を壊していない

### Interruption / resume trial

multi-step / long-running task では少なくとも一度:

1. task を途中まで進める。
2. 別 route / help / external information lookup を挟む、または一時中断する。
3. 戻る。
4. 目的、現在地、保存済み work、次 action を再構成できるか確認する。

### Error-recovery trial

1. realistic な入力ミスまたは wrong choice を発生させる。
2. back / edit / validation path で修正する。
3. unrelated data の再入力、orientation loss、duplicate confirmation が発生しないか確認する。

実 project / artifact trial を行っていない場合、production-proven / completed と表現しない。
