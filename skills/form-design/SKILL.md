---
name: form-design
description: >
  Web / application UI で申請、登録、設定、checkout、検索条件などの form flow を設計・改善するときに使用する。
  control の見た目ではなく、質問順序、label / hint、input choice、step 分割、validation、error recovery、
  review / confirmation までを一つの task flow として設計し、実際の入力・修正経路で検証する。
---

# Form Design

Form を input component の集合として作らない。

**Ask only what is needed → sequence the questions → choose the right control → recover from errors → let users verify consequential answers → test the complete path**

を基本にする。

Status: experimental  
Last reviewed: 2026-09-12

## Boundary

この Skill が扱うのは **form 固有の design decision** である。

扱う:

- 何を、どの順で聞くか
- 1 page / multi-step の分割
- label / hint / required / optional の伝え方
- text input / textarea / radio / checkbox / select 等の選択
- related controls の grouping
- validation の timing
- error summary / inline error / recovery
- back / edit / retry 時の入力保持
- review / check-answers / confirmation
- form completion を妨げる disabled / conditional state
- mobile / keyboard / screen reader / zoom / localization を含む task-flow verification

扱わない:

- backend validation / security の実装
- React Hook Form 等の library API
- general WCAG audit の再実装
- page 全体の grid / spacing system
- design system 固有の visual token のコピー

generic accessibility 問題は `accessibility-audit`、page / application layout は `layout-system`、token drift は `token-audit` を併用する。

## Workflow

1. 現在の form が完了させる **user task** と、submit 後に起こる結果を確認する。
2. 収集する field ごとに「この task の完了に本当に必要か」を確認し、不要な質問を削る。
3. 下の primary references を開き、対象に近い pattern を比較する。
4. 質問の依存関係を並べ、自然な reading / decision order を作る。
5. page / step boundary と、各 question に適した control を決める。
6. label / hint / optionality / conditional disclosure を設計する。
7. validation timing、error recovery、edit / back behavior を設計する。
8. consequential submission では review / check-answers が必要か判断する。
9. 実データを入力し、成功経路だけでなく error → correction → resubmit を通して検証する。

## Observe

reference を開いたら、見た目より次を観察する。

### Task structure

- 1つの form が扱う user goal は何か
- 最初に必要な情報と、後続回答で初めて必要になる情報は何か
- question order は user の mental model と一致しているか
- 1 page に置く質問量と multi-step の切り方
- back / edit / resume がどこから可能か
- submit 前に review があるか

### Question design

- label が input の目的を単独で説明できるか
- hint は「答えるために必要な補助情報」だけに絞られているか
- required / optional が field 単位で分かるか
- related controls が fieldset / legend 相当の単位でまとまっているか
- radio / checkbox / free text / select の選択理由
- expected answer length と input の視覚的長さが矛盾していないか
- placeholder に label や重要 instruction を押し込んでいないか

### Validation and recovery

- validation がいつ始まるか
- error が question とどのように対応付いているか
- error が「何が起きたか」と「どう直すか」を具体的に示すか
- error 後も入力済み値が保持されるか
- page-level error summary と inline error の役割が一致しているか
- paste / autofill / flexible formatting を不必要に拒否していないか
- live validation が本当に user benefit を持つか

### State and completion

- disabled control の理由が見えるか
- conditional field がいつ現れ、読み順 / focus order が破綻しないか
- destructive / financial / legal / account-related submit 前に確認機会があるか
- submit action の label が実際の結果を説明しているか
- success / confirmation が task completion を明確に伝えるか

## Decision rules

### Ask less before styling more

入力項目が多い問題を、card、accordion、multi-column で隠して解決しない。

まず不要 field を削る。
後続回答によって不要になる field は conditional にする。
一度に聞く必要がなければ logical step へ分ける。

W3C Forms Tutorial も、transaction に不要な情報を求めるほど abandonment が増えやすいとして、simple / short form を優先している。

### Preserve a single reading order

primary form flow は、原則として visual order と DOM / focus order が一致する単純な縦方向の sequence を基準にする。

2-column layout は desktop space を埋めるために導入しない。
並列配置する場合でも、読み順・focus order・zoom / narrow viewport での reflow が一意になる場合だけ使う。

### Labels stay visible

placeholder を label の代わりにしない。

label は入力中・入力後も残し、field の目的を説明できる文言にする。
format や補足が必要なら hint / description として分離する。
長い説明をすべて hint に入れず、question 前の本文へ出すことも検討する。

### Match the control to the answer

- free-form / unpredictable answer → text input / textarea
- mutually exclusive small set → radio
- zero or more independent choices → checkbox
- long predetermined list → select を検討するが、search / autocomplete の方が適切な場合もある
- dates / numbers / codes → user が自然に type / paste できる方法を優先し、picker を常に強制しない

native control で成立する問題に custom control を追加しない。

### Validate after the user has had a chance to answer

default は **continue / submit 時に validation** する。

field blur や keypress ごとの即時 error は、user research / product evidence があり、入力途中の利用者を不必要に遮らない場合だけ使う。

USWDS の live validation component は usability / accessibility testing の問題から removal 対象になっている。
「即時 feedback は常に良い」という前提を置かない。

### Errors are recovery instructions

error では:

- 元の回答を消さない
- question / label と同じ語彙を使う
- generic な `Invalid input` / `Required` だけで終えない
- 何を直せば続行できるかを具体的に書く
- 複数 error がある場合、page-level summary と inline error を対応させる
- focus / keyboard user が error location へ移動できるようにする

受け入れても曖昧にならない formatting 差は、できるだけ正規化して受け入れる。

### Use review before consequential submission

送信後の変更が難しい、金銭・契約・申請・公開・削除等を伴う場合は、check-answers / review step を検討する。

review では:

- relevant な回答だけを section 化して見せる
- 各 section / value を edit できる
- edit 後に不要な全 step を再通過させない
- final action が何を実行するか明示する

## Primary references

- [W3C WAI — Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/)
  - Observe: labeling, grouping, instructions, validation, notifications, multi-page forms の責務分離。
  - Useful for: framework に依存しない form semantics と task completion。
  - Last reviewed: 2026-09-12.

- [GOV.UK Design System — Question pages](https://design-system.service.gov.uk/patterns/question-pages/)
  - Observe: page-level question composition、label / legend、hint、複雑な説明を question から分離する方法。
  - Useful for: transactional / application flow。
  - Last reviewed: 2026-09-12.

- [GOV.UK Design System — Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/)
  - Observe: submit-time validation、error summary、inline error、入力保持、format tolerance。
  - Useful for: error recovery policy。
  - Last reviewed: 2026-09-12.

- [GOV.UK Design System — Check answers](https://design-system.service.gov.uk/patterns/check-answers/)
  - Observe: review page の information grouping、change links、edit 後の return path、final action。
  - Useful for: consequential submission。
  - Last reviewed: 2026-09-12.

- [U.S. Web Design System — Form](https://designsystem.digital.gov/components/form/)
  - Observe: vertical flow、fieldset / legend、visual order と source order、disabled state の扱い。
  - Useful for: government / enterprise forms と accessibility-sensitive flows。
  - Last reviewed: 2026-09-12.

- [U.S. Web Design System — Text input](https://designsystem.digital.gov/components/text-input/)
  - Observe: expected answer length、placeholder avoidance、mobile context、paste / segmented-number concerns。
  - Useful for: text-entry field selection。
  - Last reviewed: 2026-09-12.

- [U.S. Web Design System — Validation](https://designsystem.digital.gov/components/validation/)
  - Observe: live validation の known usability / accessibility issues と deprecation signal。
  - Useful for: real-time validation を安易に採用しない判断。
  - Last reviewed: 2026-09-12.

- [NHS digital service manual — Error message](https://service-manual.nhs.uk/design-system/components/error-message)
  - Observe: error と question / hint / field の visual / semantic association、入力保持。
  - Useful for: healthcare / high-stakes form error states。
  - Last reviewed: 2026-09-12.

## Avoid

- placeholder-only label
- desktop の空白を埋めるためだけの multi-column form
- 全 field に `required` を付け、required / optional policy を考えない
- focus を外した瞬間から赤 error を出す
- error 後に form を初期化する
- `Something went wrong` / `Invalid` だけの error
- password / phone / code 等を理由なく細かい複数 field へ分断する
- hidden dependency により「なぜこの質問が出たか」が分からない flow
- 理由のない disabled control
- native input で足りるのに custom widget を作る
- consequential submit を review なしで不可逆に実行する
- success toast だけで task completion を表現し、次の状態を不明確にする

## Verify

source code が valid でも完了にしない。実際の form flow を通す。

最低限:

1. empty state から開始し、keyboard だけで最初から最後まで完了する。
2. required / optional / conditional field を含む現実的な data set を入力する。
3. intentional error を複数作り、error summary / inline error / focus / correction path を確認する。
4. error 後に正しい既入力値が保持されていることを確認する。
5. back / edit / check-answers から変更し、不要な再入力が発生しないことを確認する。
6. narrow viewport と zoom 状態で reading / focus order が崩れないことを確認する。
7. long name、長い option label、mixed-language text、paste / autofill を試す。
8. slow typing でも validation が入力途中を攻撃的に error 扱いしないことを確認する。
9. submit / delete / pay / send 等の final action label が結果を説明しているか確認する。
10. successful completion 後、何が完了し次に何が起こるかが明確か確認する。

generic accessibility regression が見つかったら `accessibility-audit` で追加検証する。
