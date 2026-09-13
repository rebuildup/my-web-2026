---
name: interaction-states
description: >
  Design and verify interactive component states by separating transient input feedback,
  persistent choice/state, availability, validation/status, and focus semantics. Use when
  creating or reviewing controls whose hover, focus, pressed, selected, disabled, loading,
  read-only, error, warning, or success behavior must remain coherent across input methods.
---

# Interaction States

Interactive state を色違いの一覧として作らない。

**Inspect → Extract → Translate → Implement → Verify** の順で、component が何を意味し、何が変わったのかを先に定義する。

この Skill は state の**意味・組み合わせ・遷移・知覚可能性**を扱う。token value は `color-system` / `token-audit`、animation timing は `motion-system`、広範な accessibility conformance は `accessibility-audit`、form 全体の validation flow は `form-design` に委ねる。

Last reviewed: **2026-09-12**

## Workflow

1. current component / task / existing design system を読む。
2. component が取り得る state を列挙し、state ごとに意味を一文で定義する。
3. [`references/states.md`](./references/states.md) から relevant な primary references を開く。
4. reference 間で state semantics、visual cue、input method、focus behavior、state combination を比較する。
5. current product の component model へ翻訳する。
6. pointer / keyboard / touch / theme / high-contrast を含めて実装する。
7. rendered UI を操作し、state 単体と state combination を検証する。

## Observe

reference を開いたら、最低限以下を見る。

- state が **input event** なのか **persistent value** なのか **availability/status** なのか
- state を開始・終了させる event
- state が interaction 後も残るか
- focus と selection が同時に存在したときの見分け方
- pointer / keyboard / touch で同じ意味へ到達できるか
- visual cue が color だけに依存していないか
- disabled / read-only / unavailable の discoverability
- loading / busy 中に何が操作可能か
- state が重なった場合の優先関係
- light / dark / high-contrast で意味が保たれるか

## State classes

### 1. Default / enabled

component が利用可能だが、現在直接操作されていない状態。

Default は「state が無い」状態ではない。interactive affordance、label、value、selection possibility が通常状態でも理解できること。

### 2. Hover

pointer が interactive target 上にある一時的状態。

Hover は **pointer-specific enhancement** とする。

- essential action / information を hover だけで初めて出さない
- hover が存在しない touch environment でも task を完了可能にする
- hover cue と selected / current cue を同じ意味にしない

### 3. Focus

keyboard / assistive interaction における現在の navigation position。

**Focus と selection を同一視しない。**

focus は移動し、selection は focus が離れても残り得る。selected item から別 item へ focus を移した場合に、両方を視覚的に区別できる必要がある。

custom focus style を使う場合も、focus location が常に追跡可能であることを優先する。

### 4. Active / down / pressing

pointer down、touch down、key press など、activation cycle 中だけ存在する transient feedback。

**Active/down と persistent toggle state を分離する。**

button を押している瞬間の `active` appearance を、その button が ON であることを示す `pressed` appearance として流用しない。

### 5. Persistent choice / disclosure

以下は似た見た目でも意味が異なる。

- **selected** — set / list / tab 等から選ばれた item
- **checked** — checkbox / radio / switch 等の chosen value
- **pressed** — toggle button の on/off state
- **expanded** — controlled content が展開されているか
- **current** — page / step / location 等の現在位置

component semantics に合う state を使う。すべてを generic `active` と呼ばない。

selection が focus に自動追従するかは widget behavior と task cost から決める。focus 移動だけで高コスト処理や network request を発火させない。

### 6. Disabled / unavailable

機能が現在操作できない状態。

disabled を単に opacity を下げる styling shortcut にしない。

- なぜ unavailable か
- 後で利用可能になるか
- 存在を見せる必要があるか
- focusability が discoverability に必要か

を判断する。

通常の native disabled control は tab sequence から外れる。一方、toolbar / menu / listbox 等では unavailable item の存在を discoverable にするため focusable disabled state が適切な場合がある。component pattern に従い、一律 rule にしない。

### 7. Read-only

値は編集できないが、内容自体は relevant であり、閲覧・選択・copy 等が必要な状態。

**Read-only と disabled を分離する。**

read-only content を disabled のように薄くして「無関係」に見せたり、navigation から排除したりしない。

### 8. Pending / loading / busy

結果や content がまだ確定していない状態。

- component 単位か region 単位かを明確にする
- pending 中に duplicate activation が危険なら、その action だけを抑止する
- unrelated interaction まで無条件に lock しない
- loading indicator が何を待っているか理解できるようにする
- skeleton は content structure を予告する場合に使い、単なる decoration にしない

### 9. Error / warning / success

これは hover 等の input state ではなく、task / data / system status を表す。

- **error** — correction / recovery が必要
- **warning** — continuation 可能だが risk / exception がある
- **success** — requested outcome が成立した

status color だけで意味を伝えず、icon / text / structure 等の redundant cue を持たせる。form-level の validation timing や recovery flow は `form-design` に従う。

## Combination rules

実 UI では state は排他的ではない。

例:

- selected + focus
- checked + disabled
- current + focus
- read-only + focus
- error + focus
- selected + hover
- busy + current

state matrix を作り、意味の異なる cue が消し合わないか確認する。

優先順位を「色が強い方」ではなく意味で決める。

1. operability / availability
2. navigation focus
3. persistent value / location
4. validation / status
5. transient pointer / press feedback

この順序は visual stacking の固定値ではない。複数意味を同時に知覚できる構成を選ぶための inspection order とする。

## Translation rules

- existing product に state vocabulary があるなら、まずそれを再利用する
- state 名ではなく semantic meaning を token / component API へ map する
- hover / focus / pressed の exact color difference を reference からコピーしない
- light / dark theme で色値が変わっても state role は変えない
- destructive / warning color を generic active state として流用しない
- selected state を focus ring だけで表現しない
- disabled state を tooltip 必須の information architecture にしない。理由が重要なら周辺 text や visible explanation を検討する
- loading 中の label replacement で control width / context が不安定になる場合は、layout continuity も確認する

## Avoid

- hover を唯一の affordance / disclosure にする
- focus と selected を同じ treatment にする
- `active` を「current」「selected」「pressed」の総称として使う
- disabled と read-only を同じにする
- disabled item を常に focusable、または常に unfocusable と固定する
- loading 中に page 全体を不要に操作不能にする
- error / warning / success を色だけで伝える
- component library の pseudo-class 一覧をそのまま product state model とみなす
- state ごとに arbitrary な色・radius・shadow を増やして token drift を起こす

## Verify

実際の rendered / interactive artifact を操作する。

### State coverage

- default → hover → press → release を pointer で確認
- keyboard の focus path を確認
- toggle / checkbox / selection が activation 後も正しく持続することを確認
- focus を selected item から別 item へ移し、dual state が判別できることを確認
- disabled / read-only の操作可能範囲と discoverability を確認
- loading / busy 中の duplicate action と unrelated action を確認
- error / warning / success の cue を color を見分けにくい条件でも確認

### Input modes

- mouse / trackpad
- keyboard only
- touch or touch-equivalent inspection where relevant

hover がない環境でも essential behavior が欠けないこと。

### State combinations

代表的な combination を最低限確認する。

- selected + focus
- selected + hover
- error + focus
- disabled + selected/checked where product semantics allow it
- current + focus

### Visual environments

- light / dark theme（対応する場合）
- forced/high-contrast environment（対応する platform の場合）
- zoom / narrow viewport で focus ring、status text、state icon が clipping しないこと

### Completion gate

次を満たすまで完了としない。

- state の意味を component model 上で説明できる
- focus / selection / active-down / persistent state が混同されていない
- unavailable / read-only の扱いが task と discoverability に基づいている
- pointer 以外でも同じ task を完了できる
- state combination を実物で inspection した
- build success だけでなく rendered interaction を確認した
