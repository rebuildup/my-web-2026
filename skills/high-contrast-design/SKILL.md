---
name: high-contrast-design
description: >
  Design and verify interfaces that remain understandable under increased-contrast preferences,
  forced-color palettes, and OS contrast themes without treating high contrast as a stronger dark mode.
---

# High Contrast Design

高コントラスト対応を「色を濃くする」「白黒にする」処理として設計しない。

**Inspect → Extract → Translate → Implement → Verify** を順に実行する。

この Skill は、通常テーマの semantic color system ではなく、ユーザーがより強い contrast を要求した場合や、OS / user agent が作者色を limited palette へ置換する環境で、情報・状態・操作可能性をどう維持するかを扱う。

## When to use

次のいずれかを扱うときに使用する。

- increased contrast / contrast theme / forced-colors 対応
- custom controls / SVG / icons が system palette で消える問題
- focus / selection / status / boundary が subtle color や shadow に依存している UI
- light / dark appearance と contrast preference の組み合わせ
- charts / diagrams / status indicators が色だけに依存している UI
- platform contrast settings を含む visual verification

通常の palette 設計には `color-system` を使う。
light / dark appearance transformation には `dark-mode-design` を使う。
広範な WCAG conformance review は `accessibility-audit` の責務とする。

## Workflow

1. current artifact の semantic roles と、色・shadow・opacity・gradient に依存している意味を列挙する。
2. current platform / browser の contrast mechanisms を確認する。
3. 下記 reference を開き、normal / increased contrast / forced colors の差を比較する。
4. palette が置換されても残すべき構造と、user preference に委ねるべき色を分ける。
5. critical information を color-only / shadow-only / subtle-fill-only から解放する。
6. forced palette への opt-out は最小限にする。
7. light / dark / increased contrast / forced-color variants で同じ代表 task を実行して確認する。

## Observe

reference と current artifact で、少なくとも次を観察する。

### Contrast mode model

- normal theme と increased contrast preference の違い
- `prefers-contrast: more` と `forced-colors: active` の違い
- forced palette が user-selected system colors を使っているか
- light / dark appearance と contrast preference が独立しているか
- author styling が user preference を上書きしていないか

### Information survival

- text / icon / control boundary が背景から識別できるか
- focus / selected / checked / pressed / current / error / warning / success が区別できるか
- color を失っても意味が残る shape / label / pattern / border / position があるか
- disabled と active content の区別が palette 変更後も成立するか
- chart / diagram / legend が hue difference だけに依存していないか

### Effects that may disappear

- box-shadow / text-shadow に boundary や elevation を依存していないか
- gradient / translucent fill / blur が情報階層を担っていないか
- CSS background image が消えても task が成立するか
- transparent border を layout reservation のためだけに使っていないか
- custom SVG の stroke / fill が forced palette に追従するか

### System-color mapping

- canvas / text / link / button / selected / disabled の役割が system color と対応しているか
- foreground と background を semantic pair として扱っているか
- one-off hardcoded color が system palette の意味を破壊していないか

## Decision rules

### 1. Increased contrast と forced colors を分ける

`prefers-contrast: more` は「より強い contrast を望む」という preference である。

`forced-colors: active` は、user agent が user-selected limited palette を強制している状態である。
その palette は必ずしも高コントラストとは限らない。

この2つを同じ CSS branch / design mode として扱わない。

### 2. Dark mode と high contrast を同一視しない

暗い背景 + 明るい文字は dark appearance であって、high contrast 対応の証明ではない。

最低でも次を別 combination として確認する。

- light + default contrast
- dark + default contrast
- light/dark + increased contrast（platform が提供する場合）
- forced colors / OS contrast theme

### 3. Forced palette では user color choice を優先する

forced colors 中に brand palette を再構築しない。

semantic role を system colors へ翻訳し、user が選んだ foreground / background / selection / link 等の関係を尊重する。

作者が「見栄えを戻す」ために hardcoded color を重ねると、forced colors の目的を破壊しやすい。

### 4. Meaning を color-only にしない

次のような意味は、palette が限定されても読める形を持たせる。

- selected / checked / current
- validation error / warning / success
- required / optional difference
- chart series / threshold / outlier
- interactive / non-interactive difference

必要に応じて text、icon shape、outline、pattern、position、weight、decoration を併用する。

### 5. Shadow / gradient / transparency を structural cue にしない

forced colors では shadow が消え、background treatment が単純化されることがある。

card / popover / selected row / floating control の存在を shadow だけで示さない。
必要なら visible border / outline / spacing / explicit state marker を持たせる。

### 6. Custom SVG / icon は palette replacement を前提にする

意味を持つ icon / SVG の stroke や fill が author color 固定のまま残ると、system background と同化することがある。

可能なら text / current color / system color relationship に参加させる。
装飾 illustration と UI-semantic icon を同じ扱いにしない。

### 7. `forced-color-adjust: none` は例外にする

forced-color adjustment を broad scope で無効化しない。

使用を検討できるのは、例えば次の条件を満たす狭い要素だけである。

- exact color 自体が情報の一部である
- palette replacement すると意味が壊れる
- author がその要素の contrast / state visibility を自力で保証できる
- user-forced surrounding colorsとの境界も確認済み

brand identity を守りたいだけ、という理由では opt-out しない。

### 8. Thin / subtle indication を数値合格だけで済ませない

WCAG の contrast threshold を満たしていても、細い線や小さい shape は実表示で弱く見えることがある。

focus ring、input boundary、chart line、small icon は rendered artifact で perceptual visibility を確認する。

## Avoid

- high contrast = pure black + pure white と固定する
- `prefers-contrast` が true なら常に high contrast style を適用する
- `forced-colors` を dark mode の別名として扱う
- forced palette 中にブランド色を hard-code する
- shadow / blur / gradient だけで panel boundary や state を示す
- selected / error / chart series を hue difference だけで示す
- custom SVG の author fill/stroke がそのまま安全だと仮定する
- `forced-color-adjust: none` を root / large container に安易に設定する
- disabled state を単純な low-opacity 化だけで設計する
- contrast ratio の数値確認だけで visual verification を完了する

## References

詳細な current references は [`references/high-contrast.md`](./references/high-contrast.md) を読む。

最低限、実装前に次を確認する。

- W3C CSS Color Adjustment — forced colors が何を置換するか
- W3C Media Queries — `prefers-contrast` と `forced-colors` の意味の違い
- WCAG 2.2 — text / non-text / color-only information の要求
- Microsoft contrast themes — user-selected system palette の実例
- Apple sufficient contrast — dark appearance と increased contrast の組み合わせ

## Verify

source code や token 値だけを確認して完了しない。

### State matrix

代表 surface / component について次を比較する。

- default
- hover（必要な場合）
- keyboard focus
- selected / checked / pressed
- disabled / read-only
- error / warning / success

### Appearance matrix

可能な範囲で次を実際に render する。

- light appearance
- dark appearance
- increased contrast preference
- forced colors / Windows contrast theme
- user-customized contrast palette が利用できる場合はその variant

### Task verification

同じ主要 task を各 mode で実行し、次を確認する。

- interactive control を発見できる
- current focus が分かる
- selection / state が分かる
- error / status を色名なしで説明できる
- form fields / boundaries が消えない
- popover / dialog / selected row 等の境界が shadow 消失後も分かる
- custom SVG / icons が背景へ消えない
- chart / diagram の系列・関係を palette 変更後も区別できる
- native / browser controls と custom components の contrast behavior が破綻しない

### Completion gate

次を満たさなければ完了扱いにしない。

- normal contrast と contrast preference / forced palette の責務を区別した
- critical meaning に non-color redundancy がある
- user-selected forced palette を不必要に上書きしていない
- `forced-color-adjust` opt-out がある場合、その理由と代替 verification が説明できる
- rendered / interactive artifact を contrast mode で実際に確認した
