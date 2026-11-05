# /design-system グリッド・面・ボタンの修正記録（0.8.1 / Issue #804）

作成: 2026-11-02
対象: `src/routes/design-system/**`（`src/editorial/**` は変更なし）
根拠: owner feedback 2026-11-01（Issue #764 コメント）、direction B（MONOCHROME / SIGNAL）

## 1. 何を直したか

owner の feedback は次の 2 点。

- Q5: 色一覧のサイズが不揃いで説明過多、余白の左端が不揃い、面を白ボーダーで区切っている。
- Q6: セカンダリーボタンが地と同色の背景 + border でボタンに見えない。Reaction Picker の説明が足りない。

この PR は「グリッドシステムを厳密に組む」「区別は塗りで行う」に限定して直した。
token の値・意味は変えていない。accent を 1 色に固定する変更もしていない。

| 面 | 変更 |
| --- | --- |
| 色一覧 | タイルの構造を `label / path / swatch 対 / hex` の 4 行固定にした。swatch 対の高さを 5rem に固定し、説明文（role 文）を削除した。長い path は 1 行 ellipsis。`lg` を 4 列から 3 列にし、21 token を 7 行で整除させた。 |
| 余白 | ラベル列を `minmax(7.5rem, auto)` から固定 `10rem` に変更。バーの `border.subtle` 1px を削除し、塗りを `accent.surface` から `border.strong` に変更。 |
| 面 | 3 枚のカードを、`bg.subtle` の下地に載せた全幅バンドに変更。`border.subtle` 1px と footer の `borderTop` を削除。区別は `bg.canvas` / `bg.surface` / `accent.surface` の塗りだけ。 |
| セカンダリー | `bg.canvas` + `border.subtle` を廃止。`bg.subtle`（idle）→ `text.default` 反転（hover）→ `accent.interactive`（pressed）。`border.focus` の focus ring は残した。 |
| Reaction Picker | 1 行の説明を `What it is / Why here / Keyboard` の 3 項目に置き換えた。trigger はセカンダリーと同じ塗り契約に揃え、幅は内容幅にした。 |

## 2. 実測

### 2.1 方法

- Playwright（`@playwright/test` 1.63）Chromium、`colorScheme: light`、`reducedMotion: reduce`。
- viewport 1440×900 と 390×844。`networkidle` + `document.fonts.ready` の後に `getBoundingClientRect()` と `getComputedStyle()` を取得。
- analytics 同意帯は固定 overlay のため、撮影前に DOM から除去した（`[data-testid="analytics-consent"]`）。製品コードは変更していない。
- スクリーンショットは section 要素、sharp で WebP quality 82。
- before は `7311a46f` の同ファイルを checkout して撮影し、after は同じ dev server（`pnpm dev -- --port 3301 --strictPort`）で撮影した。

### 2.2 色一覧（21 token）

| 項目 | before | after |
| --- | --- | --- |
| タイル高さ @1440（px） | 221 / 238 / 242 / 259 の 4 種類（幅 38） | 178 の 1 種類 |
| タイル高さ @390（px） | 221 | 178 |
| swatch 対の高さ（px） | 32（可変） | 40（固定 5rem の行内） |
| header / pane / hex の高さ（px） | 行ごとに変動 | 64 / 80 / 34 |
| タイル左端 @1440（px） | 587 / 744 / 901 / 1059（4 列） | 586.7 / 795.1 / 1003.5（3 列） |
| 列数 @1440 | 4（21 token で最終行に 1 枚の孤立） | 3（21 token が 7 行で整除） |
| token path の表示 | 4 件が ellipsis で切れる | 全 21 件が 1 行で読める |
| 説明文 | 21 件の role 文 | 削除（path と hex のみ） |

タイル高のばらつきは role 文の折り返し行数によるものだった。4 行固定にしたことで、
どの列・どの viewport でも同一高になった。

### 2.3 余白（8 step）

| 項目 | before | after |
| --- | --- | --- |
| バー左端 @1440（px） | 730.7 / 743.3 / 754.9 / 772.1 / 775.2 / 782.8（6 種類、幅 52.1） | 770.7 の 1 種類 |
| バー左端 @390（px） | 16（1 種類） | 16（1 種類） |
| バーの border | 1px `border.subtle` | 0px |
| バーの塗り | `accent.surface` #f0f9ff（白地に 1px border がないと読めない） | `border.strong` #64748b（白地に 4.76:1） |

### 2.4 面（3 band）

| 項目 | before | after |
| --- | --- | --- |
| 外枠 border | 1px `border.subtle` ×3 | 0px ×3 |
| footer の `borderTop` | あり | 削除 |
| 塗りの実体 | 外側 article は透明、内側 div が塗る | band 自身が塗る（`data-surface-token` の要素 = 塗り面積） |
| 実測塗り @light | （外側は `rgba(0,0,0,0)`） | `bg.canvas` #ffffff / `bg.surface` #f8fafc / `accent.surface` #f0f9ff |
| 下地 | なし | `bg.subtle` #f1f5f9 |

下地を `bg.subtle` にしたのは、`bg.canvas` を下地にすると `bg.canvas` の band が
page と同色で消えるため。3 つの塗りが 1 段ずつ差として読める。

### 2.5 セカンダリーボタン

| state | before 背景 / border | after 背景 / border | 白地とのコントラスト（after） | 文字 |
| --- | --- | --- | --- | --- |
| default | #ffffff / 1px | #f1f5f9 / 0px | 1.10:1 | `text.default` #0f172a（16.30:1） |
| hover | #ffffff / 1px（border 色のみ変化） | #0f172a / 0px | 17.85:1 | `bg.canvas` #ffffff（17.85:1） |
| pressed | #f8fafc / 1px | #075985 / 0px | 7.56:1 | `text.inverse` #ffffff（7.56:1） |
| focus | #ffffff / 1px | #f1f5f9 / 0px + `border.focus` 2px ring | 1.10:1 | `text.default`（16.30:1） |

- idle の塗りは「地と同色」ではなくなった（#ffffff → #f1f5f9）。
- hover と pressed は中立ランプに段がないため、インク反転と accent に逃がした。
  `bg.subtle` より深い中立 token が存在しないので、中立のままだと hover は
  `bg.surface`（1.05:1）で不可視、pressed は `bg.canvas` で消える。
  `bg.control` / `bg.pressed` の追加は別 Issue の判断とする。
- trigger の幅は 1440 で 613.3 → 215.1 px、390 で 358 → 215.2 px（内容幅）。

## 3. 変えていないもの

- `src/editorial/tokens.ts` / `semantic-tokens.ts` の値と意味。
- accent の系統数、コンテンツ分類の色（design / code / writing / tool）。
- 文字記号 → Material Symbols。
- `/design-system` 以外の route、Home の Reaction Picker 本体
  （`src/home/reactions/widget.tsx`）。
- 全ページ共通の spacing / section rhythm。

## 4. 既知の限界

- 色タイルの swatch は outline を持たないため、`bg.canvas` / `bg.surface` の
  light 値は pane 上でほぼ見えない。これは「地と同じ色である」ことの表示であり、
  hex の読み出しが同定を担う。border を戻すと owner の Q5 に逆行するため戻していない。
- セカンダリーの hover / pressed が中立ランプを出るのは token 不足による暫定。
  中立のまま 3 段を成立させるには `bg.control` 相当の追加が必要。
- 面 band の高さは copy の行数に依存する（1440 で 162.8 / 162.8 / 185.2 px）。
  グリッドの列位置は揃っているが、帯の高さは内容由来。

## 5. 証跡

WebP（PNG なし）。before は `7311a46f`、after は本ブランチ。

- `docs/verification/design/design-system-colour-1440-before.webp` / `...-after.webp`
- `docs/verification/design/design-system-spacing-1440-before.webp` / `...-after.webp`
- `docs/verification/design/design-system-surface-1440-before.webp` / `...-after.webp`
- `docs/verification/design/design-system-interactive-1440-before.webp` / `...-after.webp`
- `docs/verification/design/design-system-colour-390-before.webp` / `...-after.webp`
- `docs/verification/design/design-system-interactive-390-before.webp` / `...-after.webp`

## 6. ゲート

`pnpm run validate:fast`（`.tmp/supervisor/bin/vfast` 経由、直列、2026-11-02）:
67 declared step(s)、exit 0。
