---
name: content-design
description: >
  Use this skill when designing or revising product, service, page, or interface content around user needs,
  information priority, task clarity, labels, instructions, errors, and status messages.
---

# Content Design

文章を最後に整えるための Skill ではない。

**Inspect → Extract → Translate → Implement → Verify** の順で、ユーザーが何を理解し、判断し、実行する必要があるかから content を設計する。

`content-design` が扱うのは **情報の必要性・順序・言葉・task-level message** である。
visual typesetting、form flow、navigation architecture、translation mechanics、generic accessibility audit はそれぞれ既存 / 別 Skill の責務とする。

## Workflow

1. current artifact と user task を読む。
2. 「この content が無ければ何が判断・実行できないか」を特定する。
3. relevant な一次 reference を `references/content.md` から実際に開く。
4. 複数 reference を下記 observation axes で比較する。
5. 必要情報を残し、重複・前置き・内部都合・不要な jargon を削る。
6. heading / body / link / label / instruction / error / status の役割に応じて翻訳する。
7. 実際の画面・task flow で読み直し、理解と次行動が成立するか検証する。

## Start from the user need

copy を書く前に次を決める。

- user は何を知る必要があるか
- user は何を決める必要があるか
- user は次に何をする必要があるか
- 間違えた場合、何を理解すれば回復できるか
- この時点で知らせる必要がある consequence / cost / risk は何か

content の存在自体を前提にしない。

必要なら:

- 削除する
- 既存 source へ link する
- task の別段階へ移す
- 長い page を複数の coherent section / step に分ける
- summary と詳細を分ける

「元原稿を全部残して短く言い換える」ことを content design としない。

## Observe

reference を開いたとき、少なくとも次を見る。

### Purpose / need

- page / surface の目的が最初に分かるか
- heading が implementation 名ではなく user task / subject を表しているか
- content の各 block が user need に結び付いているか

### Information priority

- 最重要情報・action・warning がどこにあるか
- 前置きなしで core message に到達できるか
- secondary detail が primary task を埋めていないか
- 同じ説明が複数箇所で重複していないか

### Language

- familiar / concrete な語を使っているか
- jargon / acronym / domain term を避けるか、必要なら説明しているか
- vague な代名詞や「こちら」「適切に」等だけで意味を持たせていないか
- actor と action が分かるか
- precision を失うほど単純化していないか

### Scanning structure

- heading / list / paragraph の先頭で内容を予測できるか
-重要語が遅すぎる位置にないか
- parallel な項目が parallel な文構造になっているか
- prose と list の選択が情報関係に合っているか

### Interaction copy

- button / link label から結果または destination を予測できるか
- instruction が必要な場所の前または近くにあるか
- error が「何が違うか」だけでなく「どう直すか」を示すか
- success / status が action の結果を明示するか
- UI 内部用語や component type を user に覚えさせていないか

### Voice / tone

- product / service の voice が surface 間で安定しているか
- tone が risk、urgency、emotional state、consequence に応じて変化しているか
- serious な場面で過度に playful になっていないか
- neutral な場面で過剰に警告的・威圧的になっていないか

## Decision rules

### Lead with what matters

結論・必要 action・重要条件を、長い introduction の後ろへ隠さない。

heading、link、label、paragraph では、scan 時に識別に必要な語をできるだけ前へ置く。

### Prefer familiar language without destroying precision

plain language は「専門語を禁止する」規則ではない。

専門語が user の task、legal / medical / technical accuracy、searchability に必要なら:

1. user が理解しやすい言葉を先に置く
2. 必要な専門語を併記または説明する
3. 同じ concept に複数の呼び名を増やさない

### Write for action, not the interface implementation

入力手段が複数ある場合、`click` / `tap` / `swipe` のような modality-specific instruction を不要に固定しない。

可能なら:

- `Select Save`
- `Open settings`
- `Choose a file`

のように task/action を記述する。

ただし gesture 自体を教える必要がある touch-specific interaction は `touch-interface` の判断に従う。

### Make links and controls predictable

link / button label は generic な `here` / `more` / `OK` だけに依存させない。

context なしでも可能な範囲で:

- destination
- action
- object

を予測できる wording にする。

同じ action は同じ語彙を使い、同じ語を別 meaning に再利用しない。

### Errors must support recovery

error content は可能な範囲で次を答える。

1. 何が完了しなかったか
2. どの入力 / 条件に問題があるか
3. user が次に何をすればよいか

user を責める wording、error code だけ、`Invalid input` のような recovery 情報のない wording を避ける。

validation timing / field sequencing 自体は `form-design` が担当する。

### Status and confirmation close the loop

user action が成功・失敗・pending のいずれなのか曖昧なままにしない。

特に不可逆・時間のかかる・background で処理される action では、結果と次の状態を content で伝える。

### Voice is stable; tone is contextual

voice guideline をすべての状況に同じ感情強度で適用しない。

- routine task → neutral / concise
- error → calm / actionable
- high-risk consequence → direct / explicit
- sensitive context → respectful / non-patronizing

brand personality より task comprehension を優先する。

## Responsibility boundaries

### `form-design`

owns:

- question sequencing
- single-page / multi-step choice
- validation timing
- check-answers / review flow

`content-design` owns the wording and information clarity inside those structures.

### `navigation-design`

owns information-space movement, orientation, and navigation model.

`content-design` owns heading / link wording that makes purpose and destination understandable.

### `typesetting`

owns line measure, type hierarchy, mixed-script composition, and visual reading rhythm.

`content-design` owns information order, textual structure, and language.

### `internationalization-design`

owns locale / translation / expansion / cultural adaptation mechanics.

`content-design` should avoid unnecessary idiom and input-specific phrasing, but does not replace localization design.

### `accessibility-audit`

owns broad conformance re-testing.

`content-design` defines clear-purpose, understandable-language, instruction, feedback, and recovery decisions to be audited.

## Avoid

- source document の順序をそのまま page hierarchy にする
- stakeholder / organization structure を user-facing information architecture にする
- content を削ること自体を success metric にする
- reading-age score だけで clarity を判定する
- necessary technical / legal meaning を「やさしい言葉」のために失う
- heading を `Overview` / `Information` のような generic label だけにする
- `Click here`, `Learn more`, `Submit`, `Invalid input` を context の代わりに使う
- tooltip / placeholder / error 後だけに essential instruction を隠す
- visual emphasis だけで重要性を伝え、言葉上の hierarchy を作らない
- cheerful brand tone を error / sensitive / high-consequence context に機械的適用する

## References

実作業では [`references/content.md`](./references/content.md) を開き、task に relevant な source を複数比較する。

単一 style guide の wording を universal rule としてコピーしない。

## Verify

source text だけで完了しない。delivered artifact と task flow で確認する。

### Task read-through

実際の user goal を1つ選び、画面順に読む。

- 最初の数秒で page / state の目的が分かるか
- 次に何をするか分かるか
- critical condition / consequence を見落とさないか
- error から自力で回復できるか
- success / pending / failure の結果が分かるか

### Scan test

本文を精読せず、heading / link / label / list lead だけを追う。

それだけでも content structure と主要 action を説明できることを確認する。

### Variation stress test

- short / long real content
- technical term を含むケース
- error / empty / loading / success state
- narrow viewport
- 200% zoom
- text expansion を想定した長い label

で message が切れたり意味が変わったりしないか見る。

### Read aloud / paraphrase

重要な instruction、warning、error は声に出すか別表現で要約し、意味が一意か確認する。

可能なら target user に近い reviewer / usability evidence で確認し、style guide への機械的準拠だけを verification にしない。
