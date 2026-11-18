# High Contrast References

Last reviewed: 2026-09-12

この reference set は normal theme の palette 設計ではなく、increased contrast preference / forced colors / OS contrast themes で意味と操作可能性を維持するために使う。

## W3C CSS Color Adjustment Module Level 1

- https://www.w3.org/TR/css-color-adjust-1/
- Observe:
  - forced colors mode が user-selected limited palette を page へ適用する仕組み
  - forced対象になる `color`, `background-color`, `border-color`, `fill`, `stroke`, `outline-color` 等
  - forced colors 中に `box-shadow` / `text-shadow` が消えること
  - `background-image` が URL image を除き消えること
  - CSS system colors を通じた palette access
  - `forced-color-adjust: auto | none | preserve-parent-color`
- Useful for:
  - forced palette 下で何が保持され、何が置換されるかを判断する
  - custom SVG / controls の color adaptation を設計する
- Avoid copying:
  - specification の property list を Skill の目的にすること
  - `forced-color-adjust: none` を一般的な解決策にすること

## W3C Media Queries Level 5

- https://www.w3.org/TR/mediaqueries-5/#prefers-contrast
- https://www.w3.org/TR/mediaqueries-5/#forced-colors
- Observe:
  - `prefers-contrast: more | less | custom | no-preference`
  - unqualified `prefers-contrast` を high-contrast shortcut にしてはいけない理由
  - `forced-colors: active` が contrast の強弱ではなく forced palette の存在を示すこと
  - forced palette が high / low / custom contrast になり得ること
  - simplification（gradient / background complexity reduction）が複数 contrast preference に有効な場合
- Useful for:
  - increased contrast と forced colors を同一 mode にしない判断
  - user preference の意味に沿った adaptation

## WCAG 2.2 — Use of Color

- https://www.w3.org/WAI/WCAG22/Understanding/use-of-color
- Observe:
  - color が action / status / distinction の唯一の visual channel になっていないか
  - hue difference と luminance / shape / text difference の区別
- Useful for:
  - limited palette でも意味が残る redundancy を設計する

## WCAG 2.2 — Contrast (Minimum)

- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Observe:
  - text / image-of-text の contrast threshold と適用範囲
  - large text / incidental / logo 等の例外境界
- Useful for:
  - text readability の baseline を確認する
- Avoid copying:
  - minimum ratio を high-contrast mode の唯一の設計目標にすること

## WCAG 2.2 — Non-text Contrast

- https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- Observe:
  - control や state を識別する visual information の adjacent-color contrast
  - focus / selected / checked 等、操作に必要な non-text indication
  - thin line / anti-aliasing で実表示が弱くなる failure
  - graphical object のうち意味理解に必要な部分だけを特定する考え方
- Useful for:
  - field boundary / focus ring / icon / chart line / state marker の設計

## WCAG 2.2 — Focus Visible

- https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- Observe:
  - keyboard focus の visual indication
  - author theme / forced palette 下でも current focus を識別できるか
- Useful for:
  - focus が selected / hover / current と混ざらない visual model を確認する

## Microsoft — Contrast themes for Windows apps

- https://learn.microsoft.com/windows/apps/design/accessibility/high-contrast-themes
- Observe:
  - contrast theme と light / dark theme の明示的な区別
  - user が built-in palette を選ぶだけでなく各色を customize できること
  - semantic SystemColor pairing
  - hardcoded colors と不適切な foreground/background pair が主要 failure になること
  -複数 built-in contrast themes での test recommendation
- Useful for:
  - user-selected system palette を source of truth とする考え方
  - dark-on-light / light-on-dark の両方を test する理由

## Microsoft Fluent UI Web Components — Windows high contrast mode

- https://learn.microsoft.com/fluent-ui/web-components/design-system/high-contrast
- Observe:
  - web component が `forced-colors` と system color keywords に適応する実例
  - rest / hover / active / focus / disabled を forced palette で分離する考え方
- Useful for:
  - custom component state の forced-color adaptation

## Apple — Sufficient Contrast evaluation criteria

- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria
- Observe:
  - light appearance だけでなく dark interface + Increase Contrast の組み合わせを test すること
  - text / controls だけでなく transparency / blur / background material も contrast perception に関係すること
  - platform-provided UI framework と custom UI で責任範囲が変わること
- Useful for:
  - dark mode と increased contrast を独立 dimension として扱う
  - translucent/material-heavy UI の verification

## W3C ARIA APG examples

- https://www.w3.org/WAI/ARIA/apg/patterns/radio/examples/radio-activedescendant/
- Observe:
  - high contrast で transparent border が見える環境を考慮した focus treatment
  - inline SVG の stroke / fill を forced colors に追従させる実装判断
  - focus / hover indication を label と control の双方で知覚しやすくする方法
- Useful for:
  - specification を production-like widget behavior へ翻訳する concrete example
- Avoid copying:
  - one APG example の寸法や styling を universal visual rule にすること

## Comparison questions

reference を開いたら、最低限次を比較する。

1. user palette を作者がどこまで尊重しているか
2. author colors が消えても残る state / boundary / information cue は何か
3. shadow / gradient / transparency の消失を何で補っているか
4. icon / SVG / chart の意味が limited palette でも残るか
5. focus / selection / disabled / status が system colors で区別できるか
6. dark appearance と contrast preference を別 dimension として test しているか
7. opt-out がある場合、それは color semantics 上本当に必要か
